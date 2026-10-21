import { describe, expect, it } from 'vitest';
import { createMetrics, noopMetrics } from '../../../src/observability/metrics';

describe('createMetrics', () => {
  it('keeps exact API samples within the requested window', () => {
    let clock = new Date('2026-10-21T10:00:00.000Z');
    const metrics = createMetrics({ now: () => clock });

    metrics.recordHttpRequest({ method: 'GET', route: '/v1/tasks/:taskId', status: 200, durationMs: 12 });
    clock = new Date('2026-10-21T10:10:00.000Z');
    metrics.recordHttpRequest({ method: 'POST', route: '/v1/tasks', status: 500, durationMs: 40 });

    const recent = metrics.apiSamplesSince(new Date('2026-10-21T10:05:00.000Z'));
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ method: 'POST', route: '/v1/tasks', status: 500, durationMs: 40 });
    expect(metrics.apiSamplesSince(new Date('2026-10-21T09:00:00.000Z'))).toHaveLength(2);
  });

  it('caps the number of retained API samples', () => {
    const metrics = createMetrics({ maxApiSamples: 3 });

    for (let i = 0; i < 10; i++) metrics.recordHttpRequest({ method: 'GET', route: '/x', status: 200, durationMs: i });

    expect(metrics.apiSamplesSince(new Date(0)).map((sample) => sample.durationMs)).toEqual([7, 8, 9]);
  });

  it('renders Prometheus text with the recorded series', async () => {
    const metrics = createMetrics();
    metrics.recordHttpRequest({ method: 'GET', route: '/healthz', status: 200, durationMs: 5 });
    metrics.recordAttempt({ taskType: 'data_sync', outcome: 'success', durationMs: 120 });
    metrics.recordTaskTerminal({ taskType: 'data_sync', status: 'Completed' });
    metrics.recordWebhookAttempt({ outcome: 'failure', durationMs: 30 });

    const text = await metrics.render();

    expect(metrics.contentType).toContain('text/plain');
    expect(text).toContain('taskhub_http_requests_total{method="GET",route="/healthz",status="200"} 1');
    expect(text).toContain('taskhub_http_request_duration_seconds_bucket');
    expect(text).toContain('taskhub_task_attempt_duration_seconds_count{task_type="data_sync",outcome="success"} 1');
    expect(text).toContain('taskhub_tasks_terminal_total{task_type="data_sync",status="Completed"} 1');
    expect(text).toContain('taskhub_webhook_attempts_total{outcome="failure"} 1');
    expect(text).toContain('taskhub_webhook_attempt_duration_seconds_bucket');
  });

  it('samples queue depth gauges at scrape time when a source is given', async () => {
    const counts = { Pending: 7, Running: 2 };
    const metrics = createMetrics({ taskCount: (status) => Promise.resolve(counts[status]) });

    const text = await metrics.render();

    expect(text).toContain('taskhub_tasks_in_state{status="Pending"} 7');
    expect(text).toContain('taskhub_tasks_in_state{status="Running"} 2');
  });

  it('omits the gauge when no source is given', async () => {
    expect(await createMetrics().render()).not.toContain('taskhub_tasks_in_state');
  });
});

describe('noopMetrics', () => {
  it('accepts every call and reports nothing', async () => {
    noopMetrics.recordHttpRequest({ method: 'GET', route: '/', status: 200, durationMs: 1 });
    noopMetrics.recordAttempt({ taskType: 'x', outcome: 'success', durationMs: 1 });
    noopMetrics.recordTaskTerminal({ taskType: 'x', status: 'Completed' });
    noopMetrics.recordWebhookAttempt({ outcome: 'success', durationMs: 1 });

    expect(noopMetrics.apiSamplesSince(new Date(0))).toEqual([]);
    expect(await noopMetrics.render()).toBe('');
  });
});
