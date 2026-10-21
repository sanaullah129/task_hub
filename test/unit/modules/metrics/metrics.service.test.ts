import { describe, expect, it } from 'vitest';
import { MetricsService } from '../../../../src/modules/metrics/metrics.service';
import type { DeliveryRow, TerminalTaskRow } from '../../../../src/modules/metrics/metrics.repository';
import { createMetrics } from '../../../../src/observability/metrics';
import { FakeMetricsRepository } from '../../../mocks/metricsRepository';
import { FIXED_NOW } from '../../../mocks/tasks/taskFixtures';

const at = (offsetMs: number): Date => new Date(FIXED_NOW.getTime() + offsetMs);

const terminal = (
  taskType: TerminalTaskRow['taskType'],
  status: TerminalTaskRow['status'],
  turnaroundMs: number,
  customerId = 'cust_a',
): TerminalTaskRow => ({ taskType, customerId, status, slaMs: 60_000, createdAt: FIXED_NOW, finishedAt: at(turnaroundMs) });

const delivery = (overrides: Partial<DeliveryRow>): DeliveryRow => ({
  status: 'Delivered',
  attemptCount: 1,
  attempts: [{ durationMs: 10, statusCode: 200 }],
  deliveredAt: at(1_500),
  taskFinishedAt: at(1_000),
  ...overrides,
});

function build(clock = at(3_600_000)) {
  const apiMetrics = createMetrics({ now: () => clock });
  apiMetrics.recordHttpRequest({ method: 'POST', route: '/v1/tasks', status: 202, durationMs: 20 });
  apiMetrics.recordHttpRequest({ method: 'POST', route: '/v1/tasks', status: 400, durationMs: 10 });
  apiMetrics.recordHttpRequest({ method: 'GET', route: '/v1/tasks/:taskId', status: 200, durationMs: 5 });
  apiMetrics.recordHttpRequest({ method: 'GET', route: '/v1/tasks/:taskId', status: 500, durationMs: 100 });

  const repository = new FakeMetricsRepository({
    queueWaits: [100, 200, 300, 400].map((ms) => ({ taskType: 'data_sync' as const, createdAt: FIXED_NOW, firstStartedAt: at(ms) })),
    attempts: [
      { taskType: 'data_sync', startedAt: FIXED_NOW, finishedAt: at(50), outcome: 'Completed' },
      { taskType: 'data_sync', startedAt: FIXED_NOW, finishedAt: at(150), outcome: 'Failed' },
      { taskType: 'report_generation', startedAt: FIXED_NOW, finishedAt: at(250), outcome: 'Completed' },
    ],
    pending: 3,
    running: 1,
    terminal: [
      terminal('data_sync', 'Completed', 1_000),
      terminal('data_sync', 'Completed', 2_000, 'cust_b'),
      terminal('report_generation', 'Completed', 70_000),
      terminal('report_generation', 'Failed', 500),
    ],
    perCustomer: [
      { customerId: 'cust_a', status: 'Completed', count: 2 },
      { customerId: 'cust_a', status: 'Failed', count: 1 },
      { customerId: 'cust_b', status: 'Completed', count: 5 },
    ],
    deliveries: [
      delivery({}),
      delivery({
        attemptCount: 3,
        attempts: [
          { durationMs: 30, statusCode: 500 },
          { durationMs: 20, error: 'ECONNREFUSED' },
          { durationMs: 10, statusCode: 200 },
        ],
        deliveredAt: at(4_000),
      }),
      delivery({ status: 'Failed', attemptCount: 6, attempts: [{ durationMs: 40, statusCode: 500 }], deliveredAt: null }),
      delivery({ status: 'Pending', attemptCount: 0, attempts: [], deliveredAt: null }),
      delivery({ status: 'Skipped', attemptCount: 0, attempts: [], deliveredAt: null }),
    ],
  });
  return { repository, service: new MetricsService({ repository, metrics: apiMetrics, now: () => clock }) };
}

