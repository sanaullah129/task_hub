import { WINDOWS } from '../metrics/metrics.window';
import { DELIVERY_STATUSES, EVENT_TYPES } from '../events/event.constants';
import { ATTEMPT_OUTCOMES, TASK_STATUSES, TASK_TYPES } from '../tasks/task.constants';
import type { JsonObject } from '../../shared/types/json';

const ref = (name: string): JsonObject => ({ $ref: `#/components/schemas/${name}` });
const errorRef = (name: string): JsonObject => ({ $ref: `#/components/responses/${name}` });
const param = (name: string): JsonObject => ({ $ref: `#/components/parameters/${name}` });
const json = (schema: JsonObject, example?: JsonObject): JsonObject => ({
  'application/json': { schema, ...(example === undefined ? {} : { example }) },
});
const ok = (description: string, schema: JsonObject): JsonObject => ({ description, content: json(schema) });
const nullable = (schema: JsonObject): JsonObject => ({ ...schema, nullable: true });
const date = (description?: string): JsonObject => ({
  type: 'string',
  format: 'date-time',
  ...(description === undefined ? {} : { description }),
});
const str = (description?: string): JsonObject => ({ type: 'string', ...(description === undefined ? {} : { description }) });
const int = (description?: string): JsonObject => ({ type: 'integer', ...(description === undefined ? {} : { description }) });

const DESCRIPTION = `
TaskHub accepts long-running operations, executes them asynchronously, and notifies customers by webhook when they end.

**Typical flow**
1. \`PUT /v1/customers/{customerId}/webhook\` to register where notifications go (the signing secret is returned once).
2. \`POST /v1/tasks\` to submit work. The response is \`202\` and does not wait for execution.
3. \`GET /v1/tasks/{taskId}\` to poll status and the result or failure details.
4. Receive \`task.completed\`, \`task.failed\` or \`task.timed_out\` at your webhook URL.
5. Use the operator endpoints to inspect deliveries, replay failures, investigate a task, and read metrics.

**Idempotency.** Submissions are unique per \`(customerId, idempotencyKey)\`. Repeating the same request returns the original task (\`200\`); reusing the key with a different task type or payload returns \`409\`.

**Correlation.** Send \`X-Correlation-Id\` (letters, digits, \`. _ : -\`, up to 128 chars) to trace a task through logs, the stored task, the event and the webhook headers. Every response echoes the id used.

**Webhook requests** are \`POST\` with a JSON body (see the \`WebhookPayload\` schema) and these headers: \`X-TaskHub-Event-Id\` (stable across retries; deduplicate on it),
\`X-TaskHub-Event-Type\`, \`X-TaskHub-Correlation-Id\`, \`X-TaskHub-Delivery-Attempt\`, \`X-TaskHub-Timestamp\` and
\`X-TaskHub-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" using your secret>\`.
Respond with any \`2xx\` to acknowledge. Network errors, timeouts, \`408\`, \`429\` and \`5xx\` are retried with exponential backoff; other responses are permanent failures.
Delivery is at-least-once, and a completed task and a delivered webhook are tracked separately.

**Simulated handlers.** Task handlers are simulated. \`payload.simulate\` accepts \`durationMs\`, \`failure\` (\`retryable\`, \`fatal\`, \`hang\`) and \`failTimes\` (misbehave only for the first N attempts).

**Pagination.** List endpoints return \`items\` and \`nextCursor\`; pass \`nextCursor\` back as \`cursor\` for the next page (newest first).
`.trim();

