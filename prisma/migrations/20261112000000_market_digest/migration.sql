-- The Market Reviewer's digest: one row per book per weekday, written at
-- 7:30 AM ET (lib/agent/market-reviewer/run.ts).
CREATE TABLE IF NOT EXISTS "MarketDigest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "digest" TEXT NOT NULL,
    "model" TEXT,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketDigest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MarketDigest_accountId_environment_date_key" ON "MarketDigest"("accountId", "environment", "date");

-- Every public table is RLS-locked (2026-06-10 lockdown). Prisma connects as
-- the owner and bypasses RLS; the anon key must see nothing.
ALTER TABLE "MarketDigest" ENABLE ROW LEVEL SECURITY;
