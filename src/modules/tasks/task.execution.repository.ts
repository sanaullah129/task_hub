import type { Model } from 'mongoose';
import type { JsonObject } from '../../shared/types/json';
import { assertTransition } from './task.stateMachine';
import type { TaskDocument, TaskError } from './task.types';

export interface ClaimOptions {
  workerId: string;
  now: Date;
  leaseGraceMs: number;
}

/** Identifies one claimed attempt; completion only applies while this worker still owns it. */
export interface AttemptKey {
  taskId: string;
  attempt: number;
  workerId: string;
  /** When set, the completion only applies if the lease had already expired by this time (recovery). */
  leaseExpiredBefore?: Date;
}

export type AttemptCompletion =
  | { kind: 'completed'; result: JsonObject; reason: string }
  | {
      kind: 'retry';
      outcome: 'Failed' | 'TimedOut' | 'Abandoned';
      error: TaskError;
      nextRunAt: Date;
      reason: string;
    }
  | {
      kind: 'terminal';
      status: 'Failed' | 'TimedOut';
      error: TaskError;
      reason: string;
      /** Outcome recorded on the attempt log entry; defaults to `status`. */
      attemptOutcome?: 'Failed' | 'TimedOut' | 'Abandoned';
    };

export interface TaskExecutionRepository {
  /** Atomically moves the oldest due Pending task to Running for `workerId`, or returns null. */
  claimNext(options: ClaimOptions): Promise<TaskDocument | null>;
  /** Compare-and-set on the claimed attempt; returns null when the attempt is no longer owned. */
  completeAttempt(key: AttemptKey, completion: AttemptCompletion, now: Date): Promise<TaskDocument | null>;
}

export class MongooseTaskExecutionRepository implements TaskExecutionRepository {
  constructor(private readonly tasks: Model<TaskDocument>) {}

  claimNext({ workerId, now, leaseGraceMs }: ClaimOptions): Promise<TaskDocument | null> {
    const worker = { $literal: workerId };
    const attempt = { $add: ['$attempts', 1] };
    // A pipeline update lets the lease length follow each task's own timeoutMs.
    const pipeline = [
      {
        $set: {
          status: 'Running',
          attempts: attempt,
          lease: { workerId: worker, expiresAt: { $add: [now, '$timeoutMs', leaseGraceMs] } },
          firstStartedAt: { $ifNull: ['$firstStartedAt', now] },
          updatedAt: now,
          attemptLog: {
            $concatArrays: [
              '$attemptLog',
              [{ n: attempt, workerId: worker, startedAt: now, finishedAt: null, outcome: null }],
            ],
          },
          history: {
            $concatArrays: [
              '$history',
              [
                {
                  from: 'Pending',
                  to: 'Running',
                  at: now,
                  reason: { $concat: ['claimed by ', worker, ' (attempt ', { $toString: attempt }, ')'] },
                },
              ],
            ],
          },
        },
      },
    ];

    return this.tasks
      .findOneAndUpdate({ status: 'Pending', nextRunAt: { $lte: now } }, pipeline, {
        sort: { nextRunAt: 1 },
        returnDocument: 'after',
        updatePipeline: true,
      })
      .lean<TaskDocument>()
      .exec();
  }

  completeAttempt(key: AttemptKey, completion: AttemptCompletion, now: Date): Promise<TaskDocument | null> {
    const toStatus = completion.kind === 'completed' ? 'Completed' : completion.kind === 'retry' ? 'Pending' : completion.status;
    assertTransition('Running', toStatus);

    const attemptFields = (outcome: string, error?: TaskError): Record<string, unknown> => ({
      'attemptLog.$[a].finishedAt': now,
      'attemptLog.$[a].outcome': outcome,
      ...(error === undefined ? {} : { 'attemptLog.$[a].error': error }),
    });
    const common = { updatedAt: now, lease: null };

    let set: Record<string, unknown>;
    switch (completion.kind) {
      case 'completed':
        set = {
          ...common,
          status: 'Completed',
          result: completion.result,
          finishedAt: now,
          eventPending: true,
          ...attemptFields('Completed'),
        };
        break;
      case 'retry':
        set = {
          ...common,
          status: 'Pending',
          nextRunAt: completion.nextRunAt,
          ...attemptFields(completion.outcome, completion.error),
        };
        break;
      case 'terminal':
        set = {
          ...common,
          status: completion.status,
          error: completion.error,
          finishedAt: now,
          eventPending: true,
          ...attemptFields(completion.attemptOutcome ?? completion.status, completion.error),
        };
        break;
    }

    return this.tasks
      .findOneAndUpdate(
        {
          _id: key.taskId,
          status: 'Running',
          attempts: key.attempt,
          'lease.workerId': key.workerId,
          ...(key.leaseExpiredBefore === undefined ? {} : { 'lease.expiresAt': { $lte: key.leaseExpiredBefore } }),
        },
        { $set: set, $push: { history: { from: 'Running', to: toStatus, at: now, reason: completion.reason } } },
        { arrayFilters: [{ 'a.n': key.attempt }], returnDocument: 'after' },
      )
      .lean<TaskDocument>()
      .exec();
  }
}
