# P0 security upgrade (October 2026)

This release fixes the four production blockers from the 23 October 2026 audit plus several reliability issues. Read the "Before you deploy" list: two changes can stop an existing setup from working until you act.

## What changed

| Area | Before | Now |
| --- | --- | --- |
| Production mode | `.env` with `NODE_ENV=development` overrode the image, so the API returned password-reset and invitation tokens in responses and could fall back to a published JWT secret | Compose forces `NODE_ENV=production` for `api` and `worker`. Development conveniences need `NODE_ENV=development`/`test`; token echoing also needs `DEV_EXPOSE_TOKENS=true`. An unset `NODE_ENV` behaves like production |
| Demo accounts | Seed created an owner and a `SUPER_ADMIN` with the README password, and could be forced to run in production | Seed runs only in development/test and never creates a super-admin. `pnpm db:create-admin <email>` creates one with a generated password |
| WhatsApp numbers | Any workspace could claim any unclaimed phone number ID; webhooks were routed whatever its status; `META_ACCESS_TOKEN` was used by every workspace without its own token | A number receives webhooks and sends only after **Test connection** proves, with the workspace's token, that it belongs to the saved WABA. The webhook's WABA must match. `META_ACCESS_TOKEN` is used only by the workspace in `META_ACCESS_TOKEN_BUSINESS_ID`. Unverified claims can be taken over by the real owner |
| Agent replies | Saved as "queued" and never sent when live mode was off or the number was not exactly `CONNECTED` | The API returns 422 with the reason; development keeps the simulator |
| Embedded Signup | Marked numbers `CONNECTED` without proving ownership or subscribing the app | Verifies the number is in the WABA and calls `subscribed_apps`. Phone-number registration (`/register` with a PIN) is still a P1 item |
| AI failures | A provider timeout left the customer with no reply | The conversation is handed to staff with the handover message |
| AI grounding | Non-JSON model output was sent as-is | Non-JSON output, and answers with figures but no cited source, become a clarifying question |
| Login | Per-IP limit only; `TRUST_PROXY=true` let clients spoof their IP | 10 failures lock the account for 15 minutes; `TRUST_PROXY=1` (hop count) is supported and `true` is treated as 1 outside development |
| Webhook size | 1 MB limit | 3 MB on `/webhooks/meta`, as Meta documents |
| Ports | API (4000) and web (3000) published on all interfaces | Bound to `127.0.0.1`; the reverse proxy on the host forwards to them |
| Backups | Documented only | `scripts/backup.sh`: encrypted nightly dump, off-server copy, restore drill |

## Before you deploy

1. **Reverse proxy.** Ports 3000 and 4000 now listen only on `127.0.0.1`. If Caddy or Nginx runs on the same host, nothing changes. If it runs in another container or machine, or people open the server by IP, adjust the `ports` lines in `docker-compose.yml` first.
2. **Environment.** In the server `.env`: `JWT_SECRET` (≥ 32 random characters, a new value), `ENCRYPTION_KEY` (64 hex characters — keep the existing one, or saved WhatsApp tokens become unreadable), `TRUST_PROXY=1`. Remove `DEV_EXPOSE_TOKENS` and `SEED_ALLOW_PRODUCTION` if present. The containers will not start without valid `JWT_SECRET` and `ENCRYPTION_KEY`.
3. **Shared Meta token.** If a workspace relied on `META_ACCESS_TOKEN`, set `META_ACCESS_TOKEN_BUSINESS_ID` to that workspace's id (`docker compose exec postgres psql -U oceanbrown -d oceanbrown -c 'SELECT id, name FROM "Business";'`).
4. **Backup first:** `docker compose exec -T postgres pg_dump -U oceanbrown --format=custom oceanbrown > pre-p0.dump`.

## Deploy

```bash
cd /opt/whatsapp-chatbot
git fetch origin && git checkout fix/p0-security   # or apply the patch / bundle you were sent
docker compose build api worker web migrate
docker compose up -d
docker compose logs --tail=50 api worker
```

The migration `20261023000200_p0_security` is additive. It marks existing `CONNECTED` numbers that have their own saved token as verified; numbers that used the shared token stay unverified until step 3 is done and **Test connection** is run.

## After deploy

1. `docker compose exec api printenv NODE_ENV` prints `production`.
2. Deactivate or re-password the demo accounts if they exist:
   `docker compose exec postgres psql -U oceanbrown -d oceanbrown -c "UPDATE \"User\" SET active=false WHERE email IN ('owner@oceanbrown.local','admin@oceanbrown.local');"`
3. Create your own administrator: `docker compose run --rm migrate npx tsx prisma/create-admin.ts you@your-domain.gm "Your Name"`.
4. In each workspace: Integrations → make sure the WABA ID is filled → **Test connection** → status `CONNECTED`.
5. Send a WhatsApp message to the number; it must appear in the inbox, and a staff reply must show "sent".
6. From outside the server, `curl -m 5 http://<server-ip>:4000/health` must fail.
7. Install the backup cron line from `scripts/backup.sh` and run one restore drill.

## Rollback

`git checkout <previous tag or commit>`, `docker compose build api worker web`, `docker compose up -d`. The new columns are unused by the old code and can stay. Restore `pre-p0.dump` only if data was damaged.
