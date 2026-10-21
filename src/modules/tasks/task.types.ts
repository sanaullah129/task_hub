import type { JsonObject } from '../../shared/types/json';
import type { Lease } from '../../shared/types/lease';
import type { AttemptOutcome, TaskStatus, TaskType } from './task.constants';

export interface TaskError {
  code: string;
  message: string;
  retryable: boolean;
}

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
