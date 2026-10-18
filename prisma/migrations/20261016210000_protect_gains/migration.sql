-- Protect gains: an account setting, off by default, that raises each holding's
-- own floor once it is up: up only, never below the buy price, so the floor's
-- own sale protects the gain. Additive; nothing changes until the owner turns
-- it on.
ALTER TABLE "Account"
  ADD COLUMN "protectGainsOn" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "protectGainsStartPct" DOUBLE PRECISION NOT NULL DEFAULT 3,
  ADD COLUMN "protectGainsGiveBackPct" DOUBLE PRECISION NOT NULL DEFAULT 5,
  ADD COLUMN "protectGainsSince" TIMESTAMP(3);

-- The high each position's floor is raised from.
ALTER TABLE "Position"
  ADD COLUMN "protectHigh" DOUBLE PRECISION,
  ADD COLUMN "protectHighAt" TIMESTAMP(3);
