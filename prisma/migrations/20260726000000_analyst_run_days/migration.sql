-- Per-analyst daily-run schedule (daily-run cost control).
--
-- ISO weekdays, 1=Mon..5=Fri. The morning-research cron only executes an
-- analyst whose runDaysOfWeek includes today's Eastern-Time weekday. The
-- default [1,2,3,4,5] (Mon–Fri) PRESERVES today's behavior — every existing
-- analyst keeps running each weekday until its owner narrows the days. The
-- cron treats a NULL/empty array defensively as "all weekdays" so no analyst
-- can silently stop running. The 5-min trigger cron is untouched, so intraday
-- reactivity still fires every day regardless of this setting.

ALTER TABLE "AgentConfig"
    ADD COLUMN IF NOT EXISTS "runDaysOfWeek" INTEGER[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[];
