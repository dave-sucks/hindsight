-- DAV-247: the daily indicator snapshot the trigger evaluator reads.
CREATE TABLE IF NOT EXISTS "TickerIndicators" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "asOf" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "volumeFeed" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    CONSTRAINT "TickerIndicators_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TickerIndicators_ticker_asOf_key" ON "TickerIndicators"("ticker", "asOf");

-- Every public table is RLS-locked (2026-06-10 lockdown). Prisma connects as
-- the owner and bypasses RLS; the anon key must see nothing.
ALTER TABLE "TickerIndicators" ENABLE ROW LEVEL SECURITY;
