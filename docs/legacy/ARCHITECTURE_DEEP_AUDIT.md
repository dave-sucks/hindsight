# Hindsight: Architecture Deep Audit & Path to Fix

**Status:** 2026-05-06 — written after a session that surfaced several
architectural failures the validation queries hadn't caught.

This document exists because the system has been ~working but not
producing trades, and over the course of one audit session we discovered
the watching-thesis trigger pipeline has been **completely incapable of
producing an INITIATE for the entire post-rewrite era**. That's not a
small bug. It explains why almost no trades have been placed since
PR #202. A new session needs the full picture before fixing anything.

Companion doc: [`SESSION_AUDIT_2026_05_06.md`](./SESSION_AUDIT_2026_05_06.md)
— tactical issue tracker. **Read this doc first**, that one second.

---

## Part 1 — How the system is supposed to work

### Run types (cadences)

Hindsight has three distinct run cadences. Each has different scope, model
budget, and tool allowlist. Understanding the boundary between them is
critical — most of the architectural rot comes from the morning run trying
to do work the other run types should handle.

**MORNING_PLAN — `lib/inngest/functions/morning-research.ts`**
- Cron: 8 AM ET Mon–Fri (per-analyst).
- Scope: full review of analyst's universe (held positions + watchlist + signals).
- Tool allowlist: full (`createResearchTools`), maxSteps 65.
- Workflow: Phase 0 portfolio check-in → Phase 1 read durable state → Phase 2 walk theses → Phase 3 discovery (if slots open) → Phase 4 execution → Phase 5 record summary → Phase 6 complete.
- **Key intent:** read durable thesis state via `get_theses`, `update_thesis` what changed, `record_thesis` for net-new coverage, `place_trade` if conviction passes the bar.

**INTRADAY_TACTICAL — `lib/inngest/functions/tactical-run.ts`**
- Trigger: `app/thesis.trigger.fired` event from `trigger-evaluator`.
- Scope: ONE thesis, ONE decision (validate trigger, act/update/pass).
- 15-step budget. Concurrency-limited per thesis.
- `update_thesis` is the required close-out — every tactical run writes one ThesisUpdate row.
- **Key intent:** react to a fired trigger fast, take action or update the thesis.

**EOD_REFLECTIVE — TBD**
- Mode exists in schema but cron not wired in this codebase yet.
- Intended for end-of-day review: validate theses, journal, age watchlist.

### Thesis lifecycle (intended)

A `Thesis` is a **durable state object** keyed (analyst, ticker). One
canonical row per pair, evolving over time via `update_thesis`. Statuses:

```
        ┌──── record_thesis (new coverage) ────────┐
        │                                          ▼
   (no row) ──── manage_watchlist(ADD) ─────► WATCHING ──► record_thesis(LONG/SHORT) ──► place_trade ──► ACTIVE
                                                  │                                                          │
                                                  │ update_thesis (rationale,                                │ close_position
                                                  │ confidence, target, stop)                                │ + update_thesis(CLOSED)
                                                  ▼                                                          ▼
                                          (still WATCHING)                                                CLOSED
                                                  │
                                                  │ direction flip / staleness / removal
                                                  ▼
                                          INVALIDATED  /  SUPERSEDED
```

**Critical:** WATCHING and ACTIVE differ in *position state* but share the
same trigger machinery. Triggers fire on signals; the trigger evaluator
matches predicates, dispatches a tactical run when one fires.

### The trigger system

Triggers are the **memory and contract** that connects "I'm watching this
ticker" to "I should buy it now." Without triggers, a thesis is just a
paragraph; with them, it's a state machine.

A trigger is a `(predicate, action, rationale)` tuple stored on
`Thesis.triggers` JSONB. Two evaluation paths:

1. **Signal-driven** (`signal-router` → `trigger-evaluator`) — every new
   Signal row fires predicate matching against open theses.
2. **Cron-driven** (`trigger-evaluator` every 15 min, 9-16 ET Mon-Fri) —
   walks every open thesis, evaluates price/time predicates against
   latest quote.

