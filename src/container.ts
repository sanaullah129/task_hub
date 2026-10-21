import type { Config, Role } from './config/config';
import type { AppRoute } from './app';
import type { Database } from './database/client';
import { MongooseCustomerRepository, createCustomersModule } from './modules/customers';
import { createDeliveryModule } from './modules/delivery';
import { createDocsRouter } from './modules/docs';
import { MongooseEventRepository, EventService, createEventsModule } from './modules/events';
import { createExecutionModule } from './modules/execution';
import { createHealthModule } from './modules/health';
import { MongooseMetricsRepository, createMetricsModule } from './modules/metrics';
import { createOperationsModule } from './modules/operations';
import { createReconcilerModule } from './modules/reconciler';
import {
  MongooseTaskExecutionRepository,
  MongooseTaskRecoveryRepository,
  MongooseTaskRepository,
  createTasksModule,
} from './modules/tasks';
import type { Logger } from './observability/logger';
import { createMetrics, type Metrics } from './observability/metrics';
import { createSecretBox } from './shared/security/secretBox';

export interface Lifecycle {
  name: Role;
  start(): void;
  stop(): Promise<void>;
}

export interface Container {
  routes: AppRoute[];
  metrics: Metrics;
  /** Background roles enabled by `config.roles`. */
  lifecycles: Lifecycle[];
}

/** Composition root: the only place that wires concrete repositories into modules. */
export function createContainer(deps: { config: Config; logger: Logger; database: Database }): Container {
  const { config, logger, database } = deps;

  const taskRepository = new MongooseTaskRepository(database.tasks);
  const executionRepository = new MongooseTaskExecutionRepository(database.tasks);
  const recoveryRepository = new MongooseTaskRecoveryRepository(database.tasks);
  const eventRepository = new MongooseEventRepository(database.events);
  const secretBox = config.security.secretsKey === undefined ? undefined : createSecretBox(config.security.secretsKey);
  if (secretBox === undefined) logger.warn('SECRETS_ENCRYPTION_KEY is not set, webhook secrets are stored in plain text');
  const customerRepository = new MongooseCustomerRepository(database.customers, secretBox);
  const metricsRepository = new MongooseMetricsRepository(database.tasks, database.events);

  const metrics = createMetrics({ taskCount: (status) => metricsRepository.taskCount(status) });
  const eventService = new EventService({
    events: eventRepository,
    customers: customerRepository,
    taskMarker: recoveryRepository,
    config,
    logger: logger.child({ module: 'events' }),
    metrics,
  });

  const customers = createCustomersModule({ repository: customerRepository, config, logger });
  const tasks = createTasksModule({ repository: taskRepository, config, logger });
  const events = createEventsModule(eventService);
  const operations = createOperationsModule({ tasks: taskRepository, events: eventRepository });
  const metricsModule = createMetricsModule({ repository: metricsRepository, metrics });
  const health = createHealthModule(async () => {
    const db = database.connection.db;
    if (db === undefined) return false;
    await db.command({ ping: 1 });
    return true;
  });

  const routes: AppRoute[] = [
    { path: '/healthz', router: health.router },
    { path: '/', router: metricsModule.router },
    { path: '/', router: createDocsRouter() },
    { path: '/v1/tasks', router: tasks.router },
    { path: '/v1/customers', router: customers.router },
    { path: '/v1', router: events.router },
    { path: '/v1', router: operations.router },
  ];

  const lifecycles: Lifecycle[] = [];
  const emitEvent = (task: Parameters<EventService['emitForTask']>[0]): Promise<unknown> =>
    eventService.emitForTask(task);

  if (config.roles.includes('worker')) {
    const { worker } = createExecutionModule({
      repository: executionRepository,
      config,
      logger: logger.child({ role: 'worker' }),
      onTerminal: emitEvent,
      metrics,
    });
    lifecycles.push({ name: 'worker', start: () => worker.start(), stop: () => worker.stop() });
  }
  if (config.roles.includes('delivery')) {
    const { worker } = createDeliveryModule({
      events: eventRepository,
      customers: customerRepository,
      config,
      logger: logger.child({ role: 'delivery' }),
      metrics,
    });
    lifecycles.push({ name: 'delivery', start: () => worker.start(), stop: () => worker.stop() });
  }
  if (config.roles.includes('reconciler')) {
    const { runner } = createReconcilerModule({
      recovery: recoveryRepository,
      execution: executionRepository,
      emitEvent,
      config,
      logger: logger.child({ role: 'reconciler' }),
    });
    lifecycles.push({ name: 'reconciler', start: () => runner.start(), stop: () => runner.stop() });
  }

  return { routes, metrics, lifecycles };
}
