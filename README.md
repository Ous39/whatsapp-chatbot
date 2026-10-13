# OceanBrown WhatsApp AI Agent

A multi-tenant WhatsApp customer operations platform for businesses in The Gambia: shared inbox, CRM, leads, bookings, tickets, a knowledge base, and an AI agent that answers customers on WhatsApp from approved knowledge and hands over to staff when needed.

It runs fully offline by default. Real WhatsApp delivery and a real AI model are switched on with environment variables.

## Quick start (local)

1. Copy `.env.example` to `.env`. For local use the defaults work; set `ENCRYPTION_KEY` (`openssl rand -hex 32`) if you want to save WhatsApp tokens.
2. Start infrastructure: `docker compose up -d postgres redis minio`
3. Install: `pnpm install`
4. Database: `pnpm db:generate && pnpm db:migrate && pnpm db:seed`
5. Run everything: `pnpm dev` (web on :3000, API on :4000, worker in the background)
6. Open http://localhost:3000 and sign in with `owner@oceanbrown.local` / `OceanBrown123!` (local demo data only — the seed refuses to run with `NODE_ENV=production`).

Validate with `pnpm typecheck`, `pnpm test` and `pnpm build`. The same steps run in GitHub Actions on every push (`.github/workflows/ci.yml`).

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

- Set `META_APP_SECRET`, `META_VERIFY_TOKEN`, `ENCRYPTION_KEY`, `API_URL` (public HTTPS URL) and a strong `JWT_SECRET`.
- In the dashboard: **Integrations** → enter the phone number ID and permanent token → **Test connection**.
- Point Meta's webhook at the callback URL shown there and subscribe to `messages`.
- Set `WHATSAPP_LIVE_ENABLED=true`, then turn on **Settings → AI auto-replies**.
- Optional: `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` (or `openai` + `OPENAI_API_KEY`).

## Docs

`docs/ARCHITECTURE.md`, `docs/API.md`, `docs/META-SETUP.md`, `docs/BACKUP-RESTORE.md`, `docs/VOICE.md`, `docs/PROGRESS.md`, and the security review in `docs/AUDIT.md`.
