-- Floor sales at once: an account switch, off by default. A held stock's floor
-- (the stop on its chart) always sells automatically; with this on, that sale
-- goes to the broker instead of waiting for approval. Additive.
ALTER TABLE "Account" ADD COLUMN "floorSalesAtOnce" BOOLEAN NOT NULL DEFAULT false;
