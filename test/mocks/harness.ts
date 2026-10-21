import type { Express } from 'express';
import { createApp, type AppRoute } from '../../src/app';
import { createCustomersModule } from '../../src/modules/customers';
import { EventService, createEventsModule } from '../../src/modules/events';
import { createHealthModule } from '../../src/modules/health';
import { createOperationsModule } from '../../src/modules/operations';
import { createTasksModule } from '../../src/modules/tasks';
import { noopMetrics, type Metrics } from '../../src/observability/metrics';
import type { Logger } from '../../src/observability/logger';
import { InMemoryCustomerRepository } from './customers/inMemoryCustomerRepository';
import { InMemoryEventRepository } from './events/inMemoryEventRepository';
import { silentLogger, testConfig } from './helpers';
import { InMemoryTaskRepository } from './tasks/inMemoryTaskRepository';

export interface Harness {
  app: Express;
  tasks: InMemoryTaskRepository;
  events: InMemoryEventRepository;
  customers: InMemoryCustomerRepository;
  eventService: EventService;
}

/** Real routers and services over in-memory repositories; no database needed. */
export function buildHarness(
  options: {
    env?: Record<string, string>;
    logger?: Logger;
    metrics?: Metrics;
    isHealthy?: () => Promise<boolean>;
    tasks?: InMemoryTaskRepository;
    extraRoutes?: AppRoute[];
  } = {},
): Harness {
  const config = testConfig(options.env);
  const logger = options.logger ?? silentLogger();
  const tasks = options.tasks ?? new InMemoryTaskRepository();
  const events = new InMemoryEventRepository();
  const customers = new InMemoryCustomerRepository();
  const eventService = new EventService({
    events,
    customers,
    taskMarker: { markEventEmitted: () => Promise.resolve() },
    config,
    logger,
    metrics: options.metrics ?? noopMetrics,
  });

  const routes: AppRoute[] = [
    { path: '/healthz', router: createHealthModule(options.isHealthy ?? (() => Promise.resolve(true))).router },
    { path: '/v1/tasks', router: createTasksModule({ repository: tasks, config, logger }).router },
    { path: '/v1/customers', router: createCustomersModule({ repository: customers, config, logger }).router },
    { path: '/v1', router: createEventsModule(eventService).router },
    { path: '/v1', router: createOperationsModule({ tasks, events }).router },
    ...(options.extraRoutes ?? []),
  ];
  return {
    app: createApp({ config, logger, routes, metrics: options.metrics ?? noopMetrics }),
    tasks,
    events,
    customers,
    eventService,
  };
}
