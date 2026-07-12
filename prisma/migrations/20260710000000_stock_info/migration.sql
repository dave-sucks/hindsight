-- StockInfo: per-ticker identity cache (company name + normalized exchange).
-- Populated lazily from the Finnhub profile on first touch, read from our DB
-- thereafter. Kills the live-provider dependency for header names.
CREATE TABLE "StockInfo" (
    "ticker" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "exchange" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockInfo_pkey" PRIMARY KEY ("ticker")
);

-- RLS deny-all from day one (2026-06-10 lockdown policy: anon key must see
-- nothing; Prisma connects via the direct connection and bypasses RLS).
ALTER TABLE "StockInfo" ENABLE ROW LEVEL SECURITY;
