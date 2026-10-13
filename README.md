# OceanBrown WhatsApp AI Agent

A multi-tenant customer operations platform for businesses in The Gambia. This repository currently runs entirely without external credentials: WhatsApp delivery and AI generation are disabled, and the clearly labeled simulator never contacts customers.

## Quick start

1. Copy `.env.example` to `.env` and replace `JWT_SECRET`, `ENCRYPTION_KEY`, and the MinIO password.
2. Start infrastructure: `docker compose up -d postgres redis minio`.
3. Install packages: `pnpm install`.
4. Generate and apply the local schema: `pnpm db:generate` then `pnpm db:migrate`.
5. Add demo data: `pnpm db:seed`.
6. Start the apps: `pnpm dev`.
7. Open `http://localhost:3000` and sign in with `owner@oceanbrown.local` / `OceanBrown123!`. This password is local demo data only.

## Safety defaults

- `AI_PROVIDER=simulator`; no OpenAI key is required or used.
- `WHATSAPP_LIVE_ENABLED=false`; no outbound provider call exists in the current adapter.
- Sessions are HTTP-only, role permissions are checked by the API, and tenant IDs come from the signed session.
- The simulator searches only published knowledge in the current workspace.

## Validation

Run `pnpm test`, `pnpm typecheck`, and `pnpm build`. See `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/META-SETUP.md`, and `docs/BACKUP-RESTORE.md`.

Current implementation status is tracked in `docs/PROGRESS.md`.

## Credentials required for live activation

- Meta app secret, webhook verify token, long-lived/system-user access token, WhatsApp phone-number ID, WABA ID, and an approved HTTPS callback domain.
- Production PostgreSQL, Redis, and S3-compatible object-storage credentials.
- Strong JWT/session secret and a 32-byte encryption key managed by a secret manager.
- Optional AI provider API key, configured server-side only, after a provider is selected.
- Credentials for any future CRM, calendar, order, POS, or payment connector. Those extension points are not represented as live integrations today.
