import type { Model } from 'mongoose';
import type { DeliveryStatus } from '../events/event.constants';
import type { EventDocument } from '../events/event.types';
import type { TaskStatus, TaskType } from '../tasks/task.constants';
import type { TaskDocument } from '../tasks/task.types';

export interface QueueWaitRow {
  taskType: TaskType;
  createdAt: Date;
  firstStartedAt: Date;
}

export interface AttemptRow {
  taskType: TaskType;
  startedAt: Date;
  finishedAt: Date;
  outcome: string | null;
}

export interface TerminalTaskRow {
  taskType: TaskType;
  customerId: string;
  status: TaskStatus;
  slaMs: number;
  createdAt: Date;
  finishedAt: Date;
}

export interface CustomerStatusCount {
  customerId: string;
  status: TaskStatus;
  count: number;
}

export interface DeliveryRow {
  status: DeliveryStatus;
  attemptCount: number;
  attempts: Array<{ durationMs: number; statusCode?: number; error?: string }>;
  deliveredAt: Date | null;
  taskFinishedAt: Date;
}

export interface MetricsRepository {
  queueWaits(since: Date): Promise<QueueWaitRow[]>;
  attempts(since: Date): Promise<AttemptRow[]>;
  taskCount(status: 'Pending' | 'Running'): Promise<number>;
  terminalTasks(since: Date): Promise<TerminalTaskRow[]>;
  tasksPerCustomer(since: Date): Promise<CustomerStatusCount[]>;
  deliveries(since: Date): Promise<DeliveryRow[]>;
}

const SAMPLE_LIMIT = 100_000;

/** Reads persisted timestamps so percentiles are exact and survive restarts. */
export class MongooseMetricsRepository implements MetricsRepository {
  constructor(
    private readonly tasks: Model<TaskDocument>,
    private readonly events: Model<EventDocument>,
  ) {}

  async queueWaits(since: Date): Promise<QueueWaitRow[]> {
    const rows = await this.tasks
      .find({ firstStartedAt: { $gte: since } }, { taskType: 1, createdAt: 1, firstStartedAt: 1 })
      .limit(SAMPLE_LIMIT)
      .lean<Array<{ taskType: TaskType; createdAt: Date; firstStartedAt: Date | null }>>()
      .exec();
    return rows.flatMap((row) => (row.firstStartedAt === null ? [] : [{ ...row, firstStartedAt: row.firstStartedAt }]));
  }

  async attempts(since: Date): Promise<AttemptRow[]> {
    const rows = await this.tasks
      .find({ 'attemptLog.finishedAt': { $gte: since } }, { taskType: 1, attemptLog: 1 })
      .limit(SAMPLE_LIMIT)
      .lean<Array<Pick<TaskDocument, 'taskType' | 'attemptLog'>>>()
      .exec();
    return rows.flatMap((row) =>
      row.attemptLog.flatMap((entry) =>
        entry.finishedAt !== null && entry.finishedAt >= since
          ? [{ taskType: row.taskType, startedAt: entry.startedAt, finishedAt: entry.finishedAt, outcome: entry.outcome }]
          : [],
      ),
    );
  }

  taskCount(status: 'Pending' | 'Running'): Promise<number> {
    return this.tasks.countDocuments({ status }).exec();
  }

  async terminalTasks(since: Date): Promise<TerminalTaskRow[]> {
    const rows = await this.tasks
      .find(
        { finishedAt: { $gte: since } },
        { taskType: 1, customerId: 1, status: 1, slaMs: 1, createdAt: 1, finishedAt: 1 },
      )
      .limit(SAMPLE_LIMIT)
      .lean<Array<Omit<TerminalTaskRow, 'finishedAt'> & { finishedAt: Date | null }>>()
      .exec();
    return rows.flatMap((row) => (row.finishedAt === null ? [] : [{ ...row, finishedAt: row.finishedAt }]));
  }

  async tasksPerCustomer(since: Date): Promise<CustomerStatusCount[]> {
    const rows = await this.tasks
      .aggregate<{ _id: { customerId: string; status: TaskStatus }; count: number }>([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { customerId: '$customerId', status: '$status' }, count: { $sum: 1 } } },
      ])
      .exec();
    return rows.map((row) => ({ customerId: row._id.customerId, status: row._id.status, count: row.count }));
  }

  async deliveries(since: Date): Promise<DeliveryRow[]> {
    const rows = await this.events
      .find({ createdAt: { $gte: since } }, { delivery: 1, taskFinishedAt: 1 })
      .limit(SAMPLE_LIMIT)
      .lean<Array<Pick<EventDocument, 'delivery' | 'taskFinishedAt'>>>()
      .exec();
    return rows.map((row) => ({
      status: row.delivery.status,
      attemptCount: row.delivery.attemptCount,
      attempts: row.delivery.attempts,
      deliveredAt: row.delivery.deliveredAt,
      taskFinishedAt: row.taskFinishedAt,
    }));
  }
}
