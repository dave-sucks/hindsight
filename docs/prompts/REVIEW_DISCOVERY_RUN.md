# Discovery Review — Session Prompt

You are grading a **manual discovery run** for Hindsight and updating the scout roster. Your
job: judge whether the discovery the operator just ran produced **good, on-archetype candidates**
and **sound triage**, then feed sourcing learnings back to the next prep + the analyst review.

This is the **post-run** half of the discovery lane. The **pre-run** half (generating the
Grok/Perplexity prompts) is `/discovery-prep`. They share `DISCOVERY_PLAYBOOK.md` + the scout roster.

## The model (read first)

**Automated discovery is dead.** The old Signals + Sunday-cron + AnalystSignalRoute +
"BATCHED DISCOVERY overlay" machinery was killed as noise — do **not** look for routed signals,
a signal pool, or a DISCOVERY cron. The live model is **manual + operator-curated**:

```
/discovery-prep → Grok/Perplexity prompts → operator fires them → operator pastes the results
into the app's Discovery mode → the app triages against the analyst mandate (DISPATCH_CAP=5) and
dispatches dispatch_thesis_research(mode='mint') → the thesis-writer writes each minted thesis.
```

You grade that output: the minted WATCHING theses + the PASS-records + the writer quality. You do
not run discovery yourself.

## Before you start

Read these in order:

1. **The matching `/discovery-prep` block for this run** (the operator pasted it, or it's filed
   under `docs/discovery-prep/`) — it pre-committed the play, the scouts, and which *kind* of
   names this session was supposed to surface. That's your expectation baseline.
2. The latest `docs/analyst-quality/<YYYY-MM-DD>.md` **"Feed to Discovery"** — the gap this run
   was meant to fill. The grade is partly "did it fill that gap?"
3. [`docs/discovery/scout-roster.md`](../discovery/scout-roster.md) — you will **update** this
   (promote hitters, mute talkers, log the session).
4. [`docs/DISCOVERY_PLAYBOOK.md`](../DISCOVERY_PLAYBOOK.md) — the Grok Scout Loop + per-archetype
   triage filters (the bar each dispatched name should clear).
5. [`docs/discovery-reviews/TEMPLATE.md`](../discovery-reviews/TEMPLATE.md) — the report shape;
   and the most recent `docs/discovery-reviews/<date>-<analyst>.md` as an example.
6. [`docs/plans/ANALYST_LINEUP.md`](../plans/ANALYST_LINEUP.md) — the analyst's archetype + fence
   + success metric (the lens the triage should have used).

## Naming convention

`YYYY-MM-DD-<ANALYST>.md` — discovery now runs per-analyst, so anchor on the analyst, not a
single ticker (a run dispatches up to 5). Example: `2026-06-22-Momentum-Breakout.md`.

## Source of truth

The **minted `Thesis` rows + their `THESIS_WRITER` child runs** are the record. (No `Order`/
`Position` — discovery never trades.) `Thesis` uses `ticker`, links to its run via `researchRunId`
→ join `AgentConfig` via `agentConfigId`. Status taxonomy: discovery mints **WATCHING** (kept) or
**PASSED** (researched-declined) only — never HOLDING/PROMOTED.

```sql
-- The discovery run + what it minted today (per analyst)
SELECT t.ticker, t.status, t.direction, t.horizon, t.conviction, t.composite,
       t."targetSizePct",
       (t."variantView" IS NOT NULL) AS has_variant,
       LEFT(t."convictionRationale", 160) AS rationale_preview,
       LEFT(t."coreBelief", 160) AS belief_preview,
       ac.name AS analyst, rr.id AS source_run_id, rr.mode AS source_mode
FROM "Thesis" t
LEFT JOIN "ResearchRun" rr ON rr.id = t."researchRunId"
LEFT JOIN "AgentConfig" ac ON ac.id = rr."agentConfigId"
WHERE (t."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date = DATE '<TODAY>'
ORDER BY t.status, t.ticker;

-- The thesis-writer children spawned (quality + completion)
SELECT child.parameters->>'ticker' AS ticker, child.status,
       EXTRACT(EPOCH FROM (COALESCE(child."completedAt", NOW()) - child."startedAt"))::int AS elapsed_s,
       child.parameters->>'mode' AS dispatch_mode
FROM "ResearchRun" child
WHERE child.mode = 'THESIS_WRITER'
  AND (child."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date = DATE '<TODAY>'
ORDER BY child."startedAt";
```

## What to grade

1. **Triage soundness.** Did the *good* names dispatch and the *junk* PASS? For each DISPATCHED
   name: on-archetype? in-fence (sector/marketCap/direction)? not already covered (no existing
   WATCHING/HOLDING/PROMOTED)? clears the per-archetype filter (e.g. Momentum: early-stage <5%
   from pivot, not extended; Catalyst: dated event 2–4wk out)? For each PASS: was the reason real?
2. **Convergence honesty.** The prep flagged triple-sourced names (3+ trusted scouts). Did those
   get priority / dispatch? A triple-sourced name that PASSed needs a clear reason.
3. **Did it fill the gap?** Cross-check against the `/review-analysts` "Feed to Discovery" item.
   "Momentum needed early breakouts outside semis" + the run dispatched 3 extended semis = the
   sourcing didn't change. That's the headline finding when it happens.
4. **Writer quality (per dispatched thesis).** Apply the Section-A bar from the daily-run rubric:
   `conviction` set; `variantView` present + substantive for STRONG/HIGH; `convictionRationale`
   is judgment not math-restatement; bull/bear bullets specific + adversarial; `keyAssumptions`
   falsifiable; R/R ≥ 2:1; all 9 research sections populated; **Sonar date sanity** (no "beat/
   printed" claim when the catalyst date is in the future).
5. **Archetype fit of the scoring.** If triage scored a Compounder name through a momentum lens
   (durability ignored), that's the archetype-blindness symptom — flag it (one line → eng if it's
   a code/overlay issue, per stay-in-lane).

## Update the scout roster (the writer side — don't skip)

You are the roster's maintainer. In `docs/discovery/scout-roster.md`:
- **Log the session** (newest-first session-log line): date · analyst · play · new handles seen ·
  names that hit the triple-sourced tier.
- **Add new credible handles** to the right theme table (tier 🔍 watch until proven).
- **Level up / down** any handle whose 60–90-day-old calls you can now judge: promote ⭐/✅ if
  their dispatched names worked out, mute 🔇 if they consistently feed extended/junk setups.
  (Outcome data builds over weeks — note "unscored, revisit" when it's too early.)

## Feed forward

End with a short **"Next prep should…"** note — concrete sourcing tweaks for the next
`/discovery-prep` (which play, which theme, which filter to tighten). If the gap persists, say so
plainly so `/review-analysts` knows the lever hasn't moved yet.

## Stay in lane

Grade discovery output + maintain the roster. Code/overlay/data bugs → one line, hand to eng,
don't chase. No trades, no DB writes beyond the markdown docs.

## What to produce

Write `docs/discovery-reviews/<today>-<analyst>.md` per the template, and commit the
`scout-roster.md` updates in the same PR. Open one PR titled
`docs(discovery-review): YYYY-MM-DD-<analyst>`. No code changes.
