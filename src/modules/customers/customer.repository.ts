import type { Model } from 'mongoose';
import type { SecretBox } from '../../shared/security/secretBox';
import type { CustomerDocument, CustomerWebhook } from './customer.types';

export interface CustomerRepository {
  findById(customerId: string): Promise<CustomerDocument | null>;
  upsertWebhook(customerId: string, webhook: CustomerWebhook, now: Date): Promise<CustomerDocument>;
}

/** Encrypts the webhook secret on write and decrypts on read when a secret box is given. */
export class MongooseCustomerRepository implements CustomerRepository {
  constructor(
    private readonly customers: Model<CustomerDocument>,
    private readonly secretBox?: SecretBox,
  ) {}

  private reveal(doc: CustomerDocument | null): CustomerDocument | null {
    if (doc?.webhook == null || this.secretBox === undefined) return doc;
    return { ...doc, webhook: { ...doc.webhook, secret: this.secretBox.decrypt(doc.webhook.secret) } };
  }

  async findById(customerId: string): Promise<CustomerDocument | null> {
    return this.reveal(await this.customers.findById(customerId).lean<CustomerDocument>().exec());
  }

  async upsertWebhook(customerId: string, webhook: CustomerWebhook, now: Date): Promise<CustomerDocument> {
    const stored = this.secretBox === undefined ? webhook : { ...webhook, secret: this.secretBox.encrypt(webhook.secret) };
    const updated = await this.customers
      .findOneAndUpdate(
        { _id: customerId },
        { $set: { webhook: stored, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true, returnDocument: 'after' },
      )
      .lean<CustomerDocument>()
      .exec();
    const revealed = this.reveal(updated);
    if (revealed === null) throw new Error(`customer ${customerId} could not be saved`);
    return revealed;
  }
}
