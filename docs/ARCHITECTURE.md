# Architecture decisions

OceanBrown is a TypeScript pnpm monorepo with intentionally separate runtime boundaries:

- `apps/web`: Next.js dashboard. It receives no provider secrets.
- `apps/api`: Fastify HTTP API, authentication, tenant authorization, webhook ingestion, and business operations.
- `apps/worker`: BullMQ background processing. Jobs are expected to be idempotent because queue delivery is at least once.
- `packages/db`: PostgreSQL schema and Prisma client.
- `packages/shared`: runtime validation, roles, and shared types.

Every tenant-owned record carries `businessId`. API queries include that value from the signed server session; callers cannot choose it. Globally unique external IDs and client-generated idempotency IDs prevent duplicate webhook and outbound records. Object storage is MinIO-compatible for local development and can be replaced with S3-compatible storage.

The AI boundary is a provider interface in concept, currently represented only by the deterministic local simulator. The simulator retrieves `PUBLISHED` knowledge for the authenticated tenant, labels every result as simulated, and never connects to WhatsApp. A future provider must remain server-side, apply per-business budgets, and return source/tool traces.

Webhook ingestion authenticates the raw payload, stores it before acknowledgement, and leaves asynchronous processing to the worker. Live sending must enforce Meta eligibility, consent, the customer-service window, template status, opt-out suppression, and rate limits at send time.
