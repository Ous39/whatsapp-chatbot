# Three-step customer onboarding

Branch `fix/p0-security`, built on top of the P0 security work. Nothing here has been deployed. The three-minute target is a product goal: Meta's own steps (SMS code, display-name review, payment method, business verification) can take longer, and the app says so honestly rather than pretending to be done.

**Contents:** 1 Repository audit · 2 Competitor comparison · 3 Current flow and pain points · 4 Design · 5 Files changed · 6 Prioritised plan · 7 What changed · 8 Tests run · 9 External requirements · 10 Local testing · 11 Deployment checklist

---

## 1. Repository audit (onboarding-relevant)

| Area | Before this work |
|---|---|
| Signup | `POST /auth/register` asked for an industry and installed that industry's answers immediately, **published**, including example facts the owner never gave (hours, prices, policies). |
| WhatsApp | The Integrations page asked customers to paste a phone number ID, WABA ID and system-user access token. Embedded Signup existed but only exchanged the code; it did not subscribe the app to the WABA's webhooks or register the number. |
| Status | "Connected" was driven by a server-wide flag and a successful API call, not by Meta confirming the number or a message arriving. Test configuration could look live. |
| Templates | Code-only, single version. No per-business copy tracking, so a template change could not be offered safely. |
| Provider admin | A plan table. No view of onboarding progress, connection health, failed attempts, help requests or templates. |
| Support | No way for a customer to ask for help in the app. |
| Suspension | Plan status existed but nothing enforced it. |
| Isolation | Routes filter by `businessId`, but there was no test proving it. |

## 2. Competitor comparison

From each vendor's public help pages (October 2026). No code, designs or text were copied.

| Platform | How a number is connected | What the customer must have | Notable |
|---|---|---|---|
| **WATI** | Embedded Signup inside the app, about 11 steps | Paid plan, Meta Business admin, number not on WhatsApp, desktop Chrome | Separate coexistence guide. Tells customers *not* to add their own payment method: WATI bills. |
| **SleekFlow** | Embedded Signup after a US$15 connection add-on | Facebook admin with 2FA, completed business info, number that can receive calls/SMS | "Connect via Coexistence" keeps the WhatsApp Business app and imports history. Test message as the final step. |
| **respond.io** | Embedded Signup with eligibility checks first | Meta Business admin, public website, number not on WhatsApp; Meta virtual numbers for testing | Sends a wa.me test message to confirm. Explains how to move from a previous provider. |
| **WhatChimp** | Embedded Signup (recommended) or manual | Facebook account, new number, legal name, website or public profile | Lets the customer choose existing WhatsApp Business app number or a new one. Payment method and verification are listed as after-steps. |
| **AiSensy** | Embedded Signup, Google or email signup, 14-day trial | Facebook Business Manager, number not on WhatsApp | Shows a "LIVE" status when done. Display-name approval of up to a few hours. Support team helps with setup. |
| **ManyChat** | Embedded Signup from Settings → Channels | Pro plan or higher, Meta Business account, dedicated number | Number must not be on the WhatsApp Business app. Meta fees billed separately from the plan. |
| **Twilio** | ISV embeds Meta's signup through the Tech Provider program | Customer picks or is assigned a number first | The ISV registers senders through Twilio's API and never calls Meta directly. |
| **Gupshup** | Partner-hosted Embedded Signup (beta) | Tech Provider + joint solution with Gupshup | Exposes a provisioning pipeline the partner polls for status; error and rate-limit handling is the partner's job. |

**What this means for OceanBrown.** Everyone serious uses Embedded Signup; nobody asks customers for tokens. The differences are in what happens around it: prerequisites stated up front (WATI, SleekFlow, respond.io), a test message to prove it works (SleekFlow, respond.io), coexistence for small businesses already on the WhatsApp Business app (SleekFlow, WhatChimp), honest status while Meta reviews things (AiSensy), and human help when it fails (AiSensy). OceanBrown's advantage in The Gambia is the last one plus local industries and languages, so the design leans on assisted setup and industry starters rather than a big flow builder.

## 3. Current flow and pain points (before)

1. Register with five fields including industry. → Industry answers published immediately with invented facts; AI could repeat them.
2. Land on the dashboard with no guidance.
3. Integrations: paste three technical values. → Most small businesses cannot find these; tokens pasted by customers leak and expire.
4. "Connected" shown after a token check. → No webhook subscription or number registration, so nothing arrived; the status was wrong.
5. No way to ask for help; no view for OceanBrown of who was stuck.

