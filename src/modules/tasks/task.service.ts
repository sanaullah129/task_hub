import type { Config } from '../../config/config';
import { NotFoundError } from '../../shared/errors/appErrors';
import type { JsonObject } from '../../shared/types/json';
import type { Logger } from '../../observability/logger';
import type { TaskType } from './task.constants';
import { IdempotencyConflictError } from './task.errors';
import type { TaskRepository } from './task.repository';
import type { TaskDocument } from './task.types';
import { hashTaskRequest, newTaskId } from './task.utils';

export interface SubmitTaskInput {
  customerId: string;
  taskType: TaskType;
  payload: JsonObject;
  idempotencyKey: string;
  webhookUrl: string | null;
  correlationId: string;
}

export interface SubmitTaskResult {
  task: TaskDocument;
  created: boolean;
}

export interface TaskServiceDeps {
  repository: TaskRepository;
  config: Pick<Config, 'task'>;
  logger: Logger;
  now?: () => Date;
}

export class TaskService {
  private readonly now: () => Date;

  constructor(private readonly deps: TaskServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async submit(input: SubmitTaskInput): Promise<SubmitTaskResult> {
    const { repository, config, logger } = this.deps;
    const now = this.now();
    const typeConfig = config.task.types[input.taskType];
    const payloadHash = hashTaskRequest(input.taskType, input.payload);

    const candidate: TaskDocument = {
      _id: newTaskId(),
      customerId: input.customerId,
      taskType: input.taskType,
      payload: input.payload,
      payloadHash,
      idempotencyKey: input.idempotencyKey,
      status: 'Pending',
      attempts: 0,
      maxAttempts: config.task.maxAttempts,
      timeoutMs: typeConfig.timeoutMs,
      slaMs: typeConfig.slaMs,
      webhookUrl: input.webhookUrl,
      correlationId: input.correlationId,
      nextRunAt: now,
      lease: null,
      result: null,
      error: null,
      attemptLog: [],
      history: [{ from: null, to: 'Pending', at: now, reason: 'submitted' }],
      eventEmitted: false,
      createdAt: now,
      updatedAt: now,
      firstStartedAt: null,
      finishedAt: null,
    };

    const { created, task } = await repository.insertIdempotent(candidate);
    const log = logger.child({
      taskId: task._id,
      customerId: task.customerId,
      correlationId: input.correlationId,
    });

    if (created) {
      log.info('task submitted', { taskType: task.taskType });
      return { task, created };
    }
    if (task.payloadHash !== payloadHash) {
      log.warn('idempotency key reused with different request');
      throw new IdempotencyConflictError(input.idempotencyKey);
    }
    log.info('duplicate submission returned existing task', { status: task.status });
    return { task, created };
  }

  async get(taskId: string): Promise<TaskDocument> {
    const task = await this.deps.repository.findById(taskId);
    if (task === null) throw new NotFoundError('task', taskId);
    return task;
  }
}
