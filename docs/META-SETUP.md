# Meta WhatsApp Cloud API activation

The checked-in application remains offline until all steps below are complete.

1. Create or select a Meta business portfolio, developer app, WhatsApp Business Account, and phone number in Meta's official dashboard.
2. Configure the HTTPS callback as `https://YOUR_API/webhooks/meta` and set a private verify token.
3. Subscribe to the supported WhatsApp webhook fields. Store the app secret, verify token, system-user access token, and phone-number ID only in server secrets.
4. Add the phone-number ID to the tenant's `WhatsAppConnection`. Confirm webhook health with a signed test event.
5. Synchronize message templates and approval states before enabling campaigns.
6. Complete Meta business verification, display-name review, payment method, and any regional eligibility requirements shown by Meta.
7. Test incoming events, duplicate delivery, status ordering, invalid signatures, expired tokens, throttling, opt-outs, and the customer-service-window/template gate.
8. Set `WHATSAPP_LIVE_ENABLED=true` only after an OceanBrown administrator explicitly approves activation.

OceanBrown must not claim to be a Meta partner unless Meta has separately confirmed that status.
