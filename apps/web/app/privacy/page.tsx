import { LegalPage } from "../../components/LegalPage";

export const metadata = { title: "Privacy Policy | OceanBrown Connect" };

export default function PrivacyPolicy() {
  return <LegalPage title="Privacy Policy" updated="19 October 2026">
    <p>OceanBrown Creative Studio ("OceanBrown", "we", "us") provides a WhatsApp customer-operations platform for businesses. This policy explains how we handle information when a business uses the platform or communicates with a business through WhatsApp.</p>

    <h2>Information we process</h2>
    <ul>
      <li>Account information, including names, business names, email addresses, roles and encrypted authentication records.</li>
      <li>WhatsApp business configuration, such as phone-number and business-account identifiers. Provider access tokens are encrypted at rest and are not displayed after saving.</li>
      <li>Customer records supplied by a business, including names, phone numbers, email addresses, tags and consent preferences.</li>
      <li>Messages, media metadata, delivery receipts, conversation assignments, bookings, tickets, campaign activity and audit records.</li>
      <li>Operational data such as IP addresses, timestamps, security events, errors and service usage.</li>
    </ul>

    <h2>How we use information</h2>
    <p>We use information to provide the shared inbox, customer records, automations, approved-template campaigns, analytics, account support, fraud prevention and service security. AI features process only the information needed to generate a requested response and can be disabled by the business administrator.</p>

    <h2>Legal basis and business responsibility</h2>
    <p>Businesses using OceanBrown are responsible for having a valid basis to contact customers, collecting marketing consent where required, and honouring opt-out requests. OceanBrown processes customer information on the business's instructions and also processes limited account and security information to operate the service.</p>

    <h2>Sharing and service providers</h2>
    <p>We disclose information only to service providers needed to operate the platform, such as hosting, email, AI and Meta's WhatsApp Business Platform, or when required by law. We do not sell personal information. Use of WhatsApp is also subject to Meta's applicable terms and privacy policies.</p>

    <h2>Security and retention</h2>
    <p>We use access controls, tenant isolation, HTTPS, rate limiting, audit logs and encryption for stored provider tokens. Information is retained while an account is active and for the period reasonably required for security, legal obligations, dispute resolution and backups. Backup copies expire through the applicable backup-retention cycle.</p>

    <h2>Your choices and rights</h2>
    <p>You may request access, correction, export or deletion of personal information, or object to certain processing. WhatsApp users can send STOP to opt out of further messages where supported. Requests may require identity or account verification.</p>

    <h2>Children</h2>
    <p>The platform is intended for businesses and is not directed to children under 13. Businesses must not knowingly upload children's information without an appropriate legal basis and any required guardian consent.</p>

    <h2>Contact</h2>
    <p>For privacy questions or requests, email <a href="mailto:ousjallow39@outlook.com">ousjallow39@outlook.com</a>. OceanBrown Creative Studio is based in The Gambia.</p>
  </LegalPage>;
}
