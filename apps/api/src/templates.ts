import { db } from "@oceanbrown/db";
import { INDUSTRIES, type IndustryKey } from "@oceanbrown/shared";

export async function provisionIndustryTemplate(businessId: string, industryKey: IndustryKey) {
  const industry = INDUSTRIES[industryKey];
  if (!industry) {
    console.warn(`Unknown industry: ${industryKey}`);
    return;
  }

  try {
    const existing = await db.templateInstallation.findUnique({
      where: { businessId_industry: { businessId, industry: industryKey } },
    });

    if (existing) {
      console.log(`Template for ${industryKey} already installed for business ${businessId}`);
      return;
    }

    // Starter FAQs are examples ("open 9 AM to 6 PM", "returns within 14 days"), not this business's facts.
    // They arrive as DRAFT so the AI never tells real customers a policy the owner did not write;
    // the owner edits and publishes them in Knowledge.
    const faqs = industry.faqs.map(faq => ({
      businessId,
      title: faq.title,
      content: faq.content,
      status: "DRAFT" as const,
    }));

    await db.$transaction(async tx => {
      if (faqs.length > 0) {
        await tx.knowledgeSource.createMany({ data: faqs });
      }

      await tx.business.update({
        where: { id: businessId },
        data: {
          welcomeMessage: industry.welcomeMessage,
          // AI auto-replies stay off until the owner has reviewed knowledge and switches them on in Settings.
          defaultLanguage: industry.defaultLanguage,
          templateAppliedAt: new Date(),
        },
      });

      await tx.templateInstallation.create({
        data: {
          businessId,
          industry: industryKey,
          version: 1,
        },
      });
    });

    console.log(`Successfully provisioned ${industryKey} template for business ${businessId}`);
  } catch (error) {
    console.error(`Failed to provision template for ${industryKey}:`, error);
    throw error;
  }
}
