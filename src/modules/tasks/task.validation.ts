import { z } from 'zod';
import { ValidationError } from '../../shared/errors/appErrors';
import type { JsonObject } from '../../shared/types/json';
import { formatZodIssues } from '../../shared/utils/zod';
import { customerIdSchema } from '../customers/customer.validation';
import { validateWebhookUrl } from '../webhooks/webhookUrl';
import { TASK_STATUSES, TASK_TYPES, type TaskType } from './task.constants';
import type { TaskListQuery } from './task.repository';
import { parseLimit } from '../../shared/utils/pagination';

export const simulationSchema = z.object({
  durationMs: z.number().int().min(0).max(600_000).optional(),
  failure: z.enum(['retryable', 'fatal', 'hang']).optional(),
  failTimes: z.number().int().min(0).max(10).optional(),
});
export type Simulation = z.infer<typeof simulationSchema>;

const simulate = simulationSchema.optional();

export const PAYLOAD_SCHEMAS: Readonly<Record<TaskType, z.ZodType>> = {
  document_processing: z.looseObject({ documentId: z.string().min(1).max(256), simulate }),
  report_generation: z.looseObject({ reportType: z.string().min(1).max(256), simulate }),
  data_sync: z.looseObject({
    source: z.string().min(1).max(256),
    target: z.string().min(1).max(256),
    simulate,
  }),
};

const identifier = customerIdSchema;

export const submitTaskSchema = z.object({
  customerId: identifier,
  taskType: z.enum(TASK_TYPES),
  payload: z.record(z.string(), z.json()),
  idempotencyKey: z.string().min(1).max(255),
  webhookUrl: z.string().min(1).max(2048).optional(),
});

export interface ParsedSubmitRequest {
  customerId: string;
  taskType: TaskType;
  payload: JsonObject;
  idempotencyKey: string;
  webhookUrl: string | null;
}

export function parseSubmitRequest(body: unknown, options: { demoMode: boolean }): ParsedSubmitRequest {
  const envelope = submitTaskSchema.safeParse(body);
  if (!envelope.success) throw new ValidationError(formatZodIssues(envelope.error));
  const { customerId, taskType, payload, idempotencyKey, webhookUrl } = envelope.data;

  const details: string[] = [];
  const payloadCheck = PAYLOAD_SCHEMAS[taskType].safeParse(payload);
  if (!payloadCheck.success) {
    details.push(...formatZodIssues(payloadCheck.error, { root: '', prefix: 'payload.' }));
  }

  let normalizedWebhookUrl: string | null = null;
  if (webhookUrl !== undefined) {
    const result = validateWebhookUrl(webhookUrl, options);
    if (result.ok) normalizedWebhookUrl = result.url;
    else details.push(`webhookUrl: ${result.reason}`);
  }
  if (details.length > 0) throw new ValidationError(details);

  return { customerId, taskType, payload, idempotencyKey, webhookUrl: normalizedWebhookUrl };
}

const listQuerySchema = z.object({
  customerId: customerIdSchema.optional(),
  status: z.enum(TASK_STATUSES).optional(),
  cursor: z.string().min(1).max(512).optional(),
});

export function parseTaskListQuery(query: Record<string, unknown>): TaskListQuery {
  const parsed = listQuerySchema.safeParse({
    customerId: query['customerId'],
    status: query['status'],
    cursor: query['cursor'],
  });
  if (!parsed.success) throw new ValidationError(formatZodIssues(parsed.error, { root: 'query' }));
  const { customerId, status, cursor } = parsed.data;
  return {
    limit: parseLimit(query['limit']),
    ...(customerId === undefined ? {} : { customerId }),
    ...(status === undefined ? {} : { status }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}
