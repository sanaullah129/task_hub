import { performance } from 'node:perf_hooks';
import type { RequestHandler } from 'express';
import { newCorrelationId } from '../utils/ids';
import { setRequestContext } from './requestContext';

export const CORRELATION_HEADER = 'x-correlation-id';
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

// Client-supplied IDs are only trusted when they are short and log-safe.
export const correlationMiddleware: RequestHandler = (req, res, next) => {
  const supplied = req.get(CORRELATION_HEADER);
  const correlationId =
    supplied !== undefined && SAFE_CORRELATION_ID.test(supplied) ? supplied : newCorrelationId();
  setRequestContext(req, { correlationId, startedAt: performance.now() });
  res.setHeader('X-Correlation-Id', correlationId);
  next();
};
