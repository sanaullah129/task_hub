import request, { type Response } from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTimeline, explain } from '../../../../src/modules/operations/operations.timeline';
import { buildHarness } from '../../../mocks/harness';
import { buildEventDocument } from '../../../mocks/events/eventFixtures';
import { FIXED_NOW, buildTaskDocument } from '../../../mocks/tasks/taskFixtures';

const at = (offsetMs: number): Date => new Date(FIXED_NOW.getTime() + offsetMs);

const completedTask = () =>
  buildTaskDocument({
    status: 'Completed',
    attempts: 2,
    firstStartedAt: at(100),
    finishedAt: at(2_000),
    attemptLog: [
      { n: 1, workerId: 'wrk_1', startedAt: at(100), finishedAt: at(600), outcome: 'Failed', error: { code: 'simulated_failure', message: 'flaky', retryable: true } },
      { n: 2, workerId: 'wrk_1', startedAt: at(1_500), finishedAt: at(2_000), outcome: 'Completed' },
    ],
    history: [
      { from: null, to: 'Pending', at: FIXED_NOW, reason: 'submitted' },
      { from: 'Pending', to: 'Running', at: at(100), reason: 'claimed by wrk_1 (attempt 1)' },
      { from: 'Running', to: 'Pending', at: at(600), reason: 'attempt 1 failed, retry in 900 ms' },
      { from: 'Pending', to: 'Running', at: at(1_500), reason: 'claimed by wrk_1 (attempt 2)' },
      { from: 'Running', to: 'Completed', at: at(2_000), reason: 'attempt 2 succeeded' },
    ],
  });

const deliveredEvent = () => {
  const base = buildEventDocument();
  return buildEventDocument({
    createdAt: at(2_100),
    delivery: {
      ...base.delivery,
      status: 'Delivered',
      attemptCount: 2,
      deliveredAt: at(4_200),
      attempts: [
        { n: 1, startedAt: at(2_200), durationMs: 30, statusCode: 503 },
        { n: 2, startedAt: at(4_000), durationMs: 20, statusCode: 200 },
      ],
    },
  });
};

describe('buildTimeline', () => {
  it('merges task history, attempts, events and webhook attempts in time order', () => {
    const timeline = buildTimeline(completedTask(), [deliveredEvent()]);

    const sources = timeline.map((entry) => entry.source);
    expect(sources[0]).toBe('task');
    expect(timeline.map((entry) => entry.at.getTime())).toEqual([...timeline.map((entry) => entry.at.getTime())].sort((a, b) => a - b));
    expect(timeline.map((entry) => entry.message)).toEqual(
      expect.arrayContaining([
        'new -> Pending: submitted',
        'attempt 1 started on wrk_1',
        'attempt 1 ended Failed after 0.50s (simulated_failure: flaky)',
        'attempt 2 ended Completed after 0.50s',
        expect.stringContaining('event task.completed created') as string,
        'webhook attempt 1 for evt_00000000-0000-0000-0000-000000000001: HTTP 503 in 30 ms',
        'webhook attempt 2 for evt_00000000-0000-0000-0000-000000000001: HTTP 200 in 20 ms',
        'event evt_00000000-0000-0000-0000-000000000001 delivered',
      ]),
    );
    expect(timeline.at(-1)?.message).toContain('delivered');
  });

  it('describes network failures, unfinished attempts and events without a URL', () => {
    const task = buildTaskDocument({
      attemptLog: [{ n: 1, workerId: 'wrk_1', startedAt: at(10), finishedAt: null, outcome: null }],
      history: [],
    });
    const base = buildEventDocument({ url: null });
    const event = buildEventDocument({
      url: null,
      delivery: { ...base.delivery, status: 'Skipped', attempts: [{ n: 1, startedAt: at(20), durationMs: 2, error: 'ECONNREFUSED' }] },
    });

    const messages = buildTimeline(task, [event]).map((entry) => entry.message);

    expect(messages).toContain('attempt 1 started on wrk_1');
    expect(messages.some((message) => message.includes('ended'))).toBe(false);
    expect(messages.some((message) => message.includes('no webhook URL'))).toBe(true);
    expect(messages.some((message) => message.includes('ECONNREFUSED in 2 ms'))).toBe(true);
  });

  it('shows "no response" when an attempt has neither status nor error', () => {
    const base = buildEventDocument();
    const event = buildEventDocument({ delivery: { ...base.delivery, attempts: [{ n: 1, startedAt: at(1), durationMs: 1 }] } });

    expect(buildTimeline(buildTaskDocument(), [event]).some((entry) => entry.message.includes('no response'))).toBe(true);
  });

  it('formats long durations in seconds with one decimal', () => {
    const task = buildTaskDocument({
      attemptLog: [{ n: 1, workerId: 'w', startedAt: FIXED_NOW, finishedAt: at(12_000), outcome: 'TimedOut' }],
    });

    expect(buildTimeline(task, []).some((entry) => entry.message.includes('after 12.0s'))).toBe(true);
  });
});

