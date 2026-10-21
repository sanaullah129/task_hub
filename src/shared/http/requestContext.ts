import type { Request } from 'express';

export interface RequestContext {
  correlationId: string;
  startedAt: number;
}

const contexts = new WeakMap<Request, RequestContext>();

export function setRequestContext(req: Request, context: RequestContext): void {
  contexts.set(req, context);
}

export function getRequestContext(req: Request): RequestContext {
  const context = contexts.get(req);
  if (context === undefined) throw new Error('Request context is not initialised');
  return context;
}
