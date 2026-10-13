# API overview

The API listens on port 4000. JSON routes use an HTTP-only `ob_session` cookie.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/login` | Create an 8-hour server session |
| GET | `/auth/me` | Current user and workspace |
| GET | `/overview` | Tenant metrics |
| GET | `/conversations` | Tenant inbox |
| POST | `/conversations/:id/messages` | Idempotently queue a reply |
| PATCH | `/conversations/:id/mode` | Explicit AI/human/paused mode |
| GET/POST | `/customers` | CRM records |
| GET/POST | `/bookings` | Availability-checked booking requests |
| GET/POST | `/knowledge` | Versioned knowledge sources |
| POST | `/simulator` | Local-only grounded reply preview |
| GET/POST | `/webhooks/meta` | Meta verification and signed events |
| GET | `/health` | Runtime state without secrets |

All tenant routes derive the business ID from the session. Invalid or unauthorized records return 404 or 403 without leaking cross-tenant data.
