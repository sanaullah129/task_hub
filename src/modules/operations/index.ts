import type { Router } from 'express';
import type { EventRepository } from '../events/event.repository';
import type { TaskRepository } from '../tasks/task.repository';
import { createOperationsRouter } from './operations.routes';
import { OperationsService } from './operations.service';

export function createOperationsModule(deps: {
  tasks: Pick<TaskRepository, 'findById'>;
  events: Pick<EventRepository, 'findByTaskId'>;
}): { service: OperationsService; router: Router } {
  const service = new OperationsService(deps);
  return { service, router: createOperationsRouter(service) };
}

export { OperationsService } from './operations.service';
export { buildTimeline, explain, type TimelineEntry } from './operations.timeline';
