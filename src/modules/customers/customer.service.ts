import { randomBytes } from 'node:crypto';
import type { Logger } from '../../observability/logger';
import { hostOf } from '../../observability/logContext';
import { NotFoundError } from '../../shared/errors/appErrors';
import type { CustomerRepository } from './customer.repository';

export interface WebhookConfigResult {
  customerId: string;
  url: string;
  /** Present only when the service generated the secret; it cannot be read back later. */
  generatedSecret?: string;
}

export interface WebhookConfigView {
  customerId: string;
  url: string;
  secretConfigured: boolean;
}

export const newWebhookSecret = (): string => `whsec_${randomBytes(24).toString('hex')}`;

export class CustomerService {
  private readonly now: () => Date;

  constructor(
    private readonly deps: { repository: CustomerRepository; logger: Logger; now?: () => Date },
  ) {
    this.now = deps.now ?? (() => new Date());
  }

  async setWebhook(input: { customerId: string; url: string; secret?: string }): Promise<WebhookConfigResult> {
    const generatedSecret = input.secret === undefined ? newWebhookSecret() : undefined;
    const secret = input.secret ?? generatedSecret;
    if (secret === undefined) throw new Error('webhook secret is required');

    await this.deps.repository.upsertWebhook(input.customerId, { url: input.url, secret }, this.now());
    this.deps.logger.info('customer webhook configured', {
      customerId: input.customerId,
      host: hostOf(input.url),
      secretGenerated: generatedSecret !== undefined,
    });
    return {
      customerId: input.customerId,
      url: input.url,
      ...(generatedSecret === undefined ? {} : { generatedSecret }),
    };
  }

  async getWebhook(customerId: string): Promise<WebhookConfigView> {
    const customer = await this.deps.repository.findById(customerId);
    if (customer?.webhook == null) {
      this.deps.logger.warn('customer webhook requested but not configured', { customerId });
      throw new NotFoundError('webhook', customerId);
    }
    this.deps.logger.debug('customer webhook read', { customerId, host: hostOf(customer.webhook.url) });
    return { customerId, url: customer.webhook.url, secretConfigured: true };
  }
}
