-- Three-step onboarding, provider administration and versioned industry templates. Additive only.

ALTER TABLE "Business" ADD COLUMN "businessFacts" JSONB;
ALTER TABLE "Business" ADD COLUMN "suspendedReason" TEXT;

ALTER TABLE "WhatsAppConnection" ADD COLUMN "metaStatus" JSONB;
ALTER TABLE "WhatsAppConnection" ADD COLUMN "lastCheckedAt" TIMESTAMP(3);
ALTER TABLE "WhatsAppConnection" ADD COLUMN "onboardingMethod" TEXT;
ALTER TABLE "WhatsAppConnection" ADD COLUMN "encryptedRegistrationPin" TEXT;

ALTER TABLE "KnowledgeSource" ADD COLUMN "templateKey" TEXT;
ALTER TABLE "KnowledgeSource" ADD COLUMN "templateHash" TEXT;

ALTER TABLE "TemplateInstallation" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "IndustryTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IndustryTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IndustryTemplate_key_version_key" ON "IndustryTemplate"("key", "version");

CREATE TABLE "SupportRequest" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "createdById" TEXT,
    "topic" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "contactPhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "staffNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupportRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SupportRequest_businessId_status_idx" ON "SupportRequest"("businessId", "status");
CREATE INDEX "SupportRequest_status_createdAt_idx" ON "SupportRequest"("status", "createdAt");

-- Answers installed by the previous signup code were generic examples, not this business's facts.
-- Unpublish them so the assistant never repeats invented hours or policies; owners review and republish.
UPDATE "KnowledgeSource" k
SET "status" = 'DRAFT'
FROM "TemplateInstallation" t
WHERE t."businessId" = k."businessId" AND k."templateKey" IS NULL AND k."status" = 'PUBLISHED' AND k."version" = 1
  AND k."createdAt" BETWEEN t."createdAt" - INTERVAL '1 minute' AND t."createdAt" + INTERVAL '1 minute';
