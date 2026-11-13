-- A sale a trigger proposed stays open while its trigger holds (lib/proposals/sale-card.ts).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "triggerIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "withdrawnReason" TEXT;
