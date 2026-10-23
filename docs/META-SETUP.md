# Connecting the WhatsApp Cloud API

Nothing is sent to WhatsApp until every step below is done and `WHATSAPP_LIVE_ENABLED=true`.

## 1. Meta side

1. In Meta Business Suite / developers.facebook.com create (or select) a business portfolio, a **Business** type app, and add the **WhatsApp** product.
2. Add and verify your phone number under WhatsApp → API Setup. Note the **Phone number ID** and **WhatsApp Business Account ID** (both numeric).
3. Create a **system user** in Business Settings, give it the `whatsapp_business_messaging` and `whatsapp_business_management` permissions on your WABA, and generate a **permanent access token**. (The 24-hour temporary token from API Setup works for testing only.)
4. Copy the **App secret** from App settings → Basic.

## 2. Server environment

```
API_URL=https://api.your-domain.gm          # public HTTPS URL of the API
JWT_SECRET=<openssl rand -base64 48>
ENCRYPTION_KEY=<openssl rand -hex 32>         # back this up separately
META_APP_SECRET=<app secret>
META_VERIFY_TOKEN=<any long random string>
TRUST_PROXY=true                              # if behind a load balancer / reverse proxy
WHATSAPP_LIVE_ENABLED=false                   # flip to true in step 5
```

Restart the API and worker after changing these.

## 3. Dashboard

Sign in as the workspace owner → **Integrations**:

1. Enter the phone number ID, WABA ID (required) and the permanent token → **Save**. The token is encrypted (AES-256-GCM) and never shown again. Saving leaves the number `PENDING`.
2. Click **Test connection**. The API lists the WABA's phone numbers with that token and requires this number to be among them, then reads the number's details; on success the status becomes `CONNECTED` and ownership is recorded. Until then no webhook is delivered to the workspace and nothing can be sent.

`META_ACCESS_TOKEN` (a system-user token in the environment) is used only by the workspace whose id is in `META_ACCESS_TOKEN_BUSINESS_ID` — normally OceanBrown's own number. Every customer workspace must save its own token.

## 4. Webhook

In the Meta app → WhatsApp → Configuration:

- Callback URL: the URL shown on the Integrations page (`https://<API_URL>/webhooks/meta`)
- Verify token: the value of `META_VERIFY_TOKEN`
- Subscribe to the **messages** field.

Send a WhatsApp message to your number; it appears in the Inbox and the Integrations page shows the last webhook time.

## 5. Go live

1. Set `WHATSAPP_LIVE_ENABLED=true` and restart the API and worker.
2. Publish at least one knowledge article (Knowledge → status `PUBLISHED`) and try it in **Agent & playground**.
3. Optional real AI: `AI_PROVIDER=anthropic` with `ANTHROPIC_API_KEY` (default model `claude-haiku-5-5`, override with `AI_MODEL`), or `AI_PROVIDER=openai` with `OPENAI_API_KEY`.
4. **Settings → AI auto-replies → Turn on.** Optionally set welcome and handover messages.

## Rules the platform enforces

- **24-hour window:** free-form replies are only allowed within 24h of the customer's last message. Outside it the dashboard blocks the reply (approved templates are required — template sending is the next roadmap item).
- **Opt-out:** `STOP`/`UNSUBSCRIBE` opts the customer out (a confirmation is sent); `START` opts them back in. Opted-out customers cannot be messaged.
- **Handover:** "human", "manager", "complaint", "refund" and similar switch the conversation to HUMAN mode; the AI stays silent until staff return it to AI.
- **Idempotency:** Meta retries and duplicate message IDs are stored once; outbound sends use one job per message.
- **Failures:** throttling and 5xx errors are retried with exponential backoff; permanent errors mark the message `FAILED` with Meta's reason; an expired token flags the connection as `ERROR`.

## Test checklist before launch

Incoming text/media, duplicate delivery, out-of-order status callbacks, invalid signature (401), wrong verify token (403), expired token, throttling, STOP/START, handover, and a reply after the 24h window. Complete Meta business verification and display-name review. Do not describe OceanBrown as a Meta partner unless Meta confirms it.
# Embedded Signup

For the self-service **Connect with Facebook** button, create an Embedded Signup configuration in the Meta app and set:

```env
META_APP_ID=your_meta_app_id
META_APP_SECRET=your_meta_app_secret
META_EMBEDDED_SIGNUP_CONFIG_ID=your_configuration_id
ENCRYPTION_KEY=64_hex_characters
```

The browser receives only the public App ID and Configuration ID. The API exchanges the one-time authorization code server-side (it expires after about 30 seconds), encrypts the resulting access token, verifies that the selected phone number belongs to the returned WhatsApp Business Account, subscribes the app to that account's webhooks and registers the number with a random 6-digit PIN (stored encrypted). Numbers connected through the WhatsApp Business app (coexistence, event `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`) are not re-registered. The token is never returned to the dashboard.

Requirements on Meta's side (OceanBrown, once):

- OceanBrown's Meta app must be an approved **Tech Provider** (App Review for `whatsapp_business_management` and `whatsapp_business_messaging`, plus Meta business verification). Until then only accounts with a role on the app can complete the flow.
- Create the configuration with **Embedded Signup v4** (earlier versions are deprecated) and the WhatsApp Cloud API product. Add the dashboard's domain to *Allowed domains* for the Facebook Login for Business configuration.
- Until OceanBrown's business is verified, Meta limits how many new customer businesses can be onboarded per rolling 7 days (10 at the time of writing).

Requirements on the customer's side (shown in the app as next steps, never asked of them in advance):

- A Facebook account; Meta lets them create or pick a business portfolio inside the window.
- A number that can receive an SMS or call, and is not on WhatsApp (or connect the WhatsApp Business app via coexistence).
- A payment method on their WhatsApp Business Account in WhatsApp Manager when Meta asks for it (Meta bills message charges to it).
- Display-name approval and, for higher limits, business verification happen at Meta; the app shows their status from the phone number's `name_status` and `code_verification_status`.

Fallback: OceanBrown staff can connect a number for a customer from **Provider admin → customer → Assisted setup**. Customers cannot reach that form, and a saved connection stays unverified until “Test connection” confirms the number belongs to the account. See `docs/ONBOARDING.md`.