const schemas: JsonObject = {
  Error: {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message', 'correlationId'],
        properties: {
          code: str('Stable machine-readable code, e.g. validation_error, idempotency_conflict, task_not_found'),
          message: str(),
          details: { type: 'array', items: str(), description: 'Validation problems, one per field' },
          correlationId: str(),
        },
      },
    },
  },
  TaskError: {
    type: 'object',
    required: ['code', 'message', 'retryable'],
    properties: { code: str(), message: str(), retryable: { type: 'boolean' } },
  },
  TaskAttempt: {
    type: 'object',
    properties: {
      n: int('1-based attempt number'),
      startedAt: date(),
      finishedAt: nullable(date()),
      outcome: nullable({ type: 'string', enum: [...ATTEMPT_OUTCOMES], description: 'Abandoned = the worker stopped before finishing (recovered by the reconciler)' }),
      error: nullable(ref('TaskError')),
    },
  },
  SubmitTaskRequest: {
    type: 'object',
    required: ['customerId', 'taskType', 'payload', 'idempotencyKey'],
    properties: {
      customerId: str('Letters, digits and . _ : @ - (max 128)'),
      taskType: { type: 'string', enum: [...TASK_TYPES] },
      payload: {
        type: 'object',
        additionalProperties: true,
        description:
          'Required fields depend on taskType: document_processing needs documentId; report_generation needs reportType; data_sync needs source and target. Extra fields are kept. Optional `simulate`: { durationMs (0-600000), failure: retryable|fatal|hang, failTimes (0-10) }.',
      },
      idempotencyKey: { type: 'string', minLength: 1, maxLength: 255 },
      webhookUrl: str('Optional per-task webhook URL; overrides the customer default. https and public unless the server runs in demo mode.'),
    },
  },
  Task: {
    type: 'object',
    properties: {
      taskId: str(),
      customerId: str(),
      taskType: { type: 'string', enum: [...TASK_TYPES] },
      status: { type: 'string', enum: [...TASK_STATUSES], description: 'Pending and Running are active; Completed, Failed and TimedOut are terminal' },
      attempts: int('Attempts started so far'),
      maxAttempts: int(),
      correlationId: str(),
      createdAt: date(),
      updatedAt: date(),
      startedAt: nullable(date('Start of the first attempt')),
      finishedAt: nullable(date('When the task reached a terminal state')),
      result: nullable({ type: 'object', additionalProperties: true }),
      error: nullable(ref('TaskError')),
      attemptLog: { type: 'array', items: ref('TaskAttempt') },
    },
  },
  TaskPage: {
    type: 'object',
    properties: { items: { type: 'array', items: ref('Task') }, nextCursor: nullable(str('Pass as `cursor` to fetch the next page; null on the last page')) },
  },
  WebhookConfigRequest: {
    type: 'object',
    required: ['url'],
    properties: {
      url: str('Where notifications are sent'),
      secret: { type: 'string', minLength: 16, maxLength: 256, description: 'Signing secret. Generated and returned once when omitted.' },
    },
  },
  WebhookConfigResponse: {
    type: 'object',
    properties: {
      customerId: str(),
      webhook: { type: 'object', properties: { url: str() } },
      secret: str('Present only when the server generated the secret. Store it now; it cannot be read back.'),
    },
  },
  WebhookConfigView: {
    type: 'object',
    properties: {
      customerId: str(),
      webhook: { type: 'object', properties: { url: str(), secretConfigured: { type: 'boolean' } } },
    },
  },
  WebhookPayload: {
    type: 'object',
    description: 'JSON body of every webhook request',
    properties: {
      eventId: str('Stable across retries; use for deduplication'),
      eventType: { type: 'string', enum: [...EVENT_TYPES] },
      taskId: str(),
      customerId: str(),
      timestamp: date('When the event was created'),
      correlationId: str(),
      data: {
        type: 'object',
        description: 'Outcome details',
        properties: {
          taskType: str(),
          status: str(),
          attempts: int(),
          createdAt: date(),
          startedAt: nullable(date()),
          finishedAt: date(),
          turnaroundMs: int(),
          result: nullable({ type: 'object', additionalProperties: true }),
          error: nullable({ type: 'object', properties: { code: str(), message: str() } }),
        },
      },
    },
  },
  DeliveryAttempt: {
    type: 'object',
    properties: {
      n: int(),
      startedAt: date(),
      durationMs: int(),
      statusCode: nullable(int('HTTP status; null for network errors and timeouts')),
      error: nullable(str()),
      responseSnippet: nullable(str('First 200 characters of the response body')),
    },
  },
  Delivery: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: [...DELIVERY_STATUSES], description: 'Skipped = no webhook URL was configured when the event was created' },
      attemptCount: int(),
      maxAttempts: int(),
      nextAttemptAt: nullable(date()),
      deliveredAt: nullable(date()),
      lastError: nullable(str()),
      attempts: { type: 'array', items: ref('DeliveryAttempt') },
    },
  },
  Event: {
    type: 'object',
    properties: {
      eventId: str(),
      eventType: { type: 'string', enum: [...EVENT_TYPES] },
      taskId: str(),
      customerId: str(),
      correlationId: str(),
      createdAt: date(),
      url: nullable(str('Resolved destination: task override, else customer default')),
      body: ref('WebhookPayload'),
      delivery: ref('Delivery'),
    },
  },
  EventList: { type: 'object', properties: { items: { type: 'array', items: ref('Event') } } },
  EventPage: {
    type: 'object',
    properties: { items: { type: 'array', items: ref('Event') }, nextCursor: nullable(str()) },
  },
  TimelineEntry: {
    type: 'object',
    properties: {
      at: date(),
      source: { type: 'string', enum: ['task', 'attempt', 'event', 'delivery'] },
      message: str(),
    },
  },
  Investigation: {
    type: 'object',
    properties: {
      summary: { type: 'array', items: str(), description: 'Plain-language explanation of the task and its notifications' },
      task: {
        allOf: [ref('Task')],
        description: 'Task plus operator-only fields: idempotencyKey, payload, timeoutMs, slaMs, webhookUrl, eventPending, lease, history',
      },
      events: { type: 'array', items: ref('Event') },
      timeline: { type: 'array', items: ref('TimelineEntry'), description: 'Task history, attempts, events and webhook attempts in time order' },
      logCorrelation: { type: 'object', properties: { correlationId: str(), hint: str() } },
    },
  },
  LatencyMetric: {
    type: 'object',
    description: 'Exact nearest-rank percentiles over the window',
    properties: {
      definition: str(),
      unit: str(),
      window: str(),
      count: int(),
      p50: nullable({ type: 'number' }),
      p96: nullable({ type: 'number' }),
      p99: nullable({ type: 'number' }),
      avg: nullable({ type: 'number' }),
      max: nullable({ type: 'number' }),
    },
  },
  ValueMetric: {
    type: 'object',
    properties: {
      definition: str(),
      unit: str(),
      window: str(),
      value: nullable({ type: 'number' }),
      numerator: int(),
      denominator: int(),
    },
  },
  MetricsSummary: {
    type: 'object',
    properties: {
      window: { type: 'string', enum: Object.keys(WINDOWS) },
      since: date(),
      generatedAt: date(),
      notes: { type: 'array', items: str() },
      technical: {
        type: 'object',
        description:
          'apiRequestRate, apiErrorRate5xx, apiClientErrorRate4xx, apiLatency (also byRoute), queueWait, executionDuration (also byTaskType), pendingTasks, activeTasks, webhookAttemptLatency, webhookAttemptsPerEvent, webhookFailureRate. Latency metrics follow LatencyMetric; the rest follow ValueMetric.',
        additionalProperties: true,
      },
      business: {
        type: 'object',
        description:
          'taskCompletionRate, taskTerminalFailureRate, taskTurnaround, slaCompliance (also byTaskType), tasksPerCustomer, webhookDeliverySuccessRate, notificationLatency.',
        additionalProperties: true,
      },
    },
  },
  Health: { type: 'object', properties: { status: { type: 'string', enum: ['ok', 'unavailable'] } } },
};

