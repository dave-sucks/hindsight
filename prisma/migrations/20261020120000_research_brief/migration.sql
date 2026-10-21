-- The research brief built for a proposal or a sale (lib/research/brief.ts).
CREATE TABLE IF NOT EXISTS "ResearchBrief" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "orderId" TEXT,
    "accountId" TEXT,
    "payload" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "costs" JSONB NOT NULL,
    "error" TEXT,
    "reusedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchBrief_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ResearchBrief_orderId_key" ON "ResearchBrief"("orderId");
CREATE INDEX IF NOT EXISTS "ResearchBrief_ticker_createdAt_idx" ON "ResearchBrief"("ticker", "createdAt");

-- Every public table is RLS-locked (2026-06-10 lockdown). Prisma connects as
-- the owner and bypasses RLS; the anon key must see nothing.
ALTER TABLE "ResearchBrief" ENABLE ROW LEVEL SECURITY;
