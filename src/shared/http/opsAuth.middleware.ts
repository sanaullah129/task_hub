import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { UnauthorizedError } from '../errors/appErrors';

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/** Requires `Authorization: Bearer <token>`; compares digests in constant time. */
export const requireBearerToken =
  (token: string): RequestHandler =>
  (req, _res, next) => {
    const header = req.header('authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!timingSafeEqual(digest(presented), digest(token))) {
      next(new UnauthorizedError());
      return;
    }
    next();
  };
