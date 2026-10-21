import { type ChildProcess, spawn } from 'node:child_process';
import { connectDatabase } from '../src/database/client';
import { loadConfig } from '../src/config/config';
import { MockReceiver } from './lib/mockReceiver';

/* Local demonstration of the PRD scenarios. Starts a mock webhook receiver and the service, drives
   each scenario through the public API, and prints the evidence. Needs a local MongoDB; uses (and
   drops) the throwaway database `taskhub_demo`. */

const API_PORT = Number(process.env['DEMO_API_PORT'] ?? 3100);
const DB_NAME = 'taskhub_demo';
const BASE = `http://127.0.0.1:${API_PORT}`;
const CUSTOMER = 'acme';

type Json = Record<string, unknown>;

const serviceEnv = (receiverPort: number): NodeJS.ProcessEnv => ({
  ...process.env,
  PORT: String(API_PORT),
  MONGODB_DB: DB_NAME,
  DEMO_MODE: 'true',
  LOG_LEVEL: 'info',
  TASK_TIMEOUT_MS: '1500',
  TASK_MAX_ATTEMPTS: '3',
  TASK_RETRY_BASE_MS: '200',
  TASK_RETRY_CAP_MS: '1000',
  TASK_POLL_INTERVAL_MS: '100',
  TASK_LEASE_GRACE_MS: '500',
  DELIVERY_POLL_INTERVAL_MS: '100',
  DELIVERY_BACKOFF_BASE_MS: '200',
  DELIVERY_BACKOFF_CAP_MS: '1000',
  DELIVERY_MAX_ATTEMPTS: '4',
  RECONCILER_INTERVAL_MS: '300',
  RECEIVER_PORT: String(receiverPort),
});

const sleepMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(label: string, check: () => Promise<T | undefined>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleepMs(100);
  }
}

async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text.length > 0 && text.startsWith('{') ? (JSON.parse(text) as Json) : { text } };
}

const section = (title: string): void => console.log(`\n=== ${title} ${'='.repeat(Math.max(3, 70 - title.length))}`);
const show = (label: string, value: unknown): void =>
  console.log(`  ${label.padEnd(26)} ${typeof value === 'string' ? value : JSON.stringify(value)}`);

class Service {
  private child: ChildProcess | undefined;
  readonly logLines: Json[] = [];

  constructor(private readonly env: NodeJS.ProcessEnv) {}

  async start(): Promise<void> {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { env: this.env, stdio: ['ignore', 'pipe', 'inherit'] });
    this.child = child;
    let buffered = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        try {
          this.logLines.push(JSON.parse(line) as Json);
        } catch {
          /* not a JSON log line */
        }
      }
    });
    await until('service health', async () => {
      try {
        return (await api('GET', '/healthz')).status === 200 ? true : undefined;
      } catch {
        return undefined;
      }
    });
  }

  async stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    const child = this.child;
    if (child === undefined) return;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill(signal);
    await exited;
    this.child = undefined;
  }
}

