import { describe, expect, it } from 'vitest';
import { createLogger } from '../../../src/observability/logger';
import { eventLog, hostOf, taskLog } from '../../../src/observability/logContext';
import { createLogCapture } from '../../mocks/logCapture';

const task = { _id: 'tsk_1', customerId: 'cust_a', correlationId: 'cor_task' };

describe('taskLog', () => {
  it('adds taskId, customerId and correlationId to every line', () => {
    const capture = createLogCapture();

    taskLog(createLogger({ logLevel: 'info' }, {}, [capture.transport]), task).info('task created', { status: 'Pending' });

    expect(capture.lines()[0]).toMatchObject({
      message: 'task created',
      taskId: 'tsk_1',
      customerId: 'cust_a',
      correlationId: 'cor_task',
      status: 'Pending',
    });
  });

  it('uses the request correlation id when one is given', () => {
    const capture = createLogCapture();

    taskLog(createLogger({ logLevel: 'info' }, {}, [capture.transport]), task, 'cor_request').info('repeat');

    expect(capture.lines()[0]).toMatchObject({ taskId: 'tsk_1', correlationId: 'cor_request' });
  });
});

describe('eventLog', () => {
  const event = { _id: 'evt_1', taskId: 'tsk_1', customerId: 'cust_a', correlationId: 'cor_event' };

  it('adds eventId, taskId, customerId and correlationId to every line', () => {
    const capture = createLogCapture();

    eventLog(createLogger({ logLevel: 'info' }, {}, [capture.transport]), event).info('webhook delivery started');

    expect(capture.lines()[0]).toMatchObject({ eventId: 'evt_1', taskId: 'tsk_1', customerId: 'cust_a', correlationId: 'cor_event' });
  });

  it('lets the caller override the correlation id', () => {
    const capture = createLogCapture();

    eventLog(createLogger({ logLevel: 'info' }, {}, [capture.transport]), event, 'cor_other').info('x');

    expect(capture.lines()[0]).toMatchObject({ correlationId: 'cor_other' });
  });
});

describe('hostOf', () => {
  it('keeps only the host and port so tokens in paths and queries are never logged', () => {
    expect(hostOf('https://hooks.example.com/in/secret-token?sig=abc')).toBe('hooks.example.com');
    expect(hostOf('http://127.0.0.1:4000/hook')).toBe('127.0.0.1:4000');
  });

  it('handles missing and malformed URLs', () => {
    expect(hostOf(null)).toBeNull();
    expect(hostOf('not a url')).toBe('invalid-url');
  });
});
