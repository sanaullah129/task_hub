import request, { type Response } from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../../src/observability/logger';
import { buildHarness } from '../../mocks/harness';
import { InMemoryTaskRepository } from '../../mocks/tasks/inMemoryTaskRepository';
import { createLogCapture, type LogCapture } from '../../mocks/logCapture';

const bodyOf = (res: Response): Record<string, unknown> => res.body as Record<string, unknown>;
const errorOf = (res: Response): Record<string, unknown> => bodyOf(res)['error'] as Record<string, unknown>;

describe('shared HTTP middleware', () => {
  let capture: LogCapture;
  let repository: InMemoryTaskRepository;
  let app: ReturnType<typeof buildHarness>['app'];

  beforeEach(() => {
    capture = createLogCapture();
    repository = new InMemoryTaskRepository();
    app = buildHarness({
      tasks: repository,
      logger: createLogger({ logLevel: 'http' }, {}, [capture.transport]),
    }).app;
  });

  describe('correlation id', () => {
    it('echoes a safe caller-supplied id', async () => {
      const res = await request(app).get('/healthz').set('X-Correlation-Id', 'req-123');

      expect(res.headers['x-correlation-id']).toBe('req-123');
    });

    it('generates an id when none is supplied', async () => {
      const res = await request(app).get('/healthz');

      expect(res.headers['x-correlation-id']).toMatch(/^cor_/);
    });

    it.each(['bad id with spaces', 'x'.repeat(129), 'inject\\nline'])(
      'replaces an unsafe id %#',
      async (unsafe) => {
        const res = await request(app).get('/healthz').set('X-Correlation-Id', unsafe);

        expect(res.headers['x-correlation-id']).toMatch(/^cor_/);
      },
    );
  });

  describe('request logging', () => {
    it('logs each request with correlation id, status and duration', async () => {
      await request(app).get('/v1/tasks/tsk_missing').set('X-Correlation-Id', 'req-log');
      await vi.waitFor(() => expect(capture.lines().length).toBeGreaterThan(0));

      expect(capture.lines().find((line) => line['message'] === 'request completed')).toMatchObject({
        level: 'http',
        correlationId: 'req-log',
        method: 'GET',
        path: '/v1/tasks/tsk_missing',
        status: 404,
      });
      expect(typeof capture.lines()[0]?.['durationMs']).toBe('number');
    });
  });

  describe('error handling', () => {
    it('returns a JSON 404 for unknown routes', async () => {
      const res = await request(app).get('/nope');

      expect(res.status).toBe(404);
      expect(errorOf(res)['code']).toBe('route_not_found');
    });

    it('returns 400 for malformed JSON', async () => {
      const res = await request(app).post('/v1/tasks').set('Content-Type', 'application/json').send('{"broken');

      expect(res.status).toBe(400);
      expect(errorOf(res)['code']).toBe('invalid_json');
    });

    it('returns 413 when the body exceeds the payload limit', async () => {
      const small = buildHarness({ tasks: repository, env: { MAX_PAYLOAD_BYTES: '200' } }).app;

      const res = await request(small).post('/v1/tasks').send({ payload: { text: 'x'.repeat(500) } });

      expect(res.status).toBe(413);
      expect(errorOf(res)['code']).toBe('payload_too_large');
    });

    it('hides internal error details, logs them, and includes the correlation id', async () => {
      vi.spyOn(repository, 'findById').mockRejectedValue(new Error('mongo exploded'));

      const res = await request(app).get('/v1/tasks/tsk_1').set('X-Correlation-Id', 'req-500');

      expect(res.status).toBe(500);
      expect(errorOf(res)).toMatchObject({
        code: 'internal_error',
        message: 'Internal server error',
        correlationId: 'req-500',
      });
      expect(JSON.stringify(res.body)).not.toContain('mongo exploded');
      await vi.waitFor(() =>
        expect(capture.lines().some((line) => line['message'] === 'unhandled request error')).toBe(true),
      );
    });
  });
});
