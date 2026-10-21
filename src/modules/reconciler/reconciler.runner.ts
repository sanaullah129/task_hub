import type { Logger } from '../../observability/logger';
import { sleep as defaultSleep } from '../../shared/utils/sleep';
import type { ReconcileSummary } from './reconciler.service';

export interface ReconcilerRunnerDeps {
  service: { runOnce(): Promise<ReconcileSummary> };
  intervalMs: number;
  logger: Logger;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** Runs the reconciler immediately (startup recovery) and then on a fixed interval. */
export class ReconcilerRunner {
  private readonly stopSignal = new AbortController();
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private loop: Promise<void> | undefined;

  constructor(private readonly deps: ReconcilerRunnerDeps) {
    this.sleep = deps.sleep ?? defaultSleep;
  }

  start(): void {
    if (this.loop !== undefined) return;
    this.deps.logger.info('reconciler started', { intervalMs: this.deps.intervalMs });
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.stopSignal.abort();
    await this.loop;
    this.deps.logger.info('reconciler stopped');
  }

  private async run(): Promise<void> {
    while (!this.stopSignal.signal.aborted) {
      try {
        const summary = await this.deps.service.runOnce();
        if (summary.leasesRecovered + summary.eventsEmitted + summary.eventFailures > 0) {
          this.deps.logger.info('reconciler pass finished', { ...summary });
        }
      } catch (error) {
        this.deps.logger.error('reconciler pass failed', { error });
      }
      await this.sleep(this.deps.intervalMs, this.stopSignal.signal);
    }
  }
}
