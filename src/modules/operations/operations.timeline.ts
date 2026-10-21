import type { EventDocument } from '../events/event.types';
import type { TaskDocument } from '../tasks/task.types';

export interface TimelineEntry {
  at: Date;
  source: 'task' | 'attempt' | 'event' | 'delivery';
  message: string;
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;

/** Merges task history, execution attempts, events and webhook attempts into one chronological list. */
export function buildTimeline(task: TaskDocument, events: readonly EventDocument[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const step of task.history) {
    entries.push({
      at: step.at,
      source: 'task',
      message: `${step.from ?? 'new'} -> ${step.to}: ${step.reason}`,
    });
  }
  for (const attempt of task.attemptLog) {
    entries.push({ at: attempt.startedAt, source: 'attempt', message: `attempt ${attempt.n} started on ${attempt.workerId}` });
    if (attempt.finishedAt !== null) {
      const detail = attempt.error === undefined ? '' : ` (${attempt.error.code}: ${attempt.error.message})`;
      entries.push({
        at: attempt.finishedAt,
        source: 'attempt',
        message: `attempt ${attempt.n} ended ${attempt.outcome ?? 'unknown'} after ${seconds(attempt.finishedAt.getTime() - attempt.startedAt.getTime())}${detail}`,
      });
    }
  }
  for (const event of events) {
    entries.push({
      at: event.createdAt,
      source: 'event',
      message: `event ${event.eventType} created (${event._id})${event.url === null ? ', no webhook URL so delivery is Skipped' : ` for ${event.url}`}`,
    });
    for (const attempt of event.delivery.attempts) {
      const outcome = attempt.statusCode === undefined ? (attempt.error ?? 'no response') : `HTTP ${attempt.statusCode}`;
      entries.push({
        at: attempt.startedAt,
        source: 'delivery',
        message: `webhook attempt ${attempt.n} for ${event._id}: ${outcome} in ${attempt.durationMs} ms`,
      });
    }
    if (event.delivery.deliveredAt !== null) {
      entries.push({ at: event.delivery.deliveredAt, source: 'delivery', message: `event ${event._id} delivered` });
    }
  }
  return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Plain-language answer to "what happened to this task and its notification?". */
export function explain(task: TaskDocument, events: readonly EventDocument[]): string[] {
  const lines: string[] = [];
  const attempts = `${task.attempts} attempt${task.attempts === 1 ? '' : 's'}`;
  if (task.finishedAt === null) {
    lines.push(`Task is ${task.status} after ${attempts}; it has not reached a terminal state yet.`);
  } else {
    const turnaround = seconds(task.finishedAt.getTime() - task.createdAt.getTime());
    const failure = task.error === null ? '' : ` Failure: ${task.error.code} - ${task.error.message}`;
    lines.push(`Task ${task.status} after ${attempts} in ${turnaround} (SLA ${seconds(task.slaMs)}).${failure}`);
  }

  if (task.eventPending) lines.push('The terminal event has not been created yet; the reconciler will create it.');
  for (const event of events) {
    const { delivery } = event;
    const base = `Event ${event.eventType} (${event._id}) is ${delivery.status} after ${delivery.attemptCount} of ${delivery.maxAttempts} attempts`;
    lines.push(delivery.lastError === null ? `${base}.` : `${base}; last error: ${delivery.lastError}.`);
  }
  if (events.length === 0 && task.finishedAt !== null && !task.eventPending) {
    lines.push('No event exists for this task.');
  }
  return lines;
}
