import { describe, expect, it, vi } from 'vitest';
import { DeliveryWorker } from '../../../../src/modules/delivery/delivery.worker';
import type { DeliveryService } from '../../../../src/modules/delivery/delivery.service';
import type { EventRepository } from '../../../../src/modules/events/event.repository';
import type { EventDocument } from '../../../../src/modules/events/event.types';
import { createLogger } from '../../../../src/observability/logger';
import { buildEventDocument } from '../../../mocks/events/eventFixtures';
import { testConfig } from '../../../mocks/helpers';
import { createLogCapture } from '../../../mocks/logCapture';

type Deliver = DeliveryService['deliver'];

function setup(events: EventDocument[], deliver: Deliver = () => Promise.resolve()) {
  const queue = [...events];
  const claimNextDelivery = vi.fn<EventRepository['claimNextDelivery']>(() => Promise.resolve(queue.shift() ?? null));
  const service = { deliver: vi.fn<Deliver>(deliver) };
  const capture = createLogCapture();
  const worker = new DeliveryWorker({
    events: { claimNextDelivery },
    service,
    config: testConfig({ DELIVERY_CONCURRENCY: '2', DELIVERY_POLL_INTERVAL_MS: '5', DELIVERY_TIMEOUT_MS: '2000', TASK_SHUTDOWN_TIMEOUT_MS: '500' }),
    logger: createLogger({ logLevel: 'info' }, {}, [capture.transport]),
    workerId: 'dlv_test',
  });
  return { worker, claimNextDelivery, service, capture };
}

const events = (count: number): EventDocument[] =>
  Array.from({ length: count }, (_, i) => buildEventDocument({ _id: `evt_${i}`, taskId: `tsk_${i}` }));

describe('DeliveryWorker', () => {
  it('claims due deliveries with a lease longer than the request timeout and delivers each one', async () => {
    const { worker, claimNextDelivery, service } = setup(events(3));

    worker.start();
    await vi.waitFor(() => expect(service.deliver).toHaveBeenCalledTimes(3));
    await worker.stop();

    expect(service.deliver.mock.calls.map(([event]) => event._id)).toEqual(['evt_0', 'evt_1', 'evt_2']);
    expect(claimNextDelivery).toHaveBeenCalledWith(expect.objectContaining({ workerId: 'dlv_test', leaseMs: 7_000 }));
  });

  it('respects the delivery concurrency limit', async () => {
    let running = 0;
    let peak = 0;
    const { worker, service } = setup(events(6), async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 15));
      running -= 1;
    });

    worker.start();
    await vi.waitFor(() => expect(service.deliver).toHaveBeenCalledTimes(6));
    await worker.stop();

    expect(peak).toBe(2);
  });

  it('logs and survives deliveries that could not be recorded', async () => {
    const { worker, capture } = setup(events(2), () => Promise.reject(new Error('db write failed')));

    worker.start();
    await vi.waitFor(() =>
      expect(capture.lines().filter((line) => line['message'] === 'delivery attempt could not be recorded')).toHaveLength(2),
    );
    await worker.stop();

    expect(capture.lines().find((line) => line['message'] === 'delivery attempt could not be recorded')).toMatchObject({ eventId: 'evt_0' });
  });

  it('reports its active count while delivering', async () => {
    let release: () => void = () => undefined;
    const { worker } = setup(events(1), () => new Promise<void>((resolve) => (release = resolve)));

    worker.start();
    await vi.waitFor(() => expect(worker.activeCount).toBe(1));
    release();
    await worker.stop();

    expect(worker.activeCount).toBe(0);
  });
});
