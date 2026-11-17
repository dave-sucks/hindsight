-- Each playbook is a stored list of trigger templates (lib/agent/knowledge/
-- playbooks.ts). Unseeded, an account reads the catalog's list.
ALTER TABLE "Account" ADD COLUMN "playbooks" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Account" ADD COLUMN "playbooksSeededAt" TIMESTAMP(3);

-- The chase limit, the partial, the time limit and the beat-and-fade switch
-- are carried by the templates now; the overrides keep only the sell
-- distance numbers. (No account set one of the four on 2026-11-16.)
UPDATE "Account"
SET "setupOverrides" = (
  SELECT COALESCE(jsonb_object_agg(k, v - 'chaseLimitPct' - 'partialAtR' - 'beatAndFadeReview' - 'timeTradingDays'), '{}'::jsonb)
  FROM jsonb_each("setupOverrides") AS e(k, v)
)
WHERE jsonb_typeof("setupOverrides") = 'object' AND "setupOverrides" <> '{}'::jsonb;
