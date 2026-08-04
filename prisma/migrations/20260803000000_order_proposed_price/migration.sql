-- Order.proposedPrice: market price at proposal time (the "Est. exit" in the
-- approval UI). Load-bearing for the P1-39 proposal-fatigue gate — a re-proposed
-- protective exit is only re-surfaced when the breach materially worsened vs the
-- price at the last unapproved proposal. Nullable + additive; legacy rows stay
-- NULL and the gate fails open (flows) rather than risk suppressing a real stop.
-- See docs/plans/PROPOSAL_FATIGUE.md.
ALTER TABLE "Order" ADD COLUMN "proposedPrice" DOUBLE PRECISION;