When a trigger fires:
- `ThesisUpdate` row written with `type: TRIGGER_FIRED`, `triggerId` set
- `app/thesis.trigger.fired` event dispatched
- Tactical run consumes the event → agent decides what to do

**Trigger actions** (the response shape when fired):
- `EXIT` — close the position (held only)
- `TRIM` — reduce position (held only)
- `MOVE_STOP` — adjust stop level (held only)
- `ADD` — add to existing position (held only)
- **`ENTER`** — the watchlist's "consider INITIATE now" signal (watching only) — *this action did not exist until tonight*
- `REVIEW` — generic "look at this" — works in either state

Trigger templates are derived from `(horizon, state)` via
`defaultTriggersForHorizon()` in `lib/agent/triggers/defaults.ts`.

### Horizons (trade structure)

Four horizons describe the intended trade STRUCTURE — not the position
state. Set once at thesis mint, drives exit policy.

| Horizon | Exit policy | Default review |
|---|---|---|
| **CATALYST** | Exit on the event firing, or 30d past `catalystDate` | 1d |
| **TARGET** | Exit only at target / stop / thesis invalidation. Open-ended. | 7d |
| **TRADE** | Exit on stop / target / `maxHoldDays` (default 14) | 1d |
| **COMPOUNDER** | Exit only on invalidation triggers. Years. | 30d |

**Watching theses also have horizons** — they describe the trade you'd
make if the entry trigger fires. A WATCHING/CATALYST thesis says "I'd
enter a catalyst trade if X." A WATCHING/TRADE thesis says "I'd take a
14-day swing if X."

### The action layer (tools)

Trade lifecycle tools — what the agent calls when it decides to do something:

- `place_trade` — Alpaca market order, creates a Position row
- `manage_position` — scale, trim, move stop, trail stop
- `close_position` — close existing
- `manage_watchlist` — add/remove watchlist items (auto-creates a WATCHING thesis on ADD)
- `record_thesis` — mint a new coverage row (new ticker / direction flip / replacing closed)
- `update_thesis` — modify durable fields on existing thesis
- `record_run_summary` — close out the run, mark final decision
- `complete_run` — terminal

PR #210 added an execution gate around `place_trade`: if the agent's
decision reasoning describes placing a trade but `place_trade` was never
called, the run is flagged. Same gate doesn't exist for `manage_position`,
`manage_watchlist`, or `update_thesis`.

---

## Part 2 — How the system actually works (state of rot)

The architecture above is what the master plan describes. Here's what's
actually been happening.

### 🔴 Critical: Watching theses had EXIT triggers

**The biggest finding from this session.** The `defaultTriggersForHorizon()`
function in `triggers/defaults.ts` was designed for held positions. Its
templates emit:

- `PRICE_BELOW(stop) → EXIT` (close the position when price drops)
- `PRICE_ABOVE(target) → REVIEW` (decide: close at target or trail higher)

These were applied to **every thesis**, regardless of whether it was held
or watching. So a WATCHING/LONG thesis on AMZN with target $268 / stop $240
would mint with triggers like:

- "Price below $240 → EXIT" — but there's no position to exit
- "Price above $268 → REVIEW (close at target or trail higher)" — but
  there's no position to close OR trail

**Result:** the entire watchlist trigger pipeline was incapable of
producing an INITIATE. The trigger evaluator could fire on price
crossings, but the tactical run would receive an EXIT-action trigger on
a thesis with no position — and gracefully do nothing. **Two weeks of
production runs, every watching thesis silently inert.**

This explains why the validation query showed 0 INITIATE decisions
across the entire NEW era except 1 — the SMCI trade on 5/06, which only
worked because it went `record_thesis (fresh mint, no trigger involved)
→ place_trade` directly within the morning run, bypassing the trigger
pipeline entirely.

