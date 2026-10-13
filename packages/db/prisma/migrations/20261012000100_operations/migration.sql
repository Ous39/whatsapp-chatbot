CREATE TABLE "Automation" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "conditions" JSONB,
  "actions" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "timezone" TEXT NOT NULL DEFAULT 'Africa/Banjul',
  "quietHours" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Campaign" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "templateName" TEXT,
  "audience" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "scheduledAt" TIMESTAMP(3),
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SavedReply" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "shortcut" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SavedReply_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Automation_businessId_enabled_idx" ON "Automation"("businessId", "enabled");
CREATE INDEX "Campaign_businessId_status_idx" ON "Campaign"("businessId", "status");
CREATE UNIQUE INDEX "SavedReply_businessId_shortcut_key" ON "SavedReply"("businessId", "shortcut");
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedReply" ADD CONSTRAINT "SavedReply_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
