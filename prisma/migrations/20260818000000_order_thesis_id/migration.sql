-- Order.thesisId — first-class link from a proposal/order back to the thesis
-- it acts on (GAPS P1-33, the thesis sheet's Activity tab).
--
-- The Activity tab reads proposal outcomes from the Order table directly —
-- it is the source of truth for approve/reject/expire (the ThesisUpdate
-- copies were dropped ~78% of the time by the fire-and-forget bug fixed in
-- this same PR, and old rows stay incomplete forever). To ask "which orders
-- belong to this thesis?" today requires joining Position → analystId +
-- symbol and guessing by recency, because TradeDecision.thesisId is null on
-- every post-open decision (see the GAPS P2 audit-integrity item).
--
-- This column makes the stitching first-class. Populated at order-creation
-- time on every write path (place_trade staging, manage_position proposals,
-- closeTrade) from 2026-08-18 on. NULL on older rows — readers keep the
-- (analyst, ticker) fallback for those. No backfill: v1 of the tab resolves
-- old rows through the fallback, and a data heal can land later in
-- prisma/manual-sql/ if ever needed.
--
-- Plain column, no FK: order history must survive thesis supersede/delete,
-- and every consumer resolves it defensively.

ALTER TABLE "Order"
    ADD COLUMN IF NOT EXISTS "thesisId" TEXT;

CREATE INDEX IF NOT EXISTS "Order_thesisId_idx" ON "Order"("thesisId");