describe('MetricsService.summary', () => {
  it('describes the window and how percentiles are computed', async () => {
    const { service, repository } = build();

    const summary = await service.summary('1h');

    expect(summary.window).toBe('1h');
    expect(summary.generatedAt).toBe(at(3_600_000).toISOString());
    expect(summary.since).toBe(at(0).toISOString());
    expect(repository.requestedSince[0]).toEqual(at(0));
    expect(summary.notes.join(' ')).toContain('nearest-rank');
  });

  it('states a definition, unit and window for every metric', async () => {
    const { service } = build();
    const summary = await service.summary('1h');

    for (const group of [summary.technical, summary.business]) {
      for (const [name, metric] of Object.entries(group)) {
        expect(metric, name).toMatchObject({ definition: expect.any(String) as string, unit: expect.any(String) as string, window: 'last 1h, rolling' });
      }
    }
  });

  it('computes API rate, error rates and exact latency percentiles', async () => {
    const { technical } = await build().service.summary('1h');

    expect(technical.apiRequestRate).toMatchObject({ value: 0.0011, numerator: 4, unit: 'requests/second' });
    expect(technical.apiRequestRate.byRoute).toEqual({ 'POST /v1/tasks': 0.0006, 'GET /v1/tasks/:taskId': 0.0006 });
    expect(technical.apiErrorRate5xx).toMatchObject({ value: 25, numerator: 1, denominator: 4, unit: 'percent' });
    expect(technical.apiClientErrorRate4xx).toMatchObject({ value: 25, numerator: 1 });
    expect(technical.apiLatency).toMatchObject({ count: 4, p50: 10, p96: 100, p99: 100, max: 100 });
    expect(technical.apiLatency.byRoute['GET /v1/tasks/:taskId']).toMatchObject({ count: 2, p50: 5, max: 100 });
  });

  it('computes queue wait, execution duration and the live task counts', async () => {
    const { technical } = await build().service.summary('1h');

    expect(technical.queueWait).toMatchObject({ count: 4, p50: 200, p96: 400, p99: 400, unit: 'milliseconds' });
    expect(technical.executionDuration).toMatchObject({ count: 3, p50: 150, max: 250 });
    expect(technical.executionDuration.byTaskType['data_sync']).toMatchObject({ count: 2, max: 150 });
    expect(technical.executionDuration.byTaskType['report_generation']).toMatchObject({ count: 1, p50: 250 });
    expect(technical.pendingTasks.value).toBe(3);
    expect(technical.activeTasks.value).toBe(1);
  });

  it('computes webhook latency, attempts per event and failure rate', async () => {
    const { technical } = await build().service.summary('1h');

    expect(technical.webhookAttemptLatency).toMatchObject({ count: 5, p50: 20, max: 40 });
    expect(technical.webhookAttemptsPerEvent).toMatchObject({ value: 3.33, max: 6, denominator: 3 });
    expect(technical.webhookFailureRate).toMatchObject({ value: 60, numerator: 3, denominator: 5 });
  });

  it('computes completion, failure, turnaround and SLA figures for finished tasks', async () => {
    const { business } = await build().service.summary('1h');

    expect(business.taskCompletionRate).toMatchObject({ value: 75, numerator: 3, denominator: 4 });
    expect(business.taskTerminalFailureRate).toMatchObject({ value: 25, numerator: 1 });
    expect(business.taskTurnaround).toMatchObject({ count: 4, p50: 1_000, p96: 70_000, max: 70_000 });
    expect(business.slaCompliance).toMatchObject({ value: 50, numerator: 2, denominator: 4 });
    expect(business.slaCompliance.byTaskType).toEqual({ data_sync: 100, report_generation: 0 });
  });

  it('groups tasks per customer by status, largest first', async () => {
    const { business } = await build().service.summary('1h');

    expect(business.tasksPerCustomer.value).toEqual([
      { customerId: 'cust_b', total: 5, byStatus: { Completed: 5 } },
      { customerId: 'cust_a', total: 3, byStatus: { Completed: 2, Failed: 1 } },
    ]);
  });

  it('computes delivery success among settled events and end-to-end notification latency', async () => {
    const { business } = await build().service.summary('1h');

    expect(business.webhookDeliverySuccessRate).toMatchObject({ value: 66.67, numerator: 2, denominator: 3, pending: 1, skipped: 1 });
    expect(business.notificationLatency).toMatchObject({ count: 2, p50: 500, max: 3_000 });
  });

  it('reports nulls and zero counts when nothing happened', async () => {
    const empty = new MetricsService({
      repository: new FakeMetricsRepository(),
      metrics: createMetrics(),
      now: () => FIXED_NOW,
    });

    const { technical, business } = await empty.summary('5m');

    expect(technical.apiLatency).toMatchObject({ count: 0, p50: null });
    expect(technical.apiErrorRate5xx.value).toBeNull();
    expect(technical.webhookAttemptsPerEvent).toMatchObject({ value: null, max: null });
    expect(business.taskCompletionRate.value).toBeNull();
    expect(business.slaCompliance.byTaskType).toEqual({});
    expect(business.tasksPerCustomer.value).toEqual([]);
    expect(business.webhookDeliverySuccessRate).toMatchObject({ value: null, pending: 0, skipped: 0 });
  });

  it('uses the real clock when none is injected', async () => {
    const service = new MetricsService({ repository: new FakeMetricsRepository(), metrics: createMetrics() });

    const summary = await service.summary('15m');

    expect(Math.abs(Date.parse(summary.generatedAt) - Date.now())).toBeLessThan(5_000);
    expect(Date.parse(summary.generatedAt) - Date.parse(summary.since)).toBe(15 * 60_000);
  });
});
