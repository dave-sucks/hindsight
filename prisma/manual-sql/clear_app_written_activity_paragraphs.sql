-- clear_app_written_activity_paragraphs.sql — take the app's sentences off
-- old Activity lines.
--
-- STATUS: run on production 2026-10-30 (part 1: 328 rows; part 2: 346 fire
-- lines). Operator-run, by hand, after the code that stopped writing them
-- was deployed.
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
    OR rationale LIKE 'Bought on your approval at %'
    OR rationale LIKE 'Bought at $%; it moves from the watchlist%'
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

-- ── Part 2 (2026-10-30) ─────────────────────────────────────────────────────
-- Until 2026-10-29 a fire line copied the rule's note onto its paragraph, and
-- most of those notes were the code's: a template's (lib/agent/triggers/
-- defaults.ts), a level's (price-levels.ts), a seat rule's
-- (lib/agent/knowledge/seat-rules.ts), or the old "standing rule set by the
-- principal." / ". You set this." default. The code now writes only the
-- figures that fired it (trigger-evaluator.ts, tactical-run.ts) and an agent
-- is shown a rule's note only when a person or an analyst wrote it
-- (lib/agent/triggers/note.ts, `writtenNote`). This takes the same template
-- words off the stored fire lines, with the same list the code uses (the
-- alternation below was generated from it, numbers replaced); a note an
-- analyst wrote on a rule is left alone. 346 rows matched; 18 of them were
-- the whole-line suffix forms.

BEGIN;