**Fixed in this PR:**
- Added `ENTER` action to `TriggerAction` enum
- Split `defaultTriggersForHorizon()` to take a `state: 'HELD' | 'WATCHING'` param
- WATCHING templates emit `PRICE_ABOVE(target) → ENTER` (LONG), `PRICE_BELOW(target) → ENTER` (SHORT), no EXIT triggers
- Re-backfilled 39 existing watching theses with correct templates
- Updated `record_thesis` and `manage_watchlist` callers to pass state

### 🔴 Critical: The action layer is atrophied

Validation query (5/04 → 5/06):

| Tool | OLD era avg/run | NEW era total (3 days) |
|---|---|---|
| `place_trade` | 0.33 | **1** |
| `manage_position` | 0.50 | **0** |
| `manage_watchlist` | 0.67 | **1** |

The agent calls `update_thesis` 3 times per run on average. It calls
the action verbs almost never. PR #210 added an execution gate around
`place_trade` text-vs-action, but the more common path is now:

- "I'll tighten the stop on CAPR to $32" → no `manage_position` call
- "I'll add NVDA to the watchlist" → no `manage_watchlist` call
- "I'm going to close TSM at the target" → no `close_position` call

These narrate-vs-execute gaps don't trip PR #210's gate because that
gate only watches `place_trade`. **The same bug moved layers, and the
new layers aren't gated.**

**Caveat for `manage_position`:** paper-trading stops are stored
thesis-side via `update_thesis.stopLoss`, which IS firing (CAPR's stop
moved 30→32 today via update_thesis). So `manage_position` matters more
for trim/scale operations than for stop adjustments. But `manage_watchlist`
and `close_position` are still real failures.

### 🔴 update_thesis ignores structural belief fields

99 update_thesis calls in the post-rewrite window. Field-touch breakdown:

| Field | % updates that touched it |
|---|---|
| `triggers` | 52% |
| `horizon` | 47% |
| `confidenceScore` | 29% |
| `reasoningSummary` | 37% |
| `thesisBullets` | 23% |
| **`coreBelief`** | **2%** |
| **`keyAssumptions`** | **6%** |
| **`invalidationConds`** | **6%** |

The schema has fields specifically for "what's the actual claim, what
must be true, what would prove it wrong." The agent ignores them. As a
result, the thesis sheet's "Plan" section can't render anything
substantive — the data isn't there. The agent treats `reasoningSummary`
+ `thesisBullets` (softer narrative fields) as the entire output.

### 🔴 get_theses was returning garbage until tonight

Pre-cleanup, `get_theses()` returned 251 open theses across 6 analysts
with 82% in wrong status:

- 102 mislabeled `ACTIVE` when they were just on the watchlist (should be `WATCHING`)
- 94 orphan ghost theses (not held, not on watchlist, lingering from old runs)
- 84 duplicate rows per (analyst, ticker)
- 1 inverted (CVX `WATCHING` while actually held)

After tonight's cleanup: 65 open theses, 1 per (analyst, ticker), every
row in a legal status. Tech Momentum Trader went from 54 open theses to
7. Catalyst Event Raider from 78 to 11.

This wasn't an architectural bug per se — it was bookkeeping rot from
the old "mint a fresh thesis every morning" era. But the agent was
reading these every run, polluting context and likely contributing to
the slower runtime (+37% wall-clock).

### 🟡 The run summary collapsed the decision vocabulary

`record_run_summary` was hardcoding `decision: HOLD` for any thesis the
agent edited, regardless of whether it was held. WATCH, PASS,
REMOVE_WATCH actions were being silently dropped — never persisted as
TradeDecision rows.

**Fixed in this PR:** schema description now disambiguates HOLD (held +
keeping) from WATCH (no position + still tracking). Persistence
auto-downgrades HOLD-without-position to WATCH. WATCH actions now
persist.

### 🟡 update_thesis has no zero-trigger guard

Of 203 zero-trigger theses we found, only 2 of 218 updates touched the
triggers field. The agent reviews a thesis, edits the rationale, walks
away — never adds the missing triggers. A validation gate in
`update_thesis` (refuse to update zero-trigger theses without adding
triggers) would prevent recurrence.

### 🟡 Triggers fire 0× during agent runs

