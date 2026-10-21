import type { Model } from 'mongoose';
import type { CustomerDocument, CustomerWebhook } from './customer.types';

export interface CustomerRepository {
  findById(customerId: string): Promise<CustomerDocument | null>;
  upsertWebhook(customerId: string, webhook: CustomerWebhook, now: Date): Promise<CustomerDocument>;
}

export class MongooseCustomerRepository implements CustomerRepository {
  constructor(private readonly customers: Model<CustomerDocument>) {}

  findById(customerId: string): Promise<CustomerDocument | null> {
    return this.customers.findById(customerId).lean<CustomerDocument>().exec();
  }

  async upsertWebhook(customerId: string, webhook: CustomerWebhook, now: Date): Promise<CustomerDocument> {
    const updated = await this.customers
      .findOneAndUpdate(
        { _id: customerId },
        { $set: { webhook, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true, returnDocument: 'after' },
      )
      .lean<CustomerDocument>()
      .exec();
    if (updated === null) throw new Error(`customer ${customerId} could not be saved`);
    return updated;
  }
}
