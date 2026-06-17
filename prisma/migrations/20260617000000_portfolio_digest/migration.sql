-- Portfolio Digest — Feature A backend (additive, non-destructive).
-- See docs/plans/PORTFOLIO_DIGEST.md. One account-level digest per trading day.
-- Nothing reads or writes this table yet (the agent rewire is a separate
-- reviewed PR), so this is a pure addition with zero risk to existing tables.
--
-- DO NOT applied by this PR — the principal applies via Supabase MCP.

-- CreateTable
CREATE TABLE "PortfolioDigest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "narrative" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioDigest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioDigest_accountId_date_key" ON "PortfolioDigest"("accountId", "date");

-- CreateIndex
CREATE INDEX "PortfolioDigest_accountId_idx" ON "PortfolioDigest"("accountId");

-- CreateIndex
CREATE INDEX "PortfolioDigest_date_idx" ON "PortfolioDigest"("date");
