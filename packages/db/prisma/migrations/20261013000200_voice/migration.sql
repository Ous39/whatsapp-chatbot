-- Voice notes and multilingual (English, French, Wolof) support
ALTER TABLE "Customer" ADD COLUMN "language" TEXT;
ALTER TABLE "Business" ADD COLUMN "defaultLanguage" TEXT NOT NULL DEFAULT 'en';
-- MIRROR: answer voice with voice, NEVER: text only, ALWAYS: always attach a voice note
ALTER TABLE "Business" ADD COLUMN "voiceReplies" TEXT NOT NULL DEFAULT 'MIRROR';
