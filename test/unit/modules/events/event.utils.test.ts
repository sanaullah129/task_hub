import { describe, expect, it } from 'vitest';
import { eventTypeForStatus, newEventId } from '../../../../src/modules/events/event.utils';

describe('eventTypeForStatus', () => {
  it('maps each terminal status to its webhook event type', () => {
    expect(eventTypeForStatus('Completed')).toBe('task.completed');
    expect(eventTypeForStatus('Failed')).toBe('task.failed');
    expect(eventTypeForStatus('TimedOut')).toBe('task.timed_out');
  });
});

describe('newEventId', () => {
  it('uses the evt_ prefix', () => {
    expect(newEventId()).toMatch(/^evt_/);
  });
});
