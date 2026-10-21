import type { Logger } from '../../observability/logger';
import { sleep as defaultSleep } from '../utils/sleep';

export interface PollingWorkerDeps<T> {
  /** Used as the prefix of log messages, e.g. "task worker". */
  name: string;
  workerId: string;
  logger: Logger;
  claim(): Promise<T | null>;
  process(item: T): Promise<void>;
  /** Extra log fields identifying an item whose processing failed. */
  describe(item: T): Record<string, unknown>;
  concurrency: number;
  pollIntervalMs: number;
  shutdownTimeoutMs: number;
  claimErrorMessage: string;
  processErrorMessage: string;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

/** Claims items one at a time, processes up to `concurrency` in parallel, and drains on stop. */
export class PollingWorker<T> {
  private readonly inFlight = new Set<Promise<void>>();
  private readonly wake = new AbortController();
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private stopping = false;
  private loop: Promise<void> | undefined;

  constructor(private readonly deps: PollingWorkerDeps<T>) {
    this.sleep = deps.sleep ?? defaultSleep;
    this.random = deps.random ?? Math.random;
  }

  get activeCount(): number {
    return this.inFlight.size;
  }

  start(): void {
    if (this.loop !== undefined) return;
    this.deps.logger.info(`${this.deps.name} started`, {
      workerId: this.deps.workerId,
      concurrency: this.deps.concurrency,
    });
    this.loop = this.run();
  }

  /** Stops claiming and waits up to the shutdown timeout; leftovers are recovered through lease expiry. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.wake.abort();
    await this.loop;

    const deadline = new AbortController();
    const drained = Promise.allSettled([...this.inFlight]).then(() => true);
    const timedOut = this.sleep(this.deps.shutdownTimeoutMs, deadline.signal).then(() => false);
    const completed = await Promise.race([drained, timedOut]);
    deadline.abort();

    const { name, workerId, logger } = this.deps;
    if (completed) logger.info(`${name} stopped`, { workerId });
    else logger.warn(`${name} stopped with work still running`, { workerId, running: this.inFlight.size });
  }

  private async run(): Promise<void> {
    const { logger, workerId, claimErrorMessage, concurrency } = this.deps;
    while (!this.stopping) {
      if (this.inFlight.size >= concurrency) {
        await Promise.race(this.inFlight);
        continue;
      }

      let item: T | null;
      try {
        item = await this.deps.claim();
      } catch (error) {
        logger.error(claimErrorMessage, { workerId, error });
        item = null;
      }

      if (item === null) {
        await this.sleep(Math.round(this.deps.pollIntervalMs * (0.5 + this.random())), this.wake.signal);
        continue;
      }
      this.track(item);
    }
  }

  private track(item: T): void {
    const work: Promise<void> = this.deps
      .process(item)
      .catch((error: unknown) => {
        this.deps.logger.error(this.deps.processErrorMessage, { ...this.deps.describe(item), error });
      })
      .finally(() => this.inFlight.delete(work));
    this.inFlight.add(work);
  }
}
