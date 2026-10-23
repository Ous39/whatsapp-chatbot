# OceanBrown WhatsApp AI Agent

A multi-tenant WhatsApp customer operations platform for businesses in The Gambia: shared inbox, CRM, leads, bookings, tickets, a knowledge base, and an AI agent that answers customers on WhatsApp from approved knowledge and hands over to staff when needed.

The commercial SaaS layer includes self-service workspaces, password recovery, secure team invitations, Meta template synchronization, CSV contact imports, tagged audiences, scheduled template campaigns, per-recipient delivery analytics, plan quotas and platform-admin plan controls.

It runs fully offline by default. Real WhatsApp delivery and a real AI model are switched on with environment variables.

## Quick start (local)

Requirements: Node.js 22+, Docker Desktop, and pnpm (`corepack enable`). The API, worker and database scripts read the root `.env` automatically.

1. Copy `.env.example` to `.env`. For local use the defaults work; set `ENCRYPTION_KEY` (`openssl rand -hex 32`) if you want to save WhatsApp tokens.
2. Start infrastructure: `docker compose up -d postgres redis`
3. Install: `pnpm install`
4. Database: `pnpm db:generate && pnpm db:migrate && pnpm db:seed`
5. Run everything: `pnpm dev` (web on :3000, API on :4000, worker in the background)
6. Open http://localhost:3000 and sign in with `owner@oceanbrown.local` / `OceanBrown123!` (local demo data only — the seed runs only with `NODE_ENV=development` or `test` and never creates a platform administrator).
7. Platform administrators are created with a generated password: `pnpm db:create-admin you@your-domain.gm "Your Name"`.

Validate with `pnpm typecheck`, `pnpm test` and `pnpm build`. The same steps run in GitHub Actions on every push (`.github/workflows/ci.yml`).

## Customer onboarding

New businesses sign up with four fields and are guided through three steps at `/onboarding`: connect WhatsApp with Meta's own window (no tokens or IDs), pick an industry starter that is filled only with facts the owner types, then review and test before switching on AI replies. Status turns *Live* only after Meta has delivered a real message. OceanBrown staff manage customers, help requests, failed connection attempts and industry templates in **Provider admin** (`/platform`). Details, test results and the deployment checklist: [`docs/ONBOARDING.md`](docs/ONBOARDING.md).

## How a WhatsApp message flows

1. Meta calls `POST /webhooks/meta`. The API verifies the `X-Hub-Signature-256` HMAC over the raw body, stores the delivery once (idempotent on its hash) and acknowledges immediately.
2. The worker parses every entry/change in the batch, creates or updates the customer and conversation, and stores the message (duplicates from Meta retries are ignored).
3. `STOP` / `START` opt the customer out or back in. Requests for a person, complaints and refunds hand the conversation to staff.
4. If AI auto-replies are on and the conversation is in AI mode, the agent answers using **published** knowledge only (simulator, Anthropic Claude, or OpenAI).
5. Outbound replies are queued and sent by the worker through the Cloud API, enforcing opt-out and the 24-hour customer service window at send time. Delivery receipts update message status (never downgrading read → delivered).
6. A recovery sweep re-queues anything stranded if Redis was briefly unavailable.

## Voice notes (English, French, Wolof)

Customers can send WhatsApp voice notes. The agent transcribes them, answers in the same language, and replies with a voice note when the customer used voice. Staff can test by microphone in **Agent & playground**. Wolof speech uses ElevenLabs Scribe for transcription and the bundled open-source Wolof voice in `services/tts-wolof`. Setup: [docs/VOICE.md](docs/VOICE.md).

## Going live

See [docs/META-SETUP.md](docs/META-SETUP.md). In short:

- Set `META_APP_SECRET`, `META_VERIFY_TOKEN`, `ENCRYPTION_KEY`, `API_URL` (public HTTPS URL) and a strong `JWT_SECRET`. The API and worker refuse to start without them unless `NODE_ENV` is `development` or `test`; Docker Compose always runs them with `NODE_ENV=production`.
- After upgrading an existing server, follow [docs/P0-SECURITY-UPGRADE.md](docs/P0-SECURITY-UPGRADE.md).
- In the dashboard: **Integrations** → enter the phone number ID, WABA ID and permanent token → **Test connection**. The test proves the number belongs to that WABA; only verified numbers receive webhooks or send messages.
- Point Meta's webhook at the callback URL shown there and subscribe to `messages`.
- Set `WHATSAPP_LIVE_ENABLED=true`, then turn on **Settings → AI auto-replies**.
- Optional: `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` (or `openai` + `OPENAI_API_KEY`).
- For production signup, set `ALLOW_SIGNUP=true`, `RESEND_API_KEY` and `EMAIL_FROM` so reset and invitation links are delivered securely.

## Campaigns

1. Connect a WhatsApp number and include its WABA ID.
2. Open **Campaigns** and sync approved templates from Meta.
3. Import explicitly consented contacts from CSV or add them individually.
4. Create a campaign for all consented contacts or a tagged segment, preview the plan allowance, then send now or schedule it.
5. The worker expands the audience into durable recipients, rate-smooths delivery, retries transient Meta failures and records sent, delivered, read, failed and skipped totals.

Free workspaces start with 250 campaign messages per billing period. Platform administrators can change a workspace to STARTER, GROWTH or PRO through the protected platform API.

## Docs

`docs/ARCHITECTURE.md`, `docs/API.md`, `docs/META-SETUP.md`, `docs/BACKUP-RESTORE.md`, `docs/VOICE.md`, `docs/PROGRESS.md`, and the security review in `docs/AUDIT.md`.
