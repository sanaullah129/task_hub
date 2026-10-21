import type { Metrics } from '../../observability/metrics';
import type { MetricsRepository } from './metrics.repository';
import { percentage, summarizeDurations, type DurationStats } from './metrics.stats';
import { WINDOWS, type WindowKey } from './metrics.window';

export interface MetricMeta {
  definition: string;
  unit: string;
  window: string;
}

export type LatencyMetric = MetricMeta & DurationStats;
export type ValueMetric = MetricMeta & { value: number | null; numerator?: number; denominator?: number };

export interface MetricsSummary {
  window: WindowKey;
  since: string;
  generatedAt: string;
  notes: string[];
  technical: {
    apiRequestRate: ValueMetric & { byRoute: Record<string, number> };
    apiErrorRate5xx: ValueMetric;
    apiClientErrorRate4xx: ValueMetric;
    apiLatency: LatencyMetric & { byRoute: Record<string, DurationStats> };
    queueWait: LatencyMetric;
    executionDuration: LatencyMetric & { byTaskType: Record<string, DurationStats> };
    pendingTasks: ValueMetric;
    activeTasks: ValueMetric;
    webhookAttemptLatency: LatencyMetric;
    webhookAttemptsPerEvent: ValueMetric & { max: number | null };
    webhookFailureRate: ValueMetric;
  };
  business: {
    taskCompletionRate: ValueMetric;
    taskTerminalFailureRate: ValueMetric;
    taskTurnaround: LatencyMetric;
    slaCompliance: ValueMetric & { byTaskType: Record<string, number | null> };
    tasksPerCustomer: MetricMeta & {
      value: Array<{ customerId: string; total: number; byStatus: Record<string, number> }>;
    };
    webhookDeliverySuccessRate: ValueMetric & { pending: number; skipped: number };
    notificationLatency: LatencyMetric;
  };
}

export interface MetricsServiceDeps {
  repository: MetricsRepository;
  metrics: Pick<Metrics, 'apiSamplesSince'>;
  now?: () => Date;
}

const groupBy = <T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = groups.get(key(row)) ?? [];
    bucket.push(row);
    groups.set(key(row), bucket);
  }
  return groups;
};

const statsByKey = <T>(rows: readonly T[], key: (row: T) => string, value: (row: T) => number): Record<string, DurationStats> =>
  Object.fromEntries([...groupBy(rows, key)].map(([name, group]) => [name, summarizeDurations(group.map(value))]));

const ms = (from: Date, to: Date): number => to.getTime() - from.getTime();
const is2xx = (status: number | undefined): boolean => status !== undefined && status >= 200 && status < 300;

export class MetricsService {
  private readonly now: () => Date;

