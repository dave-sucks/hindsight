-- The triggers that come with a buy besides its sell price (lib/proposals/buy-triggers.ts).
ALTER TABLE "Position" ADD COLUMN IF NOT EXISTS "buyTriggers" JSONB;
