# Product progress

## Working

- [x] Authentication with server-side session validation, login rate limiting and constant-time login
- [x] Multi-tenant workspaces and server-enforced role permissions
- [x] Shared inbox with AI/HUMAN/PAUSED modes, resolve/reopen, assignment, internal notes, live polling
- [x] WhatsApp Cloud API: signed webhooks, batch parsing, inbound text/media/interactive messages, outbound text, read receipts, delivery statuses
- [x] Per-tenant WhatsApp connections with AES-256-GCM encrypted tokens and a connection test
- [x] Opt-out/opt-in (STOP/START), 24-hour service window enforcement, human handover
- [x] Grounded AI replies from published knowledge: simulator, Anthropic Claude or OpenAI
- [x] Welcome and handover messages, AI auto-reply master switch
- [x] Voice notes in English, French and Wolof: transcription, language memory, spoken replies (Ogg/Opus voice notes), inbox playback, microphone playground, self-hosted Wolof voice service
- [x] Background worker with retries, exhausted-job handling and a stranded-work recovery sweep
- [x] CRM: customers, leads, bookings (race-safe conflict checks), tickets, saved replies, audit log, analytics
- [x] CI: install, migrate, seed, typecheck, test, build and an API smoke test
- [x] Commercial onboarding: self-service workspace registration, password recovery and secure team invitations
- [x] Meta template synchronization with approved-template enforcement
- [x] CSV contact import, consent controls, tags and reusable audience segments
- [x] Scheduled campaigns with durable per-recipient delivery/read/failure tracking and retries
- [x] Workspace plans, monthly campaign limits, usage dashboard and super-admin plan controls

## Next

- [ ] Long-term media storage in S3/MinIO (WhatsApp keeps media for a limited time)
- [ ] Native-speaker review of Wolof system messages; Mandinka support
- [ ] Executing automations (after-hours and booking reminders)
- [ ] AI usage budgets per business and cost tracking
- [ ] Real-time inbox updates (SSE/WebSocket) instead of polling
- [ ] 2FA and session revocation list
- [ ] Meta Embedded Signup, social/phone authentication and paid-plan checkout
- [ ] Instagram/Facebook inbox, catalog, forms and commerce integrations
