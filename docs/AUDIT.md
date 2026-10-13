# Security and code audit — October 2026

Scope: every file in the repository at commit `f4fbb86` (API, worker, web, Prisma schema/migrations/seed, Docker, docs). Each finding below is fixed in this change set unless marked otherwise.

## Security findings

| # | Severity | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| S1 | High | `apps/api/src/webhook.ts` | The Meta verification handshake succeeded when `META_VERIFY_TOKEN` was not set, because a request without `hub.verify_token` compared `undefined === undefined`. | Requires a configured token and compares in constant time. |
| S2 | High | `apps/api/src/auth.ts` | The JWT carried the role and was trusted for 8 hours, so deactivated users kept access and demoted users kept their old permissions until expiry. | Token carries only the user id; user, role and `active` are re-read on every request. |
| S3 | High | `apps/api/src/server.ts` | A hard-coded fallback JWT secret was used whenever `JWT_SECRET` was missing — including in production — letting anyone forge sessions. | `config.ts` refuses to start in production without a 32+ character secret; algorithm pinned to HS256. |
| S4 | High | Dockerfiles | `COPY . .` with no `.dockerignore` baked `.env` (secrets) and local `node_modules` into images; containers ran as root. | Added `.dockerignore`; images run as the `node` user. |
| S5 | High | `docker-compose.yml` | Postgres, Redis and MinIO were published on all interfaces with default passwords. | Bound to `127.0.0.1`; passwords overridable from the environment. |
| S6 | Medium | `auth.ts` | Login had no input validation (missing email caused a 500), shared the global 200/min limit (brute force), and skipped bcrypt for unknown emails (account enumeration by timing). | zod validation, 10/min limit on login/register, bcrypt always runs. |
| S7 | Medium | `routes.ts` `PATCH /team/:id` | An owner could demote or deactivate other owners, or lock themselves out. | Owners/super-admins cannot be changed here; users cannot edit themselves; role validated against assignable roles. |
| S8 | Medium | `Login.tsx`, `seed.ts` | Demo credentials were pre-filled on the production login page; the seed would create a SUPER_ADMIN with a published password in any database. | Pre-fill only in development; seed refuses `NODE_ENV=production` unless explicitly overridden. |
| S9 | Medium | Schema / env | `ENCRYPTION_KEY` was documented but never used; the WhatsApp token column had no encryption code. | AES-256-GCM encryption (`packages/shared/src/secrets.ts`); tokens are write-only through the API. |
| S10 | Medium | `auth.ts` | Self-service registration was always open. | `ALLOW_SIGNUP` (defaults off in production). |
| S11 | Medium | `server.ts` | No `trustProxy` option: behind a load balancer every user shares one rate-limit bucket (or limits are keyed on the proxy). | `TRUST_PROXY=true` support. |
| S12 | Low | `routes.ts` | Several endpoints accepted unvalidated strings/enums (ticket status/priority, automation triggers, campaigns, lead fields, business profile incl. timezone). | zod schemas everywhere. |
| S13 | Low | `webhook.ts` | If the raw body was missing the signature was checked against a re-serialised JSON body. | Raw body is mandatory. |

## Bugs

| # | Where | Bug | Fix |
| --- | --- | --- | --- |
| B1 | `web/lib/api.ts` + `server.ts` | **Sign out always failed (500):** the client sent `Content-Type: application/json` with an empty body and the custom parser ran `JSON.parse("")`. | Client only sets JSON headers with a body; parser treats empty as `{}` and returns 400 for invalid JSON. |
| B2 | API ↔ worker | **Incoming WhatsApp messages were never processed:** the API stored webhook events but never queued them, and the worker marked events processed without reading them. | API enqueues `process-webhook`; worker fully processes events. |
| B3 | `webhook.ts` | Only `entry[0].changes[0]` and the first message/status were read; Meta batches several. Events were keyed by the first message id, so a later batch starting with the same id was dropped. | All entries/changes/messages/statuses parsed; event keyed by body hash. |
| B4 | `routes.ts` | Agent replies were saved as `QUEUED` and never sent. | `send-message` jobs through the Cloud API with retries. |
| B5 | `apps/*/Dockerfile`, `start` scripts | **Production start crashed:** `node dist/server.js` imports workspace packages that export `.ts` files (`ERR_UNKNOWN_FILE_EXTENSION`). | Run compiled code with `node --import tsx`. |
| B6 | `POST /bookings` | An idempotent retry got a 409 "slot unavailable" conflict with its own booking; concurrent requests could double-book. | Idempotency checked first; per-business advisory lock in a transaction. |
| B7 | `POST /conversations/:id/messages` | Re-using a `clientId` from another conversation returned that other message. | Returns 409. |
| B8 | Errors | Missing conversation, duplicate customer phone, duplicate saved-reply shortcut and super-admin without a workspace all produced 500s. | 404/409/403 responses; Prisma `P2025` mapped to 404. |
| B9 | `apps/web/Dockerfile` | `NEXT_PUBLIC_API_URL` was set only at runtime, but Next.js inlines it at build time, so images always called `localhost:4000`. | Build argument. |
| B10 | Prisma | `migrations/migration_lock.toml` missing. | Added. |
| B11 | `/overview` | Upcoming bookings included cancelled ones. | Filter by status. |

## Added capabilities

- WhatsApp Cloud API end to end: inbound text, interactive, media and location messages; outbound text; read receipts; delivery statuses with no downgrades; per-tenant numbers with encrypted tokens and a connection test.
- Meta policy enforcement: 24-hour customer service window, STOP/START opt-out, human handover.
- AI agent grounded in published knowledge with Anthropic Claude or OpenAI (plus the offline simulator), structured actions and source attribution, prompt-injection guard rails, welcome and handover messages, master on/off switch.
- Inbox: polling, resolve/reopen, assignment on reply, notes, 24h-window and delivery indicators.
- Worker reliability: exponential backoff, exhausted-job handling (`UNCERTAIN`), stranded-work recovery sweep.
- CI workflow and an expanded test suite.

## Verification

This environment could not reach the npm registry, so the full `pnpm install` / build could not run here. What was verified:

- `packages/shared`: full TypeScript check with the real `zod` version; 18/18 unit tests pass (webhook parsing, Cloud API client, retry classification, encryption, AI provider calls, rules).
- `apps/api` and `apps/worker`: TypeScript check with third-party packages stubbed (catches errors in this code, not framework typing).
- Worker end-to-end against an in-memory database: inbound message → customer/conversation, welcome + grounded answer, duplicate delivery ignored, handover, silence in human mode, STOP/START, simulated vs. live send through a mocked Graph API, out-of-order receipts.
- New API tests (`apps/api/test/webhook.test.ts`) and worker tests run in CI (`.github/workflows/ci.yml`) together with migrate, seed, typecheck, build and an HTTP smoke test.

## Remaining recommendations

1. Run CI once on GitHub (or `pnpm typecheck && pnpm test && pnpm build` locally) — the first full run with real dependencies.
2. Host the dashboard and API on the same site (e.g. `app.example.gm` and `api.example.gm`); the session cookie is `SameSite=Lax`.
3. Implement template messages before campaigns or any message outside the 24-hour window.
4. Add password reset and 2FA for owners; consider shorter sessions with refresh.
5. Pin the MinIO image to a release tag and keep Next.js/Fastify patched.
6. A network failure after Meta accepted a send can cause one duplicate on retry; acceptable for now, revisit if it matters.
