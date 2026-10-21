import type { Request, Response } from 'express';

export type HealthCheck = () => Promise<boolean>;

export interface HealthController {
  check(req: Request, res: Response): Promise<void>;
}

export function createHealthController(isHealthy: HealthCheck): HealthController {
  return {
    async check(_req, res) {
      const healthy = await isHealthy().catch(() => false);
      res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'unavailable' });
    },
  };
}
