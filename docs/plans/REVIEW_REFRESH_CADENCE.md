# Review-Driven Refresh Cadence

> **What this is:** the design for how Hindsight keeps thesis research current. Replaces the dead "P1-22 staleness gate on `place_trade`" approach with a review-driven model where the agent uses judgment, not a Layer-1 refusal.
>
> **Status:** design, not yet implemented. Closes [`GAPS.md`](../GAPS.md) **P1-1** when shipped.
>
> **Owner:** principal. **Audience:** future session implementing this.

---

## TL;DR

1. **Delete the hard `place_trade` staleness gate** at `lib/agent/tools/place-trade.ts:160-243`. Agent's judgment + the existing review cadence keeps research current, not a Layer-1 refusal at execution time.
2. **Make staleness horizon-aware.** Single `STALE_DAYS = 14` is too aggressive for COMPOUNDER and too lax for CATALYST. Split into per-horizon thresholds tied to each horizon's review cadence.
3. **Teach the daily-run + tactical prompts the review-time decision tree** for what to do when research is stale: (a) ignore the staleness if the thesis is intact and a small patch suffices, (b) dispatch a refresh if the research is materially out of date, (c) reduce position size or skip the trade if the agent can't reach conviction without fresh research.
4. **Keep everything else.** `classifyResearchAge`, `researchAge` on get_theses output, `dispatch_thesis_research` + `wait_for_thesis_refresh` in allowlists, the writer agent. The soft-signal infrastructure is right; only the hard gate goes.

After this ships: the agent can always trade. The review flow keeps research current on cadence. Staleness becomes a soft input to the agent's reasoning, not a tool-level veto.

---

## 1. Current state — what's already built

The plumbing the principal described in conversation as "use the existing review cadences and triggers to know when a thesis needs to be rewritten" is **already in the codebase**. The only piece that's wrong is the hard gate.

### What works today

| Primitive | Where | What it does |
|---|---|---|
| **`classifyResearchAge(researchUpdatedAt)`** | `lib/agent/thesis-research/staleness.ts` | Pure function. Returns `{ daysOld, freshness, lastWrittenAt }` where `freshness ∈ { fresh, stale, missing }`. Threshold: `STALE_DAYS = 14`. |
| **`researchAge` on `get_theses` output** | `lib/agent/tools/get-theses.ts` | Every returned thesis carries the annotation. Agent reads it to decide whether to refresh. |
| **`researchAge` in run-input pre-render** | `lib/agent/run-input.ts` | Daily-run prompt sees per-thesis freshness inline, without a get_theses round-trip. |
| **`researchAge` in tactical-run prompt** | `lib/agent/system-prompts/intraday-tactical.ts` | Same — tactical agent sees freshness on the triggered thesis. |
| **`dispatch_thesis_research(refresh)`** | `lib/agent/tools/dispatch-thesis-research.ts` | Spawns a thesis-writer sub-run that refreshes one thesis. ~60-120s wall time. |
| **`wait_for_thesis_refresh(child_run_id)`** | `lib/agent/tools/wait-for-thesis-refresh.ts` | Inngest `step.waitForEvent` wrapper. Daily/tactical block until the refresh lands, then continue. |
| **Allowlists** | `lib/agent/modes.ts` | `dispatch_thesis_research` + `wait_for_thesis_refresh` are in research-run, discovery, intraday-tactical, and principal-chat allowlists. The agent CAN refresh mid-run. |
| **Review cadence** | `lib/agent/horizon-policy.ts` + `lib/agent/triggers/defaults.ts` | `nextReviewAt` set by horizon defaults. REVIEW triggers fire on time-elapsed, filings, earnings, etc. `needsAction = "REVIEW_DUE"` surfaces these on get_theses. |
| **PROMOTED auto-refresh on promotion** | `lib/actions/promote-analyst.actions.ts` | Promotion fan-out dispatches a writer refresh per PROMOTED thesis, so PROMOTED rows have fresh research on the first live run by default. |

### What's broken — the hard gate

`lib/agent/tools/place-trade.ts:160-243` refuses entries on WATCHING/PROMOTED theses when `classifyResearchAge(researchUpdatedAt).freshness !== "fresh"`, unless `dispatch_thesis_research(refresh)` was dispatched earlier in the same run.

