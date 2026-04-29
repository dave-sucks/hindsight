# Thesis-Driven Analyst Architecture — Plan

> Master plan for the three-PR overhaul that turns Hindsight's morning
> research run from a re-derive-everything-daily model into a
> thesis-driven portfolio review backed by durable state, with
> event-driven tactical runs supplementing it and a separate weekly
> discovery cadence.
>
> Audience: future sessions (Claude or human) picking up PR 2 or PR 3.
> This is self-contained — read just this doc and you can execute.

---

## Status (as of 2026-04-28)

| PR | Status | Notes |
|---|---|---|
| **PR 1 — Durable thesis state + activity log + tools** | ✅ Merged as #193 | `81e73ae` on main |
| **Hotfix — Morning-run gate counts ThesisUpdate touches** | ✅ Merged as #196 | `43e6563` on main. Fixed false-failures from PR 1 where agent legitimately used update_thesis but the gate counted only Thesis row inserts. |
| **Plan revision** (this doc) | In flight | This update — corrected framing of PR 3. |
| PR 2 — Trigger evaluator + tactical mode | Not started | — |
| PR 3 — Daily run gets smarter + weekly discovery + brief deletion + watchlist collapse | Not started | — |

PR 1 shipped the foundation. The DB has new Thesis fields, a
`ThesisUpdate` table backfilled with one row per existing thesis, three
new agent tools (`update_thesis`, `get_theses`, plus same-direction
guard on `record_thesis`), and a Timeline section embedded in the
existing ThesisSheet UI. The hotfix fixed an immediate compliance
regression where the morning-run process gate didn't recognize
`update_thesis` as a thesis touch.

PRs 2 and 3 build on that foundation.

---

## Strategy in one page

The framing here was wrong in the first version of this doc. The
correct framing:

