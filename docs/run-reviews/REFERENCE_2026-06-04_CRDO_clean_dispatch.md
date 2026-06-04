# Reference: a clean dispatch-to-fill — CRDO LIVE entry, 2026-06-04

> **This is a quality reference, not a daily review.** Use it as the bar
> for "what good looks like" when evaluating individual analyst output.
> Every section below pins a quality dimension you can grade future runs
> against.
>
> **The trade in one line:** PEAD Specialist LIVE bought 13 shares of
> CRDO at $216.17 on 2026-06-04 at 12:10 ET, fired by an autonomous
> tactical trigger on a thesis that the writer minted overnight after
> CRDO's 6/01 earnings beat.

## Why this is the reference

Most checks the [`REVIEW_DAILY_RUN.md`](../prompts/REVIEW_DAILY_RUN.md)
rubric asks the reviewer to make are "is this *not broken*" checks —
did the run avoid the storm, did the cooldown hold, did the EXIT not
ENTER. Those catch failures. They don't tell you what excellent looks
like. This trade does.

Specifically, the CRDO entry exercised **all of these primitives
correctly in a single chain:**

1. The writer minted a thesis with full conviction expression (PR [#360](https://github.com/dave-sucks/hindsight/pull/360))
2. The writer chose a sensible WATCHING ENTER trigger level
3. The autonomous tactical fired at exactly that level
4. The tactical agent validated the live setup before submitting
5. The proposal-flow gate inserted human approval cleanly
6. Alpaca filled with a small price improvement
7. HELD-side trigger regeneration produced storm-resistant cooldowns
8. The chain *never required morning intervention* — the trigger primitives carried the work

## The chain — verbatim from the audit log

```
2026-06-03 17:34:39 ET  THESIS_WRITER (PEAD)        CREATED CRDO at composite 10/10
2026-06-03 17:46:48 ET  Same writer run             UPDATED: target 290→270, stop 195→197
                                                    Set WATCHING with ENTER trigger PRICE_ABOVE $214.60
                                                    (post-earnings 6/03 close — the "stabilization confirmed" level)

2026-06-04 11:55:26 ET  TRIGGER_FIRED (tactical)    "Price above $214.6 — consider entry"
                                                    Rationale: "Stock stabilizing and reclaiming the
                                                    June 3 close signals post-earnings profit-taking
                                                    has exhausted itself — PEAD drift window is open,
                                                    enter on any close above $214.60."

2026-06-04 11:56:17 ET  STATUS_CHANGED              At $216.21, above SMA20, no fresh contradicting
                                                    headline. Stop tightened $197 → $198.91.
                                                    Status WATCHING → ACTIVE. Proposal submitted.

2026-06-04 12:10:48 ET  PROPOSAL_APPROVED           Principal approved. Alpaca filled at $216.17
                                                    (3¢ price improvement vs the $216.21 proposal).
```

15 minutes from autonomous-trigger-fire to live position. 1 thesis-writer dispatch the night before. 1 tactical run. 1 user click. Zero morning-agent involvement on this specific trade.

## Quality dimensions

### A — Thesis-writer output (the foundation)

| Field | Value | Why this is the bar |
|---|---|---|
| `conviction` | **HIGH** | NOT NULL on a directional thesis. PR #360 requires this; writer must commit to a tier. |
| `convictionRationale` | *"Monster clean beat — revenue +157% YoY, EPS $1.16 vs $1.05 est (+10.5%), guidance raised to $465–475M Q1 FY2027. Sell-off is valuation/profit-taking, NOT fundamental deterioration. 100% beat rate in 4 consecutive quarters. Textbook PEAD: clean guide raise, stock down, estimates must move up. **I want it when it stabilizes.**"* | First-person judgment voice ("I want it"), specific numbers, names the failure mode ("sell-off is valuation/profit-taking, NOT fundamental deterioration"). Passes the P1-11 math-rationale-regression sniff cleanly. |
| `variantView` | *"Market sold the print after a 125% pre-earnings run; but the Q1 FY2027 guide of $465–475M forces upward estimate revisions that consensus hasn't absorbed — drift comes as 25 buy-rated analysts update $250–300 targets over the next 30–60 days."* | Specific consensus-vs-thesis contrast with a falsifiable mechanism ("analyst updates over 30–60 days"). Not vapor like "consensus is wrong about valuation." |
| `coreBelief` | *"CRDO drifts to $270+ within 60 days as sell-side estimate revisions absorb the Q1 FY2027 guide raise and optical revenue ramp re-rates the multiple."* | Time-bounded, specific number, named mechanism. You can check this against reality on 8/3. |
| `targetSizePct` | 3 | Required after #360 for directional theses. Anchors position sizing. |

**Pass-bar:** All 5 fields populated, with the rationale + variantView reading as judgment not math restatement.

### B — Price-level math (R/R discipline)

| Level | Value |
|---|---|
| Entry | $216.21 |
| Target | $270 |
| Stop | $198.91 |
| **Reward** | $270 − $216.21 = **$53.79 (+25%)** |
| **Risk** | $216.21 − $198.91 = **$17.30 (−8%)** |
| **R/R** | **3.1 : 1** |

**Pass-bar:** R/R ≥ 2.0 minimum for PEAD; CRDO at 3.1 is comfortably above. Stop is at a fundamentals-meaningful level (8% — typical PEAD risk-budget for post-earnings drift). Target is at the writer's coreBelief-time-bound number.

### C — Position sizing alignment

`targetSizePct = 3` × principal's live book → ~$2,800 position size.
Actual order: 13 shares × $216.17 = $2,810. **Aligned within 0.4%.**

**Pass-bar:** Actual position dollars within ±5% of (book × `targetSizePct`).

### D — Trigger architecture (post-flip)

After WATCHING → ACTIVE, the HELD-side triggers regenerated as:

| Trigger | Level | Cooldown | Read |
|---|---|---|---|
| EXIT PRICE_ABOVE $270 (target) | $270 | **1d** | Storm-resistant by construction. Even before PR #381 lands, this fires at most once per day, not every 5 min. |
| EXIT PRICE_BELOW $198.91 (stop) | $198.91 | **1d** | Same — much safer than the `cooldownDays: 0` shape that bled NVDA/IREN/NVTS today |
| REVIEW TIME_ELAPSED 55d | 55d | **44d** (~80%) | Canonical formula from PR #377. Used to be the bug. |
| REVIEW BEARISH NEWS (SIGNAL_TYPE) | — | 1d | Reasonable rate limit on news-flow churn |

**Pass-bar:** EXIT cooldowns ≥ 1 day, REVIEW TIME_ELAPSED cooldown ≈ 80% of predicate window, no `cooldownDays: 0` on any non-EXIT trigger. The CRDO setup is the *post-PR-#377* template — this is the bar.

### E — Tactical-agent validation discipline

The tactical agent at 11:56 ET did three things before submitting:
1. **Re-evaluated the predicate live**: confirmed price still above $214.60 trigger level
2. **Cross-checked structure**: "above SMA20, no fresh contradicting headline"
3. **Acknowledged a weakness with archetype-aware framing**: *"0.44x volume is informational rather than a hard reject"* — PEAD doesn't require volume confirmation the way Momentum Breakout does. Correct archetype reasoning.

**Pass-bar:** Tactical doesn't just fire-and-forget. It validates the trigger's predicate against live data and frames any weaknesses against the analyst's archetype rules (volume gate ≠ universal).

### F — Proposal flow

15 minutes from agent submission to principal approval to Alpaca fill. Slight price improvement on fill ($216.17 vs $216.21 proposal). No proposal-storm (the ENTER trigger fired once and didn't re-emit — proper for ENTER triggers, which are removed/replaced on the WATCHING → ACTIVE flip).

**Pass-bar:** One proposal per intent, principal-approval-cycle measured in minutes, fill at-or-better than proposal price for limit-style entries.

### G — What this run did NOT do (also part of the bar)

- **Did not need morning-run intervention.** The trade went dispatch → tactical → proposal autonomously. The morning run's job is portfolio housekeeping and gap-up review; new entries should come through the trigger system, not through a morning agent that has to re-discover an opportunity.
- **Did not stack duplicate proposals.** One CRDO order created today, not 11 (NVDA shape).
- **Did not produce a `Order.rationale` matching the WATCHING-side text.** [This was the NVTS 6/03 bug — the order's stored rationale should reflect the actual entry decision, not the prior thesis state. Worth verifying on this row too.]
- **Did not over-emit on simultaneous adjacent triggers.** Only one ENTER trigger fired; the proposal-storm shape did not surface.

## Where this trade sits in the larger sequence

| Date | Event |
|---|---|
| 2026-06-01 | CRDO Q4 FY2026 earnings: clean beat-and-raise (+157% YoY rev, +10.5% EPS) |
| 2026-06-01 | Stock sold off −6.3% post-print (profit-taking after 125% pre-earnings run-up) |
| 2026-06-03 17:34 ET | PEAD Specialist's autonomous discovery process spawned a writer dispatch on CRDO. Writer minted with composite 10/10. |
| 2026-06-03 17:46 ET | Writer refined target/stop, set the WATCHING ENTER trigger at the post-earnings close ($214.60) |
| 2026-06-04 11:55 ET | Price reclaimed $214.60 → autonomous tactical fired |
| 2026-06-04 12:10 ET | Principal approved, fill |

The whole arc from "earnings print" to "live position" was 3 days, entirely through autonomous primitives, with the principal's only intervention being the approval click. **That's the architectural goal.**

## What to grade against this

When you review a daily run going forward, ask of each new opening:

1. Is `conviction` set? Is it written as judgment, not math?
2. Is `variantView` specific and falsifiable?
3. Does R/R clear the analyst's archetype floor (PEAD 2.0, Momentum 2.5, Compounder 1.5)?
4. Does actual position size match `targetSizePct × book`?
5. Do post-flip EXIT triggers have non-zero cooldowns?
6. Did the tactical agent validate against fresh data before submitting?
7. Did the proposal land with one Order per intent, no storm?
8. Did the chain run autonomously, or did the morning agent have to repair it?

If all eight are yes, you have a CRDO-quality trade. If 6+ are yes, you have a healthy trade. If you're consistently scoring 4 or fewer on these dimensions across an analyst's recent trades, that analyst probably isn't ready to promote yet.

## Run IDs and Order/Position IDs

- Writer run: `cmpykvfap000u04jml5lwiurj`
- Tactical run: `cmpzofmar000004lba9b6rq18`
- Thesis (LIVE CRDO ACTIVE): `cmpyl41ei000004lbi8xmem16`
- Order: `cmpzog5cf000304lb7xsp56ao` (FILLED $216.17 × 13 at 12:10 ET)
- Alpaca order ID: `9c4bcec6-084f-481c-80e5-f2aa6d0e1a1c`
- Position: `cmpzog5al000204lbeklzh7ti` (OPEN)
