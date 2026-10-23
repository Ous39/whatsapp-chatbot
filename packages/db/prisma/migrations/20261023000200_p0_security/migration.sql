-- P0 security fixes (audit 2026-10-23). Additive only.

-- Per-account login lockout
ALTER TABLE "User" ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);

-- WhatsApp number ownership. Webhooks and sends now require a verified, CONNECTED number.
ALTER TABLE "WhatsAppConnection" ADD COLUMN "ownershipVerifiedAt" TIMESTAMP(3);

-- Keep existing live connections working: a CONNECTED number with its own saved token already passed a
-- Meta call made with that token. Numbers that relied on the shared META_ACCESS_TOKEN are NOT backfilled;
-- set META_ACCESS_TOKEN_BUSINESS_ID to the owning workspace and run "Test connection" again.
UPDATE "WhatsAppConnection"
SET "ownershipVerifiedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'CONNECTED' AND "encryptedAccessToken" IS NOT NULL;
