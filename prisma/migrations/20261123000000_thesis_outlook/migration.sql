-- What we expect of the stock from here, apart from how confident we are
-- (conviction) and the kind of trade (direction). Left empty on every thesis
-- there is: nobody has judged it, and a long is not thereby bullish. The
-- Writer sets it on a thesis it writes, and the first look at a stock that
-- has none must set it (lib/agent/thesis-review.ts).
ALTER TABLE "Thesis" ADD COLUMN IF NOT EXISTS "outlook" TEXT;
ALTER TABLE "Thesis" ADD COLUMN IF NOT EXISTS "outlookReason" TEXT;
-- The top conviction level is gone: it ranked stocks against each other,
-- which is the Portfolio Manager's job. No thesis has ever had it.
UPDATE "Thesis" SET "conviction" = 'HIGH' WHERE "conviction" = 'STRONG';
