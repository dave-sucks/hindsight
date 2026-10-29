-- clear_app_written_activity_paragraphs.sql — take the app's sentences off
-- old Activity lines.
--
-- STATUS: not yet run. Operator-run, by hand, after the code that stopped
-- writing them is deployed.
--
-- Until 2026-10-29 the app wrote a paragraph of its own on many Activity
-- lines: an expired or approved proposal, a fill, a buy moving a stock to
-- held, a hand edit, a plan set down, a promotion. The code no longer writes
-- any; this clears the ones already stored, so every paragraph left on an
-- Activity line is an analyst's words or the owner's. Each line keeps its
-- title (`summary`) and its `fieldChanges`; only `rationale` is cleared.
--
-- Counted 2026-10-29: about 325 rows. Every pattern below matched only lines
-- the app wrote; a run's note is never touched ("runId" IS NULL), except the
-- two the app wrote inside a run, named exactly.

BEGIN;

UPDATE "ThesisUpdate"
SET rationale = NULL
WHERE "runId" IS NULL
  AND (
       rationale LIKE 'The % of % expired without an answer.%'
    OR rationale LIKE '%no approve / reject within the expiry window%'
    OR rationale LIKE 'You approved the %'
    OR rationale LIKE 'User approved the %'
    OR rationale LIKE '[REJECTED:USER]%'
    OR rationale LIKE 'Bought on your approval at about %'
    OR rationale LIKE 'Entry filled at $%'
    OR rationale LIKE 'Filled at $%'
    OR rationale LIKE 'The buy filled at $%'
    OR rationale LIKE 'The priced plan on % was removed:%'
    OR rationale LIKE 'You added this trigger:%'
    OR rationale LIKE 'You changed this trigger to:%'
    OR rationale LIKE 'You removed this trigger:%'
    OR rationale LIKE 'Administrative transition, not a thesis decision%'
  );

-- The two written inside a run: the buy refused at the position limit, and a
-- watchlist add's fixed label.
UPDATE "ThesisUpdate"
SET rationale = NULL
WHERE rationale LIKE 'The buy was confirmed and place_trade refused it%'
   OR (type = 'CREATED' AND rationale = 'Added manually');

COMMIT;
