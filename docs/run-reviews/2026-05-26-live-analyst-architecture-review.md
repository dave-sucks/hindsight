# First Live-Analyst Architecture Review — 2026-05-26

> **What this is:** post-promotion architecture review of Earnings Drift Trader, the
> first Hindsight analyst promoted PAPER→LIVE (today, 2026-05-26 ~04:42 UTC). Two
> principal concerns drive the review: targetPrice field overload (P1-23) and the
> writer/orchestrator boundary on the promotion-time refresh fan-out.
>
> **TL;DR ahead of the verdict:** both concerns confirmed in production with hard
> evidence, plus two NEW P0-shaped findings the principal hadn't flagged. The fan-out
> writers DID overstep on every promoted thesis (3/3), the principal's manual revert at
> 05:02 UTC saved the day, and then the 8 AM ET morning run silently bypassed all 3
> PROMOTED rows because `complete_run`'s preflight doesn't include PROMOTED in scope.

## TL;DR

- **Live analyst:** Earnings Drift Trader (`cmnhxpjio000004jvox6kl6c7`), promoted 2026-05-26 04:42:18-31 UTC. Book at review time: 3 PROMOTED (AVGO, MRVL, TSM), 5 WATCHING (AMBA, CVV, DELL, PLAB, SNPS), 0 ACTIVE.
- **Concern 1 (targetPrice overload) — confirmed but currently mitigated by the writer.** 0/8 open theses have a default `PRICE_ABOVE(targetPrice)` ENTER trigger that would buy at the take-profit level. The V2 thesis-writer is correctly overriding the broken defaults in every case. P1-23 classification holds; schema split is still the durable fix, but the writer-as-shield is working.
- **Concern 2 (writer/orchestrator boundary) — confirmed broken.** ALL 3 promotion-fan-out writers (AVGO, MRVL, TSM) called `update_thesis(change_status: "WATCHING")` to flip the freshly-promoted thesis to WATCHING. Principal manually reverted all 3 at 05:02 UTC with an explicit "thesis-writer overstepped" audit row. **Root cause: the writer prompt has no PROMOTED branch — it tells the writer "YOU ARE WRITING A WATCHING THESIS" when refreshing a PROMOTED row.** Filed as **P0-15**.
- **Cascading failure on the orchestrator side.** After the principal restored PROMOTED at 05:02 UTC, the 8 AM ET morning run (`cmpml36xb00a204k1k1mletr5`) completed COMPLETE without acting on any of the 3 PROMOTED theses — primaryDecision: WATCH, tradesPlaced: 0, rationale: "**No open positions...** exposure remains zero." Root cause: `complete_run` preflight at `lib/agent/tools/complete-run.ts:437` scopes to `{"ACTIVE","WATCHING"}` only. The V2 daily-run prompt promises "PROMOTED additionally requires a status-changing call" (Layer-3), but the Layer-1 gate doesn't enforce it. Filed as **P0-14**.
- **Two additional findings filed:** **P1-24** — `Thesis.promotedAt` column timestamp is exactly 12 hours adrift from the corresponding audit-row timestamp (probable `timestamp without time zone` AM/PM smell in Prisma). **P1-25** — the MRVL promotion writer fabricated post-earnings data 7 minutes before contradicting itself about whether MRVL had printed.
- **Stale-research place_trade gate (P1-22):** 0 occurrences today (no `place_trade` calls). Couldn't validate the gate's necessity but the upstream failures (P0-14 + P0-15) need to land first anyway.

## The promotion timeline (one-glance)

All times UTC.

