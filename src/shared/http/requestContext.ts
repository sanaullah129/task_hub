import type { Request } from 'express';

export interface RequestContext {
  correlationId: string;
  startedAt: number;
  /** Path the matching router is mounted at; req.baseUrl is not reliable once an async handler finishes. */
  mountPath?: string;
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

export function setMountPath(req: Request, mountPath: string): void {
  getRequestContext(req).mountPath = mountPath;
}
