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

    const faqs = industry.faqs.map(faq => ({
      businessId,
      title: faq.title,
      content: faq.content,
      status: "PUBLISHED" as const,
    }));

    await db.$transaction(async tx => {
      if (faqs.length > 0) {
        await tx.knowledgeSource.createMany({ data: faqs });
      }

      await tx.business.update({
        where: { id: businessId },
        data: {
          welcomeMessage: industry.welcomeMessage,
          automationEnabled: industry.automationEnabled,
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