| Time     | Event |
|----------|-------|
| 03:05-03:30 | **Backfill** thesis-writer runs (env=PAPER) refreshed pre-V2 research for AMBA, CVV, AVGO, DELL, NTAP, MRVL, PLAB, SNPS, TSM. All COMPLETE. |
| 04:39:37    | A repair script regenerated **HELD-template** triggers on the 3 actively-held theses (AVGO/MRVL/TSM) — flipped them from broken ENTER-heavy shape to EXIT+REVIEW per the post-PR #265 architecture. |
| 04:42:18-31 | `promoteAnalystToLive` ran. STATUS_CHANGED `ACTIVE → PROMOTED` written for AVGO, MRVL, TSM with paper-tenure conviction context. Three THESIS_WRITER runs dispatched (env=LIVE) for the refresh fan-out. |
| 04:48:46    | **MRVL** writer flipped status `PROMOTED → WATCHING` via `update_thesis`. Rationale: "Q1 FY2027 print due tonight (May 27 after close) — PEAD signal NOT yet confirmed. Re-entering as WATCHING with EARNINGS_BEAT trigger." |
| 04:49:02    | **TSM** writer flipped status `PROMOTED → WATCHING`. Rationale: "Q1 2026 PEAD signal intact... re-entering LONG with 2.4:1 R/R; horizon CATALYST → TARGET (dated catalyst passed)." |
| 04:50:34    | **AVGO** writer flipped status `PROMOTED → WATCHING`. Rationale: "June 3 print 8 days out — deferring re-entry to WATCHING status until June 3 print confirms a clean beat-and-raise. Not entering pre-catalyst; waiting for confirmation per PEAD strategy discipline." |
| 04:54-04:55 | Writers each posted a follow-up UPDATED to refine triggers/targets. MRVL's update at 04:55:10 claims "**MRVL printed a clean Q1 FY2027 beat-and-raise (revenue +3.2% vs est, Q2 guide above Street)**" — directly contradicting its own 04:48 message that said print is tonight (May 27). Fabricated. |
| 05:02:20    | **Principal manual fix** (3 separate ThesisUpdate STATUS_CHANGED rows, one per thesis). Audit summary: "Manual fix: WATCHING → PROMOTED. The promotion fan-out thesis-writer overstepped by flipping status to WATCHING during the refresh — that decision belongs to the first live daily-r[un]." |
| 12:00:45 (8:00 AM ET) | **First live MORNING_PLAN run** (`cmpml36xb00a204k1k1mletr5`) starts. |
| 12:01:39    | Run calls `update_thesis(type: REVIEWED)` on **PLAB** + **AMBA** only (the two WATCHING theses with `nextReviewAt` due). |
| 12:01:55    | `record_run_summary` — primaryDecision: **WATCH**, "No open positions... exposure remains zero. Best actionable-reviewed candidate AMBA is 8/10... PLAB is 7/10... SNPS signal was bullish, but no thesis trigger required action." No mention of AVGO/MRVL/TSM anywhere. |
| 12:01:59    | `complete_run` ACCEPTS — preflight gate is scoped to ACTIVE+WATCHING; the 3 PROMOTED theses are out of scope. Run marked COMPLETE. |

## Concern 1 — `targetPrice` overload (P1-23)

For every open thesis on the live analyst, what does `targetPrice` mean per the agent's own
written intent (coreBelief + bullCase), and what would the default ENTER trigger fire on if the
agent didn't override it?

| Ticker | Status | Horizon | entry | **target** | stop | Dir | Actual ENTER predicate today | What `targetPrice` MEANS per coreBelief | Mismatch w/ default? |
|---|---|---|---|---|---|---|---|---|---|
| AVGO | PROMOTED | CATALYST | $414.14 | **$478** | $390 | LONG | `EARNINGS_BEAT(minSurprisePct: 3)` | "drifts to **$478** within 60 days of June 3 print" → TAKE-PROFIT | **Mitigated** — writer used EARNINGS_BEAT; if default `PRICE_ABOVE($478)` had fired, would have bought at the take-profit. |
| MRVL | PROMOTED | TARGET | $196.33 | **$270** | $195 | LONG | `PRICE_ABOVE($215)` (post-gap consolidation) | "drifts to **$270** within 60 days of confirmed Q1 FY2027 beat" → TAKE-PROFIT | **Mitigated** — writer set entry at $215, well below $270 take-profit. |
| TSM | PROMOTED | TARGET | $404.52 | **$480** | $373 | LONG | `EARNINGS_BEAT(3%)` OR `PRICE_ABOVE($415)` | "drifts to **$480+** within 60 days" → TAKE-PROFIT | **Mitigated** — both ENTER triggers well below $480. |
| AMBA | WATCHING | TARGET | $87.55 | **$115** | $80 | LONG | `EARNINGS_BEAT(5%)` on May 28 print | "drifts to **$115+** within 60 days of beat" → TAKE-PROFIT | **Mitigated** — writer used EARNINGS_BEAT; PRICE_ABOVE($115) would have bought at the drift target. |
| CVV | WATCHING | TARGET | $5.81 | **$4** | $6.5 | SHORT | `PRICE_BELOW($5.33)` (SMA50 break) | "drifts to **$4.00** within 60 days" → TAKE-PROFIT for short | **Mitigated** — writer chose SMA50 break ($5.33), not the $4 target. |
| DELL | WATCHING | CATALYST | $295.19 | **$360** | $278 | LONG | `EARNINGS_BEAT(5%)` on May 28 print | "drifts to **$360** within 60 days" → TAKE-PROFIT | **Mitigated** — EARNINGS_BEAT, not PRICE_ABOVE($360). |
| PLAB | WATCHING | TARGET | $51.46 | **$60** | $47.5 | LONG | `EARNINGS_BEAT(5%)` on May 28 print | "drifts to **$60+** within 60 days" → TAKE-PROFIT | **Mitigated** — EARNINGS_BEAT, not PRICE_ABOVE($60). |
| SNPS | WATCHING | TARGET | $524.74 | **$610** | $490 | LONG | `PRICE_ABOVE($535)` (gap-day high follow-through) | "drifts to **$610** within 60 days" → TAKE-PROFIT | **Mitigated** — writer chose $535 breakout, well below $610 target. |