## 4. Design

### Signup: four fields
Business name, your name, email, password. Industry moved to step 2. Registration lands on `/onboarding`.

### Step 1 — Connect WhatsApp
- **Connect with Facebook** opens Meta's Embedded Signup (v4). Prerequisites are listed before starting. OceanBrown never sees the Facebook password.
- The browser listens for Meta's `WA_EMBEDDED_SIGNUP` messages (only from facebook.com origins): `FINISH`, `FINISH_ONLY_WABA`, `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` (coexistence), `CANCEL` with the step or with an error code.
- The server: exchanges the code → checks the number belongs to the returned WABA → claims it for this workspace (one workspace per number) → subscribes the app to the WABA's webhooks → registers the number with a random PIN (skipped for coexistence) → reads the number's status from Meta.
- Cancellations and errors are recorded and translated into plain language (wrong code, number already on WhatsApp, permissions not granted, rate limit, Meta temporary error). Staff see the technical reason in Provider admin.
- If Embedded Signup isn't configured, the customer sees "OceanBrown will connect your number for you" and a help form. No fake connect button.

**Connection states** (derived from stored facts, never from a flag):

| State | Meaning |
|---|---|
| Not started | No number saved. |
| In progress | Number saved, ownership not yet confirmed. |
| Action required | Something the customer or OceanBrown must fix; the next action names who. |
| Waiting for Meta | Display-name review, verification or registration pending at Meta. |
| Connected | Everything at Meta is done; waiting for the first real message. |
| Live | Connected **and** ownership verified **and** registered **and** a webhook has arrived **and** live delivery is switched on for the server. |

Six checks are shown: number verified, display name, registered, connected to OceanBrown, receiving messages, live delivery. "Check again" re-reads Meta. A temporary Meta error never downgrades a working connection.

### Step 2 — Your business
- Searchable list of 15 industries (retail, restaurant, hospitality, healthcare, education, finance, telecom, real estate, logistics, professional services, recruitment, media, government, non-profit, other).
- Each industry asks a few questions (hours, location, delivery, prices…). Answers use `{{placeholders}}`; an answer is **published only if every placeholder is filled**, otherwise it is saved as a draft that says "[Add …]".
- Healthcare, finance and government never auto-publish: a person approves every answer.
- The welcome and handover messages are filled only if the owner hasn't written their own.
- Installing never switches on AI replies. Re-running it is idempotent and keeps anything the owner edited.

**Versioning.** Each installed answer stores the template key and a content hash. When OceanBrown publishes a new template version in Provider admin, owners see it in Settings: new answers arrive as drafts, untouched answers can be refreshed, edited answers are always kept. Nothing changes until the owner chooses.

### Step 3 — Review and start
Business, number, connection status, industry, published vs draft answers, a preview chat that runs the real assistant through the simulator (nothing is sent), **Open inbox**, **Edit answers**, and **Switch on AI replies**. The API refuses to switch on AI replies when there are no published answers. "I've reviewed my setup" marks onboarding complete; it does not make anything live.

### Everywhere else
- A setup banner and a status badge in the header until onboarding is complete.
- **Help & support** page: ask OceanBrown, follow your requests and staff replies.
- The WhatsApp page shows status, next steps split between "you" and "OceanBrown", disconnect, and plain-language notes on the 24-hour window and Meta billing. Technical details are in a staff-only panel.
- Mobile: single-column stepper, wrapping banners and buttons, scrollable tables.

### Provider admin (`/platform`, SUPER_ADMIN only)
Overview counts (customers, open help, connection errors, failed attempts, failed/unmatched webhooks, stuck replies, suspended). Tabs:
- **Customers**: search; setup, WhatsApp, plan and help per business. Detail: onboarding status and checks, team, plan change, suspend (reason required) and reactivate, Meta check, connection test, number registration, assisted setup form, help requests, activity log.
- **Help requests**: start, resolve, reopen, reply with a note the customer sees.
- **Failed connections**: last 30 days of abandoned or failed Embedded Signup attempts, to follow up.
- **Industry templates**: versions in use, JSON editor that validates and publishes a new version with notes.

Every admin action is written to the affected business's audit log. Suspension blocks changes and stops automatic replies and sending; the workspace can still sign in and read.

## 5. Files changed

**Shared** `packages/shared/src/`: `industries.ts` (rewritten templates, filling, provisioning, update planning, validation), `onboarding.ts` (new: status model, Meta and signup error mapping), `onboarding.test.ts` (new), `graph.ts` (phone status fields, `registerPhoneNumber`), `index.ts`.