The recovery path works — it tells the agent exactly what to do. But it's a **judgment call at the wrong layer.** The agent might have:
- Just called `get_stock_data` confirming the live setup
- Just read fresh signals confirming the catalyst is still alive
- Strong conviction the thesis is intact

…and yet the gate refuses because the research is 15 days old. The agent then spends ~90s on a refresh that likely adds nothing new, then retries. Worst case: a fast-moving setup escapes during the refresh window.

**The principle this violates:** Layer-1 tool gates enforce STRUCTURAL invariants (no PENDING trades, no exceeding maxOpenPositions, no negative quantities). Layer-3 prompts teach JUDGMENT. Research age is judgment — keeping it at Layer-1 is the wrong layer per `docs/PRINCIPLES.md`'s three-layer principle.

---

## 2. Target architecture

Two flows, cleanly split.

### Flow A — Review (the "keep research current" flow)

Triggered by:
- `nextReviewAt` passing (per-horizon cadence — CATALYST daily, TRADE daily, TARGET weekly, COMPOUNDER quarterly)
- REVIEW triggers firing (TIME_ELAPSED, FILING, EARNINGS_BEAT, GUIDANCE_CHANGE, etc.)
- The daily run walking the book and finding `needsAction = REVIEW_DUE`

Agent's decision tree per REVIEW:

```
REVIEW_DUE fires on a thesis
  │
  ├─ researchAge.freshness === "fresh" (< horizon threshold)
  │    └─ Read the thesis, check against fresh signals + live data.
  │       Three outcomes:
  │         • Thesis intact, nothing material → update_thesis() rationale-only
  │           → writes REVIEWED row + bumps nextReviewAt forward
  │         • Small adjustment warranted (lower entry, tighter stop, etc.)
  │           → update_thesis() with the specific patch
  │         • Material change but research adequate → update_thesis() with
  │           the patch + refreshed reasoning summary (no full rewrite needed)
  │
  ├─ researchAge.freshness === "stale" (>= horizon threshold)
  │    └─ Default: dispatch_thesis_research(refresh) →
  │       wait_for_thesis_refresh → re-read the thesis → make decision per
  │       the "fresh" branch above.
  │       Override: if the agent reads the thesis and judges that a small
  │       patch (e.g., updated target based on today's chart) is enough,
  │       agent CAN just update_thesis() without dispatching. The staleness
  │       signal is advisory, not enforcing.
  │
  └─ researchAge.freshness === "missing"
       └─ Always dispatch — the row has no research backing it at all.
```

### Flow B — Trade (the "execute on conviction" flow)

Triggered by:
- ENTER trigger fires (`needsAction = TRIGGER_FIRED` or `TRIGGER_MATCHING_NOW`)
- Daily-run agent decides to enter a WATCHING/PROMOTED thesis after reviewing it
- Tactical run wakes on a trigger

**Decision tree per trade:**

```
Agent decides to place_trade
  │
  └─ NO STALENESS GATE. place_trade always works on a non-PENDING,
     non-terminal thesis with valid shape (target/stop direction-relative,
     confidence ≥ minConfidence, slots available, etc.).

     Soft signal: researchAge is available on the thesis row + in
     get_theses output. The agent SHOULD have already addressed staleness
     during the REVIEW flow. If it didn't AND the agent decides to trade
     anyway, the audit log captures the rationale.
```

**Layer-1 gates that stay on place_trade** (these are real structural):
- PENDING thesis rejected (no committed view)
- Confidence < minConfidence rejected
- Already-open position on (analyst, ticker) rejected
- maxOpenPositions exceeded rejected
- Direction-relative shape (LONG: target > entry > stop) rejected
- Negative quantity / insufficient buying power rejected

**Layer-1 gates that go away:**
- Staleness gate (the subject of this design)

---

## 3. Horizon-aware staleness thresholds

The current uniform `STALE_DAYS = 14` is wrong for both ends of the horizon spectrum:

- A **COMPOUNDER** at 14 days is fresh — the thesis is multi-year; nothing material happens in 2 weeks.
- A **CATALYST** at 14 days is dangerous — a 14-day-old earnings setup is half-a-quarter stale.

### Proposed thresholds