**Counts:**
- 8/8 theses have `targetPrice` that is structurally a **take-profit** level per the agent's coreBelief (PEAD-strategy drift target).
- 0/8 theses have a default `PRICE_ABOVE(targetPrice)` ENTER trigger that would buy at the take-profit. **Every one was overridden by the V2 thesis-writer.**
- 0 production-confirmed mis-trades from this overload on the live analyst today.

**Verdict — P1-23 stays P1.** The writer-as-shield is doing the load-bearing work. The
relevant prompt block (`lib/agent/run-thesis-writer.ts:334-374` — "CHOOSING THE ENTER TRIGGER —
match the SETUP INTENT, not the default target-price level") explicitly teaches the writer
through the four canonical patterns (pre-catalyst accumulation, post-event confirmation, breakout,
pullback) and the writer's behavior here is the proof it works.

Real but bounded risk: any thesis written WITHOUT the V2 writer (legacy rows, future code paths
that call `record_thesis` directly, accidental default-fallback) will get the broken
`PRICE_ABOVE(targetPrice)` ENTER. None observed on this analyst today — the analyst's whole book
was backfilled through the writer last night.

The schema split (`entryTriggerPrice` for WATCHING/PROMOTED, `takeProfitPrice` for ACTIVE) is
still the durable fix per P1-23's fix path. No urgency to bump priority based on this review;
the mitigation is real. Reconsider if a non-writer code path becomes a meaningful share of
thesis production.

## Concern 2 — writer/orchestrator boundary

Per-thesis, what the writer did and how the orchestrator (daily run) responded.

| Ticker | Pre-promotion status | What the writer changed (content + status) | Justified by deep research? | What the daily run did next | Outcome |
|---|---|---|---|---|---|
| **AVGO** | ACTIVE → PROMOTED at 04:42:31 (paper +$183.70 / 50d / 17 reviews) | Triggers regenerated for PROMOTED template via ThesisUpdate at 04:39:37 (pre-promotion repair). Then at writer-refresh: ENTER set to `EARNINGS_BEAT(3%)` for June 3 print, REVIEW set on EARNINGS_MISS / GUIDANCE_DOWN / TIME_ELAPSED(8d) / FILING(8-K). target $478 / stop $390 unchanged from backfill. Belief unchanged. **STATUS FLIPPED PROMOTED → WATCHING at 04:50:34.** | **Content: yes.** Writer correctly read the June 3 catalyst is 8 days out, applied PEAD discipline to defer to post-print confirmation. ENTER trigger shape is sound. **Status flip: structurally unjustified.** Should have left PROMOTED and let the daily run decide. | After principal manual revert at 05:02 → morning run **silently bypassed** AVGO (no update_thesis, no place_trade). | PROMOTED, untouched. June 3 EARNINGS_BEAT signal will trigger a tactical run. Nothing's broken structurally, but the analyst sat on its hands for the day instead of confirming the deferral via update_thesis. |
| **MRVL** | ACTIVE → PROMOTED at 04:42:18 (paper +$321.94 / 50d / 6 reviews) | Backfill at 03:11/03:20 updated target $212→$240, stop $178.50→$188. Repair at 04:39:37 stripped extra EXIT triggers. Writer at 04:48:46 stopped at $181, ENTER set to `EARNINGS_BEAT`. **STATUS FLIPPED PROMOTED → WATCHING.** Then 04:55:10 follow-up: target $240→$270, stop $181→$195, ENTER changed to `PRICE_ABOVE($215)`, rationale claims "MRVL printed a clean Q1 FY2027 beat-and-raise (revenue +3.2% vs est, Q2 guide above Street)" — **directly contradicting the writer's own 04:48 rationale** which said the print is May 27 after close. | **Content: partially.** Target raise to $270 is anchored to Stifel/Wells Fargo PT cites and post-beat analyst revisions IF earnings actually beat. But the rationale at 04:55 fabricates post-earnings data — earnings hadn't printed. Stop and ENTER level changes are sound. **Status flip: structurally unjustified.** | After principal manual revert → morning run silently bypassed MRVL. | PROMOTED, untouched. May 27 earnings (TODAY after close in ET) will produce a real EARNINGS signal that exercises the ENTER trigger one way or the other. The fabricated "we already saw the beat" rationale is now the latest UPDATED entry on the row. |
| **TSM** | ACTIVE → PROMOTED at 04:42:24 (paper -$16.31 / 43d / 19 reviews) | Backfill at 03:28 updated triggers (kept $480/$373). Repair at 04:39:37 stripped ENTER triggers, added EXIT (HELD shape). Writer at 04:49:02 changed horizon `CATALYST → TARGET` (Q1 2026 catalyst already passed), kept $480/$373, ENTER set to BOTH `EARNINGS_BEAT(3%)` AND `PRICE_ABOVE($415)`. **STATUS FLIPPED PROMOTED → WATCHING.** Then 04:54:50 follow-up refined trigger rationales. | **Content: yes.** Horizon change CATALYST → TARGET correctly reflects the dated Q1 2026 catalyst already passing; thesis is now riding the open-ended drift window. Two ENTER triggers (beat + breakout) make sense for a PEAD-mode TARGET-horizon hold. **Status flip: structurally unjustified.** | After principal manual revert → morning run silently bypassed TSM. | PROMOTED, untouched. Either trigger could fire on the next Q2 2026 print or a $415 breakout. |

### Breakdown by the four task categories

**A. Writer did the right thing.** The CONTENT changes (target/stop/horizon/triggers/belief refinements) on all 3 are defensible against the deep research the writer pulled. AVGO and TSM are PEAD-correct end-to-end. MRVL's target raise to $270 is conditional on a beat that hasn't happened yet but cites real analyst PTs ($210 Stifel, $195 Wells Fargo) and is internally consistent. The "writer shouldn't have changed so much" framing from the prior QB session conflates the (good) content changes with the (bad) status flips — the content changes are the writer's job and the writer did them well.

**B. Writer overreached on status.** ALL 3 (100%) called `update_thesis(change_status: "WATCHING")` on a PROMOTED thesis. This is structurally legal per `update_thesis`'s gate (PROMOTED → WATCHING is the "defer" exit per `docs/THESIS_ARCHITECTURE.md` §3) but violates the principal's policy that the orchestrator (daily run) owns the status decision. **Root cause is in the prompt:** `lib/agent/run-thesis-writer.ts:268-310` branches on `existingThesis?.status === "ACTIVE"` (HELD template) vs everything else (WATCHING template). PROMOTED falls into the second branch. The prompt literally says **"*** YOU ARE WRITING A WATCHING THESIS ***"** when refreshing a PROMOTED row — naturally the writer matches the framing and flips the status. There's a `promotionContext` block in the prompt (lines 132-145) but it only says "forward this verbatim to write_thesis_research" — it does NOT tell the writer "do not change status."

Worth restating: **the writer's status flip is the prompt's fault, not the model's.** No PROMOTED branch exists.

**C. Orchestrator dropped the ball.** After the principal restored PROMOTED at 05:02, the 8 AM ET morning run had a clean shot: 3 PROMOTED theses with fresh research from the night before, V2 prompt that explicitly says (line 645) "**Closeout contract — non-negotiable.** Every Live Theses row (ACTIVE + WATCHING + PROMOTED) produces exactly one tool call this run... PROMOTED theses additionally require a status-changing call." The morning run nonetheless called `update_thesis` on PLAB and AMBA only (two WATCHING theses with `nextReviewAt` due), completed `record_run_summary` with "WATCH" + "No open positions", and `complete_run` accepted because its preflight at `lib/agent/tools/complete-run.ts:437` scopes only to `["ACTIVE","WATCHING"]`. Layer-3 (prompt) said the contract is non-negotiable; Layer-1 (gate) did not enforce it.

**D. Stale-research place_trade.** No `place_trade` calls today (the morning run made zero trades). P1-22 (the staleness gate) didn't get a chance to fire either way. Filed but not triggered.

### Key direct evidence quotes

- Writer's MRVL date contradiction (same run, 7 minutes apart):
  - 04:48:46: *"Q1 FY2027 print due tonight (May 27 after close) — PEAD signal NOT yet confirmed."*
  - 04:55:10: *"MRVL printed a clean Q1 FY2027 beat-and-raise (revenue +3.2% vs est, Q2 guide above Street on both revenue and EPS) — PEAD signal confirmed."*
- Principal's manual-revert audit row at 05:02:20: *"Manual fix: WATCHING → PROMOTED. The promotion fan-out thesis-writer overstepped by flipping status to WATCHING during the refresh — that decision belongs to the first live daily-r[un]."*
- Morning-run decisionRationale: *"**No open positions**, so there was no weakest holding to rotate out of and exposure remains zero. Best actionable-reviewed candidate AMBA is 8/10... PLAB is 7/10... SNPS signal was bullish, but no thesis trigger required action."* — no mention of AVGO/MRVL/TSM despite all 3 being PROMOTED with fresh research.

## Risks not yet captured in GAPS (filed in this PR)

All four are filed in `docs/GAPS.md` as part of this PR.

1. **P0-14 — `complete_run` preflight scope skips PROMOTED theses.** Direct cause of the morning-run bypass today. The V2 daily-run prompt promises the closeout contract covers PROMOTED; the Layer-1 gate doesn't enforce it. One-line fix at `lib/agent/tools/complete-run.ts:437` (extend scope to include PROMOTED) plus a needsAction shape for PROMOTED so the refusal message is actionable.
2. **P0-15 — Thesis-writer prompt has no PROMOTED branch.** Direct cause of the 3 status flips today. Add a PROMOTED branch in `lib/agent/run-thesis-writer.ts:268-310` that uses the PR-#333 PROMOTED trigger template AND explicitly forbids `update_thesis(change_status: ...)` in this run. Optional Layer-1 backstop: refuse `change_status: WATCHING` from PROMOTED when `runMode === "THESIS_WRITER"`.
3. **P1-24 — `Thesis.promotedAt` column 12h drift from audit row.** Surfaced while building the timeline. Probable Prisma `timestamp without time zone` AM/PM-flip in `@prisma/adapter-pg`. Audit row (`timestamptz`) is authoritative. Migration to `timestamptz` + 12h backfill query.
4. **P1-25 — Writer fabricated MRVL post-earnings data.** Surfaced on the second of two same-writer-run `update_thesis` calls. Likely the deep-research model inside `write_thesis_research` returned analyst estimates framed as actuals. Add date-awareness to the synthesis prompt + Layer-1 sanity warning in `update_thesis` rationale parser.

Plus an **update on the existing P1-23** (targetPrice overload): scanned all 8 open theses on the live analyst, 0/8 have a default `PRICE_ABOVE(targetPrice)` ENTER, the V2 writer is correctly overriding in every case. P1 classification holds.

## Recommendations (ranked by impact)

1. **Ship P0-14 today or first thing tomorrow.** It's a one-line scope change plus a needsAction kind. The next live morning run on this analyst (Tuesday 8 AM ET) will hit the same problem if the gate isn't widened. Every future promotion repeats the failure mode. Risk of the change is near-zero — the V2 prompt already tells the agent PROMOTED is in scope, so the agent's behavior should already match; only the gate is loose.

2. **Ship P0-15 this week.** Add the PROMOTED branch in the writer prompt + the optional Layer-1 backstop. The principal will keep having to manually revert every promotion-fan-out run until this lands. The prompt change is cheap; the test coverage is the time investment.

3. **Order matters: P0-14 BEFORE P0-15.** If P0-15 ships first, the writer leaves status PROMOTED but the morning run STILL bypasses (P0-14 unfixed). If P0-14 ships first, the writer's overreach is repaired by the morning run resolving PROMOTED → WATCHING or → ACTIVE. P0-14 alone gets us to a coherent state on the next promotion; P0-15 alone leaves the morning-run gap. Ship P0-14 first.

4. **Concern 1 (P1-23): leave at P1, schedule the schema split when the writer-as-shield gets in the way.** Currently it doesn't — every thesis on the live analyst's book went through the writer and the broken default was overridden in every case. The split is the right architectural answer (1d work per the fix path); the urgency is low.

5. **Concern 2 (writer/orchestrator boundary): the writer is fine on CONTENT, broken on STATUS.** The principal can stop worrying about the content-change boundary — target/stop/horizon/belief edits in the 3 promotion-fan-out runs were defensible and traced back to the deep research. The structural problem is narrow (status decisions), captured by P0-15, and fixable in a single PR. Don't tell the writer to "change less"; tell the writer to "not touch status when refreshing a PROMOTED row."

6. **Verify the writer's fact-finding (P1-25) before adding date-awareness instructions.** Pull the `write_thesis_research` tool result that fed the 04:55 MRVL UPDATED rationale. If the meta-tool's output already contained "MRVL printed Q1 FY2027 beat-and-raise (revenue +3.2%)", the problem is upstream in Sonar/Claude/Gemini's web fetching, not the writer agent. If the meta-tool output was clean and the writer hallucinated on top, then the date-awareness prompt change is the right fix. ~30 min to validate.

7. **Track the second live day.** Tuesday's morning run will tell us whether (a) the agent's behavior was a one-off (cold-start on first live day) or (b) a structural pattern. If P0-14 + P0-15 ship before then, the next run becomes the validation step.

## What I checked but didn't find anything alarming on

- No FAILED ResearchRun rows on this analyst since promotion. All 3 promotion-time writer runs COMPLETE. Backfill writers COMPLETE.
- No tactical runs fired since promotion (no EARNINGS_BEAT signal landed; no PRICE_ABOVE / PRICE_BELOW level crossed for any of the open theses' ENTER triggers). The trigger evaluator wasn't given an opportunity to mis-fire.
- No second open position. The 3 paper positions (AVGO, MRVL, TSM) all closed at market open with `closeReason = "PROMOTED"` per the promotion flow.
- The PROMOTED template's trigger regen at 04:39:37 (the repair script per PR #333) wrote the correct HELD-shape (EXIT + REVIEW, no ENTER) before the promotion fired — so the architectural prerequisite for promotion landed cleanly. The downstream failures aren't due to bad trigger templates; they're due to (a) writer prompt missing a PROMOTED branch and (b) `complete_run` gate missing PROMOTED in scope.

## Why this is a clean-but-not-victory-lap review

Three theses sat on the books today on the first live morning and did exactly nothing.
The principal manually patched 3 rows by hand to keep state coherent. The morning run
silently completed without addressing the conviction set the user explicitly chose to
graduate to real money. The two upstream prompt+gate bugs (P0-14, P0-15) explain
both symptoms cleanly and are both small, mechanical fixes. The deep-research writer is
producing high-quality content — its only structural failure is following a prompt that
tells it to flip status. The principal's intuition that something was off was correct;
"the writer shouldn't have changed so much" was the wrong diagnosis but the right direction.

Ship P0-14 today, P0-15 this week, and the second live day should look meaningfully
different from the first.

## See also

- [`docs/GAPS.md`](../GAPS.md) — P0-14, P0-15, P1-22, P1-23, P1-24, P1-25
- [`docs/THESIS_ARCHITECTURE.md`](../THESIS_ARCHITECTURE.md) — §3 state diagram, Scenario J
- [`docs/PRINCIPLES.md`](../PRINCIPLES.md) — three-layer principle (the framing for "prompt says X, gate doesn't enforce X")
- [`docs/plans/THESIS_RESEARCH_V2.md`](../plans/THESIS_RESEARCH_V2.md) — the writer's design (the per-orchestrator invocation pattern table in §6.1)
- [`docs/plans/THESIS_LIFECYCLE_FIX.md`](../plans/legacy/THESIS_LIFECYCLE_FIX.md) — Phase 2 (where P1-22 lives)
- PR [#330](https://github.com/dave-sucks/hindsight/pull/330) (promotion fan-out + synthesis-prompt PROMOTED context)
- PR [#333](https://github.com/dave-sucks/hindsight/pull/333) (PROMOTED-aware trigger templates)
- The 3 promotion-time THESIS_WRITER runs: `cmpm5fmgg000b04jxvtgm3s0p` (AVGO), `cmpm5fmgg000904jx6puwbp54` (MRVL), `cmpm5fmgg000a04jxc543iafq` (TSM)
- The 8 AM ET morning run: `cmpml36xb00a204k1k1mletr5`
