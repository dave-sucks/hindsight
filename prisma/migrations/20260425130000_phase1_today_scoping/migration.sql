-- Phase 1 — today-scoping foundation.
--
-- Adds the schema fields required for:
--   • today-only signal filtering (Signal.tradingDay, AnalystSignalRoute.tradingDay)
--   • signal-type aware aging (Signal.freshnessWindow)
--   • monitor lifecycle classification (Monitor.class)
--   • watchlist as carryover mechanism (AnalystWatchlistItem.expiresAt)
--   • thesis-driven tactical re-evaluation (Thesis.revalidationTriggers)
--   • run-mode multiplexing (ResearchRun.mode)
--
-- All additive. No drops. Every column has a default or is nullable so
-- existing code keeps working until the Phase 2 query updates land.

-- ─── Signal ─────────────────────────────────────────────────────────────
ALTER TABLE "Signal"
  ADD COLUMN "tradingDay"      DATE,
  ADD COLUMN "freshnessWindow" INTEGER DEFAULT 24;

-- Backfill tradingDay from createdAt in ET (the market trading-day timezone).
UPDATE "Signal"
   SET "tradingDay" = ("createdAt" AT TIME ZONE 'America/New_York')::date
 WHERE "tradingDay" IS NULL;

-- Backfill freshnessWindow per-type. Producer code in Phase 2+ will set this
-- explicitly going forward; this is just so legacy rows aren't all 24h.
UPDATE "Signal" SET "freshnessWindow" = CASE "type"
  WHEN 'NEWS'         THEN 24
  WHEN 'EARNINGS'     THEN 72
  WHEN 'FILING'       THEN 72
  WHEN 'MACRO'        THEN 24
  WHEN 'SECTOR'       THEN 48
  WHEN 'SOCIAL'       THEN 12
  WHEN 'PRICE_ACTION' THEN 4
  WHEN 'OPTIONS'      THEN 8
  WHEN 'ANALYST_NOTE' THEN 48
  ELSE 24
END
WHERE "freshnessWindow" = 24;

CREATE INDEX "Signal_tradingDay_idx" ON "Signal" ("tradingDay");

-- ─── Monitor ────────────────────────────────────────────────────────────
ALTER TABLE "Monitor"
  ADD COLUMN "class" TEXT NOT NULL DEFAULT 'FIRM_WIDE';

-- Backfill class from existing scope/builtIn/name heuristics.
-- Order matters: most-specific first.
UPDATE "Monitor" SET "class" = 'POSITION'
  WHERE "builtIn" = true AND "name" ILIKE '%portfolio%';

UPDATE "Monitor" SET "class" = 'WATCHLIST'
  WHERE "builtIn" = true AND "name" ILIKE '%watchlist%';

UPDATE "Monitor" SET "class" = 'UNIVERSE'
  WHERE "scope" = 'ANALYST' AND "class" = 'FIRM_WIDE';

UPDATE "Monitor" SET "class" = 'UNIVERSE'
  WHERE "type" = 'DOMAIN' AND "class" = 'FIRM_WIDE';

-- Everything else stays FIRM_WIDE (FMP movers, Finnhub earnings, firm-scope
-- searches). Operator can re-classify via UI later.

-- ─── AnalystWatchlistItem ───────────────────────────────────────────────
ALTER TABLE "AnalystWatchlistItem"
  ADD COLUMN "expiresAt" TIMESTAMP(3);

-- ─── Thesis ─────────────────────────────────────────────────────────────
ALTER TABLE "Thesis"
  ADD COLUMN "revalidationTriggers" JSONB;

-- ─── ResearchRun ────────────────────────────────────────────────────────
ALTER TABLE "ResearchRun"
  ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'MORNING_PLAN';

-- All historical runs were morning runs by definition (no other mode existed).

-- ─── AnalystSignalRoute ─────────────────────────────────────────────────
ALTER TABLE "AnalystSignalRoute"
  ADD COLUMN "tradingDay" DATE;

UPDATE "AnalystSignalRoute"
   SET "tradingDay" = ("routedAt" AT TIME ZONE 'America/New_York')::date
 WHERE "tradingDay" IS NULL;

CREATE INDEX "AnalystSignalRoute_analystId_tradingDay_idx"
  ON "AnalystSignalRoute" ("analystId", "tradingDay");
