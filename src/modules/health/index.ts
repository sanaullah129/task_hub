import type { Router } from 'express';
import { createHealthController, type HealthCheck } from './health.controller';
import { createHealthRouter } from './health.routes';

export function createHealthModule(isHealthy: HealthCheck): { router: Router } {
  return { router: createHealthRouter(createHealthController(isHealthy)) };
}

export type { HealthCheck } from './health.controller';
