-- TriggerShadowDay: the condition shape's trigger checker, run beside today's
-- on every pass of the trigger check, one row per New York trading day
-- (docs/plans/TRIGGER_TYPES.md, PR 2). The cutover's proof is three trading
-- days of zero disagreements, and console lines expire before that, so the
-- counts land here. Nothing reads it to make a decision.
CREATE TABLE "TriggerShadowDay" (
    "day"           TEXT NOT NULL,
    "passes"        INTEGER NOT NULL DEFAULT 0,
    "compared"      INTEGER NOT NULL DEFAULT 0,
    "disagreements" INTEGER NOT NULL DEFAULT 0,
    "samples"       JSONB NOT NULL DEFAULT '[]',
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriggerShadowDay_pkey" PRIMARY KEY ("day")
);

-- RLS deny-all from day one (2026-06-10 lockdown policy: the anon key must see
-- nothing; Prisma connects directly and bypasses RLS).
ALTER TABLE "TriggerShadowDay" ENABLE ROW LEVEL SECURITY;
