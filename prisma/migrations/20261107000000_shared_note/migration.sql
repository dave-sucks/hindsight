-- A note written once and read on every stock in its audience: the whole
-- account, one analyst, a sector, or a list of stocks (lib/agent/shared-notes.ts).
CREATE TABLE IF NOT EXISTS "SharedNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "runId" TEXT,
    "body" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "analystId" TEXT,
    "sector" TEXT,
    "tickers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "eventDate" TEXT,
    "pinnedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SharedNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SharedNote_userId_createdAt_idx" ON "SharedNote"("userId", "createdAt");

-- Every public table is RLS-locked (2026-06-10 lockdown). Prisma connects as
-- the owner and bypasses RLS; the anon key must see nothing.
ALTER TABLE "SharedNote" ENABLE ROW LEVEL SECURITY;