Tie staleness to each horizon's review cadence (`HORIZON_REVIEW_DAYS` in `lib/agent/horizon-policy.ts`):

| Horizon | Review cadence | Staleness threshold | Rationale |
|---|---|---|---|
| **CATALYST** | 1 day | **7 days** | Event windows are short. After 7d the world has moved enough to warrant a re-anchor. |
| **TRADE** | 1 day | **7 days** | maxHoldDays is 14; research can't be older than half the hold window. |
| **TARGET** | 7 days | **30 days** | Open-ended swing. Monthly refresh keeps the thesis aligned without churn. |
| **COMPOUNDER** | 90 days | **90 days** | Multi-year hold. Quarterly is sufficient. |

### How to implement

Replace `STALE_DAYS` constant with a horizon-keyed map in `lib/agent/thesis-research/staleness.ts`:

```ts
export const STALE_DAYS_BY_HORIZON: Record<Horizon, number> = {
  CATALYST: 7,
  TRADE: 7,
  TARGET: 30,
  COMPOUNDER: 90,
};

// Default for theses missing a horizon (PENDING seeds, edge cases) — match
// the most conservative threshold to bias toward refresh.
const DEFAULT_STALE_DAYS = 7;

export function classifyResearchAge(
  researchUpdatedAt: Date | null | undefined,
  horizon?: Horizon | null,
): ResearchAge {
  if (!researchUpdatedAt) {
    return { daysOld: null, freshness: "missing", lastWrittenAt: null };
  }
  const daysOld = Math.floor(
    (Date.now() - researchUpdatedAt.getTime()) / 86_400_000,
  );
  const threshold = horizon
    ? STALE_DAYS_BY_HORIZON[horizon]
    : DEFAULT_STALE_DAYS;
  const freshness: Freshness = daysOld > threshold ? "stale" : "fresh";
  return {
    daysOld,
    freshness,
    lastWrittenAt: researchUpdatedAt.toISOString(),
    horizonThreshold: threshold, // NEW: surface for the agent's prompt rendering
  };
}
```

Every caller passes the thesis's horizon. The 3 current callsites (`get-theses.ts`, `run-input.ts`, `intraday-tactical.ts`) already have horizon on the thesis row — minor refactor.

---

## 4. Prompt changes

### Daily-run prompt (`lib/agent/system-prompt.ts:buildDailyRunSystemPromptV2`)

Add to Step 2's `REVIEW_DUE` branch (around line 970 of the current V2 prompt):

```
**Staleness — research age vs horizon threshold.** Each thesis row carries
`researchAge: { freshness: "fresh" | "stale" | "missing", daysOld, horizonThreshold }`.

When researchAge.freshness === "stale" or "missing" on a REVIEW_DUE:
  • Default: dispatch_thesis_research(ticker, analyst_id, existing_thesis_id,
    mode: "refresh", reason: "<why refresh now>") → wait_for_thesis_refresh
    → re-read the refreshed thesis → make the review decision.
  • Override: if you read the existing thesis and judge that a small update
    (lower entry, tighter stop, updated reasoning bullet) captures the change,
    you CAN skip the dispatch and just update_thesis() with the patch. Cite
    why a full rewrite wasn't needed in the rationale. Staleness is advisory,
    not enforcing.

When researchAge.freshness === "fresh" on a REVIEW_DUE:
  • Default: update_thesis() rationale-only → writes REVIEWED + bumps next
    review forward by horizon cadence.
  • If small adjustment warranted (target/stop/belief patch): update_thesis()
    with the patch. No need to dispatch when fresh.
```

Add to the closeout-contract paragraph:

```
**There is no staleness gate on place_trade.** Research-age decisions
belong to the REVIEW flow, not the TRADE flow. If you reach a TRIGGER_FIRED
ENTER on a stale thesis and you've already done the review work this run,
trade it. The audit log captures the rationale.
```

### Tactical-run prompt (`lib/agent/system-prompts/intraday-tactical.ts`)

Same logic, single-thesis-shaped. Replace any "must refresh before trading on stale research" language with "you SHOULD refresh on stale research if the thesis needs it, but place_trade will not refuse — judgment call."

### Writer prompt (`lib/agent/run-thesis-writer.ts`)

No change. Writer's job is producing fresh research; doesn't care about the trade-time gate.

