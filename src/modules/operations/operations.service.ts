import { NotFoundError } from '../../shared/errors/appErrors';
import type { EventRepository } from '../events/event.repository';
import { toEventView } from '../events/event.view';
import type { TaskRepository } from '../tasks/task.repository';
import { toTaskView } from '../tasks/task.view';
import { buildTimeline, explain } from './operations.timeline';

export class OperationsService {
  constructor(
    private readonly deps: { tasks: Pick<TaskRepository, 'findById'>; events: Pick<EventRepository, 'findByTaskId'> },
  ) {}

  async investigate(taskId: string) {
    const task = await this.deps.tasks.findById(taskId);
    if (task === null) throw new NotFoundError('task', taskId);
    const events = await this.deps.events.findByTaskId(taskId);

    return {
      summary: explain(task, events),
      task: {
        ...toTaskView(task),
        idempotencyKey: task.idempotencyKey,
        payload: task.payload,
        timeoutMs: task.timeoutMs,
        slaMs: task.slaMs,
        webhookUrl: task.webhookUrl,
        eventPending: task.eventPending,
        lease: task.lease,
        history: task.history,
      },
      events: events.map(toEventView),
      timeline: buildTimeline(task, events),
      logCorrelation: {
        correlationId: task.correlationId,
        hint: 'Filter structured logs on this correlationId to see submission, execution, and delivery log lines.',
      },
    };
  }
}
