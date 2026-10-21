import { randomUUID } from 'node:crypto';

export const newTaskId = (): string => `tsk_${randomUUID()}`;
export const newEventId = (): string => `evt_${randomUUID()}`;
export const newCorrelationId = (): string => `cor_${randomUUID()}`;
