# Discovery Run Review — YYYY-MM-DD — ANALYST

> **Naming:** `YYYY-MM-DD-<ANALYST>.md` (per-analyst discovery session). One file per run.
> **Model:** manual — `/discovery-prep` → operator fires Grok/Perplexity → pastes into the app's
> Discovery mode → app triages (DISPATCH_CAP=5) + dispatches thesis writes. This doc **grades the
> output** and updates the scout roster. (Automated Signals/cron discovery is dead — don't look for it.)

**Inputs read:** the `/discovery-prep` block for this run · latest `analyst-quality/*` "Feed to
Discovery" gap · `scout-roster.md` · `DISCOVERY_PLAYBOOK.md` (Scout Loop + archetype filters).

---

## TL;DR

2–4 sentences: did this run fill the gap it was meant to? How many dispatched / passed, were the
dispatched names on-archetype and early/clean (not chased)? The single biggest sourcing or triage
finding.

## What was sourced (recap from the prep block)

- **Analyst + gap** (from "Feed to Discovery"): …
- **Play used** (A/B/C/D) + theme: …
- **Scouts leaned on:** @… (note triple-sourced names the prep flagged)
- **Skip-list at run time:** … (names already WATCHING/HOLDING/PROMOTED)

## Dispatch scorecard

| Ticker | Scout(s) | Convergence | Dispatched? | On-archetype + in-fence? | Early/clean (not chased)? | Writer quality | Verdict |
|---|---|---|---|---|---|---|---|
| | | | DISPATCH / PASS | | | | ✓ / flag |

- **DISPATCHED names** — per name: clears the per-archetype filter? R/R ≥2:1? (Momentum: <5% from
  pivot, $5B+, no earnings 5d. Catalyst: dated event 2–4wk. PEAD: clean beat-and-raise. Compounder:
  durable operator.)
- **PASS names** — each has a real reason + ≥1 invalidation? (Good PASS discipline is a positive.)
- **Triple-sourced names that PASSed** — flag with the reason; convergence should usually win.

## Writer quality (per dispatched thesis)

Apply the daily-run Section-A bar: `conviction` set · `variantView` substantive for STRONG/HIGH ·
`convictionRationale` is judgment not math · bull/bear bullets specific + adversarial ·
`keyAssumptions` falsifiable · all 9 sections populated · **Sonar date sanity** (no "beat/printed"
claim when the catalyst is in the future). List any thesis that fails, with the ticker + quote.

## Did it fill the gap?

Cross-check against the "Feed to Discovery" item. Yes / partially / no — and if the gap persists
(e.g. still sourcing extended setups), say so plainly so `/review-analysts` knows the lever hasn't moved.

## Scout-roster updates (committed to scout-roster.md this PR)

- **Session-log line added:** date · analyst · play · new handles · triple-sourced names.
- **Handles added / promoted / muted:** … (or "too early to score — revisit in 60–90d").

## Next prep should…

Concrete sourcing tweaks for the next `/discovery-prep`: which play, theme, filter to tighten.

## Flagged to eng (NOT my lane)

One line each — triage/overlay/data bugs (e.g. archetype-blind scoring). Operator files to GAPS.

## Queries used

(See `docs/prompts/REVIEW_DISCOVERY_RUN.md` → Source of truth. Paste notable rows for the record:
minted Thesis rows + THESIS_WRITER child statuses.)
