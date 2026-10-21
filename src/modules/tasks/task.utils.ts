import { createHash } from 'node:crypto';
import { canonicalJson } from '../../shared/utils/canonicalJson';
import { prefixedId } from '../../shared/utils/ids';
import type { JsonValue } from '../../shared/types/json';
import type { TaskType } from './task.constants';

export const newTaskId = (): string => prefixedId('tsk');

export function hashTaskRequest(taskType: TaskType, payload: JsonValue): string {
  return createHash('sha256').update(canonicalJson({ taskType, payload })).digest('hex');
}
