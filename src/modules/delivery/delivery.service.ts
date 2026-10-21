import type { Config } from '../../config/config';
import type { Logger } from '../../observability/logger';
import { eventLog, hostOf } from '../../observability/logContext';
import { noopMetrics, type Metrics } from '../../observability/metrics';
import type { RandomSource } from '../../shared/utils/backoff';
import type { CustomerRepository } from '../customers/customer.repository';
import type { EventRepository } from '../events/event.repository';
import type { DeliveryAttempt, EventDocument } from '../events/event.types';
import type { WebhookClient } from './delivery.client';
import { decideDelivery } from './delivery.outcome';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, signPayload } from './delivery.signing';

export interface DeliveryServiceDeps {
  events: Pick<EventRepository, 'recordAttempt'>;
  customers: Pick<CustomerRepository, 'findById'>;
  client: WebhookClient;
  config: Pick<Config, 'delivery'>;
  logger: Logger;
  workerId: string;
  metrics?: Metrics;
  now?: () => Date;
  random?: RandomSource;
}

export class DeliveryService {
  private readonly now: () => Date;

  constructor(private readonly deps: DeliveryServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Sends one attempt for a leased event and records the outcome. */
  async deliver(event: EventDocument): Promise<void> {
    const { events, customers, client, config, workerId } = this.deps;
    const log = eventLog(this.deps.logger, event);
    const attemptNumber = event.delivery.attemptCount + 1;
    const startedAt = this.now();

    const customer = await customers.findById(event.customerId);
    if (event.url === null) {
      log.warn('webhook delivery has no URL configured, recording a failed attempt', { attempt: attemptNumber, eventType: event.eventType });
    } else {
      log.info('webhook delivery started', { attempt: attemptNumber, maxAttempts: event.delivery.maxAttempts, eventType: event.eventType, host: hostOf(event.url), signed: customer?.webhook?.secret !== undefined });
    }
    const response =
      event.url === null
        ? { error: 'no webhook URL is configured for this event', durationMs: 0 }
        : await client({
            url: event.url,
            body: JSON.stringify(event.body),
            headers: this.headers(event, attemptNumber, startedAt, customer?.webhook?.secret),
            timeoutMs: config.delivery.timeoutMs,
          });

    const result = decideDelivery({
      response,
      attemptNumber,
      maxAttempts: event.delivery.maxAttempts,
      now: this.now(),
      backoff: config.delivery.backoff,
      random: this.deps.random,
    });
    const attempt: DeliveryAttempt = {
      n: attemptNumber,
      startedAt,
      durationMs: response.durationMs,
      ...(response.statusCode === undefined ? {} : { statusCode: response.statusCode }),
      ...(response.error === undefined ? {} : { error: response.error }),
      ...(response.responseSnippet === undefined ? {} : { responseSnippet: response.responseSnippet }),
    };

    const updated = await events.recordAttempt(event._id, workerId, attempt, result);
    (this.deps.metrics ?? noopMetrics).recordWebhookAttempt({
      outcome: result.kind === 'delivered' ? 'success' : 'failure',
      durationMs: response.durationMs,
    });

    if (updated === null) {
      log.warn('webhook delivery attempt discarded: lease is no longer held', { attempt: attemptNumber });
      return;
    }
    const level = result.kind === 'delivered' ? 'info' : result.kind === 'retry' ? 'warn' : 'error';
    log[level]('webhook delivery attempt finished', {
      attempt: attemptNumber,
      eventType: event.eventType,
      host: hostOf(event.url),
      statusCode: response.statusCode,
      error: response.error,
      durationMs: response.durationMs,
      result: result.kind,
      deliveryStatus: updated.delivery.status,
      nextAttemptAt: updated.delivery.nextAttemptAt,
    });
  }

  private headers(
    event: EventDocument,
    attemptNumber: number,
    at: Date,
    secret: string | undefined,
  ): Record<string, string> {
    const timestamp = Math.floor(at.getTime() / 1000);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'TaskHub-Webhook/1.0',
      'X-TaskHub-Event-Id': event._id,
      'X-TaskHub-Event-Type': event.eventType,
      'X-TaskHub-Correlation-Id': event.correlationId,
      'X-TaskHub-Delivery-Attempt': String(attemptNumber),
      [TIMESTAMP_HEADER]: String(timestamp),
    };
    if (secret !== undefined) headers[SIGNATURE_HEADER] = signPayload(secret, timestamp, JSON.stringify(event.body));
    return headers;
  }
}
