import type {
  AttemptRow,
  CustomerStatusCount,
  DeliveryRow,
  MetricsRepository,
  QueueWaitRow,
  TerminalTaskRow,
} from '../../src/modules/metrics/metrics.repository';

export interface MetricsData {
  queueWaits: QueueWaitRow[];
  attempts: AttemptRow[];
  pending: number;
  running: number;
  terminal: TerminalTaskRow[];
  perCustomer: CustomerStatusCount[];
  deliveries: DeliveryRow[];
}

export class FakeMetricsRepository implements MetricsRepository {
  readonly requestedSince: Date[] = [];

  constructor(private readonly data: Partial<MetricsData> = {}) {}

  queueWaits(since: Date): Promise<QueueWaitRow[]> {
    this.requestedSince.push(since);
    return Promise.resolve(this.data.queueWaits ?? []);
  }

  attempts(): Promise<AttemptRow[]> {
    return Promise.resolve(this.data.attempts ?? []);
  }

  taskCount(status: 'Pending' | 'Running'): Promise<number> {
    return Promise.resolve(status === 'Pending' ? (this.data.pending ?? 0) : (this.data.running ?? 0));
  }

  terminalTasks(): Promise<TerminalTaskRow[]> {
    return Promise.resolve(this.data.terminal ?? []);
  }

  tasksPerCustomer(): Promise<CustomerStatusCount[]> {
    return Promise.resolve(this.data.perCustomer ?? []);
  }

  deliveries(): Promise<DeliveryRow[]> {
    return Promise.resolve(this.data.deliveries ?? []);
  }
}
