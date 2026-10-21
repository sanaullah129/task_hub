# TaskHub: Using the APIs and Monitoring

## 1. Start it

Interactive API docs: once the service is running, open **http://localhost:3000/docs** (Swagger UI, with **Try it out**). The raw OpenAPI 3 document is at `/openapi.json`; import it into Postman or Insomnia to get a ready-made collection.

```bash
pnpm install
pnpm receiver            # terminal 1: mock webhook endpoint on :4000
pnpm dev                 # terminal 2: API on :3000 (reads .env; DEMO_MODE=true allows http://127.0.0.1 webhook URLs)
```

Needs a local MongoDB. Configuration comes from `.env` (copy `.env.example`): `PORT`, `MONGODB_URI`, `MONGODB_DB`, `LOG_LEVEL`, `ROLES`, `DEMO_MODE`.
For a scripted walkthrough of everything below, run `pnpm demo`.

## 2. Configure a customer webhook

```bash
curl -X PUT localhost:3000/v1/customers/acme/webhook \
  -H 'content-type: application/json' \
  -d '{"url":"http://127.0.0.1:4000/hook"}'
```

The response contains `secret` **once**. Save it, because it is never shown again. You can supply your own with `"secret":"<16+ chars>"`.

```bash
curl localhost:3000/v1/customers/acme/webhook   # shows url, secretConfigured:true
```

The URL must be https and public unless `DEMO_MODE=true`.

## 3. Submit and track tasks

```bash
curl -X POST localhost:3000/v1/tasks -H 'content-type: application/json' \
  -H 'x-correlation-id: my-trace-1' \
  -d '{"customerId":"acme","taskType":"document_processing",
       "payload":{"documentId":"d1"},"idempotencyKey":"k1"}'
```

| Field | Notes |
| --- | --- |
| `taskType` | `document_processing` (needs `documentId`), `report_generation` (needs `reportType`), `data_sync` (needs `source` and `target`) |
| `idempotencyKey` | Same key and same request returns the original task (`200`). Same key with a different payload returns `409`. |
| `webhookUrl` (optional) | Overrides the customer default for this task. |
| `x-correlation-id` (optional) | Ties together the logs, the task, the event and the webhook. One is generated if you omit it. |

The response is `202` with a `taskId` and does not wait for execution.

To simulate behaviour, add `payload.simulate`:

| Value | Effect |
| --- | --- |
| `{"durationMs":3000}` | Slow task |
| `{"failure":"fatal"}` | Fails immediately, no retry |
| `{"failure":"retryable"}` | Fails and retries |
| `{"failure":"hang"}` | Times out |
| `"failTimes":N` | Only the first N attempts misbehave, then it succeeds |

```bash
curl localhost:3000/v1/tasks/<taskId>                                    # status, result or error, attempts
curl 'localhost:3000/v1/tasks?customerId=acme&status=Failed&limit=20'    # newest first
curl 'localhost:3000/v1/tasks?cursor=<nextCursor from previous page>'
```

Task statuses: `Pending`, `Running`, `Completed`, `Failed`, `TimedOut`.

## 4. Check webhook delivery

```bash
curl localhost:3000/v1/tasks/<taskId>/events
curl 'localhost:3000/v1/deliveries?status=Failed'              # also Pending, Delivered, Skipped; filter by customerId
curl -X POST localhost:3000/v1/deliveries/<eventId>/retry      # replay a Failed delivery (202)
```

- A task finishing and its webhook being delivered are tracked separately. `delivery.status` can be `Pending`, `Delivered`, `Failed` or `Skipped`. `Skipped` means no URL was configured.
- Each attempt in `delivery.attempts` shows the status code or error, latency and a response snippet.
- A failed attempt is retried with backoff. After `DELIVERY_MAX_ATTEMPTS` (default 6) the delivery is `Failed` until you replay it.

Each webhook request carries these headers:

- `X-TaskHub-Event-Id` is stable across retries, so receivers should deduplicate on it.
- `X-TaskHub-Event-Type` and `X-TaskHub-Correlation-Id`.
- `X-TaskHub-Delivery-Attempt`.
- `X-TaskHub-Timestamp`.
- `X-TaskHub-Signature` is `t=<unix>,v1=<HMAC-SHA256 of "<t>.<body>" with your secret>`.

## 5. Investigate one task

```bash
curl localhost:3000/v1/ops/tasks/<taskId>/investigation
```

Returns a plain-language `summary`, the full task with its state `history` and attempts, the events with delivery attempts, a merged chronological `timeline`, and the `correlationId`. To see the log lines, filter the service's JSON logs on that `correlationId`:

```bash
pnpm dev 2>&1 | grep my-trace-1
```

Log lines carry `correlationId`, `taskId`, `customerId`, `eventId` and `attempt`. Secrets are redacted.

## 6. Monitor with metrics

Summary with exact percentiles:

```bash
curl 'localhost:3000/v1/ops/metrics/summary?window=1h'   # windows: 5m, 15m, 1h, 24h
```

Every metric includes `definition`, `unit` and `window`. Latencies show `count`, `p50`, `p96`, `p99`, `avg` and `max`.

| Technical | Business |
| --- | --- |
| `apiRequestRate`, `apiErrorRate5xx`, `apiClientErrorRate4xx`, `apiLatency` (also per route) | `taskCompletionRate`, `taskTerminalFailureRate` |
| `queueWait`, `executionDuration` (also per task type) | `taskTurnaround`, `slaCompliance` (also per task type) |
| `pendingTasks`, `activeTasks` (live) | `tasksPerCustomer` |
| `webhookAttemptLatency`, `webhookAttemptsPerEvent`, `webhookFailureRate` | `webhookDeliverySuccessRate`, `notificationLatency` |

Prometheus:

```bash
curl localhost:3000/metrics
```

Series include `taskhub_http_requests_total`, `taskhub_http_request_duration_seconds`, `taskhub_task_attempt_duration_seconds`, `taskhub_tasks_terminal_total`, `taskhub_webhook_attempts_total`, `taskhub_webhook_attempt_duration_seconds` and `taskhub_tasks_in_state{status="Pending|Running"}`. Point Prometheus at `:3000/metrics`.

Health: `curl localhost:3000/healthz` returns `ok`, or `503` if MongoDB is unreachable.

The API metrics (request rate, error rate and latency) live in the API process and reset when it restarts. All other metrics are read from stored timestamps and survive restarts.

## 7. What to watch

- `pendingTasks` rising together with `queueWait` p96 means workers can't keep up. Raise `TASK_CONCURRENCY` or run more processes with `ROLES=worker`.
- `apiErrorRate5xx` above 0 means an internal error. Check the logs for `unhandled request error`.
- `taskTerminalFailureRate` and `slaCompliance` show customer impact.
- A rising `webhookFailureRate` or deliveries stuck in `Failed` means a customer endpoint is down. Use `GET /v1/deliveries?status=Failed`, then replay.
- Log messages `recovered task with expired lease` mean a worker died mid-task. The reconciler requeues those tasks automatically.

## 8. Mock receiver controls (for testing failures)

```bash
curl -X POST localhost:4000/admin/mode -H 'content-type: application/json' \
  -d '{"path":"/hook","mode":"fail-n","failCount":2}'   # modes: ok, fail-n, always-500, slow, drop
curl localhost:4000/admin/received    # duplicates are flagged
curl -X DELETE localhost:4000/admin/received
```

`pnpm receiver` does not check signatures unless `WEBHOOK_SECRET=<your secret>` is set.