  constructor(private readonly deps: MetricsServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async summary(window: WindowKey): Promise<MetricsSummary> {
    const { repository, metrics } = this.deps;
    const windowMs = WINDOWS[window];
    const generatedAt = this.now();
    const since = new Date(generatedAt.getTime() - windowMs);
    const label = `last ${window}, rolling`;
    const meta = (definition: string, unit: string): MetricMeta => ({ definition, unit, window: label });

    const [queueWaits, attempts, pending, running, terminal, perCustomer, deliveries] = await Promise.all([
      repository.queueWaits(since),
      repository.attempts(since),
      repository.taskCount('Pending'),
      repository.taskCount('Running'),
      repository.terminalTasks(since),
      repository.tasksPerCustomer(since),
      repository.deliveries(since),
    ]);
    const api = metrics.apiSamplesSince(since);

    const apiByRoute = groupBy(api, (sample) => `${sample.method} ${sample.route}`);
    const errors5xx = api.filter((sample) => sample.status >= 500).length;
    const errors4xx = api.filter((sample) => sample.status >= 400 && sample.status < 500).length;

    const webhookAttempts = deliveries.flatMap((delivery) => delivery.attempts);
    const failedWebhookAttempts = webhookAttempts.filter((attempt) => !is2xx(attempt.statusCode)).length;
    const settled = deliveries.filter((delivery) => delivery.status === 'Delivered' || delivery.status === 'Failed');
    const delivered = deliveries.filter((delivery) => delivery.status === 'Delivered');

    const completed = terminal.filter((task) => task.status === 'Completed').length;
    const slaMet = (task: (typeof terminal)[number]): boolean =>
      task.status === 'Completed' && ms(task.createdAt, task.finishedAt) <= task.slaMs;
    const slaByType = Object.fromEntries(
      [...groupBy(terminal, (task) => task.taskType)].map(([type, rows]) => [
        type,
        percentage(rows.filter(slaMet).length, rows.length),
      ]),
    );

    const customers = new Map<string, { total: number; byStatus: Record<string, number> }>();
    for (const row of perCustomer) {
      const entry = customers.get(row.customerId) ?? { total: 0, byStatus: {} };
      entry.total += row.count;
      entry.byStatus[row.status] = (entry.byStatus[row.status] ?? 0) + row.count;
      customers.set(row.customerId, entry);
    }

    const attemptCounts = settled.map((delivery) => delivery.attemptCount);
    const windowSeconds = windowMs / 1000;

    return {
      window,
      since: since.toISOString(),
      generatedAt: generatedAt.toISOString(),
      notes: [
        'Percentiles use the nearest-rank method on exact samples (no histogram approximation).',
        'API metrics come from process-local samples and reset on restart; all other metrics are read from persisted timestamps.',
        'Counts of Pending and Running tasks are instantaneous, not windowed.',
      ],
      technical: {
        apiRequestRate: {
          ...meta('API requests received per second, over the window', 'requests/second'),
          value: Math.round((api.length / windowSeconds) * 10_000) / 10_000,
          numerator: api.length,
          byRoute: Object.fromEntries(
            [...apiByRoute].map(([route, rows]) => [route, Math.round((rows.length / windowSeconds) * 10_000) / 10_000]),
          ),
        },
        apiErrorRate5xx: {
          ...meta('Share of API responses with a 5xx status', 'percent'),
          value: percentage(errors5xx, api.length),
          numerator: errors5xx,
          denominator: api.length,
        },
        apiClientErrorRate4xx: {
          ...meta('Share of API responses with a 4xx status (client errors, reported separately)', 'percent'),
          value: percentage(errors4xx, api.length),
          numerator: errors4xx,
          denominator: api.length,
        },
        apiLatency: {
          ...meta('API response latency from request received to response sent', 'milliseconds'),
          ...summarizeDurations(api.map((sample) => sample.durationMs)),
          byRoute: statsByKey(api, (sample) => `${sample.method} ${sample.route}`, (sample) => sample.durationMs),
        },
        queueWait: {
          ...meta('Time from task creation to the start of its first attempt', 'milliseconds'),
          ...summarizeDurations(queueWaits.map((row) => ms(row.createdAt, row.firstStartedAt))),
        },
        executionDuration: {
          ...meta('Duration of one execution attempt, from claim to outcome', 'milliseconds'),
          ...summarizeDurations(attempts.map((row) => ms(row.startedAt, row.finishedAt))),
          byTaskType: statsByKey(attempts, (row) => row.taskType, (row) => ms(row.startedAt, row.finishedAt)),
        },
        pendingTasks: { ...meta('Tasks currently Pending (queue depth)', 'tasks'), value: pending },
        activeTasks: { ...meta('Tasks currently Running', 'tasks'), value: running },
        webhookAttemptLatency: {
          ...meta('Webhook request latency from request sent to response received (or failure)', 'milliseconds'),
          ...summarizeDurations(webhookAttempts.map((attempt) => attempt.durationMs)),
        },
        webhookAttemptsPerEvent: {
          ...meta('Delivery attempts used by events that reached Delivered or Failed', 'attempts per event'),
          value:
            attemptCounts.length === 0
              ? null
              : Math.round((attemptCounts.reduce((a, b) => a + b, 0) / attemptCounts.length) * 100) / 100,
          max: attemptCounts.length === 0 ? null : Math.max(...attemptCounts),
          denominator: attemptCounts.length,
        },
        webhookFailureRate: {
          ...meta('Share of webhook attempts that did not get a 2xx response', 'percent'),
          value: percentage(failedWebhookAttempts, webhookAttempts.length),
          numerator: failedWebhookAttempts,
          denominator: webhookAttempts.length,
        },
      },
      business: {
        taskCompletionRate: {
          ...meta('Share of tasks that finished in the window and ended Completed', 'percent'),
          value: percentage(completed, terminal.length),
          numerator: completed,
          denominator: terminal.length,
        },
        taskTerminalFailureRate: {
          ...meta('Share of tasks that finished in the window and ended Failed or TimedOut', 'percent'),
          value: percentage(terminal.length - completed, terminal.length),
          numerator: terminal.length - completed,
          denominator: terminal.length,
        },
        taskTurnaround: {
          ...meta('Time from task creation to its terminal state', 'milliseconds'),
          ...summarizeDurations(terminal.map((task) => ms(task.createdAt, task.finishedAt))),
        },
        slaCompliance: {
          ...meta('Share of finished tasks that Completed within their per-type SLA turnaround target', 'percent'),
          value: percentage(terminal.filter(slaMet).length, terminal.length),
          numerator: terminal.filter(slaMet).length,
          denominator: terminal.length,
          byTaskType: slaByType,
        },
        tasksPerCustomer: {
          ...meta('Tasks submitted in the window, grouped by customer and current status', 'tasks'),
          value: [...customers]
            .map(([customerId, entry]) => ({ customerId, ...entry }))
            .sort((a, b) => b.total - a.total),
        },
        webhookDeliverySuccessRate: {
          ...meta('Share of events created in the window that ended Delivered, among those that ended Delivered or Failed', 'percent'),
          value: percentage(delivered.length, settled.length),
          numerator: delivered.length,
          denominator: settled.length,
          pending: deliveries.filter((delivery) => delivery.status === 'Pending').length,
          skipped: deliveries.filter((delivery) => delivery.status === 'Skipped').length,
        },
        notificationLatency: {
          ...meta('End-to-end notification latency from task terminal state to successful webhook delivery', 'milliseconds'),
          ...summarizeDurations(
            delivered.flatMap((delivery) =>
              delivery.deliveredAt === null ? [] : [ms(delivery.taskFinishedAt, delivery.deliveredAt)],
            ),
          ),
        },
      },
    };
  }
}