---

## 5. Implementation deltas

### Code

| File | Change | Effort |
|---|---|---|
| `lib/agent/tools/place-trade.ts:160-243` | **Delete the staleness gate block.** All ~80 lines of the `if (directionCheck && (status === "WATCHING" \|\| status === "PROMOTED"))` clause. | 30 min |
| `lib/agent/thesis-research/staleness.ts` | Add `STALE_DAYS_BY_HORIZON` map. Update `classifyResearchAge()` signature to accept optional `horizon` arg. Add `horizonThreshold` to the return type. | 1 hr |
| `lib/agent/tools/get-theses.ts` | Pass `t.horizon` into `classifyResearchAge()` call. | 5 min |
| `lib/agent/run-input.ts` | Same — pass horizon when computing researchAge for per-thesis context block. | 5 min |
| `lib/agent/system-prompts/intraday-tactical.ts` | Pass horizon when rendering researchAge for the single triggered thesis. | 5 min |
| `lib/agent/system-prompt.ts` (V2 daily-run prompt) | Add the staleness decision-tree language to Step 2's REVIEW_DUE branch (~15 lines). Add the "no staleness gate" note to the closeout contract (~3 lines). | 30 min |
| `lib/agent/system-prompts/intraday-tactical.ts` | Same prompt-side staleness language adapted for single-thesis tactical mode. | 20 min |

**Total: ~3 hours of focused work for one session.**

### Tests

| File | What to add |
|---|---|
| `lib/agent/thesis-research/staleness.test.ts` (NEW) | Unit tests for horizon-aware thresholds + the missing/stale/fresh classification + the `horizonThreshold` return field. |
| `lib/agent/tools/place-trade.test.ts` | **Remove** any test that asserts the staleness gate refuses on old research. **Add** a test that asserts place_trade succeeds when research is stale (regression guard against the gate creeping back). |
| `lib/agent/tools/get-theses.test.ts` (if exists) | Confirm researchAge uses horizon-aware threshold per row. |

### Migration

None — purely additive at the type level (`horizonThreshold` is a new optional field on the return type) and purely subtractive at the gate level (deleting code paths).

---

## 6. What stays — the existing primitives we explicitly keep

- ✅ `classifyResearchAge` — still the single source of truth for freshness.
- ✅ `researchAge` on get_theses output — the agent's signal.
- ✅ `dispatch_thesis_research` + `wait_for_thesis_refresh` in allowlists — the agent's refresh path.
- ✅ Promotion auto-refresh fan-out — PROMOTED rows still get fresh research at promotion time.
- ✅ Review triggers + nextReviewAt — the existing cadence that drives the REVIEW flow.
- ✅ `needsAction = "REVIEW_DUE"` — the signal that wakes the agent for a review.
- ✅ Writer agent + write_thesis_research — the deep-refresh path.

The only deletion is the Layer-1 refusal in place_trade. Everything else stays.

---

## 7. Verification

### Code-level

After the changes ship, the test suite should show:
- `npm test` passing.
- Specifically: at least one test asserting place_trade SUCCEEDS on a thesis with `researchAge.freshness === "stale"`.
- No test asserting place_trade REFUSES on stale research.

### Production-level

Within a few trading days of the ship:
- The 8 AM ET morning runs on Earnings Drift Trader (and any other live analysts) should NOT show "Trade blocked: research is stale" run events.
- Run summaries shouldn't carry "blocked by staleness gate" decision rationales.
- If a thesis stays inert at "stale" for >7 days post-ship, the REVIEW cadence should have refreshed it; flag if it didn't.

### Behavioral

If a thesis gets reviewed and the agent decides "small patch is enough" instead of dispatching a refresh:
- The audit log captures the rationale.
- `researchUpdatedAt` does NOT advance (no refresh ran).
- Next REVIEW_DUE fires on cadence; agent has another chance.
- This is correct behavior — not every review needs a $1-2 deep-research refresh.

---

## 8. Risks

### Risk 1: Agent never refreshes, research goes ancient

**Mitigation:** the REVIEW cadence is per-horizon and fires deterministically. The agent's prompt biases toward dispatch on stale. If the agent consistently skips the refresh, that's a prompt-comprehension issue we can patch.

