-- Wall Street targets and EPS consensus from Nasdaq's website JSON, one row
-- per stock per day (lib/market-data/street-consensus.ts).
CREATE TABLE IF NOT EXISTS "StreetConsensus" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "asOf" TEXT NOT NULL,
    "targetLow" DOUBLE PRECISION NOT NULL,
    "targetAvg" DOUBLE PRECISION NOT NULL,
    "targetHigh" DOUBLE PRECISION NOT NULL,
    "analysts" INTEGER NOT NULL,
    "buy" INTEGER NOT NULL,
    "hold" INTEGER NOT NULL,
    "sell" INTEGER NOT NULL,
    "epsNextQuarter" DOUBLE PRECISION,
    "epsNextQuarterEstimates" INTEGER,
    "epsNextQuarterUp" INTEGER,
    "epsNextQuarterDown" INTEGER,
    "epsNextQuarterFiscalEnd" TEXT,
    "epsFiscalYear" DOUBLE PRECISION,
    "epsFiscalYearUp" INTEGER,
    "epsFiscalYearDown" INTEGER,
    "epsNextQuarter1wAgo" DOUBLE PRECISION,
    "epsNextQuarter1mAgo" DOUBLE PRECISION,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StreetConsensus_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StreetConsensus_ticker_asOf_key" ON "StreetConsensus"("ticker", "asOf");

-- Every public table is RLS-locked (2026-06-10 lockdown). Prisma connects as
-- the owner and bypasses RLS; the anon key must see nothing.
ALTER TABLE "StreetConsensus" ENABLE ROW LEVEL SECURITY;