const parameters: JsonObject = {
  taskId: { name: 'taskId', in: 'path', required: true, schema: str(), example: 'tsk_3d7a2774-5c34-4689-8095-11d8e72b3ef1' },
  eventId: { name: 'eventId', in: 'path', required: true, schema: str(), example: 'evt_9a844059-3799-409b-ae96-0558bc8eedd3' },
  customerId: { name: 'customerId', in: 'path', required: true, schema: str(), example: 'acme' },
  limit: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
  cursor: { name: 'cursor', in: 'query', schema: str(), description: 'nextCursor from the previous page' },
  correlationId: {
    name: 'X-Correlation-Id',
    in: 'header',
    required: false,
    schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,128}$' },
    description: 'Optional trace id; generated when absent or invalid. Echoed in the response header.',
  },
};

const responses: JsonObject = {
  ValidationError: {
    description: 'The request failed validation (code validation_error, invalid_json)',
    content: json(ref('Error'), {
      error: { code: 'validation_error', message: 'Request validation failed', details: ['taskType: Invalid option'], correlationId: 'cor_1' },
    }),
  },
  NotFound: { description: 'The resource does not exist', content: json(ref('Error')) },
  Conflict: { description: 'The request conflicts with current state', content: json(ref('Error')) },
  PayloadTooLarge: { description: 'The request body exceeds the size limit', content: json(ref('Error')) },
};

