import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export interface HttpSample {
  method: string;
  route: string;
  status: number;
  durationMs: number;
  at: Date;
}

export interface Metrics {
  recordHttpRequest(sample: Omit<HttpSample, 'at'>): void;
  recordAttempt(sample: { taskType: string; outcome: string; durationMs: number }): void;
  recordTaskTerminal(sample: { taskType: string; status: string }): void;
  recordWebhookAttempt(sample: { outcome: 'success' | 'failure'; durationMs: number }): void;
  /** Process-local request samples, used for exact API percentiles in the summary endpoint. */
  apiSamplesSince(since: Date): HttpSample[];
  render(): Promise<string>;
  readonly contentType: string;
}

export const noopMetrics: Metrics = {
  recordHttpRequest: () => undefined,
  recordAttempt: () => undefined,
  recordTaskTerminal: () => undefined,
  recordWebhookAttempt: () => undefined,
  apiSamplesSince: () => [],
  render: () => Promise.resolve(''),
  contentType: 'text/plain',
};

export interface MetricsOptions {
  now?: () => Date;
  maxApiSamples?: number;
  /** Live gauges sampled at scrape time. */
  taskCount?: (status: 'Pending' | 'Running') => Promise<number>;
}

const SECONDS_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];

export function createMetrics(options: MetricsOptions = {}): Metrics {
  const now = options.now ?? (() => new Date());
  const maxApiSamples = options.maxApiSamples ?? 50_000;
  const registry = new Registry();
  const samples: HttpSample[] = [];

  const httpRequests = new Counter({
    name: 'taskhub_http_requests_total',
    help: 'API requests received, by method, route and status.',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });
  const httpDuration = new Histogram({
    name: 'taskhub_http_request_duration_seconds',
    help: 'API response latency in seconds, from request received to response sent.',
    labelNames: ['method', 'route'],
    buckets: SECONDS_BUCKETS,
    registers: [registry],
  });
  const attemptDuration = new Histogram({
    name: 'taskhub_task_attempt_duration_seconds',
    help: 'Task execution attempt duration in seconds.',
    labelNames: ['task_type', 'outcome'],
    buckets: SECONDS_BUCKETS,
    registers: [registry],
  });
  const taskTerminal = new Counter({
    name: 'taskhub_tasks_terminal_total',
    help: 'Tasks that reached a terminal state.',
    labelNames: ['task_type', 'status'],
    registers: [registry],
  });
  const webhookDuration = new Histogram({
    name: 'taskhub_webhook_attempt_duration_seconds',
    help: 'Webhook delivery attempt latency in seconds, from request sent to response received.',
    labelNames: ['outcome'],
    buckets: SECONDS_BUCKETS,
    registers: [registry],
  });
  const webhookAttempts = new Counter({
    name: 'taskhub_webhook_attempts_total',
    help: 'Webhook delivery attempts, by outcome.',
    labelNames: ['outcome'],
    registers: [registry],
  });

  const taskCount = options.taskCount;
  if (taskCount !== undefined) {
    const queueGauge = new Gauge({
      name: 'taskhub_tasks_in_state',
      help: 'Tasks currently Pending (queue depth) or Running (active).',
      labelNames: ['status'],
      registers: [registry],
      async collect(): Promise<void> {
        const [pending, running] = await Promise.all([taskCount('Pending'), taskCount('Running')]);
        queueGauge.set({ status: 'Pending' }, pending);
        queueGauge.set({ status: 'Running' }, running);
      },
    });
  }

  return {
    recordHttpRequest(sample) {
      httpRequests.inc({ method: sample.method, route: sample.route, status: String(sample.status) });
      httpDuration.observe({ method: sample.method, route: sample.route }, sample.durationMs / 1000);
      samples.push({ ...sample, at: now() });
      if (samples.length > maxApiSamples) samples.splice(0, samples.length - maxApiSamples);
    },
    recordAttempt({ taskType, outcome, durationMs }) {
      attemptDuration.observe({ task_type: taskType, outcome }, durationMs / 1000);
    },
    recordTaskTerminal({ taskType, status }) {
      taskTerminal.inc({ task_type: taskType, status });
    },
    recordWebhookAttempt({ outcome, durationMs }) {
      webhookAttempts.inc({ outcome });
      webhookDuration.observe({ outcome }, durationMs / 1000);
    },
    apiSamplesSince: (since) => samples.filter((sample) => sample.at >= since),
    render: () => registry.metrics(),
    contentType: registry.contentType,
  };
}
