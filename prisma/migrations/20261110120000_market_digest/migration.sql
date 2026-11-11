-- What the Market Reviewer writes: one row per book per weekday, at 7:30 AM ET
-- (lib/inngest/functions/market-reviewer.ts). `brief` is what every agent
-- reads; `narrative` is the digest on the homepage's Market tab.
CREATE TABLE IF NOT EXISTS "MarketDigest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "brief" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "model" TEXT,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketDigest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MarketDigest_accountId_environment_date_key" ON "MarketDigest"("accountId", "environment", "date");
CREATE INDEX IF NOT EXISTS "MarketDigest_accountId_idx" ON "MarketDigest"("accountId");
CREATE INDEX IF NOT EXISTS "MarketDigest_date_idx" ON "MarketDigest"("date");

-- Every public table is RLS-locked (2026-06-10 lockdown). Prisma connects as
-- the owner and bypasses RLS; the anon key must see nothing.
ALTER TABLE "MarketDigest" ENABLE ROW LEVEL SECURITY;
