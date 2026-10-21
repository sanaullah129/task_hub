import { z } from 'zod';
import { ValidationError } from '../../shared/errors/appErrors';
import { formatZodIssues } from '../../shared/utils/zod';
import { validateWebhookUrl } from '../webhooks/webhookUrl';

export const customerIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:@-]+$/, 'may only contain letters, digits and . _ : @ -');

const webhookBodySchema = z.object({
  url: z.string().min(1).max(2048),
  secret: z.string().min(16).max(256).optional(),
});

export interface ParsedWebhookRequest {
  customerId: string;
  url: string;
  secret: string | undefined;
}

export function parseCustomerId(raw: unknown): string {
  const parsed = customerIdSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(formatZodIssues(parsed.error, { root: 'customerId' }));
  return parsed.data;
}

export function parseWebhookRequest(
  customerId: unknown,
  body: unknown,
  options: { demoMode: boolean },
): ParsedWebhookRequest {
  const id = parseCustomerId(customerId);
  const parsed = webhookBodySchema.safeParse(body);
  if (!parsed.success) throw new ValidationError(formatZodIssues(parsed.error));

  const urlCheck = validateWebhookUrl(parsed.data.url, options);
  if (!urlCheck.ok) throw new ValidationError([`url: ${urlCheck.reason}`]);
  return { customerId: id, url: urlCheck.url, secret: parsed.data.secret };
}
