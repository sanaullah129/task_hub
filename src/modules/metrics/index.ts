import type { Router } from 'express';
import type { Metrics } from '../../observability/metrics';
import type { MetricsRepository } from './metrics.repository';
import { createMetricsRouter } from './metrics.routes';
import { MetricsService } from './metrics.service';

export function createMetricsModule(deps: {
  repository: MetricsRepository;
  metrics: Metrics;
}): { service: MetricsService; router: Router } {
  const service = new MetricsService(deps);
  return { service, router: createMetricsRouter({ service, metrics: deps.metrics }) };
}

export { MongooseMetricsRepository, type MetricsRepository } from './metrics.repository';
export { MetricsService, type MetricsSummary } from './metrics.service';
export { percentileOfSorted, summarizeDurations, percentage } from './metrics.stats';
export { WINDOWS, parseWindow, type WindowKey } from './metrics.window';
