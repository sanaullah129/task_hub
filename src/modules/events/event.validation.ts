import { z } from 'zod';
import { ValidationError } from '../../shared/errors/appErrors';
import { formatZodIssues } from '../../shared/utils/zod';
import { parseLimit } from '../../shared/utils/pagination';
import { DELIVERY_STATUSES } from './event.constants';
import type { EventListQuery } from './event.repository';

const listSchema = z.object({
  status: z.enum(DELIVERY_STATUSES).optional(),
  customerId: z.string().min(1).max(128).optional(),
  cursor: z.string().min(1).max(512).optional(),
});

export function parseDeliveryListQuery(query: Record<string, unknown>): EventListQuery {
  const parsed = listSchema.safeParse({
    status: query['status'],
    customerId: query['customerId'],
    cursor: query['cursor'],
  });
  if (!parsed.success) throw new ValidationError(formatZodIssues(parsed.error, { root: 'query' }));
  const { status, customerId, cursor } = parsed.data;
  return {
    limit: parseLimit(query['limit']),
    ...(status === undefined ? {} : { status }),
    ...(customerId === undefined ? {} : { customerId }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}
