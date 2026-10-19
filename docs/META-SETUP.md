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

1. Enter the phone number ID, WABA ID and the permanent token → **Save**. The token is encrypted (AES-256-GCM) and never shown again.
2. Click **Test connection**. The API asks Meta for the number's details; on success the status becomes `CONNECTED`.

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

The browser receives only the public App ID and Configuration ID. The API exchanges the one-time authorization code server-side, encrypts the resulting access token, verifies the selected phone number and never returns the token to the dashboard. Manual system-user token setup remains available as an administrator fallback.
