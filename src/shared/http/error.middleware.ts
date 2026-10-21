import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, NotFoundError } from '../errors/appErrors';
import type { Logger } from '../../observability/logger';
import { getRequestContext } from './requestContext';

export const notFoundHandler: RequestHandler = (req) => {
  throw new NotFoundError('route', `${req.method} ${req.path}`);
};

interface HttpLikeError {
  status?: unknown;
  type?: unknown;
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const { correlationId } = getRequestContext(req);

    if (error instanceof AppError) {
      res.status(error.status).json({
        error: { code: error.code, message: error.message, details: error.details, correlationId },
      });
      return;
    }

    // body-parser errors carry a status and a type, e.g. entity.too.large or entity.parse.failed.
    const { status, type } = (typeof error === 'object' && error !== null ? error : {}) as HttpLikeError;
    if (type === 'entity.too.large') {
      res.status(413).json({
        error: { code: 'payload_too_large', message: 'Request body is too large', correlationId },
      });
      return;
    }
    if (status === 400 && typeof type === 'string') {
      res.status(400).json({
        error: { code: 'invalid_json', message: 'Request body is not valid JSON', correlationId },
      });
      return;
    }

    logger.error('unhandled request error', { correlationId, error });
    res.status(500).json({
      error: { code: 'internal_error', message: 'Internal server error', correlationId },
    });
  };
}
