-- The Portfolio Reviewer's brief, read by every agent in the Market and portfolio block.
ALTER TABLE "PortfolioDigest" ADD COLUMN IF NOT EXISTS "brief" TEXT;
