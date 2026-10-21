# TaskHub — Improvements and Production Readiness

Living list of things deliberately left out of the current scope. Add items as they come up; each entry states what, why, and the trigger for doing it.

## Queueing and scale

| Item | Why | Trigger |
| --- | --- | --- |
| Redis-backed queue (BullMQ) or a broker (SQS, RabbitMQ, Kafka) in place of MongoDB polling | Removes polling latency and DB load, gives native delayed jobs, rate limits, priorities, and dead-letter queues | Sustained load beyond a few hundred tasks/s or tight queue-wait SLOs |
| Change Streams instead of polling | Push-style wake-up of workers without a new dependency | Needs replica set; useful if polling latency matters |
| Per-customer concurrency limits and fair scheduling | Stop one customer from starving others | Noisy-neighbour incidents |
| Task priorities | Urgent work jumps the queue | Business request |
| Worker autoscaling based on queue depth and wait time | Cost and latency control | Real deployment |

## Data and consistency

| Item | Why | Trigger |
| --- | --- | --- |
| MongoDB replica set with transactions for task+event write | Removes the brief window between terminal write and event insert (currently covered by the reconciler) | Production deployment (replica sets are required for HA anyway) |
| Retention: TTL indexes and archival of old tasks/events | Bounded storage | Data growth |
| Pre-aggregated metrics (rollup collection or time-series store) | Exact percentiles over large windows without loading samples into memory | Large windows or high volume |
| Schema versioning and migrations | Safe schema evolution | First schema change |
| Encrypt webhook secrets at rest (KMS or field-level encryption) | Secrets are currently stored as plain fields | Before real customers |
| Payload storage offload (object storage) for large payloads/results | Document size limit and DB bloat | Large documents/reports |
| Move `history[]` and `attemptLog[]` to a separate `task_history` collection (one document per transition/attempt) | Embedded arrays are bounded today; a collection allows unbounded history, richer queries, and metrics aggregation without loading whole tasks | More states/attempts per task, or metrics queries become slow |

## Security

| Item | Why | Trigger |
| --- | --- | --- |
| Authentication and authorization (API keys or OAuth/JWT; customer-scoped access) | `customerId` is currently an unauthenticated field | Before exposing the API |
| Separate operator/admin credentials and roles | Ops endpoints should not be customer-accessible | Before exposing the API |
| Webhook secret rotation with dual-secret grace period | Rotate without losing deliveries | Security policy |
| Stronger SSRF protection (resolve DNS and pin IP at connect time, egress proxy/allowlist) | DNS rebinding can bypass URL-level checks | Real customer URLs |
| Rate limiting per customer, request size limits, abuse protection | Protect platform | Public traffic |
| Audit log of operator actions (e.g. manual delivery replay) | Accountability | Compliance |

## Reliability

| Item | Why | Trigger |
| --- | --- | --- |
| Circuit breaker per webhook endpoint | Stop hammering a dead endpoint and protect workers | Many failing endpoints |
| Dead-letter handling with alerts and bulk replay | Operators can recover missed notifications | Operations maturity |
| Lease heartbeats for long-running real tasks | Leases are currently timeout + grace | Tasks with long or variable runtimes |
| Poison-task detection and quarantine | Tasks that repeatedly crash workers | Real handlers |
| Graceful draining and rolling deploys | Zero-downtime releases | Real deployment |
| Chaos/failure-injection test suite | Verify recovery behavior continuously | CI maturity |

## Observability

| Item | Why | Trigger |
| --- | --- | --- |
| OpenTelemetry traces (API to worker to delivery, W3C trace context in webhook headers) | Full distributed tracing beyond correlation IDs | Multi-service deployment |
| Dashboards (Grafana) and alert rules for SLA breach, queue age, delivery failure rate | Proactive operations | Real deployment |
| Log shipping and retention (ELK/Loki/CloudWatch) | Central search | Real deployment |
| SLOs with error budgets per task type | Formal reliability targets | Operations maturity |

## API and product

| Item | Why | Trigger |
| --- | --- | --- |
| Task cancellation endpoint | Let clients stop pending work | Customer request |
| Multiple webhook endpoints per customer and per-event-type subscriptions | Flexibility | Customer request |
| Webhook payload versioning | Backward compatibility | First breaking change |
| OpenAPI specification and generated client SDK | Easier integration | External consumers |
| Pagination cursors and richer filtering/search | Large task volumes | Growth |
| Optional polling-free result delivery (SSE/WebSocket) | Better client experience | Customer request |

## Delivery and engineering practice

| Item | Why | Trigger |
| --- | --- | --- |
| CI pipeline (lint, type-check, unit and integration tests, coverage gate) | Quality gate | Team collaboration |
| Dockerfile and deployment manifests | Reproducible runtime | Deployment |
| Load and soak testing with recorded baselines | Validate NFR targets | Before launch |
| Contract tests against the webhook receiver spec | Catch signature/payload regressions | Customer integrations |
