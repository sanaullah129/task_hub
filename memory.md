# TaskHub Working Memory

## Working agreement
- Source requirements: docs/task_prompt.md. Stack: Node.js + MongoDB (local `MONGODB_URI`, no Docker).
- Docs live in /docs (PRD.md, ARCHITECTURE.md, IMPROVEMENTS.md, task_prompt.md).
- docs/IMPROVEMENTS.md is the single living list of production-readiness/future work (Redis queue etc.). Add to it whenever a shortcut is taken.
- Step by step, user reviews each step before moving on. Do not implement everything at once.
- Steps: 1) PRD  2) Architecture + tool choices  3) Implementation in slices  4) Unit tests for each slice (run and fix)  5) Demo + metrics.
- Unit tests are generated alongside each code slice.
- Rules: TypeScript only, NEVER use `any` (eslint enforces). Package manager: pnpm (not npm). Run single test files with `pnpm vitest run <path>` (no `--`).
- Tests live in test/unit (Vitest), 80% coverage threshold; shared mocks in test/mocks.

## Status
- [x] Step 1: PRD -> docs/PRD.md (v0.2, review answers incorporated; decisions in PRD section 7)
- [x] Step 2: Architecture + tools + schema -> docs/ARCHITECTURE.md (v0.2, approved by user; later switched to Mongoose + Winston)
- [x] Slice 1 (scaffold, config, winston logger, domain types, state machine, backoff, ids, mongoose schemas/connection/index creation): DONE, awaiting user review. 62 tests pass, typecheck + lint clean, ~97% coverage; schemas/indexes/unique idempotency verified on local Mongo.
- [ ] Slice 2: task submission API + idempotency (next; needs express, supertest or similar)
- [ ] Slices 3-8: see ARCHITECTURE section 8
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
