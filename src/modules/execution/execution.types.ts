import type { JsonObject } from '../../shared/types/json';
import type { TaskType } from '../tasks/task.constants';

export interface HandlerContext {
  taskId: string;
  taskType: TaskType;
  payload: JsonObject;
  /** 1-based attempt number. */
  attempt: number;
  /** Aborted when the attempt times out; handlers must stop work when it fires. */
  signal: AbortSignal;
}

export type TaskHandler = (context: HandlerContext) => Promise<JsonObject>;
export type HandlerRegistry = Readonly<Record<TaskType, TaskHandler>>;
