# Discovery Review — Session Prompt

You are writing a pre-session expectations doc for a discovery chat session (or, while
the Sunday cron still runs, a pre-cron expectations doc). Your job is to commit in
writing what the agent SHOULD produce for one or more anchor tickers, then compare
actual results after the session/cron completes.

## Operating model — read this first

Discovery is now [operator-driven via Principal Chat](../plans/DISCOVERY_V2.md) ([PR #361](https://github.com/dave-sucks/hindsight/pull/361)).
The operator opens `/chat` with an analyst scope, pastes candidates from external
sources (Grok / Twitter / Substack / Notion notes), and the agent runs the
**BATCHED DISCOVERY** prompt overlay (`buildPrincipalSystemPrompt`) to triage with
4-dim composite scoring (`trendStrength` / `relativeStrength` / `entryQuality` /
`catalystFreshness`), then dispatches `dispatch_thesis_research(mode='mint')` for
worthy candidates. The Sunday cron (`lib/inngest/functions/discovery-run.ts`) is
still wired — [disposition TBD](../GAPS.md) — but is no longer the primary mode.

[GAPS P1-13](../GAPS.md) is the relevant open issue: the BATCHED DISCOVERY overlay
is archetype-blind — same 4-dim rubric across all analysts. Compounder /
value-archetype dispatches scored through a momentum lens will look credible but
be wrong. Flag this in every review until P1-13 ships.

## Two flavors of review

### Flavor A — Chat-driven discovery session (primary)

The operator runs a chat session. The review is **paired** to that session:
- **Pre-session expectations doc:** before the chat, write what you'd dispatch
  given the candidates + analyst archetype. Commit it.
- **Post-session comparison:** after the chat completes, compare the agent's
  triage to your pre-commit.

### Flavor B — Sunday cron review (legacy)

Same pre/post structure, but anchor selection comes from the cron's expected
candidate pool rather than operator paste. Kept for as long as the cron runs.

## Naming convention

`YYYY-MM-DD-TICKER.md` — the date the review was written, the anchor ticker.
For chat sessions covering multiple tickers, use the most-decision-rich one as
the anchor and reference the others in §Other Candidates. Example:
`2026-06-01-PLTR.md`.

## Before you start

Read these in order:

1. [`docs/GAPS.md`](../GAPS.md) — start at "Done since"; note [P1-13](../GAPS.md) (archetype-blind overlay) and [P1-12](../GAPS.md) (Secular Compounder 5/5 writer FAILUREs)
2. [`docs/plans/DISCOVERY_V2.md`](../plans/DISCOVERY_V2.md) — operating model + 16-source catalog
3. [`docs/plans/DISCOVERY_OVERHAUL.md`](../plans/DISCOVERY_OVERHAUL.md) — phased to-do list with status
4. [`docs/discovery-reviews/TEMPLATE.md`](../discovery-reviews/TEMPLATE.md) — expectations doc structure
5. The most recent `docs/discovery-reviews/YYYY-MM-DD-TICKER.md` for the same analyst archetype — example of a completed review
6. [`docs/THESIS_ARCHITECTURE.md`](../THESIS_ARCHITECTURE.md) — confirms what "correct" discovery output looks like

## Choosing an anchor (Flavor A — chat-driven)

The anchor ticker comes from the operator's paste. Good anchors:
- Have a clear pre-determinable verdict from the BATCHED DISCOVERY rubric (DISPATCH vs PASS)
- Are squarely in the scoped analyst's archetype (so the archetype-blindness in
  P1-13 doesn't muddy the test)
- Have mixed sentiment OR a clear single-direction edge — both let you score
  rigorously
- Are NOT already covered (`Thesis` rows in WATCHING / HOLDING / PROMOTED)

If the operator pasted 5+ candidates, pick one for the anchor and list the rest
under §Other Candidates with a one-line pre-commit on each.

## Choosing an anchor (Flavor B — Sunday cron)

The cron iterates through analysts and dispatches discovery candidates. Anchor
selection from the candidate pool the cron sees. There is **no** AnalystSignalRoute
table to query anymore (signal-router is paused since PR #361). Inspect:

```sql
-- Theses the cron would consider dispatching for an analyst (proxy)
-- The Sunday-cron implementation lives at lib/inngest/functions/discovery-run.ts
-- and currently reads from get_market_movers + get_earnings_calendar (the pull
-- tools). Replicate its filter to predict candidates.
-- (If the cron is killed per the GAPS P2 disposition, delete Flavor B.)

-- Confirm no existing coverage on a candidate
SELECT id, ticker, direction, status, "agentConfigId"
FROM "Thesis"
WHERE ticker = '<TICKER>'
  AND status IN ('WATCHING', 'ACTIVE', 'HOLDING', 'PROMOTED');
```

## What to commit pre-session/cron

For each anchor:

1. **Pre-commit the 4-dim score.** What's `trendStrength` (1-5)?
   `relativeStrength` (1-5)? `entryQuality` (1-5)? `catalystFreshness` (1-5)?
   Composite = sum. Above ~13 → DISPATCH; below → PASS.
2. **Pre-commit the verdict + conviction.** DISPATCH at what conviction tier
   (STRONG / HIGH / MEDIUM / LOW)? If PASS, expected reason in one sentence.
3. **Archetype-blindness sniff (P1-13):** what would a 4-dim score say vs what
   the analyst's archetype-native rubric would say? If they diverge, you've
   found a P1-13 case.
4. **Expected dispatched fields if DISPATCH:**
   - direction (LONG / SHORT)
   - horizon (CATALYST / TRADE / TARGET / COMPOUNDER)
   - target / stop / entry levels (rough ranges)
   - `variantView` if STRONG/HIGH ("consensus thinks X, I think Y")
   - `convictionRationale` shape (judgment, not math)
5. **Cross-analyst dedup check.** Is another analyst's chat session likely to
   pick up the same ticker today? If so, expect the second dispatch to be
   refused per PR #361's cross-analyst dedup.

## What to compare post-session/cron

Use the template's "Post-run comparison" section. Key axes:

| Axis | Match? | If diverged, why? |
|---|---|---|
| 4-dim score (each dim) | | |
| DISPATCH vs PASS verdict | | |
| Conviction tier | | |
| `variantView` substance | | |
| `convictionRationale` quality (judgment vs math) | | |
| Direction / horizon | | |
| Trigger levels | | |
| Cross-analyst dedup behavior | | |
| Archetype-blindness symptom (P1-13) | | |

For each divergence, decide: bug / intentional / P1-13 / writer regression / new
finding.

## Useful queries

```sql
-- Newly minted theses today (chat-driven OR cron-driven)
SELECT t.id, t.ticker, t.direction, t.horizon, t.status, t.conviction,
       LEFT(t."convictionRationale", 200) AS rationale_preview,
       LEFT(t."variantView", 200) AS variant_preview,
       t."composite", t."targetSizePct",
       ac.name AS analyst,
       rr.id AS source_run_id,
       rr.mode AS source_run_mode
FROM "Thesis" t
LEFT JOIN "ResearchRun" rr ON rr.id = t."researchRunId"
LEFT JOIN "AgentConfig" ac ON ac.id = rr."agentConfigId"
WHERE (t."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date = DATE '<TODAY>'
ORDER BY t."createdAt";

-- Discovery chat runs (Principal Chat with BATCHED DISCOVERY overlay activated)
-- Note: the overlay activates on content-detection, no explicit mode flag.
-- Proxy: PRINCIPAL_CHAT runs that dispatched multiple thesis-writer children.
SELECT r.id, ac.name AS analyst, r.status,
       (r."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') AS started_et,
       EXTRACT(EPOCH FROM (COALESCE(r."completedAt", NOW()) - r."startedAt"))::int AS elapsed_s,
       r.parameters->'toolStats'->'byTool'->>'dispatch_thesis_research' AS dispatch_calls
FROM "ResearchRun" r
LEFT JOIN "AgentConfig" ac ON ac.id = r."agentConfigId"
WHERE r.mode = 'PRINCIPAL_CHAT'
  AND (r."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date = DATE '<TODAY>'
  AND (r.parameters->'toolStats'->'byTool'->>'dispatch_thesis_research')::int > 1
ORDER BY r."startedAt";

-- Sunday cron run (legacy, if still active)
SELECT r.id, ac.name AS analyst, r.status, r.environment,
       (r."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') AS started_et,
       EXTRACT(EPOCH FROM (COALESCE(r."completedAt", NOW()) - r."startedAt"))::int AS elapsed_s,
       r.parameters->>'error' AS error_text
FROM "ResearchRun" r
LEFT JOIN "AgentConfig" ac ON ac.id = r."agentConfigId"
WHERE r.mode = 'DISCOVERY'
  AND (r."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date = DATE '<TODAY>'
ORDER BY r."startedAt";
```

## What to produce

Write `docs/discovery-reviews/<YYYY-MM-DD>-<TICKER>.md` using the template. Commit
every expected field value you can derive before the session/cron. The sharper
your pre-commit, the more useful the post-session comparison.

After the session/cron, add a "## Post-session comparison" section to the same
file with the axis table above filled in.

Open one PR titled `docs(discovery-review): YYYY-MM-DD-TICKER`. No code changes.