describe('explain', () => {
  it('summarises a completed task and a delivered event', () => {
    const lines = explain(completedTask(), [deliveredEvent()]);

    expect(lines[0]).toBe('Task Completed after 2 attempts in 2.00s (SLA 60.0s).');
    expect(lines[1]).toBe('Event task.completed (evt_00000000-0000-0000-0000-000000000001) is Delivered after 2 of 6 attempts.');
  });

  it('includes the failure and the last delivery error', () => {
    const task = buildTaskDocument({ status: 'Failed', attempts: 1, finishedAt: at(1_000), error: { code: 'simulated_fatal', message: 'nope', retryable: false } });
    const base = buildEventDocument();
    const event = buildEventDocument({ delivery: { ...base.delivery, status: 'Failed', attemptCount: 6, lastError: 'HTTP 500 (attempts exhausted)' } });

    const lines = explain(task, [event]);

    expect(lines[0]).toContain('Failure: simulated_fatal - nope');
    expect(lines[0]).toContain('1 attempt ');
    expect(lines[1]).toContain('last error: HTTP 500 (attempts exhausted).');
  });

  it('explains non-terminal tasks, pending events and missing events', () => {
    expect(explain(buildTaskDocument({ status: 'Running', attempts: 1 }), [])[0]).toContain('has not reached a terminal state yet');
    expect(explain(buildTaskDocument({ status: 'Completed', finishedAt: at(1), eventPending: true }), []).join(' ')).toContain('reconciler will create it');
    expect(explain(buildTaskDocument({ status: 'Completed', finishedAt: at(1), eventPending: false }), []).join(' ')).toContain('No event exists');
  });
});

describe('GET /v1/ops/tasks/:taskId/investigation', () => {
  const bodyOf = (res: Response): Record<string, unknown> => res.body as Record<string, unknown>;

  it('returns the task, events, timeline and a plain-language summary in one call', async () => {
    const harness = buildHarness();
    const task = completedTask();
    harness.tasks.tasks.set(task._id, task);
    harness.events.add(deliveredEvent());

    const res = await request(harness.app).get(`/v1/ops/tasks/${task._id}/investigation`);

    expect(res.status).toBe(200);
    expect(bodyOf(res)['summary']).toHaveLength(2);
    expect(bodyOf(res)['task']).toMatchObject({ taskId: task._id, status: 'Completed', payload: { documentId: 'doc_1' }, idempotencyKey: 'idem_1', correlationId: 'cor_1' });
    expect((bodyOf(res)['task'] as { history: unknown[] }).history).toHaveLength(5);
    expect(bodyOf(res)['events']).toHaveLength(1);
    expect((bodyOf(res)['timeline'] as unknown[]).length).toBeGreaterThan(8);
    expect(bodyOf(res)['logCorrelation']).toMatchObject({ correlationId: 'cor_1' });
  });

  it('returns 404 for an unknown task', async () => {
    const res = await request(buildHarness().app).get('/v1/ops/tasks/tsk_missing/investigation');

    expect(res.status).toBe(404);
  });
});
