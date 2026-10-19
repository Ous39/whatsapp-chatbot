# API overview

The API listens on port 4000. Dashboard routes use the HTTP-only `ob_session` cookie (8-hour JWT that carries only the user id; the user, role and active flag are re-read from the database on every request).

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/register` | Create a workspace + owner (disabled in production unless `ALLOW_SIGNUP=true`) |
| POST | `/auth/login` | Start a session (rate-limited, 10/min) |
| POST | `/auth/logout` | End the session |
| GET | `/auth/me` | Current user |
| GET | `/overview`, `/analytics` | Tenant metrics |
| GET/PATCH | `/business` | Workspace profile, AI auto-replies switch, welcome/handover messages |
| GET/POST/PATCH | `/team`, `/team/:id` | Team members (owners cannot be demoted; you cannot edit yourself) |
| GET | `/conversations?status=OPEN&mine=true` | Inbox |
| GET/PATCH | `/conversations/:id` | Thread, notes, 24h-window flag / status + assignment |
| POST | `/conversations/:id/messages` | Idempotent reply (`clientId`); queued for WhatsApp when live |
| POST | `/conversations/:id/notes` | Internal note |
| PATCH | `/conversations/:id/mode` | AI / HUMAN / PAUSED |
| GET/POST | `/customers`, `/leads`, `/tickets`, `/bookings` (+ PATCH `/:id`) | CRM |
| GET/POST/PATCH/DELETE | `/knowledge` | Versioned knowledge; only PUBLISHED is used by the agent |
| GET/POST/PATCH | `/automations`, `/campaigns`, `/saved-replies` | Drafts and saved replies |
| GET | `/audit` | Audit log |
| POST | `/simulator` | Agent playground (uses the configured AI provider, never sends) |
| POST | `/simulator/voice?language=wo` | Playground by voice: raw `audio/*` body → transcript, answer and spoken reply (base64) |
| POST | `/simulator/speak` | Playground text question with a spoken answer in `en`/`fr`/`wo` |
| GET | `/voice/status` | Which speech-to-text and per-language voices are configured |
| GET | `/messages/:id/media` | Streams a voice note from WhatsApp for playback in the inbox |
| GET/PUT/DELETE | `/whatsapp/connection` | Tenant WhatsApp number; token encrypted at rest, never returned |
| POST | `/whatsapp/connection/test` | Verify token + phone number ID with Meta |
| GET/POST | `/webhooks/meta` | Meta verification handshake and signed events |
| GET | `/settings/status`, `/health` | Runtime state without secrets |

Tenant routes derive the business ID from the session; callers cannot choose it. Records from other tenants return 404. Invalid input returns 400 with zod details; unexpected errors return a generic 500.
# Commercial API additions

- `POST /auth/password/forgot`, `POST /auth/password/reset`
- `POST /customers/import`, `PATCH /customers/:id/preferences`, `GET /segments`
- `GET /templates`, `POST /templates/sync`
- `GET|POST /campaigns`, `GET /campaigns/:id/preview`, `POST /campaigns/:id/start`, `POST /campaigns/:id/cancel`
- `GET /billing/usage`
- `GET|POST /team/invites`, `GET /team/invites/accept/:token`, `POST /team/invites/accept`
- `GET /platform/businesses`, `PATCH /platform/businesses/:id/plan` (SUPER_ADMIN only)

Campaigns only target customers with explicit `consent=true` and no opt-out timestamp. The worker re-checks consent immediately before every template send.
