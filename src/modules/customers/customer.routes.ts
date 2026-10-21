import { Router } from 'express';
import type { CustomerController } from './customer.controller';

export function createCustomerRouter(controller: CustomerController): Router {
  const router = Router();
  router.put('/:customerId/webhook', (req, res) => controller.setWebhook(req, res));
  router.get('/:customerId/webhook', (req, res) => controller.getWebhook(req, res));
  return router;
}
