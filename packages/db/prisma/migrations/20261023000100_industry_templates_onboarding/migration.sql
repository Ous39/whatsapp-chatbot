-- Add templateAppliedAt to Business to track when industry templates were provisioned
ALTER TABLE "Business" ADD COLUMN "templateAppliedAt" TIMESTAMP(3);

-- Create a table to track which industry templates have been installed for which business
-- This allows safe retry of template provisioning without creating duplicates
CREATE TABLE "TemplateInstallation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "TemplateInstallation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE,
    UNIQUE("businessId", "industry")
);

-- Index for quick lookup of template installations
CREATE INDEX "TemplateInstallation_businessId_idx" ON "TemplateInstallation"("businessId");
