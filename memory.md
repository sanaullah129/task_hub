# TaskHub Working Memory

## Working agreement
- Source requirements: docs/task_prompt.md. Stack: Node.js 24 + TypeScript + Express 5 + Mongoose 9 + MongoDB (local `MONGODB_URI`, no Docker, no transactions).
- Docs in /docs: PRD.md (v1.0), ARCHITECTURE.md (v1.0, describes the built system), IMPROVEMENTS.md (single living list of future work and known limitations; add to it whenever a shortcut is taken), task_prompt.md. Root README.md explains run/demo/API/tests.
- Rules: TypeScript only, NEVER use `any` (eslint enforces). pnpm (not npm). Imports extensionless (no `.js`, no `/index`); tsconfig module ESNext + moduleResolution Bundler; `pnpm build` bundles with tsup to dist/index.js; dev uses tsx; tests use vitest. Single test file: `pnpm vitest run <path>` (no `--`).
- Module layout: src/modules/<feature>/<feature>.{constants,types,model,repository,service,controller,routes,validation,utils}.ts + index.ts; shared code in src/shared; src/container.ts is the composition root; modules never import src/database; dependency direction tasks -> events -> webhooks/customers.
- Tests: test/unit (no DB) mirrors src; test/integration (real local mongod, throwaway DBs taskhub_it_*, dropped after) incl. system.test.ts end to end; test/mocks has helpers, harness (real routers over in-memory fakes), fakes per module, webhookReceiver, testDatabase. Coverage threshold 80% (unit); Mongoose repos are covered by integration tests.
- Edit tools: in single replace_string_in_file calls use real newlines (not `\n`); do not create stray files; never commit/push unless the user asks (commit-me skill = personal identity via `git -c user.name/email`).
- User's own edit in package.json: `start` is `npm run build && node dist/index.js` (leave it).

## Status (all planned work implemented)
- Committed and pushed: slice 1 (a08aeec) and slice 2 incl. module refactor (c73bc10) on origin/main.
- NOT committed yet: slice 3 (task worker), slice 4 (reconciler), slice 5 (events + delivery + customers), slice 6 (list/ops/deliveries endpoints), slice 7 (metrics), slice 8 (mock receiver, demo, README), docs updates.
- Final verification: typecheck + lint clean; 390 unit tests (85% coverage); 61 integration tests (stable over repeated runs); `pnpm build` ok; `pnpm demo` ran all PRD scenarios successfully.

## What exists
- Task lifecycle: Pending, Running, Completed, Failed, TimedOut (added). Transitions guarded by CAS (`completeAttempt` on {_id, Running, attempts n, lease.workerId}); claim via findOneAndUpdate aggregation pipeline (lease = now + timeoutMs + grace). Retries with exponential backoff + jitter; timeouts via AbortController + race; late results ignored.
- Reconciler: recovers expired leases (outcome Abandoned -> Pending or Failed when exhausted) and creates events for terminal tasks with eventPending=true; runs at startup and on RECONCILER_INTERVAL_MS.
- Events: one per (taskId,eventType); created by worker `onTerminal` hook and reconciler through idempotent `EventService.emitForTask`; URL = task override else customer default else delivery `Skipped`; event stores `taskFinishedAt`.
- Delivery: PollingWorker claims due events (expired leases count as free); HMAC `X-TaskHub-Signature: t=,v1=`; no redirects; 2xx delivers, network/timeout/408/429/5xx retry with backoff, other 4xx/3xx permanent; every attempt recorded; operator replay `POST /v1/deliveries/:id/retry`.
- Customers: PUT/GET /v1/customers/:id/webhook (secret generated and returned once).
- Ops: GET /v1/ops/tasks/:id/investigation (timeline + summary), GET /v1/ops/metrics/summary?window=5m|15m|1h|24h (exact nearest-rank p50/p96/p99, definitions, units, windows), GET /metrics (prom-client), GET /v1/tasks list with cursor pagination, GET /v1/tasks/:id/events, GET /v1/deliveries.
- Logging: winston JSON with correlationId/taskId/customerId/eventId/attempt; request logging records route template via per-mount path (req.baseUrl is unreliable at finish).
- Scripts: `pnpm receiver` (mock endpoint: ok|fail-n|always-500|slow|drop), `pnpm demo` (all PRD scenarios incl. SIGKILL restart recovery; uses/drops DB taskhub_demo).

## Decisions (user answers)
- customerId plain string in body, no auth. TimedOut separate state. Defaults: timeout 30s, 3 attempts, backoff 1s x2 cap 30s + jitter; SLA doc 60s / report 120s / sync 300s. Per-customer webhook + optional per-task override; many tasks per customer. Keep p96. MongoDB only (Redis in IMPROVEMENTS). No transactions (eventPending flag + reconciler).

## Known gaps (see docs/IMPROVEMENTS.md "Known limitations")
- Unauthenticated ops/metrics/list endpoints; prom-client flagged deprecated on npm; API percentiles are process-local; summary loads up to 100k samples; per-task URL without customer secret is unsigned; Skipped events not re-evaluated after webhook is configured; no retention.
