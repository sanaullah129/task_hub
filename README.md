# TaskHub

Asynchronous task execution service with reliable webhook notifications, built with Node.js, TypeScript, Express and MongoDB.
Requirements: [docs/task_prompt.md](docs/task_prompt.md). Usage and monitoring guide: [docs/USAGE.md](docs/USAGE.md). Design: [docs/PRD.md](docs/PRD.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Future work: [docs/IMPROVEMENTS.md](docs/IMPROVEMENTS.md).

## Prerequisites

- Node.js 24+, pnpm
- A local MongoDB (default `mongodb://127.0.0.1:27017`, override with `MONGODB_URI`). No Docker, no replica set needed.

## Run

```bash
pnpm install
pnpm dev                      # API + task worker + delivery worker + reconciler in one process (PORT 3000)
pnpm build && node dist/index.js
```

Roles can be split with `ROLES=api,worker,delivery,reconciler` (comma separated; run several processes for scale).
Configuration is read from environment variables; defaults and validation are in [src/config/config.ts](src/config/config.ts), examples in [.env.example](.env.example).

## Try it

```bash
pnpm receiver                 # mock webhook endpoint with failure modes (terminal 1)
pnpm dev                      # terminal 2 (use DEMO_MODE=true to allow http://localhost webhook URLs)

curl -X PUT localhost:3000/v1/customers/acme/webhook -H 'content-type: application/json' \
  -d '{"url":"http://127.0.0.1:4000/hook"}'          # returns the signing secret once

curl -X POST localhost:3000/v1/tasks -H 'content-type: application/json' -H 'x-correlation-id: try-1' \
  -d '{"customerId":"acme","taskType":"document_processing","payload":{"documentId":"d1"},"idempotencyKey":"k1"}'
curl localhost:3000/v1/tasks/<taskId>
curl localhost:3000/v1/tasks/<taskId>/events
curl localhost:3000/v1/ops/tasks/<taskId>/investigation
curl 'localhost:3000/v1/ops/metrics/summary?window=1h'
curl localhost:3000/metrics
```

## Demonstration of the required scenarios

```bash
pnpm demo
```

Starts the service and a mock receiver, then drives and prints evidence for: normal task, failed task, timed-out task,
restart recovery (service killed mid-execution), duplicate submission, webhook endpoint failure with operator replay,
metrics (p50/p96/p99 and business outcomes), and a single-task investigation with correlated logs. It uses and drops the
database `taskhub_demo`.

## API

Interactive docs (Swagger UI) are served at `http://localhost:3000/docs`, and the OpenAPI 3 document at `/openapi.json`. Use **Try it out** to call any endpoint from the browser.

| Method and path | Purpose |
| --- | --- |
| `POST /v1/tasks` | Submit (`202` new, `200` same idempotency key and request, `409` key reused with a different request) |
| `GET /v1/tasks/:taskId` | Status, result or failure details, attempts |
| `GET /v1/tasks?customerId=&status=&limit=&cursor=` | List, newest first, cursor paginated |
| `PUT /v1/customers/:customerId/webhook` | Set the default webhook URL (and optional secret; generated and returned once if omitted) |
| `GET /v1/customers/:customerId/webhook` | Show the configured URL (never the secret) |
| `GET /v1/tasks/:taskId/events` | Events of a task with every delivery attempt |
| `GET /v1/deliveries?status=&customerId=` | Operator view of deliveries, e.g. `status=Failed` |
| `POST /v1/deliveries/:eventId/retry` | Replay a `Failed` delivery |
| `GET /v1/ops/tasks/:taskId/investigation` | Task, history, attempts, events, delivery attempts, merged timeline, plain-language summary |
| `GET /v1/ops/metrics/summary?window=5m\|15m\|1h\|24h` | JSON technical and business metrics with p50/p96/p99, definitions, units, windows |
| `GET /metrics` | Prometheus exposition |
| `GET /healthz` | Liveness and MongoDB connectivity |

Task types: `document_processing` (`documentId`), `report_generation` (`reportType`), `data_sync` (`source`, `target`).
Handlers are simulated; `payload.simulate` accepts `durationMs`, `failure` (`retryable`, `fatal`, `hang`) and `failTimes`
(misbehave only for the first N attempts).

Task states: `Pending`, `Running`, `Completed`, `Failed`, plus `TimedOut`. Webhook events: `task.completed`, `task.failed`, `task.timed_out`.
Webhook requests carry `X-TaskHub-Event-Id`, `X-TaskHub-Event-Type`, `X-TaskHub-Correlation-Id`, `X-TaskHub-Delivery-Attempt`,
`X-TaskHub-Timestamp` and `X-TaskHub-Signature: t=<unix>,v1=<hmac-sha256 of "<t>.<body>">`. Delivery is at-least-once;
receivers deduplicate on `eventId`.

## Tests

```bash
pnpm test                     # unit tests (no database needed)
pnpm test:cov                 # with coverage (threshold 80%)
pnpm test:integration         # real local MongoDB: repositories, claims, races, and an end-to-end system test
pnpm typecheck && pnpm lint
```

## Layout

`src/modules/<feature>` holds each feature (tasks, execution, reconciler, events, delivery, customers, webhooks, metrics,
operations, health); `src/shared` holds cross-cutting code; `src/container.ts` wires modules; `scripts/` has the mock receiver and demo.
