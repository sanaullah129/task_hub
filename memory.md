# TaskHub Working Memory

## Working agreement
- Source requirements: docs/task_prompt.md. Stack: Node.js + MongoDB (local `MONGODB_URI`, no Docker).
- Docs live in /docs (PRD.md, ARCHITECTURE.md, IMPROVEMENTS.md, task_prompt.md).
- docs/IMPROVEMENTS.md is the single living list of production-readiness/future work (Redis queue etc.). Add to it whenever a shortcut is taken.
- Step by step, user reviews each step before moving on. Do not implement everything at once.
- Steps: 1) PRD  2) Architecture + tool choices  3) Implementation in slices  4) Unit tests for each slice (run and fix)  5) Demo + metrics.
- Unit tests are generated alongside each code slice.
- Rules: TypeScript only, NEVER use `any` (eslint enforces). Package manager: pnpm (not npm). Run single test files with `pnpm vitest run <path>` (no `--`).
- Imports are extensionless (no `.js`, no `/index`): tsconfig uses module ESNext + moduleResolution Bundler; `pnpm build` bundles with tsup (tsup.config.ts) to dist/index.js; dev uses tsx, tests use vitest. Do not reintroduce `.js` specifiers or tsc-emitted builds.
- Tests live in test/unit (Vitest, `pnpm test`, `pnpm test:cov`) and test/integration (`pnpm test:integration`, needs local mongod, uses throwaway DB taskhub_it_*, dropped after). 80% coverage threshold; shared mocks/fixtures in test/mocks (helpers, fixtures, inMemoryTaskRepository, logCapture, testDatabase).
- Don't create stray files by mistake; user's own edit in package.json: start script is `npm run build && node dist/index.js` (leave it alone, don't commit it unless asked).

## Status
- [x] Step 1: PRD -> docs/PRD.md (v0.2, review answers incorporated; decisions in PRD section 7)
- [x] Step 2: Architecture + tools + schema -> docs/ARCHITECTURE.md (v0.2, approved by user; later switched to Mongoose + Winston)
- [x] Slice 1 committed and pushed (a08aeec on origin/main, personal identity via commit-me skill).
- [x] Slice 2: task submission API + idempotency: DONE, awaiting user review, NOT yet committed. 150 unit tests + 9 integration tests (real local Mongo, 50-way concurrent same-key race => 1 task) pass; typecheck/lint clean; ~94% unit coverage; curl-verified end to end.
  - Files: src/api/{app,middleware,requestContext,parseSubmitRequest,schemas,taskView,tasksRouter}.ts, src/services/taskService.ts, src/db/taskRepository.ts, src/domain/{errors,payloadHash,webhookUrl}.ts
  - POST /v1/tasks (202 new, 200 duplicate, 409 conflict, 400 validation, 413 too large), GET /v1/tasks/:taskId, GET /healthz.
  - Per-type payload schemas (FR-4): document_processing{documentId}, report_generation{reportType}, data_sync{source,target}; optional simulate{durationMs,failure:retryable|fatal|hang,failTimes} hints for slice 3 handlers; extra fields allowed.
  - Webhook override URL: https only, no credentials, no private/loopback hosts unless DEMO_MODE=true (literal-host check only; DNS pinning in IMPROVEMENTS).
  - Correlation id: X-Correlation-Id accepted only if /^[A-Za-z0-9._:-]{1,128}$/, else generated (cor_ prefix); echoed in response header.
  - Task view hides payload/lease/history/idempotencyKey. GET has no customer ownership check (no auth yet).
- [x] Slice 2 refactored into modules (user request): feature modules under src/modules/{tasks,events,customers,webhooks,health}, shared code under src/shared/{errors,http,database,types,utils}, src/database (connection+indexes), src/app.ts composes. Tests mirror src (test/unit/<path>, test/integration/<path>, test/mocks + test/mocks/tasks). 161 unit + 9 integration tests pass, typecheck/lint clean. Layout + conventions documented in docs/ARCHITECTURE.md section 7.
  - New code goes in a module: <name>.constants/types/model/repository/service/controller/routes/validation/utils + index.ts (createXModule wiring); no `any`; modules never import src/database; dependency direction tasks -> events -> webhooks/customers.
- [ ] Slice 3: task worker module (claim via findOneAndUpdate, handlers, timeout, retry, terminal transitions) - next
- [ ] Slices 4-8: see ARCHITECTURE section 8
- Local env: Node 24, pnpm 11, local mongod running at mongodb://127.0.0.1:27017 (smoke tests use throwaway DB `taskhub_smoke`, dropped after).
- pnpm-workspace.yaml allows esbuild build script (needed for tsx/vitest).

## Decisions (resolved by user answers)
- customerId: plain string in request body, no auth for now.
- TimedOut kept as separate terminal state (my decision). No Retrying state.
- Defaults: timeout 30s, 3 attempts, backoff 1s x2 cap 30s w/ jitter; SLA doc 60s, report 120s, sync 300s (configurable).
- Webhook: per-customer default + optional per-task override; many tasks per customer supported.
- Keep p96 as written (p50/p96/p99). Mock webhook receiver in demo.
- No transactions: CAS updates, unique indexes, reconciler creates missing events (eventEmitted flag).
- Idempotency scope: (customerId, idempotencyKey), unique index; same key + different payload -> 409.
- Execution and webhook delivery are at-least-once; stable eventId; HMAC signature.
- Task handlers are simulated.

## Architecture picks
- User decided: Express (v5), MongoDB only (Redis/BullMQ only in IMPROVEMENTS.md). Node 24 (user edited runtime row).
- TypeScript, zod, Mongoose 9 (NOT the raw mongodb driver), winston (NOT pino; no pino-http, write own request-logging middleware), prom-client, Vitest, built-in fetch.
- Mongoose conventions: schemas in src/db/schemas.ts with versionKey/timestamps/autoIndex off, minimize off; models per connection (connection.model) in src/db/client.ts; indexes via ensureIndexes() at startup; use findOneAndUpdate + .lean() for claims/CAS; avoid deprecated validateSync (use validate()).
- JsonObject/JsonArray are interfaces on purpose (recursive type aliases cause TS2589 in Mongoose schemas).
- Logger: createLogger(config, bindings, transports?) ; tests use test/mocks/logCapture.ts; redaction masks secret/authorization/x-taskhub-signature keys.
- Collections: customers, tasks, events (event + delivery attempts in one doc). MongoDB is the queue (polling).
- Roles: api, worker, delivery, reconciler via ROLES env.
- Exact percentiles computed in app from persisted timestamps; Prometheus histograms for live.

## Open questions
- TypeScript vs plain JS not explicitly confirmed (assumed TypeScript); schema/slice order awaiting approval.

## Review log
- (none yet)
