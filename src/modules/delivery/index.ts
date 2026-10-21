import type { Config } from '../../config/config';
import type { Logger } from '../../observability/logger';
import type { Metrics } from '../../observability/metrics';
import { newWorkerId } from '../../shared/utils/ids';
import type { CustomerRepository } from '../customers/customer.repository';
import type { EventRepository } from '../events/event.repository';
import { fetchWebhookClient, type WebhookClient } from './delivery.client';
import { DeliveryService } from './delivery.service';
import { DeliveryWorker } from './delivery.worker';

export function createDeliveryModule(deps: {
  events: EventRepository;
  customers: Pick<CustomerRepository, 'findById'>;
  config: Pick<Config, 'delivery' | 'task'>;
  logger: Logger;
  metrics?: Metrics;
  client?: WebhookClient;
  workerId?: string;
}): { worker: DeliveryWorker; service: DeliveryService } {
  const workerId = deps.workerId ?? newWorkerId('dlv');
  const logger = deps.logger.child({ workerId });
  const service = new DeliveryService({
    events: deps.events,
    customers: deps.customers,
    client: deps.client ?? fetchWebhookClient,
    config: deps.config,
    logger,
    workerId,
    ...(deps.metrics === undefined ? {} : { metrics: deps.metrics }),
  });
  const worker = new DeliveryWorker({ events: deps.events, service, config: deps.config, logger, workerId });
  return { worker, service };
}

export { DeliveryService } from './delivery.service';
export { DeliveryWorker } from './delivery.worker';
export { fetchWebhookClient, type WebhookClient, type WebhookRequest, type WebhookResponse } from './delivery.client';
export { decideDelivery } from './delivery.outcome';
export { SIGNATURE_HEADER, TIMESTAMP_HEADER, signPayload, verifySignature } from './delivery.signing';
