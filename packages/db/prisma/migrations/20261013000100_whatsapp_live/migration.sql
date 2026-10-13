-- WhatsApp Cloud API live integration
ALTER TABLE "Customer" ADD COLUMN "lastInboundAt" TIMESTAMP(3);
ALTER TABLE "WhatsAppConnection" ADD COLUMN "wabaId" TEXT;
ALTER TABLE "WhatsAppConnection" ADD COLUMN "verifiedName" TEXT;
ALTER TABLE "WhatsAppConnection" ADD COLUMN "lastError" TEXT;
ALTER TABLE "Business" ADD COLUMN "welcomeMessage" TEXT;
ALTER TABLE "Business" ADD COLUMN "handoverMessage" TEXT;
CREATE INDEX "WhatsAppConnection_businessId_idx" ON "WhatsAppConnection"("businessId");
-- Fast lookup of the active conversation for a customer
CREATE INDEX "Conversation_businessId_customerId_status_idx" ON "Conversation"("businessId", "customerId", "status");