Trigger fires (`ThesisUpdate.type = TRIGGER_FIRED`) in NEW window: 30,
all from the 15-min cron path. Zero from agent runs. The agent isn't
checking trigger state during the morning walk; it's reading
`get_theses` and editing rationales in isolation. Discovery → action
goes through `record_thesis → place_trade` only.

### 🟡 Cooldowns aren't being honored consistently

AMZN's `EARNINGS_BEAT` trigger fired 8× in 24h on a single signal,
despite having `cooldownDays: 7` declared. Each fire spawned a tactical
run that REVIEWED → no changes. (User says this was fixed in another
session — verify on next run.)

---

## Part 3 — Root causes

The individual issues above share a few root causes worth naming:

### Root cause #1: Held-vs-watching distinction wasn't load-bearing

The codebase treats `status: 'WATCHING'` as metadata. The trigger
factory ignored it. The action verbs (EXIT, ADD, TRIM) only made sense
for held. The system prompt didn't differentiate. So the agent was
trained on held-position semantics and applied them everywhere.

**Fix vector:** treat HELD vs WATCHING as a first-class branch
everywhere the agent makes decisions. Tools should refuse held-only
actions on watching theses (and vice versa). Triggers must be templated
per state.

### Root cause #2: The narrate-vs-execute pattern keeps moving

PR #210 fixed it for `place_trade`. The agent migrated the same
behavior to `manage_position`. We fix `manage_position`, it'll move to
`manage_watchlist`. The real fix is **a generalized gate** that
inspects every TradeDecision's reasoning text for action verbs and
verifies a corresponding tool call landed.

### Root cause #3: The morning prompt rewards thesis maintenance — and the agent moves goalposts to avoid acting

When you read the system prompt for `MORNING_PLAN`, it emphasizes:
review your theses, update what changed, summarize. The action verbs
(`place_trade`, `close_position`, `manage_position`) are listed as
available but not foregrounded. The agent has learned that "a good run"
means "I read everything and updated some rationales." It's not
incentivized to act.

**Worse — the agent will actively move the entry trigger up to avoid
acting on it.** Concrete case (run `cmouv51f7000004jpp5zzogjv`,
2026-05-06 22:24 ET, Secular Theme Architect):

- MRVL was WATCHING/LONG/CATALYST with `targetPrice: $175`, trigger
  `PRICE_ABOVE $172 → REVIEW (rationale: "Promote if financial targets beat")`
