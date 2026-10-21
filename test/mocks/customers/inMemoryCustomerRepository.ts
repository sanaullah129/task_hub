import type { CustomerRepository } from '../../../src/modules/customers/customer.repository';
import type { CustomerDocument, CustomerWebhook } from '../../../src/modules/customers/customer.types';

export class InMemoryCustomerRepository implements CustomerRepository {
  readonly customers = new Map<string, CustomerDocument>();

  findById(customerId: string): Promise<CustomerDocument | null> {
    return Promise.resolve(this.customers.get(customerId) ?? null);
  }

  upsertWebhook(customerId: string, webhook: CustomerWebhook, now: Date): Promise<CustomerDocument> {
    const existing = this.customers.get(customerId);
    const customer: CustomerDocument = { _id: customerId, webhook, createdAt: existing?.createdAt ?? now, updatedAt: now };
    this.customers.set(customerId, customer);
    return Promise.resolve(customer);
  }
}