**Backstop (if needed):** add a STALE_RESEARCH counter on get_theses output (`consecutiveReviewsWithoutRefresh`) and after N reviews without a refresh, the prompt language escalates ("you've reviewed this 3 times without refreshing — dispatch now"). Don't ship this until production data shows the soft signal isn't enough.

### Risk 2: Agent trades on ancient research

**Mitigation:** the REVIEW flow runs more often than the TRADE flow (daily reviews on most horizons; trades happen only on TRIGGER_FIRED). If reviews are happening on cadence, research is current by the time a trade fires.

**Backstop (if needed):** add a soft warning in the agent's prompt: "if you place_trade on `researchAge.freshness !== 'fresh'`, the trade rationale MUST explain why (live data confirmation, fast-moving setup, etc.). Audit log will surface these for review."

### Risk 3: Refresh-then-trade latency

**Today:** the gate forces a ~90s refresh before any stale-research trade.

**After this:** the agent can choose to skip the refresh and trade immediately. For fast-moving setups (breakout in progress, earnings just printed), this is the right call.

**Risk:** the agent might skip the refresh on a setup that genuinely needs it. The audit log captures the decision; we can spot-check.

### Risk 4: P1-22's original concern was real (it WAS shipped, after all)

Someone built the gate for a reason. Likely: agent was placing trades on stale research that had structurally changed since (e.g., a thesis written before an earnings miss being traded after the miss).

**Mitigation:** the REVIEW flow now catches this — when earnings prints, a REVIEW trigger fires, the agent reviews, and if research is stale, the agent SHOULD dispatch. The prompt language biases toward this.

**The gate was a band-aid for an agent that didn't review thoroughly.** The fix is to teach the agent to review thoroughly, not to add a tool-level refusal.

---

## 9. Open questions

1. **Per-horizon thresholds vs uniform.** The proposal uses per-horizon (7/7/30/90). The principal said "some rule for when a thesis officially becomes stale" — uniform `14` would also work. Per-horizon is smarter but adds a config dimension. **Recommendation: per-horizon, because COMPOUNDER at 14d is silly and CATALYST at 14d is dangerous.** Easy to flatten back to uniform if it's noise.

2. **Should missing-research be treated differently from stale-research?** Today the gate treats both as "fresh-blocking." The new model treats both as "review-time signal to refresh." Probably fine to collapse — both mean "agent should refresh before placing big bets."

3. **Backstop counter (Risk 1 mitigation)** — implement now or wait for evidence? **Recommendation: wait.** Premature backstops add gates we said we don't want.

4. **Tactical runs and the staleness signal.** Tactical wakes on a single trigger (often an ENTER trigger). The agent has ~15 steps and may not have time to dispatch + wait + retry. Should tactical SKIP the refresh and just trade? **Recommendation: yes, give tactical's prompt a clearer "trade fast on tactical triggers; review research at the next daily run" instruction. The daily run is the right place for thorough review.**

---

## 10. Sequencing

After this ships:
- **P1-2** (gate audit) follows — look at every other Layer-1 gate and ask the same question: "is this preventing a structural failure, or second-guessing a judgment call?"
- **P1-6** (writer urgency signal) follows — once the gate is gone, the writer's output becomes the primary input to the agent's review decision. Adding `recommendedAction: "BUY_LIVE" | "DEFER_TO_WATCHING" | "INVALIDATE"` to the writer's output gives the next review the writer's call as data.

These are sequential because they all touch the same review-flow surface. Land P1-1 first, validate it works in production for a few days, then iterate.

---

## See also

- [`THESIS_ARCHITECTURE.md`](../THESIS_ARCHITECTURE.md) §0 — the 5 roles + the research-freshness principle this design implements.
- [`THESIS_ARCHITECTURE.md`](../THESIS_ARCHITECTURE.md) §6, §7 — horizons and per-horizon trigger templates (where the new per-horizon thresholds anchor).
- [`PRINCIPLES.md`](../PRINCIPLES.md) — the three-layer principle (gate = structural; prompt = judgment).
- [`GAPS.md`](../GAPS.md) P1-1 — this is the design for that gap.
- `lib/agent/thesis-research/staleness.ts` — current STALE_DAYS implementation.
- `lib/agent/tools/place-trade.ts:160-243` — the gate to delete.
