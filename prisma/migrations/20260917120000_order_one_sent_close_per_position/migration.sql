-- At most one full close SENT to Alpaca per position (DAV-282, second PR).
--
-- SMMT 2026-09-15: two sell rules queued two 450-share closes on a 450-share
-- position, and approving both would have sent the whole position twice.
-- The position lock (lockPositionSales in lib/proposals/cancel-sibling-proposals.ts)
-- already stops that on every current sell path; this makes it impossible for
-- a future path that skips the lock — its second close fails to save instead
-- of reaching Alpaca.
--
-- PENDING only. A close waiting for approval may sit beside a manual close
-- the principal sends, and trims (PARTIAL_CLOSE) stack.
--
-- Additive; no rows change. Checked 2026-09-17 against production: 482
-- orders, no position with two PENDING full closes. If one exists at deploy
-- time the index creation fails and so does the build — the running app is
-- untouched. Not declared in schema.prisma (partial indexes are a Prisma
-- preview feature) — same as Order_idempotencyKey_key.
CREATE UNIQUE INDEX IF NOT EXISTS "Order_one_sent_close_per_position"
    ON "Order" ("positionId")
    WHERE "intent" = 'CLOSE' AND "status" = 'PENDING';
