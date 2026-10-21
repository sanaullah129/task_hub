import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  InvalidTransitionError,
  assertTransition,
  canTransition,
  eventTypeForStatus,
  isTerminalStatus,
} from '../../src/domain/stateMachine.js';
import { TASK_STATUSES, type TaskStatus } from '../../src/domain/types.js';

const VALID: ReadonlyArray<[TaskStatus, TaskStatus]> = [
  ['Pending', 'Running'],
  ['Running', 'Completed'],
  ['Running', 'Failed'],
  ['Running', 'TimedOut'],
  ['Running', 'Pending'],
];

describe('task state machine', () => {
  it.each(VALID)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it('rejects every transition that is not explicitly allowed', () => {
    const allowed = new Set(VALID.map(([from, to]) => `${from}->${to}`));
    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        if (allowed.has(`${from}->${to}`)) continue;
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
  });

  it.each(['Completed', 'Failed', 'TimedOut'] as const)('treats %s as immutable', (terminal) => {
    expect(ALLOWED_TRANSITIONS[terminal]).toEqual([]);
    expect(isTerminalStatus(terminal)).toBe(true);
  });

  it.each(['Pending', 'Running'] as const)('does not treat %s as terminal', (status) => {
    expect(isTerminalStatus(status)).toBe(false);
  });

  it('only allows a new task to start as Pending', () => {
    expect(canTransition(null, 'Pending')).toBe(true);
    expect(canTransition(null, 'Running')).toBe(false);
    expect(canTransition(null, 'Completed')).toBe(false);
  });

  it('throws InvalidTransitionError carrying both states', () => {
    try {
      assertTransition('Completed', 'Running');
      expect.unreachable('assertTransition should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransitionError);
      const typed = error as InvalidTransitionError;
      expect(typed.from).toBe('Completed');
      expect(typed.to).toBe('Running');
      expect(typed.message).toContain('Completed -> Running');
    }
  });

  it('describes a missing origin state in the error message', () => {
    expect(() => assertTransition(null, 'Running')).toThrow('none -> Running');
  });

  it('maps each terminal status to its webhook event type', () => {
    expect(eventTypeForStatus('Completed')).toBe('task.completed');
    expect(eventTypeForStatus('Failed')).toBe('task.failed');
    expect(eventTypeForStatus('TimedOut')).toBe('task.timed_out');
  });
});
