-- A proposal a trigger made stays open while its trigger holds (lib/proposals/trigger-proposals.ts),
-- and every proposal keeps the price it was made at.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "triggerIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "withdrawnReason" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "proposedPrice" DOUBLE PRECISION;

-- The proposals open at deploy that a trigger made (no 24 hours for them either): a sale, trim,
-- buy or add staged by the trigger run that a sell, trim, buy or add trigger woke on the same
-- stock, in the 15 minutes before it. That run's trigger is the one it answers. No price: none
-- was kept.
UPDATE "Order" o
SET "triggerIds" = ARRAY[r.parameters->>'triggerId'], "expiresAt" = NULL
FROM "ResearchRun" r
WHERE o.status = 'AWAITING_APPROVAL'
  AND cardinality(o."triggerIds") = 0
  AND o."thesisId" IS NOT NULL
  AND r.mode = 'INTRADAY_TACTICAL'
  AND r.parameters->>'thesisId' = o."thesisId"
  AND r.parameters->>'triggerId' IS NOT NULL
  AND r."createdAt" BETWEEN o."createdAt" - INTERVAL '15 minutes' AND o."createdAt"
  AND ((o.side = 'SELL' AND r.parameters->>'action' IN ('EXIT', 'TRIM'))
    OR (o.side = 'BUY' AND r.parameters->>'action' IN ('ENTER', 'ADD')));
