import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

export const prefixedId = (prefix: string): string => `${prefix}_${randomUUID()}`;
export const newCorrelationId = (): string => prefixedId('cor');

/** Identifies one running process of a worker role, e.g. wrk_host_1234_ab12cd34. */
export const newWorkerId = (prefix: string): string =>
  `${prefix}_${hostname()}_${process.pid}_${randomUUID().slice(0, 8)}`;
