export const TASK_TYPES = ['document_processing', 'report_generation', 'data_sync'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ['Pending', 'Running', 'Completed', 'Failed', 'TimedOut'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_STATUSES = ['Completed', 'Failed', 'TimedOut'] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export const ATTEMPT_OUTCOMES = ['Completed', 'Failed', 'TimedOut', 'Abandoned'] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];
