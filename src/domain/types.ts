export const TASK_TYPES = ['document_processing', 'report_generation', 'data_sync'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ['Pending', 'Running', 'Completed', 'Failed', 'TimedOut'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_STATUSES = ['Completed', 'Failed', 'TimedOut'] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export const EVENT_TYPES = ['task.completed', 'task.failed', 'task.timed_out'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const DELIVERY_STATUSES = ['Pending', 'Delivered', 'Failed', 'Skipped'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;
// Interfaces (not recursive aliases) keep the type lazy; aliases trigger TS2589 in Mongoose schemas.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface JsonArray extends Array<JsonValue> {}
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface Lease {
  workerId: string;
  expiresAt: Date;
}

export interface TaskError {
  code: string;
  message: string;
  retryable: boolean;
}

export type AttemptOutcome = 'Completed' | 'Failed' | 'TimedOut' | 'Abandoned';

export interface AttemptLogEntry {
  n: number;
  workerId: string;
  startedAt: Date;
  finishedAt: Date | null;
  outcome: AttemptOutcome | null;
  error?: TaskError;
}

export interface HistoryEntry {
  from: TaskStatus | null;
  to: TaskStatus;
  at: Date;
  reason: string;
}

export interface TaskDocument {
  _id: string;
  customerId: string;
  taskType: TaskType;
  payload: JsonObject;
  payloadHash: string;
  idempotencyKey: string;
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
  timeoutMs: number;
  slaMs: number;
  webhookUrl: string | null;
  correlationId: string;
  nextRunAt: Date;
  lease: Lease | null;
  result: JsonObject | null;
  error: TaskError | null;
  attemptLog: AttemptLogEntry[];
  history: HistoryEntry[];
  eventEmitted: boolean;
  createdAt: Date;
  updatedAt: Date;
  firstStartedAt: Date | null;
  finishedAt: Date | null;
}

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

export interface CustomerWebhook {
  url: string;
  secret: string;
}

export interface CustomerDocument {
  _id: string;
  webhook: CustomerWebhook | null;
  createdAt: Date;
  updatedAt: Date;
}
