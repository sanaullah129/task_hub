import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../../src/shared/errors/appErrors';
import { CustomerService, newWebhookSecret } from '../../../../src/modules/customers/customer.service';
import { FIXED_NOW } from '../../../mocks/tasks/taskFixtures';
import { InMemoryCustomerRepository } from '../../../mocks/customers/inMemoryCustomerRepository';
import { silentLogger } from '../../../mocks/helpers';
import { createLogCapture } from '../../../mocks/logCapture';
import { createLogger } from '../../../../src/observability/logger';

const setup = () => {
  const repository = new InMemoryCustomerRepository();
  return { repository, service: new CustomerService({ repository, logger: silentLogger(), now: () => FIXED_NOW }) };
};

describe('CustomerService', () => {
  it('generates and returns a secret once when none is supplied', async () => {
    const { service, repository } = setup();

    const result = await service.setWebhook({ customerId: 'cust_a', url: 'https://hooks.example.com/' });

    expect(result.generatedSecret).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(repository.customers.get('cust_a')?.webhook).toEqual({
      url: 'https://hooks.example.com/',
      secret: result.generatedSecret,
    });
  });

  it('stores a caller-provided secret without echoing it back', async () => {
    const { service, repository } = setup();

    const result = await service.setWebhook({ customerId: 'cust_a', url: 'https://hooks.example.com/', secret: 'x'.repeat(24) });

    expect(result).toEqual({ customerId: 'cust_a', url: 'https://hooks.example.com/' });
    expect(repository.customers.get('cust_a')?.webhook?.secret).toBe('x'.repeat(24));
  });

  it('replaces the configuration and keeps the creation time on update', async () => {
    const { service, repository } = setup();

    await service.setWebhook({ customerId: 'cust_a', url: 'https://one.example.com/' });
    await service.setWebhook({ customerId: 'cust_a', url: 'https://two.example.com/' });

    expect(repository.customers.get('cust_a')?.webhook?.url).toBe('https://two.example.com/');
    expect(repository.customers.get('cust_a')?.createdAt).toEqual(FIXED_NOW);
  });

  it('reports the configured URL without exposing the secret', async () => {
    const { service } = setup();
    await service.setWebhook({ customerId: 'cust_a', url: 'https://hooks.example.com/' });

    const view = await service.getWebhook('cust_a');

    expect(view).toEqual({ customerId: 'cust_a', url: 'https://hooks.example.com/', secretConfigured: true });
    expect(JSON.stringify(view)).not.toContain('whsec_');
  });

  it('logs the host only when the webhook is read and warns when it is missing', async () => {
    const repository = new InMemoryCustomerRepository();
    const capture = createLogCapture();
    const service = new CustomerService({ repository, logger: createLogger({ logLevel: 'debug' }, {}, [capture.transport]), now: () => FIXED_NOW });
    await service.setWebhook({ customerId: 'cust_a', url: 'https://hooks.example.com/secret-path' });

    await service.getWebhook('cust_a');
    await expect(service.getWebhook('cust_x')).rejects.toBeInstanceOf(NotFoundError);

    const lines = capture.lines();
    expect(lines.find((line) => line['message'] === 'customer webhook read')).toMatchObject({ customerId: 'cust_a', host: 'hooks.example.com' });
    expect(lines.find((line) => line['message'] === 'customer webhook requested but not configured')).toMatchObject({ level: 'warn', customerId: 'cust_x' });
    expect(JSON.stringify(lines)).not.toContain('secret-path');
  });

  it('throws NotFoundError for an unknown customer or one without a webhook', async () => {
    const { service, repository } = setup();
    repository.customers.set('cust_b', { _id: 'cust_b', webhook: null, createdAt: FIXED_NOW, updatedAt: FIXED_NOW });

    await expect(service.getWebhook('cust_x')).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.getWebhook('cust_b')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('uses the real clock when none is injected', async () => {
    const repository = new InMemoryCustomerRepository();
    const service = new CustomerService({ repository, logger: silentLogger() });

    await service.setWebhook({ customerId: 'cust_a', url: 'https://hooks.example.com/' });

    expect(repository.customers.get('cust_a')?.updatedAt.getTime()).toBeGreaterThan(FIXED_NOW.getTime() - 1e12);
  });
});

describe('newWebhookSecret', () => {
  it('is random per call', () => {
    expect(newWebhookSecret()).not.toBe(newWebhookSecret());
  });
});
