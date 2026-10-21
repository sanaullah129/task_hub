import type { Config } from '../../config/config';
import type { Logger } from '../../observability/logger';
import { PollingWorker } from '../../shared/workers/pollingWorker';
import type { EventRepository } from '../events/event.repository';
import type { EventDocument } from '../events/event.types';
import type { DeliveryService } from './delivery.service';

const LEASE_GRACE_MS = 5_000;

export interface DeliveryWorkerDeps {
  events: Pick<EventRepository, 'claimNextDelivery'>;
  service: Pick<DeliveryService, 'deliver'>;
  config: Pick<Config, 'delivery' | 'task'>;
  logger: Logger;
  workerId: string;
  now?: () => Date;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

export class DeliveryWorker {
  private readonly worker: PollingWorker<EventDocument>;

  constructor(deps: DeliveryWorkerDeps) {
    const now = deps.now ?? (() => new Date());
    const { delivery, task } = deps.config;
    this.worker = new PollingWorker<EventDocument>({
      name: 'delivery worker',
      workerId: deps.workerId,
      logger: deps.logger,
      claim: () =>
        deps.events.claimNextDelivery({
          workerId: deps.workerId,
          now: now(),
          leaseMs: delivery.timeoutMs + LEASE_GRACE_MS,
        }),
      process: (event) => deps.service.deliver(event),
      describe: (event) => ({ eventId: event._id, taskId: event.taskId }),
      concurrency: delivery.concurrency,
      pollIntervalMs: delivery.pollIntervalMs,
      shutdownTimeoutMs: task.shutdownTimeoutMs,
      claimErrorMessage: 'failed to claim delivery',
      processErrorMessage: 'delivery attempt could not be recorded',
      sleep: deps.sleep,
      random: deps.random,
    });
  }

  get activeCount(): number {
    return this.worker.activeCount;
  }

  start(): void {
    this.worker.start();
  }

  stop(): Promise<void> {
    return this.worker.stop();
  }
}
