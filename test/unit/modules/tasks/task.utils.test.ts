import { describe, expect, it } from 'vitest';
import { hashTaskRequest, newTaskId } from '../../../../src/modules/tasks/task.utils';

describe('hashTaskRequest', () => {
  it('ignores key order in the payload', () => {
    expect(hashTaskRequest('data_sync', { a: 1, b: 2 })).toBe(hashTaskRequest('data_sync', { b: 2, a: 1 }));
  });

  it('changes when the payload or the task type changes', () => {
    const base = hashTaskRequest('data_sync', { a: 1 });

    expect(hashTaskRequest('data_sync', { a: 2 })).not.toBe(base);
    expect(hashTaskRequest('report_generation', { a: 1 })).not.toBe(base);
  });

  it('returns a sha256 hex digest', () => {
    expect(hashTaskRequest('data_sync', {})).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('newTaskId', () => {
  it('uses the tsk_ prefix', () => {
    expect(newTaskId()).toMatch(/^tsk_/);
  });
});
