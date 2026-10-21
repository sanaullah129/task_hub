import { describe, expect, it } from 'vitest';
import { customerSchema } from '../../../../src/modules/customers/customer.model';

describe('customer schema', () => {
  it('uses the customers collection with a nullable webhook', () => {
    expect(customerSchema.get('collection')).toBe('customers');
    expect(customerSchema.path('webhook')).toBeDefined();
    expect(customerSchema.get('autoIndex')).toBe(false);
  });
});
