import { randomUUID } from 'node:crypto';

export const prefixedId = (prefix: string): string => `${prefix}_${randomUUID()}`;
export const newCorrelationId = (): string => prefixedId('cor');