-- Fire lines (TRIGGER_FIRED) whose paragraph starts with a note the code wrote on the rule
-- (a template's, a level's, a seat rule's), optionally followed by the figures that fired it.
-- The template words come off; the figures stay; an emptied paragraph becomes NULL.
-- Also the two old code suffixes: "<trigger> — standing rule set by the principal." and "<trigger>. You set this."
UPDATE "ThesisUpdate"
SET rationale = NULLIF(btrim(regexp_replace(rationale, $re$^(?:Look at this every day\.|Hard stop at \$[0-9]+(?:[.,][0-9]+)*\.|Entry trigger — price broke above \$[0-9]+(?:[.,][0-9]+)*\. Validate setup and consider INITIATE\.|Floor \$[0-9]+(?:[.,][0-9]+)* — below this the setup is wrong, so the plan comes off rather than waiting to be bought\.|Target \$[0-9]+(?:[.,][0-9]+)* reached before we bought — the move happened without us, so the entry is stale\.|Short entry trigger — price broke below \$[0-9]+(?:[.,][0-9]+)*\. Validate setup and consider INITIATE short\.|Price hit the entry level we dismissed\. Re-evaluate the PASS — was the rejection wrong\?|Look at this every [0-9]+(?:[.,][0-9]+)* days, counting from the last real review\.|Target \$[0-9]+(?:[.,][0-9]+)* hit\. Decide: close at target or trail higher with confidence intact\.|Tight stop at \$[0-9]+(?:[.,][0-9]+)*\. Trade-horizon — get out fast on invalidation\.|Target \$[0-9]+(?:[.,][0-9]+)* hit\. Trade plan executed; close\.|Look at this every [0-9]+(?:[.,][0-9]+)* days, counting from the last real review\.|Hard stop at \$[0-9]+(?:[.,][0-9]+)*\. If we hit it the thesis is broken; close and write up the lessons\.|[0-9]+(?:[.,][0-9]+)*% drop from entry — something material happened\. Re-evaluate before deciding to ride it out or trim\.|Up [0-9]+(?:[.,][0-9]+)*% in a day — strength on a held name\. Evaluate pressing the winner \(add \+ raise target/stop\) if the move is thesis-confirming, not an exhaustion spike\. Approval-gated\.|Down [0-9]+(?:[.,][0-9]+)*% in a day — evaluate a pullback-add ONLY if the drop is market/sector-wide with the thesis intact\. A company-specific drop is thesis damage: do not add — hold, trim, or exit\. Approval-gated\.|Look at this every [0-9]+(?:[.,][0-9]+)* days, counting from the last real review\.|I buy when it breaks above \$[0-9]+(?:[.,][0-9]+)*\.|I buy when it comes back down to \$[0-9]+(?:[.,][0-9]+)*\.|I short when it rallies to \$[0-9]+(?:[.,][0-9]+)*\.|I short when it breaks below \$[0-9]+(?:[.,][0-9]+)*\.|I sell at \$[0-9]+(?:[.,][0-9]+)*: below it, the reason I own this is wrong\.|Below \$[0-9]+(?:[.,][0-9]+)* the setup is wrong, so the plan comes down instead of waiting to buy\.|I cover at \$[0-9]+(?:[.,][0-9]+)*: above it, the reason I'm short is wrong\.|Above \$[0-9]+(?:[.,][0-9]+)* the setup is wrong, so the plan comes down instead of waiting to short\.|Target \$[0-9]+(?:[.,][0-9]+)*: when it gets there, I take it, trim, or raise the target\.|Up [0-9]+(?:[.,][0-9]+)*% from our buy: look again, move the stop up under the gain, and set the next level to watch\.|Down [0-9]+(?:[.,][0-9]+)*% from our buy: decide on purpose whether to hold or sell, before the stop decides for us\.|[0-9]+(?:[.,][0-9]+)* days before the company's event: if we own it for the run-up, this is when to sell, one to two weeks before the decision; if we're holding through it, check the position could take a [0-9]+(?:[.,][0-9]+)*% drop on bad news\.|[0-9]+(?:[.,][0-9]+)* days after the company's event: if we still own it, sell, or say why we're keeping it\.|The company filed an 'other events' report or a press release, which is where FDA decisions and trial results show up\. Read it before the market finishes reacting\.|Down [0-9]+(?:[.,][0-9]+)*% from its high\. A question, not a sale: is the reason we bought still true\? If it is, hold, and move the stop up under the gain\.|Below its [0-9]+(?:[.,][0-9]+)*-day average: the long-term trend is in doubt\. Look at the business, not just the chart\.|Up [0-9]+(?:[.,][0-9]+)*% from our buy: is the business doing what we bought it for\? If so, it may be time to buy the second half, with the stop moved up under the gain\.|Down [0-9]+(?:[.,][0-9]+)*% from our buy: is the reason we bought still true\? For a long-term holding, a drop like this means a closer look, never an automatic sale\.|Up [0-9]+(?:[.,][0-9]+)*% from entry — re-underwrite: raise the floor under real structure and arm the next milestone\.|Down [0-9]+(?:[.,][0-9]+)*% from entry — decide hold-vs-cut deliberately, before the floor decides for us\.|[0-9]+(?:[.,][0-9]+)* days before the event date on the thesis: decide the size into the event — hold, trim, or step aside \(DAV-[0-9]+(?:[.,][0-9]+)* ruling\)\.|[0-9]+(?:[.,][0-9]+)* days after the event date on the thesis: the catalyst has played; is there a reason to still own it\? \(DAV-[0-9]+(?:[.,][0-9]+)* ruling\)|An 'other events' or press-release filing — where FDA outcomes and trial readouts land\. Read it before the market finishes pricing it\.|Gave back [0-9]+(?:[.,][0-9]+)*% from the high\. This is a question, not a sale: is the reason we bought still true\? If yes, hold and raise the floor under real structure \(the [0-9]+(?:[.,][0-9]+)*-day low, the breakout level\)\. If partly, trim\. Sell only if you can name what broke in the business\.|Below the [0-9]+(?:[.,][0-9]+)*-day — the long trend is in question\. Review the business, not the chart\.|Up [0-9]+(?:[.,][0-9]+)*% from entry — re-underwrite at the new price and raise the floor under real structure \(DAV-[0-9]+(?:[.,][0-9]+)* ruling\)\.|Down [0-9]+(?:[.,][0-9]+)*% from entry — decide hold-vs-cut deliberately, before the stop decides \(DAV-[0-9]+(?:[.,][0-9]+)* ruling\)\.)\s*$re$, '')), '')
WHERE type = 'TRIGGER_FIRED' AND rationale ~ $re$^(?:Look at this every day\.|Hard stop at \$[0-9]+(?:[.,][0-9]+)*\.|Entry trigger — price broke above \$[0-9]+(?:[.,][0-9]+)*\. Validate setup and consider INITIATE\.|Floor \$[0-9]+(?:[.,][0-9]+)* — below this the setup is wrong, so the plan comes off rather than waiting to be bought\.|Target \$[0-9]+(?:[.,][0-9]+)* reached before we bought — the move happened without us, so the entry is stale\.|Short entry trigger — price broke below \$[0-9]+(?:[.,][0-9]+)*\. Validate setup and consider INITIATE short\.|Price hit the entry level we dismissed\. Re-evaluate the PASS — was the rejection wrong\?|Look at this every [0-9]+(?:[.,][0-9]+)* days, counting from the last real review\.|Target \$[0-9]+(?:[.,][0-9]+)* hit\. Decide: close at target or trail higher with confidence intact\.|Tight stop at \$[0-9]+(?:[.,][0-9]+)*\. Trade-horizon — get out fast on invalidation\.|Target \$[0-9]+(?:[.,][0-9]+)* hit\. Trade plan executed; close\.|Look at this every [0-9]+(?:[.,][0-9]+)* days, counting from the last real review\.|Hard stop at \$[0-9]+(?:[.,][0-9]+)*\. If we hit it the thesis is broken; close and write up the lessons\.|[0-9]+(?:[.,][0-9]+)*% drop from entry — something material happened\. Re-evaluate before deciding to ride it out or trim\.|Up [0-9]+(?:[.,][0-9]+)*% in a day — strength on a held name\. Evaluate pressing the winner \(add \+ raise target/stop\) if the move is thesis-confirming, not an exhaustion spike\. Approval-gated\.|Down [0-9]+(?:[.,][0-9]+)*% in a day — evaluate a pullback-add ONLY if the drop is market/sector-wide with the thesis intact\. A company-specific drop is thesis damage: do not add — hold, trim, or exit\. Approval-gated\.|Look at this every [0-9]+(?:[.,][0-9]+)* days, counting from the last real review\.|I buy when it breaks above \$[0-9]+(?:[.,][0-9]+)*\.|I buy when it comes back down to \$[0-9]+(?:[.,][0-9]+)*\.|I short when it rallies to \$[0-9]+(?:[.,][0-9]+)*\.|I short when it breaks below \$[0-9]+(?:[.,][0-9]+)*\.|I sell at \$[0-9]+(?:[.,][0-9]+)*: below it, the reason I own this is wrong\.|Below \$[0-9]+(?:[.,][0-9]+)* the setup is wrong, so the plan comes down instead of waiting to buy\.|I cover at \$[0-9]+(?:[.,][0-9]+)*: above it, the reason I'm short is wrong\.|Above \$[0-9]+(?:[.,][0-9]+)* the setup is wrong, so the plan comes down instead of waiting to short\.|Target \$[0-9]+(?:[.,][0-9]+)*: when it gets there, I take it, trim, or raise the target\.|Up [0-9]+(?:[.,][0-9]+)*% from our buy: look again, move the stop up under the gain, and set the next level to watch\.|Down [0-9]+(?:[.,][0-9]+)*% from our buy: decide on purpose whether to hold or sell, before the stop decides for us\.|[0-9]+(?:[.,][0-9]+)* days before the company's event: if we own it for the run-up, this is when to sell, one to two weeks before the decision; if we're holding through it, check the position could take a [0-9]+(?:[.,][0-9]+)*% drop on bad news\.|[0-9]+(?:[.,][0-9]+)* days after the company's event: if we still own it, sell, or say why we're keeping it\.|The company filed an 'other events' report or a press release, which is where FDA decisions and trial results show up\. Read it before the market finishes reacting\.|Down [0-9]+(?:[.,][0-9]+)*% from its high\. A question, not a sale: is the reason we bought still true\? If it is, hold, and move the stop up under the gain\.|Below its [0-9]+(?:[.,][0-9]+)*-day average: the long-term trend is in doubt\. Look at the business, not just the chart\.|Up [0-9]+(?:[.,][0-9]+)*% from our buy: is the business doing what we bought it for\? If so, it may be time to buy the second half, with the stop moved up under the gain\.|Down [0-9]+(?:[.,][0-9]+)*% from our buy: is the reason we bought still true\? For a long-term holding, a drop like this means a closer look, never an automatic sale\.|Up [0-9]+(?:[.,][0-9]+)*% from entry — re-underwrite: raise the floor under real structure and arm the next milestone\.|Down [0-9]+(?:[.,][0-9]+)*% from entry — decide hold-vs-cut deliberately, before the floor decides for us\.|[0-9]+(?:[.,][0-9]+)* days before the event date on the thesis: decide the size into the event — hold, trim, or step aside \(DAV-[0-9]+(?:[.,][0-9]+)* ruling\)\.|[0-9]+(?:[.,][0-9]+)* days after the event date on the thesis: the catalyst has played; is there a reason to still own it\? \(DAV-[0-9]+(?:[.,][0-9]+)* ruling\)|An 'other events' or press-release filing — where FDA outcomes and trial readouts land\. Read it before the market finishes pricing it\.|Gave back [0-9]+(?:[.,][0-9]+)*% from the high\. This is a question, not a sale: is the reason we bought still true\? If yes, hold and raise the floor under real structure \(the [0-9]+(?:[.,][0-9]+)*-day low, the breakout level\)\. If partly, trim\. Sell only if you can name what broke in the business\.|Below the [0-9]+(?:[.,][0-9]+)*-day — the long trend is in question\. Review the business, not the chart\.|Up [0-9]+(?:[.,][0-9]+)*% from entry — re-underwrite at the new price and raise the floor under real structure \(DAV-[0-9]+(?:[.,][0-9]+)* ruling\)\.|Down [0-9]+(?:[.,][0-9]+)*% from entry — decide hold-vs-cut deliberately, before the stop decides \(DAV-[0-9]+(?:[.,][0-9]+)* ruling\)\.)$re$;

UPDATE "ThesisUpdate"
SET rationale = NULL
WHERE type = 'TRIGGER_FIRED' AND (rationale LIKE '% — standing rule set by the principal.' OR rationale LIKE '%. You set this.' OR rationale LIKE '(Restored on 2026-06-05 orphan cleanup%');

COMMIT;
