-- The Market Reviewer's notes carry two fields: how much the news could
-- matter (low | medium | high) and which way it moves the reason we own or
-- watch the stock (stronger | weaker | neutral). Null on the owner's notes.
ALTER TABLE "SharedNote" ADD COLUMN IF NOT EXISTS "impact" TEXT;
ALTER TABLE "SharedNote" ADD COLUMN IF NOT EXISTS "effect" TEXT;
