import { describe, expect, it } from 'vitest';
import { newCorrelationId, newEventId, newTaskId } from '../../src/domain/ids.js';

describe('id generators', () => {
  it('prefixes ids by entity type', () => {
    expect(newTaskId()).toMatch(/^tsk_[0-9a-f-]{36}$/);
    expect(newEventId()).toMatch(/^evt_[0-9a-f-]{36}$/);
    expect(newCorrelationId()).toMatch(/^cor_[0-9a-f-]{36}$/);
  });

  it('generates unique ids', () => {
    expect(newTaskId()).not.toBe(newTaskId());
  });
});
