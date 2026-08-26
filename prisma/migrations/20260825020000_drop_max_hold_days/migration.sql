-- Drop Thesis.maxHoldDays (DAV-195 L8).
--
-- It produced exactly one thing: a "review after N days" trigger, minted once
-- when the thesis was created. Nothing read the column afterwards, so raising
-- it changed nothing and it drifted from the trigger it had spawned.
--
-- "This has been open long enough — look at it" is now a plain TIME_ELAPSED
-- review trigger on the ladder, minted per horizon (TRADE = 14 days), visible
-- and editable like every other level.
ALTER TABLE "Thesis" DROP COLUMN IF EXISTS "maxHoldDays";
