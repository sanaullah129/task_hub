import { sleep } from '../../shared/utils/sleep';
import { simulationSchema, type Simulation } from '../tasks/task.validation';
import type { TaskType } from '../tasks/task.constants';
import { HandlerError } from './execution.errors';
import type { HandlerContext, HandlerRegistry, TaskHandler } from './execution.types';
import type { JsonObject } from '../../shared/types/json';

export const DEFAULT_SIMULATED_DURATION_MS = 100;

const text = (payload: JsonObject, key: string): string => {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
};

function readSimulation(payload: JsonObject): Simulation {
  const parsed = simulationSchema.safeParse(payload['simulate'] ?? {});
  return parsed.success ? parsed.data : {};
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
}

const aborted = (): HandlerError => new HandlerError('aborted', 'Handler was aborted', true);

// `simulate` payload hints let demos and tests drive slow, failing, or hanging work.
function simulatedHandler(buildResult: (context: HandlerContext) => JsonObject): TaskHandler {
  return async (context) => {
    const { durationMs = DEFAULT_SIMULATED_DURATION_MS, failure, failTimes } = readSimulation(context.payload);
    const misbehave = failure !== undefined && (failTimes === undefined || context.attempt <= failTimes);

    if (misbehave && failure === 'hang') {
      await waitForAbort(context.signal);
      throw aborted();
    }
    await sleep(durationMs, context.signal);
    if (context.signal.aborted) throw aborted();

    if (misbehave && failure === 'retryable') {
      throw new HandlerError('simulated_failure', `Simulated retryable failure on attempt ${context.attempt}`, true);
    }
    if (misbehave && failure === 'fatal') {
      throw new HandlerError('simulated_fatal', 'Simulated non-retryable failure', false);
    }
    return buildResult(context);
  };
}

export function createSimulatedHandlers(): HandlerRegistry {
  const handlers: Record<TaskType, TaskHandler> = {
    document_processing: simulatedHandler(({ payload, attempt }) => ({
      documentId: text(payload, 'documentId'),
      status: 'processed',
      attempt,
    })),
    report_generation: simulatedHandler(({ payload, taskId, attempt }) => ({
      reportType: text(payload, 'reportType'),
      reportRef: `reports/${taskId}`,
      attempt,
    })),
    data_sync: simulatedHandler(({ payload, attempt }) => ({
      source: text(payload, 'source'),
      target: text(payload, 'target'),
      recordsSynced: 100,
      attempt,
    })),
  };
  return handlers;
}