> **The daily portfolio management run STAYS. It is the primary engine.**
>
> What changes is how it thinks. With durable thesis state (PR 1), the
> daily run can decide per-thesis whether to act, update, review-only,
> or leave alone — instead of re-deriving every thesis from scratch
> every morning.
>
> Tactical runs are an **event-driven supplement** that catches mid-day
> signals between morning runs. They don't replace the daily run.
>
> Discovery has TWO cadences: a dedicated weekly cron AND opportunistic
> use within the daily run when conditions warrant. Discovery is
> **conditional in the daily run** — sometimes the right call is "skip
> discovery, focus on book management."
>
> The morning brief generator goes away in PR 3. Not because we're
> removing capability, but because the agent now reads durable state
> directly (theses, triggers, today's signals) instead of consuming a
> synthesized blob.

### Three execution paths (one agent, one persona)

| Path | Cadence | Scope | Goal | Step budget |
|---|---|---|---|---|
| **Daily portfolio review** | Daily (existing morning cron, smarter) | All ACTIVE + WATCHING theses + portfolio + watchlist signals + (conditional) discovery candidates | Walk the book per-thesis. Update where warranted. Trade. Discover when conditions allow. | ~50 |
| **Tactical** | Event-driven (trigger fires) | One ticker, one signal, one thesis | Validate the trigger fired correctly. Act / update / pass. | ~15 |
| **Discovery** | Weekly cron (separate path) | Universe-fenced signals not cited by any active thesis | Mint new WATCHING theses; rare ACTIVE entries on high conviction | ~25 |

### The thesis as durable state

One `Thesis` row per `(analyst, ticker, direction)`. Lives for weeks /
months / years depending on horizon. Edits go through `update_thesis`,
which writes a `ThesisUpdate` log row — not a new Thesis row. The
chain pattern (parentThesisId) is reserved for genuine direction flips
or explicit replacements after invalidation.

The Thesis row carries the metadata that makes the daily run smart:
`horizon`, `nextReviewAt`, `triggers[]`, `targetSizePct`,
`scalingPlan`, `maxHoldDays`, `catalystDate`, `expiresAt`. The agent
reads these and acts. See "How the daily run thinks per-thesis"
below.

### Triggers as machine-evaluable predicates

Every thesis can carry a `triggers[]` array of structured predicates
(PRICE_*, SIGNAL_TYPE, EARNINGS_*, FILING, TIME_*, AND/OR). The router
evaluates these deterministically — no LLM in the matching loop.

In PR 2 these power tactical runs (signal arrives → trigger matches →
tactical run fires). The daily run also reads triggers — when a daily
run starts, it checks "which of my theses had triggers fire since the
last run?" and prioritizes those.

### What "the brief" becomes

In PR 3 the AI-consumed morning brief goes away. The agent reads
signals, thesis library, and triggers directly. The brief generator
gets repurposed (or deleted) — see PR 3 plan below.

---

## How the daily run thinks per-thesis

This is the part that was missing from the first version of this doc.
A fresh session needs to understand the per-thesis decision logic the
daily run will execute, because that's where most of PR 3's value lives.

For every ACTIVE thesis, the daily run asks four questions in order:

### 1. Did anything fire since the last run?

Sources:
- Triggers that fired (PR 2's evaluator already stamped the matches).
- New signals on this ticker since last run.
- Price moves past key levels (entry, target, stop, scalingPlan rungs).

If yes → **prioritize this thesis for real review.** Pull fresh stock
data, walk the trigger / signal / price-move evidence, decide what to
do.

### 2. Is review due even without a trigger?

Sources:
- `thesis.nextReviewAt <= now`
- For COMPOUNDER: `now - thesis.updatedAt >= 30 days`
- For TARGET: `now - thesis.updatedAt >= 7 days` (or position-size shift > 20%)
- For TRADE: `position.openedAt + maxHoldDays >= now` (approaching forced review)
- For CATALYST: `thesis.catalystDate within 3 days` OR `now > catalystDate + 30 days`

If yes → **scheduled review.** Same workflow as #1 but the prompt
emphasizes "is the thesis still right?" rather than "what just changed?"

### 3. Otherwise: REVIEWED, no fields touched

If neither #1 nor #2 fires, the agent calls `update_thesis(thesis_id,
rationale="Reviewed; nothing changed")` with an empty patch. This
writes one REVIEWED row to the timeline — the audit trail of "agent
looked, nothing to change" — and the daily run moves on.

This is the "leave thesis static for days at a time" behavior. A
COMPOUNDER thesis like "MSFT cloud capex" might log REVIEWED entries
for 29 straight days then get a real touch on day 30. No tokens
wasted regenerating the thesis from scratch every morning.

### 4. Position-management decisions per thesis

For ACTIVE theses with an open position, the daily run also evaluates:

- **Hold longer?** TRADE horizon past `maxHoldDays` → review the exit.
  COMPOUNDER never auto-exits on time.
- **Add to position?** Compare current position size as % of portfolio
  vs `targetSizePct`. If under target AND a `scalingPlan` rung's
  conditions met (price below trigger, signal arrived, etc.) AND
  conviction unchanged → scale in. ADD-action triggers codify the same
  logic for cases where the agent should fire deterministically.
- **Trim?** If conviction has dropped (recent confidence_score lower
  than entry), or invalidation conditions partially met → trim toward
  smaller position.
- **Close?** If invalidation conditions clearly fired (now in
  `invalidationConds`) → close_position + update_thesis(change_status:
  "INVALIDATED"). If target hit → close_position + update_thesis
  (change_status: "CLOSED").

### 5. Discovery decision (per run, not per thesis)

After walking every active thesis, the daily run decides whether to
do discovery this morning. Gates:

- Is a portfolio slot available? (Below `maxOpenPositions`.)
- Did today's signals surface candidates outside existing coverage that
  pass the universe fence with anything resembling conviction?
- Is the regime hostile? (SPY breaking 200d, VIX > 30 — operator-set
  thresholds, exposed via intelligencePolicy.)

If any of these answer "no" or "hostile" → **skip discovery this run.**
The weekly discovery cron is the safety net for genuinely-new coverage
scanning. The daily run is allowed to skip.

If all green → research the top 2-3 candidates, score, mint new
theses (record_thesis with WATCHING or ACTIVE).

### 6. Watchlist (WATCHING-status thesis) review

For every WATCHING thesis the daily run also asks:

- Did a promotion trigger fire today? (e.g. trigger says "breakout
  confirmed → ACTIVE.") → Promote: `update_thesis(change_status:
  "ACTIVE")` + place_trade.
- `expiresAt` past with no signal activity? → Invalidate
  (auto-prune stale watches).
- `nextReviewAt` past? → Re-evaluate; either keep watching with
  refined triggers, or invalidate.
- Otherwise → REVIEWED.

### 7. Run summary

After the per-thesis loop + discovery decision:
`record_run_summary` with primary_decision, ranked picks (every
researched/touched ticker), structured rationale. Then `complete_run`.

This is unchanged from today's morning run in shape — but the inputs
are radically different. The summary now reflects "I looked at 8
active theses, touched 3 with real updates, kept 5 static, decided to
skip discovery, made 1 trade" instead of "I researched 6 random
tickers and minted 6 fresh thesis rows."

---

### How the user's specific concerns are addressed

| Concern | Where it's handled |
|---|---|
| "Leave thesis static for days at a time" | Question #3: REVIEWED entries when neither #1 nor #2 fires. |
| "Ignore discovery for the time being" | Question #5: discovery gates allow the daily run to skip. Plus weekly cron as backup. |
| "Know when to review and update a watchlist thesis" | Question #6: nextReviewAt + expiresAt + promotion triggers. |
| "Know how long it should be holding something" | Question #4 hold-longer check. Horizon-aware: TRADE has maxHoldDays, COMPOUNDER never time-exits, etc. |
| "Know when to review and when to add more" | Question #4 add-to-position check. targetSizePct vs current position; scalingPlan rungs; ADD triggers. |

---

## What PR 1 left in place

### New Thesis fields (all additive, all nullable or defaulted)

- `horizon` — `"CATALYST" | "TARGET" | "TRADE" | "COMPOUNDER"`. Dictates exit policy.
- `coreBelief`, `keyAssumptions[]`, `invalidationConds[]` — the durable belief.
- `targetSizePct`, `scalingPlan` — sizing intent.
- `triggers` (JSONB array) — structured predicate union (see `lib/agent/triggers/types.ts`).
- `catalystDate`, `maxHoldDays`, `nextReviewAt` — scheduling.
- `closedAt`, `closeReason` — terminal-state mirror.
- `ThesisStatus.WATCHING` — new enum value (PR 3 collapses watchlist into this).

### New `ThesisUpdate` table

One row per state change. Captures `fieldChanges` diff, `priceAtTime`,
`positionAtTime`, narrative, and links to the run / signals / trade
that produced it. Backfilled at migration time: every existing thesis
got a CREATED row, terminal-state theses got a SUPERSEDED / INVALIDATED
/ CLOSED row.

### Tools registered with the agent

- `record_thesis` — same-direction guard active. Rejects with
  `existing_thesis_id` pointing at the thesis the agent should be
  updating instead.
- `update_thesis` — patches a thesis in place. Writes one
  ThesisUpdate row with the diff. Empty patch + rationale → REVIEWED row.
  Auto-fetches latest Finnhub quote for `priceAtTime` if agent omits.
- `get_theses` — read the durable library. Default: ACTIVE +
  WATCHING. Optional: `include_history`, status / ticker / horizon
  filters, `watching_review_due_only`.

### System prompt

Step 1 calls `get_theses(include_history: true)`. Step 3 has the
explicit decision tree (ACTIVE same-dir → update_thesis; ACTIVE
opposite → record_thesis flip; INVALIDATED/CLOSED/none → record_thesis
new coverage; WATCHING → update_thesis to refine or promote).

### UI

`ThesisSheet` (and by extension `ThesisCard`) accept a `thesis_id`
prop. When supplied, `ThesisTimelineSection` lazy-fetches
`/api/theses/:id/updates` and renders an inline timeline at the bottom
of the existing sheet — vertical rail with small dots, price + date
heading, summary, rationale, and a footer with type / View run /
signal count.

`ThesisCardRenderer` falls back to `existing_thesis_id` when a
record_thesis call is rejected by the same-direction guard, so
clicking a rejected card still opens the real thesis's history.

### Operating model after PR 1 ships (today's behavior)

The morning cron (`morning-research`) still runs the 6-step workflow
and is still called the "morning research run." The only changes are:

1. Step 1 calls `get_theses` in addition to the existing brief / signals / portfolio reads.
2. Step 3 defaults to `update_thesis` for held names; `record_thesis` is reserved for new coverage and direction flips. The same-direction guard backstops compliance.
3. Every thesis touched writes one ThesisUpdate row. Theses no longer chain into new rows on every run — they evolve in place.
4. Discovery still happens in this run. Brief is still consumed. Trade execution unchanged.

PR 2 and PR 3 progressively move away from this transitional shape.

---

## PR 2 — Trigger evaluator + tactical mode

**Estimated scope:** ~2-3 days.
**Depends on:** PR 1 (merged).
**Doesn't touch:** the morning run prompt (PR 3's job).

### Goal

When a signal arrives that matches a structured trigger predicate on
an active thesis, fire a small focused decision run for that
(thesis, signal) pair — without waiting for the next morning cron.

This is the actual reactivity unlock. Once shipped:
- Mid-day signals that should change the book actually change the book.
- The agent stops needing to eyeball "did this hit my thesis" — the router answers deterministically.
- Trigger volume becomes a measurable signal (how often did predicates fire? did the resulting decisions add P&L?).

### File-by-file plan

#### New: `lib/agent/triggers/evaluate.ts`

Pure function:

```ts
export interface EvaluationContext {
  signal?: SignalRow;        // present when called from signal-router
  latestQuote?: { c: number; dp: number };
  recentPrices?: Array<{ date: Date; close: number }>; // for windowed predicates
  thesis: ThesisRow;
  now: Date;
}

export function evaluateTrigger(
  predicate: TriggerPredicate,
  ctx: EvaluationContext
): boolean;
```

Implements every predicate kind in `lib/agent/triggers/types.ts`. AND/OR
recurse. Predicates that need data not in `ctx` (e.g. PRICE_MOVE_PCT
when no `recentPrices`) return `false` rather than throwing.

**RSI predicate is stubbed for v1.** Returns `false` always with a
TODO comment. Real RSI calculation needs careful candle handling and
isn't worth blocking PR 2 on. Add in a follow-up.

Unit tests: `lib/agent/triggers/evaluate.test.ts`. Cover every
predicate kind with one match + one non-match case. Covers AND/OR.
This is one of the few places in the codebase where unit tests pay
their cost — the predicate logic is pure and the failure modes are
silent (a bad evaluator just doesn't fire triggers).

#### New: `lib/inngest/functions/trigger-evaluator.ts`

Two trigger paths:

**1. Signal-driven (event consumer):**
- Consumes `app/signal.routed` event. Payload: `{ signalId, analystIds[] }`.
- For each analystId × ticker in the signal's tickers, load active+watching theses.
- For each thesis × trigger, evaluate signal-side predicates against the signal. Skip cooldowns (`Date.now() - new Date(trigger.lastFiredAt) < cooldownDays * 86400e3`).
- On match: emit `app/thesis.trigger.fired` with `{ thesisId, triggerId, signalId, analystId }`. Stamp `lastFiredAt` on the trigger (transactional update of `Thesis.triggers` JSON).

**2. Cron-driven (price + time predicates):**
- Schedule: `*/15 9-16 * * 1-5` (every 15 min during US market hours, ET timezone).
- Walk all ACTIVE theses with non-empty triggers.
- Batch-fetch latest quotes (one Finnhub `/quote` call per unique ticker; cap at 200 unique tickers per run).
- For each thesis × trigger, evaluate price/time-side predicates. Same cooldown + emit pattern.

Idempotency: `(thesisId, triggerId, signalId)` is the natural key for an event. If the same signal evaluates twice (e.g. signal-router fires twice), the cooldown stamp on the trigger prevents re-fire.

#### New: `lib/inngest/functions/tactical-run.ts`

Consumes `app/thesis.trigger.fired`. For each event:

1. Load thesis (with triggers, signals cited via signalIds, position state).
2. Load the firing signal.
3. Resolve fresh stock data + recent ThesisUpdate rows for context.
4. Create `ResearchRun(mode='INTRADAY_TACTICAL', agentConfigId, parameters: { triggerId, signalId, thesisId })`.
5. Spawn the agent with the tactical system prompt.
6. On run completion, emit `app/tactical.run.complete` so any downstream consumers (notifications, eod-eval) can react.

Step budget: 15. Tool allowlist: see modes.ts changes below.

#### New: `lib/agent/system-prompts/intraday-tactical.ts`

Single-decision prompt, very different shape from the morning prompt.
Skeleton outline (full prompt to be drafted during implementation):

```
You are <analyst.name>. A trigger you set on your <ticker> thesis just
fired. Your job is to decide what to do about it.

THESIS (id: <thesisId>):
  direction, horizon, coreBelief, keyAssumptions, invalidationConds
  entry / target / stop / current price
  recent activity (last 5 ThesisUpdate rows)

TRIGGER THAT FIRED:
  predicate (kind + values)
  declared action (REVIEW / EXIT / ADD / TRIM / MOVE_STOP)
  rationale you wrote when you set the trigger

SIGNAL (if signal-driven):
  type, sentiment, urgency, headline, summary, source

POSITION:
  qty, avgCost, unrealizedPnL — or "no position"

DECISION FRAMEWORK:
  1. Read the trigger. Does the signal/price actually validate the
     predicate, or did it match by accident?
  2. If validation holds: do the declared action (or override with reasoning).
  3. If validation fails: pass (write a REVIEWED row noting the false-fire).
  4. Outputs: at most one trade (place_trade / manage_position /
     close_position). Always one update_thesis call documenting what
     you did and why.

TOOLS:
  read-only intel: get_stock_data, get_earnings_data, get_market_context, web_search (sparingly)
  action: place_trade, close_position, manage_position
  thesis: update_thesis (REQUIRED — every tactical run writes one)
  finalize: complete_run

CONSTRAINTS:
  - 15 step max. Be concise.
  - No discovery (you're not finding new names).
  - No new theses (record_thesis is not in your toolbox).
  - update_thesis is the close-out call. Always.
```

Specific non-trivial bits to get right:
- Reject the trigger when the signal is stale (cooldown should catch most, but signal might be hours old by the time the agent runs).
- Reference `triggerId` in the update_thesis call so the timeline row carries the link.
- "Override the declared action" must be deliberate — if the trigger says EXIT but the agent decides TRIM, the rationale must explain why.

#### Modified: `lib/agent/modes.ts`

Add a new `tactical` mode entry:

```ts
"tactical": {
  model: "gpt-4o",
  provider: "openai",
  maxSteps: 15,
  hasSuggestConfig: false,
  maxDuration: 300,
  toolAllowlist: [
    "get_stock_data", "get_earnings_data", "get_market_context",
    "get_options_flow", "get_sec_filings", "web_search",
    "read_artifact",
    "place_trade", "close_position", "manage_position",
    "update_thesis", "get_theses",  // get_theses for context, update for the close-out
    "complete_run",
  ],
  systemPrompt: TACTICAL_SYSTEM_PROMPT,
}
```

Note: `record_thesis` is intentionally NOT in the tactical allowlist.
Tactical mode never mints new theses. If the agent decides the thesis
is broken, it calls `update_thesis(change_status: "INVALIDATED")` and
the position-close happens via `close_position`. New coverage on a
new ticker happens in the daily run or weekly discovery.

#### Modified: `app/api/agent/[mode]/route.ts`

Wire the `"tactical"` mode through. Should be small — the existing
unified route already dispatches by mode. Likely just needs the new
mode entry to flow through.

#### Modified: `lib/inngest/functions/signal-router.ts`

After `createMany` of routes, emit `app/signal.routed` event for each
signal with the list of analystIds it routed to. Single event per
signal, payload includes `{ signalId, analystIds[], ticker[] }`.
Trigger-evaluator consumes.

Don't fire one event per route — that's analystCount × signalCount
events. One event per signal is enough; the consumer fans out.

#### Modified: `lib/inngest/functions/morning-brief-generator.ts`

Add a new section to the brief: **"Thesis triggers hit today."**
Computed deterministically by walking each analyst's active theses
and evaluating signal-side predicates against today's signals. Surface
the matches with thesis ticker + trigger rationale + signal that
fired. This becomes the agent's pre-vetted "you should look at these"
list — no eyeballing.

The narrative LLM call still happens (market context, etc.) but the
trigger section is computed before the LLM call and embedded in the
prompt.

Bonus: this also surfaces in the `/intelligence` dashboard for the
human operator.

#### Modified: `app/api/inngest/route.ts`

Register `triggerEvaluator` and `tacticalRun` functions in the array.

#### Modified: `lib/agent/tools/read-signals.ts`

Tighten the today-only window. PR 1 added a `lookbackDays` param
defaulted to 0 — confirm tactical mode passes 0 (it should). Also
add a way for the tactical run to query "signals matching this
trigger" so the agent can see related signals if it wants to dig.
Probably a new optional filter: `triggerId?: string` that joins
through ThesisUpdate to find prior signal context. Optional, low
priority.

### Test plan

Manual:
- Insert a Thesis row with a `SIGNAL_TYPE` trigger matching EARNINGS bearish.
- Trigger Inngest manually with `app/signal.routed` event for an EARNINGS bearish signal on that ticker.
- Confirm `app/thesis.trigger.fired` event emitted.
- Confirm `tactical-run` consumes it, creates a ResearchRun with mode=INTRADAY_TACTICAL, agent runs to completion.
- Confirm one ThesisUpdate(TRIGGER_FIRED) row written with the right links.

Unit:
- `evaluate.test.ts` covers every predicate kind.
- Add one router-event-emit test (signal-router emits on insert).

Validation in prod:
- Deploy. Wait 1-2 days. Spot-check the `/intelligence` dashboard for "triggers hit" panel.
- Verify tactical runs are firing and producing useful trades, not just noise.

### Known unknowns / open decisions

1. **Cooldown placement.** Today I have it on the trigger object. But the trigger is JSON inside the Thesis row — to update `lastFiredAt` we have to mutate the JSON and re-write the row. Alternative: separate `TriggerFiring` table with its own (triggerId, firedAt) rows. Easier to query, less hot-write contention. Probably worth doing as part of PR 2.
2. **Latest quote source.** Finnhub `/quote` is the obvious choice (we already use it). Cache: 30s on the call, but 15-min cron means ~30 fetches per ticker per market day. Costs are fine; just confirm.
3. **Signal-router event vs cron-only.** Initially I wanted the event path. But signals can route batched — easier to evaluate triggers in the SAME function that wrote the routes, before emitting events. Decide during implementation; either works.
4. **Brief section ordering.** Today's brief is portfolio alerts → watchlist updates → new opportunities → risk flags. "Triggers hit" goes BEFORE all of those (highest priority). Confirm during implementation.

---

## PR 3 — Daily run gets smarter + weekly discovery cron + brief deletion + watchlist collapse

**Estimated scope:** ~2 days.
**Depends on:** PR 2 (the daily run uses the trigger evaluator's
"triggers hit since last run" surface to prioritize work).
**Touches:** the existing morning-research function, watchlist data,
the brief generator, and various UI surfaces that render watchlist.

### Goal

The daily portfolio management run (today's `morning-research.ts`)
**stays.** It's the primary engine. PR 3 evolves it in three ways:

1. **Make it thesis-driven** with the per-thesis decision logic
   described in "How the daily run thinks per-thesis" above. Same cron,
   same step budget — radically different inputs and outputs.
2. **Add a separate weekly discovery cron** as a backstop for
   genuinely-new coverage. The daily run can also do discovery when
   conditions warrant; the weekly cron is the "make sure we don't go
   weeks without scanning" safety net.
3. **Delete the AI-consumed brief.** The agent reads durable state
   directly (theses, triggers, today's signals). The brief generator
   gets repurposed to write a human-facing daily journal artifact.

Plus: collapse watchlist into `Thesis.status='WATCHING'`. Single
durable primitive instead of two.

### File-by-file plan

#### Modified: `lib/inngest/functions/morning-research.ts`

The function stays. Same cron, same per-analyst dispatch, same
agent invocation. What changes:

1. **Inputs**: load `get_theses(include_history: true)`, today's
   pre-computed trigger matches (from PR 2's evaluator), today's
   signals routed to this analyst, portfolio state. The brief load
   goes away (see brief deletion below).
2. **Step 1 of the system prompt** (Stage 1) gets expanded to include
   the trigger-matches view and the thesis library. The "load brief"
   reference is removed.
3. **Step 2 (research)**: per-thesis decision logic kicks in here.
   Walk every ACTIVE + WATCHING thesis, route through the four
   per-thesis questions (#1-#4 from "How the daily run thinks
   per-thesis"). Most will REVIEWED-only; a few get full research +
   update.
4. **Step 3 (theses)**: unchanged in shape but now consistently
   uses update_thesis as default; record_thesis only for new coverage.
5. **Step 4 (compare and decide)**: discovery decision is here. Apply
   the gates (slot available? candidates exist? regime ok?). If yes,
   research 2-3 candidates. If no, skip with a note in the run summary.
6. **Steps 5-6 (execute, record)**: unchanged.

This is the BIG file. Most of the change is in the system prompt
(`lib/agent/system-prompt.ts`) since the function's structure already
supports the new flow.

#### Modified: `lib/agent/system-prompt.ts`

Substantial rewrite of the Workflow section to encode the per-thesis
decision logic. The skeleton:

```
## Workflow

### Step 1 — Gather state
- read_signals (today only)
- get_portfolio_context
- get_theses(include_history: true)
- (NEW) read the pre-computed "Triggers hit since last run" list
  injected into the prompt — this is your priority queue for Step 2

### Step 2 — Per-thesis review
For every ACTIVE + WATCHING thesis, decide one of:
  A. **Trigger fired or signal arrived** → research + update_thesis
     with the specific changes. (Priority bucket from Step 1.)
  B. **Review due** (nextReviewAt past, holding-duration limit, etc.)
     → research + update_thesis with the changes you decide.
  C. **Nothing changed** → update_thesis with empty patch + rationale
     ("Reviewed; no triggers, thesis intact"). Writes REVIEWED row.

Priority order: A → B → C. Budget your steps accordingly. Most theses
go through C.

### Step 3 — Position management
For every open position whose thesis you reviewed in Step 2:
  - Holding duration check (TRADE past maxHoldDays → review exit)
  - Add-to-position check (under target, scalingPlan rung met,
    ADD trigger fired → place_trade or manage_position)
  - Trim check (conviction down → manage_position partial close)
  - Close check (invalidation conditions met → close_position)

### Step 4 — Discovery (CONDITIONAL)
Apply the gates:
  - Are slots available?
  - Did today's discoverySignals surface candidates with conviction?
  - Is the regime hostile (SPY breaking 200d, VIX > 30)?
If any "no" → skip discovery. Note in the run summary.
If all clear → research top 2-3 candidates, score, mint via record_thesis
(status=ACTIVE if conviction high enough to trade, WATCHING otherwise).

### Step 5 — Execute
Trades, manages, closes from Steps 3 and 4. (Already happens inline.)

### Step 6 — Record
record_run_summary with primary_decision, ranked_picks (theses touched +
discovery candidates considered), structured rationale.
complete_run.
```

The Decision Framework / Compare-and-decide section (R/R, leader-first,
etc.) stays as the gate logic for Step 3 and Step 4. Just gets reframed
around "did the thesis library tell me to act?" rather than "what's
the best of the 6 random tickers I researched?"

#### New: `lib/inngest/functions/discovery-run.ts`

Weekly cron. Schedule: `0 9 * * 0` (Sunday 9am ET — operator
preference; ask before committing).

Per analyst:

1. Load universe (sectors, industries, themes, exclusion).
2. Load past 7 days of signals NOT cited by any active thesis (universe-fenced).
3. Load existing thesis tickers (so we don't re-cover names already covered).
4. Create ResearchRun(mode='DISCOVERY'). Spawn agent with discovery prompt.
5. Agent reviews candidates, creates new WATCHING theses (via record_thesis
   with explicit `status: "WATCHING"`), occasionally promotes
   highest-conviction picks to ACTIVE with a place_trade.

This is the BACKSTOP. The daily run also does discovery when conditions
warrant. The weekly cron exists so we don't accidentally go a month
without scanning if the daily run keeps deciding "no slots / hostile
regime / weak candidates."

#### New: `lib/agent/system-prompts/discovery.ts`

Weekly discovery prompt. Different from the daily-run prompt because
the scope is narrower (no portfolio management, just net-new coverage).

```
You are <analyst.name>. Weekly discovery run. Your job is to find new
names worth covering — names within your universe that aren't already
in your thesis library.

YOU DO NOT TOUCH EXISTING THESES. The daily portfolio review handles
those.

INPUT:
  Universe (sectors, industries, themes, market cap range).
  Existing thesis tickers (so you don't re-cover).
  Last 7 days of signals on universe-matching tickers that no current
  thesis cites.
  Top movers / unusual filings on universe tickers.

WORKFLOW:
  1. Scan candidate signals + tickers.
  2. For each candidate worth a deeper look (≥2): get_stock_data,
     get_earnings_data as needed.
  3. Score with the same scoring framework as record_thesis.
  4. Mint new theses:
     - High conviction (score ≥ 7) → record_thesis with status=ACTIVE
       and an entry trade (place_trade).
     - Lower conviction → record_thesis with status=WATCHING and
       triggers describing what would flip it to ACTIVE.
  5. record_run_summary with the week's discovery output.

CONSTRAINTS:
  - Cap at 5 new theses per discovery run. Quality over quantity.
  - No updates to existing theses (the daily run does that).
  - 25 step budget.

TOOLS: <allowlist below>
```

#### Modified: `lib/agent/modes.ts`

Add a `"discovery"` mode entry:

```ts
"discovery": {
  // toolAllowlist: read intel + record_thesis + place_trade +
  //   record_run_summary + complete_run.
  //   NO update_thesis. NO close_position. NO manage_position.
  maxSteps: 25,
  ...
}
```

The existing `"research-run"` mode (used by the daily run) stays —
it's the smarter daily portfolio review now. Tactical mode comes from PR 2.

#### Modified: `lib/inngest/functions/morning-brief-generator.ts`

Two paths to choose from during implementation:

**A. Delete it.** The morning brief was a scaffold from when humans
read it. The AI no longer needs it. The /intelligence dashboard can
render the same data live without a generated artifact.

**B. Repurpose it as the daily journal.** After the daily run completes,
write the journal artifact with: market context, theses touched today,
decisions made, watch-tomorrow flags. This is for the human dashboard,
NOT consumed by any AI.

Recommend B — gives the human something to scan each morning ("here's
what your analysts decided overnight"). Lower stakes than generating an
AI input. The brief generator becomes a post-run summarizer.

In either case: `read_morning_brief` tool gets DELETED. The agent no
longer has it.

#### Modified: `lib/agent/tools/read-morning-brief.ts`

Delete.

#### Modified: `lib/agent/tools/manage-watchlist.ts`

Rewrite to use `Thesis` with `status='WATCHING'` instead of
`AnalystWatchlistItem`. ADD = create a WATCHING thesis. REMOVE = mark
INVALIDATED with the reason. UPDATE = update_thesis.

Or: deprecate `manage_watchlist` and have the daily run / discovery use
`record_thesis(status: "WATCHING")` and `update_thesis` directly.
Cleaner, but requires more prompt rework. Decide during implementation.

#### New migration: `prisma/migrations/{date}_watchlist_to_thesis_collapse/`

```sql
-- Convert AnalystWatchlistItem rows to WATCHING-status Thesis rows.
-- Preserves expiry, conviction, target/stop, catalyst.
-- Keep AnalystWatchlistItem rows intact (don't drop the table) — mark
-- a `migratedAt` timestamp so we can trace the conversion.
ALTER TABLE "AnalystWatchlistItem" ADD COLUMN "migratedAt" TIMESTAMP(3);

-- Relax Thesis.researchRunId to nullable so migration-minted WATCHING
-- theses don't need a synthetic ResearchRun.
ALTER TABLE "Thesis" ALTER COLUMN "researchRunId" DROP NOT NULL;

-- For each ACTIVE AnalystWatchlistItem with no existing WATCHING thesis
-- on (analyst, symbol), insert a Thesis row with status=WATCHING.
-- Direction defaults to thesisDirection if set, else LONG.
INSERT INTO "Thesis" (...)
SELECT ...
FROM "AnalystWatchlistItem" w
WHERE w.status = 'ACTIVE' AND NOT EXISTS (
  SELECT 1 FROM "Thesis" t
  WHERE t.ticker = w.symbol
    AND t.status = 'WATCHING'
    AND t."researchRunId" IN (
      SELECT id FROM "ResearchRun" WHERE "agentConfigId" = w."analystId"
    )
);

UPDATE "AnalystWatchlistItem" SET "migratedAt" = NOW() WHERE "status" = 'ACTIVE';
```

The `Thesis.researchRunId` is NOT NULL today. Two ways forward:

(a) **Relax the FK to allow null** (recommended). The few places that
assume it's set should already null-check. Update them as needed.

(b) **Create synthetic ResearchRun rows for migration**. Heavier.

Going with (a) above.

#### Modified: UI — watchlist tiles → WATCHING-thesis rendering

Find every place that renders `AnalystWatchlistItem` (dashboard,
intelligence page, analyst detail). Replace with WATCHING-status
thesis rendering. Most should re-use existing thesis-row /
thesis-card components, possibly with a status-aware visual difference
(badge, lighter color).

#### Modified: `app/api/inngest/route.ts`

- Register `discoveryRun` (new weekly cron).
- `morningResearch` stays — it's the daily run.

### Test plan

- Manually trigger one analyst's daily run after the prompt rewrite.
  Confirm: agent calls `get_theses` in Step 1; for held names it goes
  through update_thesis (with full updates OR REVIEWED-only); discovery
  decision is logged in the run summary; no `read_morning_brief` call.
- Manually trigger discovery cron for one analyst. Confirm it produces
  new WATCHING theses, no updates to existing theses.
- After watchlist migration, confirm the dashboard renders the
  collapsed theses correctly. Confirm `expiresAt` carryover preserved.
- Confirm `read_morning_brief` is deleted and the agent doesn't try
  to call it.

### Known unknowns / open decisions

1. **Discovery cron day.** Sunday 9am ET is one option. Friday after
   close is another. Operator preference; ask before committing.
2. **Brief: delete vs repurpose.** Recommended B (repurpose as
   journal). Confirm with user.
3. **Watchlist UI vs thesis UI.** Do WATCHING theses get their own
   visual treatment (lighter color, "Watching" badge) or do they look
   identical to ACTIVE theses with just a status difference? At least
   the badge — operators want to see at a glance.
4. **Manage_watchlist tool.** Keep as a thin wrapper that delegates
   to record_thesis/update_thesis, OR delete and have the agent call
   the underlying tools directly? Cleaner is delete; safer (less
   prompt rework) is keep-as-wrapper.
5. **What happens to `mode='HOUSEKEEPING'`?** The original PR 1 plan
   added a HOUSEKEEPING mode value. With the corrected framing, we
   keep `mode='MORNING_PLAN'` for the daily run (just smarter inputs)
   and add `mode='DISCOVERY'` for the weekly cron. Tactical comes
   from PR 2 as `mode='INTRADAY_TACTICAL'` (already in the schema).

---

## Operating rules (lessons from this PR)

These rules came out of the PR 1 work. Observe them in PR 2 and PR 3.

### 1. No prod schema changes without explicit approval

- **Never** call `mcp__supabase__apply_migration` against prod without the user saying "go apply that."
- **Never** INSERT into infra tables (`_prisma_migrations`, etc.) without explicit approval.
- The pattern: write the migration SQL, open the PR, let the user say "apply it" → then apply via MCP. If user prefers to apply via Vercel deploy, ship the PR without prod changes.
- Don't infer approval from prior precedent (e.g. "PR #189 did this so I assume it's OK"). Each migration is its own approval.

### 2. Validate each PR's behavior in production before stacking the next

After merging a PR with behavior changes (new agent prompts, new tools,
new flows), wait at least one full production run cycle (e.g. tomorrow
morning's cron) and spot-check the output before starting the next PR.
Stacking on top of a flaky foundation compounds debugging.

### 3. Write the master plan BEFORE starting the multi-PR work

Don't carry the plan in your head. Write it down in `docs/`. Future
sessions (Claude or human) read the doc, not your memory. This doc is
the example.

### 4. Show diffs before applying anything to prod or prod-adjacent infra

- Local code changes: edit and proceed.
- Prod schema, prod data, prod registry tables: show the SQL, ask, then apply.

### 5. Don't conflate "I have a clear mental model" with "this is documented"

If you can't point to a file in `docs/` or a section in CLAUDE.md that
explains the plan, the plan isn't real for anyone but you.

### 6. Never invent a new agent UI renderer (carryover from CLAUDE.md)

The renderer surface is fixed at five (ToolUIRenderer, ThesisCardRenderer,
RunSummaryRenderer, ConfigPreviewRenderer, AskQuestionRenderer). For
new tools, return `data.items[]` with the right row kinds. Adding a
sixth renderer is almost always wrong.

### 7. ShadCN-only UI; no custom classes on primitives

CLAUDE.md rule. Honor it.

---

## Quick-start for a fresh session picking up PR 2

1. Read this doc top to bottom.
2. Read `lib/agent/triggers/types.ts` and `lib/agent/triggers/schema.ts` (already exist).
3. Read PR 1 (commit `81e73ae`) to see the foundation: `lib/agent/tools/{record,update,get}-thesis.ts`, `lib/agent/thesis-updates.ts`, `lib/inngest/functions/signal-router.ts`.
4. Start with `lib/agent/triggers/evaluate.ts` + its unit tests. This is the smallest standalone piece and the foundation for everything else.
5. Build outward: trigger-evaluator function, tactical-run function, tactical system prompt, modes.ts wiring.
6. Modify signal-router last (it's the only existing-code modification; everything else is additive).
7. Open the PR with the test plan. Ask the user before applying any migration.

## Quick-start for a fresh session picking up PR 3

1. Read this doc top to bottom — especially "How the daily run thinks
   per-thesis." That's the heart of PR 3.
2. Read PR 2's merged work — particularly the trigger evaluator + the
   "triggers hit since last run" surface, since the daily run uses it.
3. Confirm with user: discovery cron day, brief delete vs repurpose,
   manage_watchlist keep vs drop.
4. **Start with the system prompt rewrite** in `lib/agent/system-prompt.ts`.
   That's where most of the user-visible behavior change lives. Validate
   against a single analyst manually before unblocking the cron.
5. Add the discovery cron + system prompt + mode wiring next.
6. Watchlist collapse migration LAST — show the SQL to the user, get
   approval, apply via MCP only after confirmation.
7. Brief deletion / repurpose at the end. It's the user-facing change
   with the highest "I miss it" risk if cut wrong.

**Important reframing reminder:** PR 3 does NOT delete the morning run.
It evolves it. The function name `morning-research` may stay, the cron
may stay, the mode value (`MORNING_PLAN`) may stay. What changes is
how the agent thinks per-thesis, which is mostly a prompt change with
a few input changes. Don't over-rewrite.
