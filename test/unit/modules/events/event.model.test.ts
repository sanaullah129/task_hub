import { describe, expect, it } from 'vitest';
import { eventSchema } from '../../../../src/modules/events/event.model';

type IndexEntry = [Record<string, unknown>, Record<string, unknown>];

const indexByName = (name: string): IndexEntry | undefined =>
  (eventSchema.indexes() as IndexEntry[]).find(([, options]) => options['name'] === name);

describe('event schema', () => {
  it('enforces one event per task outcome', () => {
    const [fields, options] = indexByName('uniq_task_event_type') ?? [];
    expect(fields).toEqual({ taskId: 1, eventType: 1 });
    expect(options).toMatchObject({ unique: true });
  });

  it('indexes claiming of due deliveries and stuck leases', () => {
    expect(indexByName('delivery_due')?.[0]).toEqual({
      'delivery.status': 1,
      'delivery.nextAttemptAt': 1,
    });
    expect(indexByName('delivery_lease_expiry')?.[0]).toEqual({
      'delivery.status': 1,
      'delivery.lease.expiresAt': 1,
    });
  });

  it('uses the events collection with automatic indexing disabled', () => {
    expect(eventSchema.get('collection')).toBe('events');
    expect(eventSchema.get('autoIndex')).toBe(false);
  });
});
