-- The rule a line answered or fired on, as it stood then (its action and its
-- condition shape), so a review's title holds after the rule is edited or removed.
ALTER TABLE "ThesisUpdate" ADD COLUMN "triggerAction" TEXT;
ALTER TABLE "ThesisUpdate" ADD COLUMN "triggerCondition" JSONB;
