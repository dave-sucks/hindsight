-- One-time data fix for the RECONCILED_FILL mislabel.
-- Run manually: psql $DIRECT_URL -f prisma/migrations/manual/fix_reconciled_fill_mislabel.sql
--
-- Context: before the Order.closeReason/closeSource fix, any close that did not
-- fill inside closeOpenPosition's 5s poll (or went through proposal→approve) was
-- finalized by reconcile-orders with closeReason='RECONCILED_FILL ($price)',
-- closeSource='reconcile'. Real stop/target/manual exits were therefore
-- mislabeled and excluded from win-rate/payoff/expectancy by the analytics
-- rubrics. This relabels the rows whose backing FILLED Order is an explicit
-- intent='CLOSE' decision (i.e. a genuine exit), and voids the stale sell
-- proposals left dangling on already-closed positions.
--
-- Idempotent + conservative: only touches Positions still marked
-- 'RECONCILED_FILL' that have a FILLED intent='CLOSE' order behind them, so a
-- true orphan fill (no decision row) keeps its RECONCILED_FILL label.

-- ── 1. Relabel positions whose close traces to a real intent='CLOSE' fill ────
-- These were agent-initiated exits (tactical-run close_position / manage_position
-- full_close). closeSource='agent'; closeReason defaults to 'STOP' for the
-- confirmed Momentum Breakout cohort (all four exits cite a stop / -5%
-- trade-risk breach). Any other relabeled row falls back to 'MANUAL' since the
-- precise enum wasn't persisted pre-fix.
UPDATE "Position" p
SET
  "closeReason" = CASE
    WHEN p.symbol IN ('SMTC', 'MTSI', 'LRCX', 'MRVL') THEN 'STOP'
    ELSE 'MANUAL'
  END,
  "closeSource" = 'agent'
WHERE p.status = 'CLOSED'
  AND p."closeReason" LIKE 'RECONCILED_FILL%'
  AND EXISTS (
    SELECT 1 FROM "Order" o
    WHERE o."positionId" = p.id
      AND o.intent = 'CLOSE'
      AND o.status = 'FILLED'
  );

-- ── 2. Backfill the originating Order rows for the audit trail ───────────────
-- Stamp the same reason/source on the FILLED close orders so the decision row
-- matches the position (what new orders carry going forward).
UPDATE "Order" o
SET
  "closeReason" = p."closeReason",
  "closeSource" = p."closeSource"
FROM "Position" p
WHERE o."positionId" = p.id
  AND o.intent = 'CLOSE'
  AND o.status = 'FILLED'
  AND o."closeReason" IS NULL
  AND p."closeReason" IN ('STOP', 'TARGET', 'TIME', 'MANUAL')
  AND p."closeSource" = 'agent';

-- ── 3. Void orphaned sell proposals on already-closed positions ──────────────
-- SMTC + MTSI each carry an AWAITING_APPROVAL intent='CLOSE' order proposed by
-- the daily run while the price-monitor/tactical path sold directly. Cancel
-- them so the user isn't shown an approve/reject card for a closed position.
UPDATE "Order" o
SET
  status = 'CANCELLED',
  "alpacaConfirmedAt" = NOW(),
  "rejectionMessage" = 'Auto-cancelled — position closed by another path before this proposal was approved.'
WHERE o.status = 'AWAITING_APPROVAL'
  AND o.intent IN ('CLOSE', 'PARTIAL_CLOSE')
  AND EXISTS (
    SELECT 1 FROM "Position" p
    WHERE p.id = o."positionId"
      AND p.status = 'CLOSED'
  );
