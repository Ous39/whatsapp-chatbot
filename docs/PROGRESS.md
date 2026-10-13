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
- [x] Background worker with retries, exhausted-job handling and a stranded-work recovery sweep
- [x] CRM: customers, leads, bookings (race-safe conflict checks), tickets, saved replies, audit log, analytics
- [x] CI: install, migrate, seed, typecheck, test, build and an API smoke test

## Next

- [ ] Template messages (sync approved templates, send outside the 24h window, campaigns)
- [ ] Media download/storage to S3/MinIO and media replies
- [ ] Executing automations (after-hours, reminders) and campaign delivery
- [ ] AI usage budgets per business and cost tracking
- [ ] Real-time inbox updates (SSE/WebSocket) instead of polling
- [ ] Password reset, 2FA, and session revocation list
