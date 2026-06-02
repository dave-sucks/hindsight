-- Trade-as-Proposal — split the two global approval toggles into per-
-- environment toggles. See docs/plans/TRADE_AS_PROPOSAL.md.
--
-- Before: requireApprovalForBuys / requireApprovalForSells applied to PAPER
-- and LIVE identically. That made "auto-execute paper, review live"
-- impossible — the exact split the feature needs (paper = fast iteration,
-- live = disclosure review).
--
-- After: four columns. The gate (lib/proposals/maybe-await-approval.ts)
-- reads the column matching the trade's Position.environment.
--   LIVE  defaults TRUE  — real money is gated by default; a forgotten
--                          toggle can never auto-fire a live trade.
--   PAPER defaults FALSE — fake money auto-executes; flip on only to
--                          exercise the approval flow during testing.

-- Step 1 — repurpose the existing two columns as the LIVE toggles. RENAME
-- preserves whatever value the row currently holds (no data loss).
ALTER TABLE "Account" RENAME COLUMN "requireApprovalForBuys" TO "requireApprovalBuysLive";
ALTER TABLE "Account" RENAME COLUMN "requireApprovalForSells" TO "requireApprovalSellsLive";

-- Step 2 — flip the LIVE column defaults to TRUE for any future account.
ALTER TABLE "Account" ALTER COLUMN "requireApprovalBuysLive" SET DEFAULT true;
ALTER TABLE "Account" ALTER COLUMN "requireApprovalSellsLive" SET DEFAULT true;

-- Step 3 — add the PAPER toggles (default FALSE = auto-execute).
ALTER TABLE "Account"
  ADD COLUMN "requireApprovalBuysPaper"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requireApprovalSellsPaper" BOOLEAN NOT NULL DEFAULT false;

-- Step 4 — existing accounts: turn LIVE review ON. The whole point of the
-- feature is that live trades are reviewed; defaulting existing rows to the
-- safe state matches intent ("review for Live"). PAPER stays FALSE (auto).
-- One account exists today (single-user product); this is the right state
-- for it out of the box.
UPDATE "Account"
   SET "requireApprovalBuysLive"  = true,
       "requireApprovalSellsLive" = true;
