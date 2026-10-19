import { LegalPage } from "../../components/LegalPage";

export const metadata = { title: "User Data Deletion | OceanBrown WhatsApp Agent" };

export default function DataDeletion() {
  return <LegalPage title="User Data Deletion Instructions" updated="19 October 2026">
    <p>You can request deletion of information associated with OceanBrown WhatsApp Agent, including information received through Meta or WhatsApp.</p>

    <h2>How to request deletion</h2>
    <ol>
      <li>Email <a href="mailto:ousjallow39@outlook.com?subject=OceanBrown%20data%20deletion%20request">ousjallow39@outlook.com</a> with the subject <strong>OceanBrown data deletion request</strong>.</li>
      <li>Include the email address used for the account, the workspace or business name, and the WhatsApp phone number connected to the workspace, if applicable.</li>
      <li>Do not include your password, Meta App Secret, access token or any one-time code.</li>
      <li>We will verify that you control the account or business before deletion.</li>
    </ol>

    <h2>What happens next</h2>
    <p>We will acknowledge the request and normally complete verified deletion within 30 days. We delete or anonymise the account, imported contacts, conversations, campaign records, stored WhatsApp configuration and related workspace data.</p>

    <h2>Limited retention</h2>
    <p>We may retain limited records where required for security, fraud prevention, legal compliance, dispute resolution or financial reporting. Encrypted backups are removed through the normal backup-retention cycle and are not restored except for disaster recovery.</p>

    <h2>Facebook and WhatsApp data</h2>
    <p>Deleting OceanBrown data does not automatically delete information held independently by Meta or another business. You may also need to manage your information through Facebook, WhatsApp or the business you communicated with.</p>
  </LegalPage>;
}
