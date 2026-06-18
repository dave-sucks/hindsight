-- Carry the originating close decision on the Order row.
--
-- Problem: a close that does NOT fill inside closeOpenPosition's 5s synchronous
-- poll (or that goes through the proposal→approve seam) is finalized later by
-- the reconcile-orders cron. That cron had no record of WHY the position was
-- closed, so it stamped Position.closeReason = 'RECONCILED_FILL ($price)'. Real
-- stop / target / manual exits were therefore mislabeled as reconciliation
-- artifacts and EXCLUDED from win-rate / payoff / expectancy by the analytics
-- rubrics. Confirmed on Momentum Breakout's SMTC/MTSI/LRCX/MRVL (2026-06-17).
--
-- Fix: closeOpenPosition now stamps the reason + source on the PENDING/AWAITING
-- close Order at creation time. reconcile-orders reads them back and only falls
-- back to RECONCILED_FILL when the order carries NEITHER (a true orphan fill
-- with no decision row behind it). See lib/inngest/functions/reconcile-orders.ts
-- and lib/actions/closeTrade.actions.ts.
--
-- Additive + safe: both columns are nullable, no backfill needed for forward
-- correctness. The one-time data fix for the already-mislabeled rows lives in
-- prisma/migrations/manual/ (applied separately by the principal).
--
-- NOTE: these columns were already applied directly to the prod DB during the
-- fix session (additive nullable columns — safe). IF NOT EXISTS keeps this
-- migration a no-op on re-apply.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "closeReason" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "closeSource" TEXT;