const taskExample: JsonObject = {
  customerId: 'acme',
  taskType: 'document_processing',
  payload: { documentId: 'doc_1' },
  idempotencyKey: 'order-1001',
};

export function buildOpenApiSpec(): JsonObject {
  return {
    openapi: '3.0.3',
    info: { title: 'TaskHub API', version: '1.0.0', description: DESCRIPTION },
    servers: [{ url: '/', description: 'This server' }],
    tags: [
      { name: 'Tasks', description: 'Submit work and read its progress and result' },
      { name: 'Customers', description: 'Webhook configuration' },
      { name: 'Deliveries', description: 'Webhook events and their delivery attempts' },
      { name: 'Operations', description: 'Investigation and metrics for operators (unauthenticated in this version)' },
      { name: 'Health', description: 'Liveness' },
    ],
    paths: {
      '/v1/tasks': {
        post: {
          tags: ['Tasks'],
          summary: 'Submit a task',
          description: 'Returns immediately with the task id. `202` for a new task, `200` when the idempotency key was already used with the same request.',
          parameters: [param('correlationId')],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: ref('SubmitTaskRequest'),
                examples: {
                  document: { summary: 'Document processing', value: taskExample },
                  flaky: {
                    summary: 'Fails once, then succeeds (simulated)',
                    value: { ...taskExample, idempotencyKey: 'order-1002', payload: { documentId: 'doc_2', simulate: { failure: 'retryable', failTimes: 1 } } },
                  },
                  hang: {
                    summary: 'Times out (simulated)',
                    value: { customerId: 'acme', taskType: 'report_generation', payload: { reportType: 'monthly', simulate: { failure: 'hang' } }, idempotencyKey: 'order-1003' },
                  },
                },
              },
            },
          },
          responses: {
            '202': ok('Task accepted', ref('Task')),
            '200': ok('Duplicate submission; the original task is returned', ref('Task')),
            '400': errorRef('ValidationError'),
            '409': errorRef('Conflict'),
            '413': errorRef('PayloadTooLarge'),
          },
        },
        get: {
          tags: ['Tasks'],
          summary: 'List tasks',
          description: 'Newest first. Filter by customer and status.',
          parameters: [
            { name: 'customerId', in: 'query', schema: str() },
            { name: 'status', in: 'query', schema: { type: 'string', enum: [...TASK_STATUSES] } },
            param('limit'),
            param('cursor'),
          ],
          responses: { '200': ok('A page of tasks', ref('TaskPage')), '400': errorRef('ValidationError') },
        },
      },
      '/v1/tasks/{taskId}': {
        get: {
          tags: ['Tasks'],
          summary: 'Get task status and result',
          description: 'Includes the result when Completed, and the error and every attempt when Failed or TimedOut.',
          parameters: [param('taskId')],
          responses: { '200': ok('The task', ref('Task')), '404': errorRef('NotFound') },
        },
      },
      '/v1/customers/{customerId}/webhook': {
        put: {
          tags: ['Customers'],
          summary: 'Set the default webhook',
          description: 'Replaces the configuration. When `secret` is omitted a secret is generated and returned **once**.',
          parameters: [param('customerId')],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('WebhookConfigRequest'), example: { url: 'https://hooks.example.com/taskhub' } } },
          },
          responses: { '200': ok('Configured', ref('WebhookConfigResponse')), '400': errorRef('ValidationError') },
        },
        get: {
          tags: ['Customers'],
          summary: 'Show the webhook configuration',
          description: 'Never returns the secret.',
          parameters: [param('customerId')],
          responses: { '200': ok('Current configuration', ref('WebhookConfigView')), '404': errorRef('NotFound'), '400': errorRef('ValidationError') },
        },
      },
      '/v1/tasks/{taskId}/events': {
        get: {
          tags: ['Deliveries'],
          summary: 'Events and delivery attempts of a task',
          description: 'Use this to see whether and how the notification for a task was delivered.',
          parameters: [param('taskId')],
          responses: { '200': ok('Events, oldest first', ref('EventList')) },
        },
      },
      '/v1/deliveries': {
        get: {
          tags: ['Deliveries'],
          summary: 'List deliveries',
          description: 'Operator view, newest first. Use `status=Failed` to find missing notifications.',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string', enum: [...DELIVERY_STATUSES] } },
            { name: 'customerId', in: 'query', schema: str() },
            param('limit'),
            param('cursor'),
          ],
          responses: { '200': ok('A page of events', ref('EventPage')), '400': errorRef('ValidationError') },
        },
      },
      '/v1/deliveries/{eventId}/retry': {
        post: {
          tags: ['Deliveries'],
          summary: 'Replay a failed delivery',
          description: 'Gives a `Failed` delivery a fresh attempt budget. Other states return `409`.',
          parameters: [param('eventId')],
          responses: { '202': ok('Requeued', ref('Event')), '404': errorRef('NotFound'), '409': errorRef('Conflict') },
        },
      },
      '/v1/ops/tasks/{taskId}/investigation': {
        get: {
          tags: ['Operations'],
          summary: 'Investigate one task',
          description: 'Task, state history, attempts, events, webhook attempts, a merged timeline and a plain-language summary in one call. Includes the task payload.',
          parameters: [param('taskId')],
          responses: { '200': ok('Investigation', ref('Investigation')), '404': errorRef('NotFound') },
        },
      },
      '/v1/ops/metrics/summary': {
        get: {
          tags: ['Operations'],
          summary: 'Technical and business metrics',
          description:
            'Every metric states its definition, unit and window. Latencies report count, p50, p96, p99, avg and max (nearest-rank, exact). API metrics are process-local and reset on restart; everything else is read from stored timestamps.',
          parameters: [{ name: 'window', in: 'query', schema: { type: 'string', enum: Object.keys(WINDOWS), default: '1h' } }],
          responses: { '200': ok('Metrics summary', ref('MetricsSummary')), '400': errorRef('ValidationError') },
        },
      },
      '/metrics': {
        get: {
          tags: ['Operations'],
          summary: 'Prometheus metrics',
          responses: { '200': { description: 'Prometheus text exposition format', content: { 'text/plain': { schema: str() } } } },
        },
      },
      '/healthz': {
        get: {
          tags: ['Health'],
          summary: 'Liveness and MongoDB connectivity',
          responses: { '200': ok('Healthy', ref('Health')), '503': ok('MongoDB is unreachable', ref('Health')) },
        },
      },
    },
    components: { schemas, parameters, responses },
  };
}
