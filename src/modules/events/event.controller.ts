import type { Request, Response } from 'express';
import { ValidationError } from '../../shared/errors/appErrors';
import { parseDeliveryListQuery } from './event.validation';
import type { EventService } from './event.service';
import { toEventView } from './event.view';

export interface EventController {
  listForTask(req: Request<{ taskId: string }>, res: Response): Promise<void>;
  listDeliveries(req: Request, res: Response): Promise<void>;
  retryDelivery(req: Request<{ eventId: string }>, res: Response): Promise<void>;
}

export function createEventController(service: EventService): EventController {
  return {
    async listForTask(req, res) {
      const events = await service.listForTask(req.params.taskId);
      res.json({ items: events.map(toEventView) });
    },

    async listDeliveries(req, res) {
      const page = await service.listDeliveries(parseDeliveryListQuery(req.query));
      res.json({ items: page.items.map(toEventView), nextCursor: page.nextCursor });
    },

    async retryDelivery(req, res) {
      if (req.params.eventId.length === 0) throw new ValidationError(['eventId: is required']);
      const event = await service.retryDelivery(req.params.eventId);
      res.status(202).json(toEventView(event));
    },
  };
}
