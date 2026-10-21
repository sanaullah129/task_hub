import type { JsonObject } from '../../shared/types/json';
import type { Lease } from '../../shared/types/lease';
import type { DeliveryStatus, EventType } from './event.constants';

export interface EventBody {
  eventId: string;
  eventType: EventType;
  taskId: string;
  customerId: string;
  timestamp: string;
  data: JsonObject;
  correlationId: string;
}

export interface DeliveryAttempt {
  n: number;
  startedAt: Date;
  durationMs: number;
  statusCode?: number;
  error?: string;
  responseSnippet?: string;
}

export interface Delivery {
  status: DeliveryStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: Date | null;
  lease: Lease | null;
  attempts: DeliveryAttempt[];
  deliveredAt: Date | null;
  lastError: string | null;
}

export interface EventDocument {
  _id: string;
  taskId: string;
  customerId: string;
  eventType: EventType;
  correlationId: string;
  body: EventBody;
  url: string | null;
  createdAt: Date;
  delivery: Delivery;
}
