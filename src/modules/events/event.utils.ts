import { prefixedId } from '../../shared/utils/ids';
import type { TerminalStatus } from '../tasks/task.constants';
import type { EventType } from './event.constants';

export const newEventId = (): string => prefixedId('evt');

const EVENT_TYPE_BY_STATUS: Readonly<Record<TerminalStatus, EventType>> = {
  Completed: 'task.completed',
  Failed: 'task.failed',
  TimedOut: 'task.timed_out',
};

export function eventTypeForStatus(status: TerminalStatus): EventType {
  return EVENT_TYPE_BY_STATUS[status];
}
