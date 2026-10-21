import type { Request, Response } from 'express';
import type { Config } from '../../config/config';
import { parseCustomerId, parseWebhookRequest } from './customer.validation';
import type { CustomerService } from './customer.service';

export interface CustomerController {
  setWebhook(req: Request<{ customerId: string }>, res: Response): Promise<void>;
  getWebhook(req: Request<{ customerId: string }>, res: Response): Promise<void>;
}

export function createCustomerController(deps: {
  service: CustomerService;
  config: Pick<Config, 'demoMode'>;
}): CustomerController {
  return {
    async setWebhook(req, res) {
      const input = parseWebhookRequest(req.params.customerId, req.body, { demoMode: deps.config.demoMode });
      const result = await deps.service.setWebhook({
        customerId: input.customerId,
        url: input.url,
        ...(input.secret === undefined ? {} : { secret: input.secret }),
      });
      res.json({
        customerId: result.customerId,
        webhook: { url: result.url },
        ...(result.generatedSecret === undefined ? {} : { secret: result.generatedSecret }),
      });
    },

    async getWebhook(req, res) {
      const view = await deps.service.getWebhook(parseCustomerId(req.params.customerId));
      res.json({ customerId: view.customerId, webhook: { url: view.url, secretConfigured: view.secretConfigured } });
    },
  };
}
