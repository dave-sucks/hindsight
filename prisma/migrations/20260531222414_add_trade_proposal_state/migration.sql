-- Trade-as-Proposal — see docs/plans/TRADE_AS_PROPOSAL.md
--
-- Two Account-level booleans gate agent-initiated buys/sells through a
-- human-approval step. Three new Order columns carry the proposal payload
-- (expiry + optional rejection message + the agent's rationale).
--
-- Position.status and Order.status are existing `String` columns, so the
-- new convention values (PENDING_APPROVAL on Position, AWAITING_APPROVAL /
-- EXPIRED on Order) need no DDL — they're enforced by code + the schema
-- comments, matching existing convention (see Order.status, Position.status).
--
-- All changes are additive and reversible (DROP COLUMN). Defaults on the
-- two booleans mean existing Account rows pick up `false` (= today's
-- autonomous behaviour), so flipping the analyst back on requires the
-- explicit toggle.

-- Step 1 — Account approval toggles (default false = today's behaviour).
ALTER TABLE "Account"
  ADD COLUMN "requireApprovalForBuys"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requireApprovalForSells" BOOLEAN NOT NULL DEFAULT false;

-- Step 2 — Order proposal payload.
--   expiresAt is TIMESTAMPTZ(6) to dodge the adapter-pg AM/PM-flip bug that
--   bit Thesis.promotedAt (GAPS P1-4). It's set from a JS `Date` in the
--   proposal-creation path, so bare `timestamp without time zone` would
--   store the wrong instant.
ALTER TABLE "Order"
  ADD COLUMN "expiresAt"        TIMESTAMPTZ(6),
  ADD COLUMN "rejectionMessage" TEXT,
  ADD COLUMN "rationale"        TEXT;
