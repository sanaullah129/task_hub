import { describe, expect, it } from 'vitest';
import { newCorrelationId, prefixedId } from '../../../src/shared/utils/ids';
import { newTaskId } from '../../../src/modules/tasks/task.utils';
import { newEventId } from '../../../src/modules/events/event.utils';

describe('id generators', () => {
  it('builds ids with the given prefix', () => {
    expect(prefixedId('abc')).toMatch(/^abc_[0-9a-f-]{36}$/);
  });

  it('prefixes ids by entity type', () => {
    expect(newTaskId()).toMatch(/^tsk_[0-9a-f-]{36}$/);
    expect(newEventId()).toMatch(/^evt_[0-9a-f-]{36}$/);
    expect(newCorrelationId()).toMatch(/^cor_[0-9a-f-]{36}$/);
  });

  it('generates unique ids', () => {
    expect(newTaskId()).not.toBe(newTaskId());
  });
});
