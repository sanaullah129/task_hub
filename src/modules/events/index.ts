import type { Router } from 'express';
import { createEventController } from './event.controller';
import { createEventRouter } from './event.routes';
import type { EventService } from './event.service';

export function createEventsModule(service: EventService): { router: Router } {
  return { router: createEventRouter(createEventController(service)) };
}

export { eventSchema } from './event.model';
export { DELIVERY_STATUSES, EVENT_TYPES, type DeliveryStatus, type EventType } from './event.constants';
export { eventTypeForStatus, newEventId } from './event.utils';
export {
  MongooseEventRepository,
  type DeliveryClaimOptions,
  type DeliveryResult,
  type EventListQuery,
  type EventPage,
  type EventRepository,
} from './event.repository';
export { EventService, type EventServiceDeps, type TaskEventMarker } from './event.service';
export { toEventView } from './event.view';
export type { Delivery, DeliveryAttempt, EventBody, EventDocument } from './event.types';
