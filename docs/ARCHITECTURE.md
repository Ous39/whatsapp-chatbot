# Architecture decisions

OceanBrown is a TypeScript pnpm monorepo with intentionally separate runtime boundaries:

- `apps/web`: Next.js dashboard. It receives no provider secrets.
- `apps/api`: Fastify HTTP API, authentication, tenant authorization, webhook ingestion, and business operations.
- `apps/worker`: BullMQ background processing. Jobs are expected to be idempotent because queue delivery is at least once.
- `packages/db`: PostgreSQL schema and Prisma client.
- `packages/shared`: runtime validation, roles, and shared types.

Every tenant-owned record carries `businessId`. API queries include that value from the signed server session; callers cannot choose it. Globally unique external IDs and client-generated idempotency IDs prevent duplicate webhook and outbound records. Object storage is MinIO-compatible for local development and can be replaced with S3-compatible storage.

`packages/shared` also holds the framework-free WhatsApp logic (webhook parsing, Cloud API client, service-window and status rules, opt-out/handover detection), the AI provider layer and AES-256-GCM secret encryption, so the API and worker use exactly the same rules and they are unit-tested in isolation.

The AI boundary (`packages/shared/src/ai.ts`) supports a deterministic simulator, Anthropic Claude and OpenAI through plain HTTPS calls made server-side. It retrieves `PUBLISHED` knowledge for the tenant, instructs the model to answer only from it, returns structured `ANSWER/CLARIFY/HANDOVER` actions with source ids, and short-circuits explicit requests for a person before any model call.

Webhook ingestion authenticates the raw payload, stores it before acknowledgement (idempotent on the body hash) and enqueues a `process-webhook` job. The worker creates customers, conversations and messages, applies opt-out and handover rules, generates AI replies and enqueues `send-message` jobs. Sending re-checks opt-out, the 24-hour window and the connection at send time, retries transient Meta errors with backoff, and marks permanent failures. A scheduled `recover-stranded` job re-enqueues work if Redis was unavailable when the API tried to queue it.

Workspace packages ship TypeScript sources; compiled apps run with `node --import tsx dist/...` so those sources load at runtime.
