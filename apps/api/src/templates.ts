import { db } from "@oceanbrown/db";
import {
  contentHash,
  INDUSTRIES,
  isIndustryKey,
  planProvisioning,
  planTemplateUpdate,
  validateTemplateDefinition,
  type Facts,
  type IndustryKey,
  type IndustryTemplate,
} from "@oceanbrown/shared";

/** Latest master template: the newest version published by OceanBrown staff, else the built-in default. */
export async function currentTemplate(key: IndustryKey): Promise<IndustryTemplate> {
  const row = await db.industryTemplate.findFirst({ where: { key }, orderBy: { version: "desc" } });
  if (row) {
    const checked = validateTemplateDefinition({ ...(row.definition as object), key, version: row.version });
    if (checked.ok) return checked.template;
  }
  return INDUSTRIES[key];
}

function cleanFacts(template: IndustryTemplate, facts: Facts) {
  const allowed = new Set(template.fields.map(f => f.key));
  return Object.fromEntries(Object.entries(facts).filter(([k, v]) => allowed.has(k) && typeof v === "string" && v.trim()).map(([k, v]) => [k, String(v).trim().slice(0, 1000)]));
}

/**
 * Installs (or refreshes) an industry starter for one business. Idempotent:
 * - answers this business has never had are created (published only when fully answered and not sensitive);
 * - answers it already has are refreshed only if the business never edited them;
 * - nothing is deleted, AI replies are never switched on here, and other businesses are never touched.
 */
export async function installIndustryTemplate(businessId: string, key: IndustryKey, facts: Facts) {
  const template = await currentTemplate(key);
  const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, welcomeMessage: true, handoverMessage: true, businessFacts: true } });
  const mergedFacts = { ...((business.businessFacts as Facts | null) ?? {}), ...cleanFacts(template, facts) };
  const plan = planProvisioning(template, mergedFacts, business.name);

  const result = await db.$transaction(async tx => {
    const existing = await tx.knowledgeSource.findMany({ where: { businessId, templateKey: { not: null } }, select: { id: true, templateKey: true, templateHash: true, title: true, content: true } });
    const byKey = new Map<string, (typeof existing)[number]>(existing.map(row => [row.templateKey!, row] as const));
    let created = 0;
    let refreshed = 0;
    let keptCustomised = 0;
    for (const faq of plan.faqs) {
      const templateKey = `${key}:${faq.key}`;
      const row = byKey.get(templateKey);
      if (!row) {
        await tx.knowledgeSource.create({ data: { businessId, title: faq.title, content: faq.content, status: faq.status, sourceType: "TEMPLATE", templateKey, templateHash: faq.hash } });
        created += 1;
        continue;
      }
      const untouched = row.templateHash === contentHash(`${row.title}\n${row.content}`);
      if (!untouched) {
        keptCustomised += 1;
        continue;
      }
      if (row.templateHash !== faq.hash) {
        await tx.knowledgeSource.update({ where: { id: row.id }, data: { title: faq.title, content: faq.content, status: faq.status, templateHash: faq.hash, version: { increment: 1 } } });
        refreshed += 1;
      }
    }
    await tx.business.update({
      where: { id: businessId },
      data: {
        industry: key,
        businessFacts: mergedFacts,
        templateAppliedAt: new Date(),
        // Default messages only fill empty settings; a business's own wording is never replaced.
        ...(business.welcomeMessage ? {} : { welcomeMessage: plan.welcomeMessage }),
        ...(business.handoverMessage ? {} : { handoverMessage: plan.handoverMessage }),
      },
    });
    await tx.templateInstallation.upsert({
      where: { businessId_industry: { businessId, industry: key } },
      create: { businessId, industry: key, version: template.version },
      update: { version: template.version },
    });
    return { created, refreshed, keptCustomised };
  });

  return {
    ...result,
    industry: key,
    version: template.version,
    published: plan.faqs.filter(f => f.status === "PUBLISHED").length,
    drafts: plan.faqs.filter(f => f.status === "DRAFT").length,
    missingRequired: plan.missingRequired,
    aiCanBeEnabled: plan.aiCanBeEnabled,
  };
}

/** Kept for the registration endpoint: installs the starter if an industry was chosen at signup. */
export async function provisionIndustryTemplate(businessId: string, industryKey: string) {
  if (!isIndustryKey(industryKey)) return null;
  return installIndustryTemplate(businessId, industryKey, {});
}

/** What a newer master template would change for this business. Customised answers are never included. */
export async function templateUpdateFor(businessId: string) {
  const installation = await db.templateInstallation.findFirst({ where: { businessId }, orderBy: { updatedAt: "desc" } });
  if (!installation || !isIndustryKey(installation.industry)) return null;
  const key = installation.industry;
  const [template, business, rows] = await Promise.all([
    currentTemplate(key),
    db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, businessFacts: true } }),
    db.knowledgeSource.findMany({ where: { businessId, templateKey: { startsWith: `${key}:` } }, select: { id: true, templateKey: true, templateHash: true, title: true, content: true } }),
  ]);
  const installed = rows.map(r => ({ ...r, templateKey: r.templateKey ? r.templateKey.slice(key.length + 1) : null }));
  const plan = planTemplateUpdate(template, installation.version, installed, (business.businessFacts as Facts | null) ?? {}, business.name);
  return { industry: key, label: template.label, installedVersion: installation.version, latestVersion: template.version, plan };
}

/** Applies only the parts of a template update the owner accepted. */
export async function applyTemplateUpdate(businessId: string, accept: { add: string[]; replace: string[] }) {
  const update = await templateUpdateFor(businessId);
  if (!update || update.latestVersion <= update.installedVersion) return { added: 0, replaced: 0, version: update?.installedVersion ?? null };
  const key = update.industry;
  const add = update.plan.additions.filter(f => accept.add.includes(f.key));
  const replace = update.plan.replacements.filter(f => accept.replace.includes(f.key));
  await db.$transaction(async tx => {
    for (const faq of add) {
      await tx.knowledgeSource.create({ data: { businessId, title: faq.title, content: faq.content, status: "DRAFT", sourceType: "TEMPLATE", templateKey: `${key}:${faq.key}`, templateHash: faq.hash } });
    }
    for (const faq of replace) {
      // updateMany scoped by businessId: an id from another business can never be changed here.
      await tx.knowledgeSource.updateMany({ where: { id: faq.id, businessId }, data: { title: faq.title, content: faq.content, templateHash: faq.hash, version: { increment: 1 } } });
    }
    await tx.templateInstallation.update({ where: { businessId_industry: { businessId, industry: key } }, data: { version: update.latestVersion } });
  });
  return { added: add.length, replaced: replace.length, version: update.latestVersion };
}