**Database** `packages/db/prisma/`: `schema.prisma`; migration `20261023000300_three_step_onboarding` (business facts, suspension reason, connection Meta status / last checked / method / encrypted PIN, template key and hash on answers, `IndustryTemplate`, `SupportRequest`, and unpublishing of old auto-installed answers — see §11).

**API** `apps/api/src/`: `templates.ts` (rewritten), `whatsapp-routes.ts` (rewritten), `onboarding-routes.ts` (new), `platform-routes.ts` (new), `auth.ts` (four-field register, suspension guard, staff guard, platform audit), `routes.ts` (no AI without published answers; staff-only requirements), `commercial-routes.ts` (old platform routes removed), `app.ts`. Test: `apps/api/test/isolation.test.ts` (new).

**Worker** `apps/worker/src/processor.ts`: no automatic replies or sends for suspended workspaces.

**Web** `apps/web/`: `app/onboarding/page.tsx` (rewritten wizard), `app/integrations/page.tsx`, `app/page.tsx`, `app/platform/page.tsx` (rewritten), `app/help/page.tsx` (new), `app/settings/page.tsx`, `app/onboarding.css` (new), `app/layout.tsx`, `components/ConnectWhatsApp.tsx` (new), `components/HelpRequest.tsx` (new), `components/StarterTemplateUpdate.tsx` (new), `components/Shell.tsx`, `components/Login.tsx`, `lib/onboarding.ts` (new), `lib/api.ts` (validation details on errors).

**Docs/config**: `docs/ONBOARDING.md` (this file), `docs/META-SETUP.md`, `README.md`, `.env.example`.

## 6. Prioritised plan

| # | Item | Status |
|---|---|---|
| P0 | Customers never handle tokens/IDs; staff-only manual setup | Done |
| P0 | Embedded Signup completes properly (subscribe + register + coexistence) | Done; needs Meta configuration to use |
| P0 | Honest status: Live only after a real delivery | Done |
| P0 | Starter answers never publish invented facts; AI off until reviewed | Done |
| P1 | Failure handling and assisted setup; help requests | Done |
| P1 | Provider admin, suspension, audit | Done |
| P1 | Template versions with owner-controlled updates | Done |
| P1 | Tenant-isolation tests | Written; run in CI (see §8) |
| P2 | Message-template (HSM) submission per industry at Meta | Not started |
| P2 | Prices per plan | Not set on purpose: decide after measuring Meta and AI costs per customer |
| P2 | Email notifications to customers when Meta status changes | Not started |
| P2 | Wolof/French text for onboarding screens | Not started |
| P3 | Meta webhooks for account updates (`account_update`, `phone_number_name_update`) to refresh status without "Check again" | Not started |

## 7. What changed for each role

