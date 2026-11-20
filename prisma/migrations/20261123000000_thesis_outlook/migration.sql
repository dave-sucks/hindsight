-- What we expect of the stock from here, apart from how confident we are
-- (conviction) and the kind of trade (direction). A thesis with a view starts
-- from its direction; its analyst changes it at a review.
ALTER TABLE "Thesis" ADD COLUMN IF NOT EXISTS "outlook" TEXT;
ALTER TABLE "Thesis" ADD COLUMN IF NOT EXISTS "outlookReason" TEXT;
UPDATE "Thesis" SET "outlook" = 'BULLISH' WHERE "outlook" IS NULL AND "direction" = 'LONG';
UPDATE "Thesis" SET "outlook" = 'BEARISH' WHERE "outlook" IS NULL AND "direction" = 'SHORT';
-- The top conviction level is gone: it ranked stocks against each other,
-- which is the Portfolio Manager's job. No thesis has ever had it.
UPDATE "Thesis" SET "conviction" = 'HIGH' WHERE "conviction" = 'STRONG';
