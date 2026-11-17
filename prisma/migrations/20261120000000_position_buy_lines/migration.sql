-- The lines a buy comes with besides its sale (lib/proposals/buy-lines.ts).
ALTER TABLE "Position" ADD COLUMN IF NOT EXISTS "buyLines" JSONB;
