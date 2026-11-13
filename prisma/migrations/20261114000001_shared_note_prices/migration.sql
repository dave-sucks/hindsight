-- Each stock a note names, with its price when the note was written
-- ({ "NVDA": 162.26 }): the note's price-at-write on that stock's Activity line.
ALTER TABLE "SharedNote" ADD COLUMN IF NOT EXISTS "prices" JSONB;