- **New customer**: four fields → three guided steps → preview → live, with help at every step.
- **Existing customer** (e.g. OceanBrown's own workspace): sees the stepper with steps already marked done where facts exist. Old auto-installed answers become drafts after the migration and must be reviewed (see §11).
- **OceanBrown staff**: Provider admin replaces the plan table; manual connection moved there.

## 8. Tests run

The sandbox could not install packages (npm registry blocked), so the full `pnpm test`/`next build` could not run here. What did run:

| Check | How | Result |
|---|---|---|
| Shared unit tests (status model, error mapping, templates, existing tests) | Bun 1.4.4 with a vitest-compatible shim | **63 passed, 0 failed** (5 files) |
| Worker processor tests | Bun with the shim | **7 passed, 0 failed** |
| Type check: shared, API, worker, db scripts | `tsc` 6.0.3 with stubs for Fastify/Prisma/BullMQ | **No errors** apart from implicit-`any` noise caused by the stubs |
| Type check: web app | `tsc` with minimal React/Next/lucide stubs | **No errors** apart from implicit-`any` noise caused by the stubs |
| `apps/api/test/isolation.test.ts` | Syntax-checked only | **Not run** — needs Fastify installed. Run it with `pnpm --filter @oceanbrown/api test`. |

The isolation test replaces the database with an in-memory store that filters only by the `where` each route passes, seeds a second workspace marked `SECRET-B`, and checks: 17 list endpoints never return it; 12 by-id reads/updates/deletes on the other workspace's records fail without touching them; all 12 Provider admin routes return 403 to a business owner and 401 without a session; customers can't save tokens or run the staff test and don't see IDs; a suspended workspace can read but not change settings.

**Not tested here**: a real Embedded Signup with Meta, number registration, display-name states, rate limits from Meta, and the pages in a real browser. These need the steps in §10 and §11.

## 9. External requirements

- **Meta app as Tech Provider**: App Review for `whatsapp_business_management` and `whatsapp_business_messaging`; OceanBrown business verification. Until approved, only people with a role on the app can complete Embedded Signup.
- **Embedded Signup v4 configuration** → `META_EMBEDDED_SIGNUP_CONFIG_ID`. Allowed domains must include the dashboard domain.
- **Server env**: `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `ENCRYPTION_KEY` (64 hex), `WHATSAPP_LIVE_ENABLED=true` for live delivery, optional `SUPPORT_EMAIL` (and the existing email provider settings) for help-request notifications.
- **Webhook**: Meta app → WhatsApp → Configuration → `https://<api-domain>/webhooks/meta`, field `messages`.
- **Onboarding limit**: until OceanBrown's business is verified, Meta caps new customer businesses per rolling 7 days (10 at the time of writing).
- **Customer side**: a payment method on their WhatsApp Business Account when Meta asks; display-name approval; business verification for higher limits. Meta charges for marketing and utility templates and, since 1 October 2026, service messages above the monthly free allowance per number — check Meta's current rate card for The Gambia before setting prices.
- OceanBrown's own number is **not** a shared sender: every customer connects their own number.

## 10. Local testing

```bash
cp .env.example .env            # leave WHATSAPP_LIVE_ENABLED=false
docker compose up -d postgres redis
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm db:create-admin             # creates a SUPER_ADMIN for Provider admin
pnpm dev
pnpm test                        # includes apps/api/test/isolation.test.ts
```

Walk-through without Meta:

1. Open http://localhost:3000, **Create account** with four fields → you land on `/onboarding`.
2. Step 1 shows "OceanBrown will connect your number for you" (Embedded Signup not configured). Send a help request.
3. Step 2: search "rest", pick Restaurant, fill only some fields → the summary shows which answers were published and which are drafts.
4. Step 3: ask the preview chat a question; try **Switch on AI replies** before publishing anything (refused), then publish an answer in Knowledge and retry.
5. Sign in as the SUPER_ADMIN → **Provider admin**: the new customer, the help request (reply and resolve), assisted setup form, suspend → as the customer, try changing Settings (refused) → reactivate.
6. Templates tab: edit Restaurant, publish v2 → as the customer, Settings shows the update; accept part of it.

With a Meta test app: set `META_APP_ID`, `META_APP_SECRET`, `META_EMBEDDED_SIGNUP_CONFIG_ID`, `ENCRYPTION_KEY`, expose the API over HTTPS (e.g. a tunnel) as the webhook, and use a test number. Status should stop at **Connected** until you message the number and live delivery is on; then it becomes **Live**. Test-mode connections are never shown as Live.

## 11. Deployment checklist

Do these in order, with a backup first. Nothing has been deployed.

1. **Backup** the database (`scripts/backup.sh`) and confirm a restore works.
2. **Read the migration warning.** Migration `20261023000300_three_step_onboarding` sets answers to **DRAFT** if they were auto-installed by the old signup (no template key, version 1, created within a minute of the template installation). On the live server this will unpublish the 8 OceanBrown starter FAQs. That is intended — they contain example facts — but the assistant will have nothing to answer from until they are reviewed. Either review and republish them right after deploying, or turn AI replies off first.
3. Deploy the P0 security changes first if not already deployed (ports bound to localhost, cookie and lockout fixes).
4. Set env: `META_APP_ID`, `META_EMBEDDED_SIGNUP_CONFIG_ID` (when ready), `SUPPORT_EMAIL` (optional). Keep `META_ACCESS_TOKEN_BUSINESS_ID` pointing at OceanBrown's own workspace.
5. `prisma migrate deploy`, then restart api, worker, web.
6. Smoke test: sign in; `/onboarding` loads; your own number still shows **Live** after a message arrives; Provider admin loads for the SUPER_ADMIN and returns 403 for an owner.
7. Review and republish OceanBrown's answers; switch AI replies back on deliberately.
8. Only after Meta approves the Tech Provider review: configure Embedded Signup and try it with one friendly customer before announcing it.
9. Watch Provider admin for failed connection attempts and stuck replies during the first week.

Rollback: the migration only adds columns/tables and changes answer status; restoring the backup reverts it. The previous build can run against the new schema, but answers will remain drafts.
