import request, { type Response } from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildHarness } from '../../../mocks/harness';
import { InMemoryTaskRepository } from '../../../mocks/tasks/inMemoryTaskRepository';
import { validSubmitBody } from '../../../mocks/helpers';

const bodyOf = (res: Response): Record<string, unknown> => res.body as Record<string, unknown>;
const errorOf = (res: Response): Record<string, unknown> => bodyOf(res)['error'] as Record<string, unknown>;

describe('task routes', () => {
  let repository: InMemoryTaskRepository;

  const build = (env: Record<string, string> = {}) => buildHarness({ tasks: repository, env }).app;

  beforeEach(() => {
    repository = new InMemoryTaskRepository();
  });

  describe('POST /v1/tasks', () => {
    it('accepts a task with 202 without executing it', async () => {
      const res = await request(build()).post('/v1/tasks').send(validSubmitBody());

      expect(res.status).toBe(202);
      expect(bodyOf(res)).toMatchObject({
        customerId: 'cust_acme',
        taskType: 'document_processing',
        status: 'Pending',
        attempts: 0,
        result: null,
        error: null,
        finishedAt: null,
      });
      expect(bodyOf(res)['taskId']).toMatch(/^tsk_/);
      expect(repository.tasks.size).toBe(1);
    });

    it('does not expose internal fields', async () => {
      const res = await request(build()).post('/v1/tasks').send(validSubmitBody());

      for (const hidden of ['payload', 'payloadHash', 'lease', 'history', 'idempotencyKey', '_id']) {
        expect(bodyOf(res)).not.toHaveProperty(hidden);
      }
    });

    it('returns 200 with the same task for a repeated idempotency key', async () => {
      const app = build();
      const first = await request(app).post('/v1/tasks').send(validSubmitBody());
      const second = await request(app).post('/v1/tasks').send(validSubmitBody());

      expect(first.status).toBe(202);
      expect(second.status).toBe(200);
      expect(bodyOf(second)['taskId']).toBe(bodyOf(first)['taskId']);
      expect(repository.tasks.size).toBe(1);
    });

    it('returns 409 when the key is reused with a different payload', async () => {
      const app = build();
      await request(app).post('/v1/tasks').send(validSubmitBody());
      const res = await request(app)
        .post('/v1/tasks')
        .send(validSubmitBody({ payload: { documentId: 'doc_2' } }));

      expect(res.status).toBe(409);
      expect(errorOf(res)['code']).toBe('idempotency_conflict');
    });

    it('returns 400 with details for an invalid request', async () => {
      const res = await request(build())
        .post('/v1/tasks')
        .send(validSubmitBody({ taskType: 'nope', payload: {} }));

      expect(res.status).toBe(400);
      expect(errorOf(res)['code']).toBe('validation_error');
      expect(String(errorOf(res)['details'])).toContain('taskType');
      expect(repository.tasks.size).toBe(0);
    });

    it('returns 400 when the body is missing', async () => {
      const res = await request(build()).post('/v1/tasks');

      expect(res.status).toBe(400);
      expect(errorOf(res)['code']).toBe('validation_error');
    });

    it('rejects an unsafe webhook override unless demo mode is on', async () => {
      const body = validSubmitBody({ webhookUrl: 'http://localhost:4000/hook' });

      expect((await request(build()).post('/v1/tasks').send(body)).status).toBe(400);
      expect((await request(build({ DEMO_MODE: 'true' })).post('/v1/tasks').send(body)).status).toBe(202);
    });

    it('stores the caller correlation id on the task', async () => {
      const res = await request(build())
        .post('/v1/tasks')
        .set('X-Correlation-Id', 'req-123')
        .send(validSubmitBody());

      expect(bodyOf(res)['correlationId']).toBe('req-123');
    });
  });

  describe('GET /v1/tasks/:taskId', () => {
    it('returns the task status', async () => {
      const app = build();
      const created = await request(app).post('/v1/tasks').send(validSubmitBody());
      const res = await request(app).get(`/v1/tasks/${String(bodyOf(created)['taskId'])}`);

      expect(res.status).toBe(200);
      expect(bodyOf(res)).toMatchObject({ taskId: bodyOf(created)['taskId'], status: 'Pending', attemptLog: [] });
    });

    it('returns 404 for an unknown task', async () => {
      const res = await request(build()).get('/v1/tasks/tsk_missing');

      expect(res.status).toBe(404);
      expect(errorOf(res)['code']).toBe('task_not_found');
    });
  });
});