async function main(): Promise<void> {
  const cleanup = await connectDatabase(loadConfig({ MONGODB_DB: DB_NAME, ...(process.env['MONGODB_URI'] === undefined ? {} : { MONGODB_URI: process.env['MONGODB_URI'] }) }).mongo);
  await cleanup.connection.dropDatabase();

  const receiver = new MockReceiver();
  const receiverPort = await receiver.listen(0);
  const hook = (name: string): string => `http://127.0.0.1:${receiverPort}/hook/${name}`;
  const service = new Service(serviceEnv(receiverPort));

  const submit = async (idempotencyKey: string, taskType: string, payload: Json, correlationId: string, extra: Json = {}): Promise<string> => {
    const res = await api('POST', '/v1/tasks', { customerId: CUSTOMER, taskType, payload, idempotencyKey, ...extra }, { 'X-Correlation-Id': correlationId });
    if (res.status !== 202) throw new Error(`submit failed: ${JSON.stringify(res)}`);
    return String(res.body['taskId']);
  };
  const ended = (taskId: string): Promise<Json> =>
    until(`task ${taskId}`, async () => {
      const task = (await api('GET', `/v1/tasks/${taskId}`)).body;
      return ['Completed', 'Failed', 'TimedOut'].includes(String(task['status'])) ? task : undefined;
    });
  const delivery = async (taskId: string, wanted: string[]): Promise<Json> =>
    until(`delivery of ${taskId}`, async () => {
      const events = ((await api('GET', `/v1/tasks/${taskId}/events`)).body['items'] as Json[]) ?? [];
      const first = events[0];
      return first !== undefined && wanted.includes(String((first['delivery'] as Json)['status'])) ? first : undefined;
    });
  const attempts = (event: Json): string =>
    ((event['delivery'] as Json)['attempts'] as Json[]).map((attempt) => String(attempt['statusCode'] ?? attempt['error'])).join(', ');

  try {
    await service.start();
    const secret = String((await api('PUT', `/v1/customers/${CUSTOMER}/webhook`, { url: hook('default') })).body['secret']);
    receiver.setSecret(secret);
    console.log('TaskHub demo: service, mock receiver and MongoDB are up.');
    show('customer', `${CUSTOMER} -> ${hook('default')} (secret ${secret.slice(0, 10)}...)`);

    section('1. Normal task: submit, execute, retrieve result, signed webhook');
    const normalId = await submit('demo-normal', 'document_processing', { documentId: 'doc_1', simulate: { durationMs: 150 } }, 'demo-normal');
    show('submitted (202)', { taskId: normalId });
    const normal = await ended(normalId);
    const normalEvent = await delivery(normalId, ['Delivered']);
    show('task', { status: normal['status'], attempts: normal['attempts'], result: normal['result'] });
    show('event', { type: normalEvent['eventType'], delivery: (normalEvent['delivery'] as Json)['status'], attempts: attempts(normalEvent) });
    const normalHook = receiver.forPath('/hook/default').find((entry) => entry.eventId === normalEvent['eventId']);
    show('receiver saw', { eventType: normalHook?.eventType, signatureValid: normalHook?.signatureValid, duplicate: normalHook?.duplicate });

    section('2. Failed task: recorded failure and a terminal notification');
    const failedId = await submit('demo-failed', 'data_sync', { source: 'crm', target: 'dwh', simulate: { durationMs: 50, failure: 'fatal' } }, 'demo-failed');
    const failed = await ended(failedId);
    const failedEvent = await delivery(failedId, ['Delivered']);
    show('task', { status: failed['status'], error: failed['error'] });
    show('event', { type: failedEvent['eventType'], delivery: (failedEvent['delivery'] as Json)['status'] });

    section('3. Timed-out task: attempts time out, retried, ends TimedOut');
    const hangId = await submit('demo-timeout', 'report_generation', { reportType: 'q3', simulate: { failure: 'hang' } }, 'demo-timeout');
    const hung = await ended(hangId);
    const hungEvent = await delivery(hangId, ['Delivered']);
    show('task', { status: hung['status'], attempts: hung['attempts'], error: hung['error'] });
    show('attempt outcomes', (hung['attemptLog'] as Json[]).map((attempt) => attempt['outcome']));
    show('event', { type: hungEvent['eventType'], delivery: (hungEvent['delivery'] as Json)['status'] });

    section('4. Restart recovery: kill the service mid-execution, restart, task still completes');
    const recoverId = await submit('demo-recover', 'document_processing', { documentId: 'doc_big', simulate: { durationMs: 1_200 } }, 'demo-recover');
    await until('task running', async () => ((await api('GET', `/v1/tasks/${recoverId}`)).body['status'] === 'Running' ? true : undefined));
    show('status before kill', 'Running (SIGKILL sent now)');
    await service.stop('SIGKILL');
    await service.start();
    show('service restarted', 'lease expires, reconciler requeues the abandoned attempt');
    const recovered = await ended(recoverId);
    const recoveredEvent = await delivery(recoverId, ['Delivered']);
    show('task', { status: recovered['status'], attempts: recovered['attempts'] });
    show('attempt outcomes', (recovered['attemptLog'] as Json[]).map((attempt) => attempt['outcome']));
    show('notifications received', receiver.forPath('/hook/default').filter((entry) => entry.eventId === recoveredEvent['eventId']).length);

    section('5. Duplicate submission: concurrent identical requests, one outcome');
    const body = { customerId: CUSTOMER, taskType: 'data_sync', payload: { source: 'a', target: 'b', simulate: { durationMs: 100 } }, idempotencyKey: 'demo-dup' };
    const results = await Promise.all(Array.from({ length: 10 }, () => api('POST', '/v1/tasks', body)));
    const ids = new Set(results.map((res) => String(res.body['taskId'])));
    show('responses', { '202': results.filter((res) => res.status === 202).length, '200': results.filter((res) => res.status === 200).length });
    show('distinct task ids', [...ids]);
    const conflict = await api('POST', '/v1/tasks', { ...body, payload: { source: 'x', target: 'y' } });
    show('changed payload', { status: conflict.status, error: (conflict.body['error'] as Json | undefined)?.['code'] });
    const dupId = [...ids][0] ?? '';
    await ended(dupId);
    const dupEvent = await delivery(dupId, ['Delivered']);
    show('notifications received', receiver.forPath('/hook/default').filter((entry) => entry.eventId === dupEvent['eventId']).length);

    section('6. Webhook endpoint failure: attempts, retries, final status, operator replay');
    receiver.setMode('/hook/flaky', { kind: 'fail-n', remaining: 2, status: 503 });
    const flakyId = await submit('demo-flaky', 'document_processing', { documentId: 'doc_f', simulate: { durationMs: 50 } }, 'demo-flaky', { webhookUrl: hook('flaky') });
    const flakyEvent = await delivery(flakyId, ['Delivered']);
    show('endpoint behaviour', 'first 2 requests -> 503, then 200');
    show('delivery', { status: (flakyEvent['delivery'] as Json)['status'], attemptCount: (flakyEvent['delivery'] as Json)['attemptCount'], attempts: attempts(flakyEvent) });
    show('same eventId each retry', new Set(receiver.forPath('/hook/flaky').map((entry) => entry.eventId)).size === 1);

    receiver.setMode('/hook/dead', { kind: 'always-500' });
    const deadId = await submit('demo-dead', 'document_processing', { documentId: 'doc_d', simulate: { durationMs: 50 } }, 'demo-dead', { webhookUrl: hook('dead') });
    const deadEvent = await delivery(deadId, ['Failed']);
    show('dead endpoint', { status: (deadEvent['delivery'] as Json)['status'], attempts: attempts(deadEvent), lastError: (deadEvent['delivery'] as Json)['lastError'] });
    show('task is unaffected', (await api('GET', `/v1/tasks/${deadId}`)).body['status']);
    const failedList = (await api('GET', '/v1/deliveries?status=Failed')).body['items'] as Json[];
    show('operator sees failed', failedList.map((item) => item['eventId']));
    receiver.setMode('/hook/dead', { kind: 'ok' });
    show('operator replay', (await api('POST', `/v1/deliveries/${String(deadEvent['eventId'])}/retry`)).status);
    const replayed = await delivery(deadId, ['Delivered']);
    show('after replay', { status: (replayed['delivery'] as Json)['status'], attemptCount: (replayed['delivery'] as Json)['attemptCount'] });

    section('7. Metrics: measured values, definitions, units, windows (last 15m)');
    const summary = (await api('GET', '/v1/ops/metrics/summary?window=15m')).body as { technical: Record<string, Json>; business: Record<string, Json> };
    const latency = (name: string, group: Record<string, Json>): void => {
      const metric = group[name] ?? {};
      show(name, `n=${String(metric['count'])} p50=${String(metric['p50'])} p96=${String(metric['p96'])} p99=${String(metric['p99'])} ${String(metric['unit'])}`);
    };
    const value = (name: string, group: Record<string, Json>): void => {
      const metric = group[name] ?? {};
      show(name, `${JSON.stringify(metric['value'])} ${String(metric['unit'])}`);
    };
    console.log('  technical');
    latency('apiLatency', summary.technical);
    value('apiRequestRate', summary.technical);
    value('apiErrorRate5xx', summary.technical);
    latency('queueWait', summary.technical);
    latency('executionDuration', summary.technical);
    value('pendingTasks', summary.technical);
    value('activeTasks', summary.technical);
    latency('webhookAttemptLatency', summary.technical);
    value('webhookAttemptsPerEvent', summary.technical);
    value('webhookFailureRate', summary.technical);
    console.log('  business');
    value('taskCompletionRate', summary.business);
    value('taskTerminalFailureRate', summary.business);
    latency('taskTurnaround', summary.business);
    value('slaCompliance', summary.business);
    show('tasksPerCustomer', summary.business['tasksPerCustomer']?.['value']);
    value('webhookDeliverySuccessRate', summary.business);
    latency('notificationLatency', summary.business);
    show('definition example', String(summary.business['notificationLatency']?.['definition']));
    const prometheus = await fetch(`${BASE}/metrics`).then((res) => res.text());
    show('prometheus (excerpt)', prometheus.split('\n').filter((line) => line.startsWith('taskhub_tasks_terminal_total')).join(' | '));

    section('8. Failure investigation: one task, its execution and notification history');
    const investigation = (await api('GET', `/v1/ops/tasks/${deadId}/investigation`)).body;
    for (const line of investigation['summary'] as string[]) console.log(`  summary: ${line}`);
    for (const entry of investigation['timeline'] as Array<{ at: string; source: string; message: string }>) {
      console.log(`  ${entry.at.slice(11, 23)}  ${entry.source.padEnd(8)} ${entry.message}`);
    }
    const correlationId = String((investigation['logCorrelation'] as Json)['correlationId']);
    const correlated = service.logLines.filter((line) => line['correlationId'] === correlationId);
    show('correlated log lines', `${correlated.length} for correlationId ${correlationId}`);
    for (const line of correlated.slice(0, 8)) {
      const role = typeof line['role'] === 'string' ? line['role'] : 'api';
      console.log(`    ${role.padEnd(8)} ${String(line['message'])}`);
    }

    console.log('\nDemo finished.');
  } finally {
    await service.stop();
    await receiver.close();
    await cleanup.connection.dropDatabase();
    await cleanup.close();
  }
}

main().catch((error: unknown) => {
  console.error('demo failed:', error);
  process.exit(1);
});
