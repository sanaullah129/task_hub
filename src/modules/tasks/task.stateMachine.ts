import { type TaskStatus, type TerminalStatus, TERMINAL_STATUSES } from './task.constants';

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: TaskStatus | null,
    public readonly to: TaskStatus,
  ) {
    super(`Invalid task transition: ${from ?? 'none'} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export const ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  Pending: ['Running'],
  Running: ['Completed', 'Failed', 'TimedOut', 'Pending'],
  Completed: [],
  Failed: [],
  TimedOut: [],
};

export function isTerminalStatus(status: TaskStatus): status is TerminalStatus {
  return (TERMINAL_STATUSES as readonly TaskStatus[]).includes(status);
}

export function canTransition(from: TaskStatus | null, to: TaskStatus): boolean {
  if (from === null) return to === 'Pending';
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TaskStatus | null, to: TaskStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}
