import type { Router } from 'express';
import type { Config } from '../../config/config';
import type { Logger } from '../../observability/logger';
import { createCustomerController } from './customer.controller';
import type { CustomerRepository } from './customer.repository';
import { createCustomerRouter } from './customer.routes';
import { CustomerService } from './customer.service';

export function createCustomersModule(deps: {
  repository: CustomerRepository;
  config: Pick<Config, 'demoMode'>;
  logger: Logger;
}): { service: CustomerService; router: Router } {
  const service = new CustomerService({ repository: deps.repository, logger: deps.logger });
  return { service, router: createCustomerRouter(createCustomerController({ service, config: deps.config })) };
}

export { customerSchema } from './customer.model';
export { customerIdSchema } from './customer.validation';
export { MongooseCustomerRepository, type CustomerRepository } from './customer.repository';
export { CustomerService } from './customer.service';
export type { CustomerDocument, CustomerWebhook } from './customer.types';