- Current price at run time: **$172.15** — trigger condition was true
- The agent's own prior rationale said "Promote if financial targets beat"
- Instead of placing a trade, the agent called `update_thesis`:
  - target $175 → **$195** (raised by $20)
  - stop $162 → $165 (tightened)
  - kept the same PRICE_ABOVE $172 trigger (didn't even raise the threshold to match the new target)
  - added a second REVIEW trigger
- Decision: HOLD. Run summary: *"1 refined ($MRVL target ↑ to $195). No new trades executed as all positions remain within strategy parameters."*

The agent **acknowledged** the trigger was met (the update's own rationale
says "MRVL's price has surpassed the trigger level"), then chose to move
the bar instead of acting. This is not narrate-vs-execute — it's a
deliberate substitution. ENTER triggers (PR #217) won't fix this on
their own; the agent will still pick `update_thesis` over `place_trade`.

**Fix vector:** add explicit promotion rules to the morning prompt:
- "If you encounter a WATCHING thesis whose ENTER trigger condition is currently met (PRICE_ABOVE crossed for LONG, PRICE_BELOW crossed for SHORT), you MUST call `get_stock_data` and evaluate INITIATE before exiting the run."
- "Raising the target instead of placing the trade when the entry condition is met is a RUN FAILURE — the run completes only if you either INITIATE or document why the setup was rejected (volume too low, regime change, etc.)."
- "If a held position is within 5% of stop, you MUST evaluate `manage_position` (tighten/trim/close) before exiting the run."
- "Reviewing without acting is a successful run only when no triggers are near firing AND no entry conditions are currently met."

**Validation gate to enforce it:** the run-summary tool should refuse
to write `primary_decision: HOLD` when a watching thesis's entry trigger
predicate currently evaluates true and no `place_trade` call landed.
Same shape as PR #210's gate but for the entry-not-taken pattern.

### Root cause #4: No promotion path between horizons

Once a thesis is minted with `horizon: TRADE` (max 14 days), it can
never become a long-term hold. The `update_thesis` tool doesn't expose
horizon promotion. The agent (or user) has no path to say "this NVDA
trade became a multi-year hold." So your held NVDA gets force-closed at
day 14 even if conviction is intact.

**Fix vector:** add `horizon` to the `update_thesis` field set, with a
schema description that explicitly invites promotion when conviction +
duration warrant it.

### Root cause #5: Discovery doesn't surface to the action layer

Discovery cron runs separately. Its output (Signal rows) routes to
analysts via `signal-router`. But in the morning run, the agent reads
signals as background context — there's no explicit "if any of these
signals match an analyst's thesis criteria, mint a thesis and consider
trading" step. Discovery is invisible to the action layer.

**Fix vector:** in the morning prompt's Phase 3 (Discovery), make
"convert at least N high-conviction signals to fresh `record_thesis`
calls" a hard rule when discovery slots are open.

---

## Part 4 — What changed in this PR

### Code changes

| File | Change |
|---|---|
| `lib/agent/triggers/types.ts` | Added `ENTER` action |
| `lib/agent/triggers/schema.ts` | Zod accepts `ENTER` |
| `lib/agent/triggers/format.ts` | `actionLabel(ENTER) = "consider entry"` |
| `lib/agent/triggers/defaults.ts` | Added `ThesisState` param. New `watchingDefaults()` template emits ENTER triggers off targetPrice, no EXIT. Direction-aware (LONG → PRICE_ABOVE, SHORT → PRICE_BELOW, PASS → REVIEW). |
| `lib/agent/tools/manage-watchlist.ts` | Passes `'WATCHING'` to trigger factory |
| `lib/agent/tools/record-thesis.ts` | Hoists `effectiveStatus` so it's available before trigger build; passes `'HELD'` or `'WATCHING'` per status |
| `lib/agent/tools/record-run-summary.ts` | Schema description disambiguates HOLD vs WATCH; pre-pass batched position lookup; downgrades misclassified HOLD→WATCH; persists WATCH actions (previously dropped) |
| `components/agent/sheets/ThesisSheet.tsx` | Extended `PositionRow` with intent suffix; new `WatchingRow` for non-held WATCHING theses; shared `IntentSuffix` |
| `components/agent/sheets/ThesisTriggersSection.tsx` | Added `HORIZON_DESCRIPTIONS`; description renders below horizon row; `TriggerGroups` component groups by Enter If / Exit If / Review If; ENTER icon + green tint |
| `components/agent/sheets/ThesisTimelineSection.tsx` | `useCurrentRunId()` from URL; entries from current run get amber pulsing dot + tinted card + "in this run" badge |

### Data fixes (SQL)

These ran tonight against production and are not in the PR diff — they're recorded here for posterity:

- 23 LONG watchlist theses got triggers + horizon backfilled (initial backfill, with the wrong held-position template — corrected in re-backfill below)
- 94 orphan ghost theses closed (not held, not on watchlist)
- 102 mislabeled ACTIVE-on-watchlist relabeled to WATCHING
- 1 inverted (CVX WATCHING while held → ACTIVE)
- 84 duplicate rows per (analyst, ticker) marked SUPERSEDED
- **39 watching theses re-backfilled with state-correct templates** (16 LONG + 13 PASS + the 10 from the initial set), now using ENTER triggers off target price

**Net data effect:** 251 → 65 open theses, 26 watching theses now have
ENTER triggers (vs 0 before).

---

## Part 5 — Issues tracker

The full enumerated tracker lives in
[`docs/SESSION_AUDIT_2026_05_06.md`](./SESSION_AUDIT_2026_05_06.md). 35 items
covering fixed / open / withdrawn / FE / day-trader.

Highlights of what's still open after this PR:

| Priority | Issue | Fix path |
|---|---|---|
| P0 | Action layer atrophied (`manage_position`, `manage_watchlist`, `close_position` rarely called) | Generalized narrate-vs-execute gate covering all action verbs |
| P0 | update_thesis has no zero-trigger guard | Schema validation refuses zero-trigger updates without adding triggers |
| P0 | Morning prompt doesn't push promotion of WATCHING→INITIATE | Add explicit Phase rules requiring action evaluation when triggers are near firing |
| P1 | No horizon promotion path (TRADE → COMPOUNDER) | Add `horizon` to update_thesis field set |
| P1 | Discovery doesn't connect to action layer | Phase 3 prompt rule: convert N signals to record_thesis when slots open |
| P1 | Overdue reviews not picked up by housekeeping cron | Cron query needs `nextReviewAt < NOW()` regardless of trigger state |
| P1 | 11 watching theses still have zero triggers (no target/stop) | Either close them or have agent set entry conditions |
| P2 | FE work for thesis sheet (status line, etc.) — partly done in this PR | See SESSION_AUDIT items 20-32 |
| P2 | Day-trader analyst infrastructure | Separate workstream |

---

## Part 6 — What a new session should do, in order

The architectural rot has a hierarchy. Don't fix #5 before #1 — they
build on each other.

### Step 1: Verify this PR's changes hold AND watch for goalpost-moving

Run tomorrow's morning runs (8 AM ET). Watch for:

- `place_trade` count > 1 (any analyst minting a fresh thesis from a
  watchlist breakout would count)
- Any `ENTER` triggers firing during market hours (the trigger evaluator's
  cron should pick them up; check `ThesisUpdate.type = TRIGGER_FIRED`
  with `triggerId` whose action is `ENTER`)
- **The MRVL pattern repeating** — query: any `update_thesis` that
  *raised* a `targetPrice` on a WATCHING thesis whose existing
  PRICE_ABOVE trigger had a level <= current price at the time of update.
  That's the agent moving the goalposts instead of trading.
- The Global Event-Driven ETF Strategist is most fully wired (11 of 13
  watching theses with ENTER triggers) — easiest to spot signal there

The goalpost-moving query (run after the morning run):

```sql
SELECT
  ac.name AS analyst, t.ticker, tu.timestamp,
  tu."priceAtTime",
  tu."fieldChanges"->'targetPrice'->>'from' AS old_target,
  tu."fieldChanges"->'targetPrice'->>'to' AS new_target,
  tu.rationale
FROM "ThesisUpdate" tu
JOIN "Thesis" t ON t.id = tu."thesisId"
JOIN "ResearchRun" rr ON rr.id = tu."runId"
JOIN "AgentConfig" ac ON ac.id = rr."agentConfigId"
WHERE tu.timestamp >= CURRENT_DATE
  AND tu.type = 'UPDATED'
  AND tu."fieldChanges"::jsonb ? 'targetPrice'
  AND t.status = 'WATCHING'
  AND (tu."fieldChanges"->'targetPrice'->>'to')::float
      > (tu."fieldChanges"->'targetPrice'->>'from')::float;
```

Any rows here are goalpost-moves. **Step 2 and Step 3 are now both
required** — Step 2 alone (action-layer gate) won't catch this because
the agent isn't narrating intent then skipping the call; it's
explicitly choosing update_thesis.

### Step 2: Fix the morning prompt to enforce promotion (was Step 3)

This is now the highest-priority fix because the MRVL run proved the
agent will move the bar to avoid acting even when triggers exist.

In `lib/agent/system-prompt.ts` MORNING_PLAN workflow, add a hard
promotion check before `complete_run`:

```
PROMOTION CHECK (mandatory before complete_run):

For every WATCHING thesis returned by get_theses:
  - Get current price (get_stock_data if not already loaded)
  - For LONG direction: if currentPrice >= targetPrice, the entry
    condition is MET. You MUST evaluate INITIATE.
    - If passing: call record_thesis with status=ACTIVE (or update_thesis
      with change_status=ACTIVE), then place_trade.
    - If rejecting: record_run_summary's decision_rationale MUST cite
      the specific reason (volume too low, regime change, fresh
      negative news). "Raising the target" is NOT an acceptable
      rejection reason — that is goalpost-moving and is a RUN FAILURE.
  - For SHORT direction: mirror with PRICE_BELOW.

For every ACTIVE held position:
  - If currentPrice within 5% of stopLoss:
    - You MUST call manage_position (tighten/trim) OR close_position.
  - If currentPrice within 5% of targetPrice:
    - You MUST call close_position OR update_thesis with new target.

Reviewing without acting is a successful run only when no entry
conditions are currently met AND no held positions are near stops.
```

Pair the prompt rule with a runtime gate: `record_run_summary` should
refuse `primary_decision: HOLD` when:
- Any WATCHING/LONG thesis has `currentPrice >= targetPrice` AND no
  `place_trade` call landed for that ticker in this run, OR
- Any update_thesis call raised a target on a watching thesis whose
  current price was already at-or-above the old target

### Step 3: Fix the action layer (generalized narrate-vs-execute)

Add a generalized narrate-vs-execute gate in `record_run_summary` (or a
new `validate_run_intent` tool that fires before complete_run):

- Parse every TradeDecision's `reasoning` text
- If it contains stop/target/trim/close/buy/sell/watchlist verbs, verify
  a corresponding tool call landed during the run
- Flag mismatches as `RunEvent` warnings

This is the durable fix for the narrate-vs-execute pattern moving between
layers. PR #210's gate was a special case; we need the general one.

In `lib/agent/system-prompt.ts`, add to the MORNING_PLAN workflow:

```
PROMOTION CHECK (before complete_run):

For every WATCHING thesis with direction=LONG:
  - Get current price
  - If price >= 95% of targetPrice (entry trigger near):
    - You MUST call get_stock_data and evaluate INITIATE
    - If passing: call record_thesis with status=ACTIVE, then place_trade
    - If passing on trade: explain why in record_run_summary

For every ACTIVE held position:
  - If currentPrice within 5% of stopLoss:
    - You MUST call manage_position (tighten/trim) OR close_position
    - "I'll keep watching" is not an acceptable response
  - If currentPrice within 5% of targetPrice:
    - You MUST call close_position OR update_thesis with new target
```

### Step 4: Make update_thesis enforce structural fields + zero-trigger guard

In `lib/agent/tools/update-thesis.ts`:

- Tighten schema description: any update that changes more than rationale
  must include at least one of `coreBelief`, `keyAssumptions`,
  `invalidationConds` (or explicitly explain why none changed)
- Add validation: refuse update on a zero-trigger thesis unless the
  update includes triggers

### Step 5: Add horizon promotion path

`update_thesis` should accept `horizon` as an optional field. Schema
description should call out promotion explicitly:

```
horizon — current trade structure. Update this when conviction has
shifted the intended trade type. Examples:
  - 14-day TRADE that's worked → upgrade to TARGET (open-ended) when
    fundamentals confirm thesis
  - TARGET that's compounded → upgrade to COMPOUNDER for multi-year hold
  - COMPOUNDER where moat eroded → downgrade to TARGET with tighter exit
When you change horizon, also update maxHoldDays and nextReviewAt to
match the new horizon's defaults.
```

### Step 6: Wire discovery into the action layer

In MORNING_PLAN Phase 3:

```
DISCOVERY (when slots open):
  - read_signals scope=universe, urgency=HIGH
  - For each signal that matches your archetype:
    - get_stock_data
    - If conviction passes the bar: record_thesis with status=ACTIVE,
      followed by place_trade
  - "No discovery needed today because slots aren't full" is BACKWARDS —
    open slots are the reason discovery should run
```

### Step 7: FE work (parallel)

Most of the high-value FE work is in `SESSION_AUDIT_2026_05_06.md` items
20-32. The status line, horizon explanation, and trigger grouping landed
in this PR. The remaining work:

- Run-detail page: "Why these tickers?" panel showing the trigger fires
  that drove each thesis edit
- Days-held / maxHoldDays progress indicator on TRADE-horizon cards
- UI control to override horizon
- Overdue review red flag

---

## Appendix: Validation queries

Run these against Supabase project `zomxxtqiszpkqrjrqqat` after any
material run to gauge progress.

**Action layer health (post-action gate):**
```sql
-- How many of each action verb fired today?
SELECT
  td.decision, COUNT(*) AS n
FROM "TradeDecision" td
JOIN "ResearchRun" rr ON rr.id = td."runId"
WHERE rr."createdAt" >= CURRENT_DATE
  AND rr.status = 'COMPLETE'
GROUP BY td.decision
ORDER BY n DESC;
```

**Watching trigger health:**
```sql
-- Of WATCHING theses, how many have ENTER triggers vs none vs still EXIT?
SELECT
  ac.name AS analyst,
  COUNT(*) AS watching,
  COUNT(*) FILTER (WHERE t.triggers::jsonb @> '[{"action": "ENTER"}]'::jsonb) AS enter,
  COUNT(*) FILTER (WHERE t.triggers::jsonb @> '[{"action": "EXIT"}]'::jsonb) AS still_exit,
  COUNT(*) FILTER (WHERE jsonb_array_length(t.triggers::jsonb) = 0) AS zero_triggers
FROM "Thesis" t
JOIN "ResearchRun" rr ON rr.id = t."researchRunId"
JOIN "AgentConfig" ac ON ac.id = rr."agentConfigId"
WHERE t."closedAt" IS NULL AND t.status = 'WATCHING'
GROUP BY ac.name;
```

**Trigger fires that produced action:**
```sql
-- For each TRIGGER_FIRED, did the resulting tactical run produce a
-- TradeDecision other than HOLD/WATCH? That's the conversion rate.
SELECT
  COUNT(*) AS total_fires,
  COUNT(DISTINCT tu."runId") AS runs_spawned,
  COUNT(DISTINCT td.id) FILTER (WHERE td.decision IN ('INITIATE','EXIT','ADD','TRIM','SELL')) AS action_decisions
FROM "ThesisUpdate" tu
LEFT JOIN "TradeDecision" td ON td."runId" = tu."runId"
WHERE tu.type = 'TRIGGER_FIRED'
  AND tu.timestamp >= CURRENT_DATE - interval '7 days';
```

If `action_decisions / total_fires` is below 10%, trigger fires aren't
converting to action — that's the action-layer atrophy showing through.

---

## TL;DR for a new session

1. **Read this doc top to bottom**, then `SESSION_AUDIT_2026_05_06.md`.
2. **Two intertwined critical findings:**
   - Watching theses had EXIT triggers (held-position templates) for
     the entire post-rewrite era. The watchlist trigger pipeline was
     silently incapable of producing INITIATE. **Fixed in this PR.**
   - **The agent actively moves entry-trigger thresholds UP to avoid
     acting on them.** Concrete example: MRVL's PRICE_ABOVE $172
     trigger fired (current price $172.15), agent's response was to
     raise the target $175 → $195 and walk away. **Not fixed in this
     PR — needs the prompt fix.**
3. The action-layer atrophy is the second-largest issue. PR #210 fixed
   `place_trade` narrate-vs-execute; the same pattern moved to
   `manage_position`, `manage_watchlist`, `close_position`. Needs a
   generalized gate.
4. Most of the architectural rot stems from **HELD vs WATCHING not
   being load-bearing** in the codebase. Triggers, prompts, action
   verbs all assumed held-position semantics applied everywhere. Fix
   that distinction first; many other bugs collapse into it.
5. Tomorrow's run after this PR's changes is the next data point.
   - If `place_trade` rises AND no goalpost-moves appear (run the
     query in Step 1), the system is recovering.
   - If `place_trade` is still 0 OR goalpost-moves continue, **Step 2
     (prompt fix) is required immediately** — the trigger system fix
     alone is not sufficient.
