# Thesis-Driven Analyst Architecture — Plan

> Master plan for the three-PR overhaul that turns Hindsight from a
> daily-research-run model into a durable thesis library with reactive
> updates and a clean separation of housekeeping vs tactical vs
> discovery work.
>
> Audience: future sessions (Claude or human) picking up PR 2 or PR 3.
> This is self-contained — read just this doc and you can execute.

---

## Status (as of 2026-04-27)

| PR | Status | Branch / commit |
|---|---|---|
| **PR 1 — Durable thesis state + activity log + tools** | ✅ **Merged** as #193 | `81e73ae` on main |
| PR 2 — Trigger evaluator + tactical mode | Not started | — |
| PR 3 — Housekeeping + discovery + brief deletion + watchlist collapse | Not started | — |

PR 1 shipped the foundation. The DB has new Thesis fields, a
`ThesisUpdate` table backfilled with one row per existing thesis, three
new agent tools (`update_thesis`, `get_theses`, plus same-direction
guard on `record_thesis`), and a Timeline section embedded in the
existing ThesisSheet UI.

Everything in PRs 2 and 3 builds on that foundation.

---

## Strategy in one page

We're moving from:

> "Daily research run that re-discovers, re-researches, and re-writes
> theses every morning"

to:

> "Durable thesis library that the analyst maintains as a coverage
> commitment. Most days nothing changes. Signals trigger small focused
> decisions. New names enter slowly via a separate weekly cadence."

### Three operating modes (one agent, three contexts)

| Mode | Cadence | Scope | Goal | Step budget |
|---|---|---|---|---|
| **Tactical** | Event-driven (trigger fires) | One ticker, one signal, one thesis | Act / update thesis / pass | ~15 |
| **Housekeeping** | Daily (replaces today's morning cron) | All ACTIVE + WATCHING theses | Walk the book; update where warranted; queue tactical actions | ~25 |
| **Discovery** | Weekly | Universe-fenced signals not matching any active thesis | Mint new WATCHING theses; rare ACTIVE entries on high conviction | ~25 |

### The thesis as durable state

One `Thesis` row per `(analyst, ticker, direction)`. Lives for weeks /
months / years depending on horizon. Edits go through `update_thesis`,
which writes a `ThesisUpdate` log row — not a new Thesis row. The
chain pattern (parentThesisId) is reserved for genuine direction flips
or explicit replacements after invalidation.

### Triggers as machine-evaluable predicates

Every thesis can carry a `triggers[]` array of structured predicates
(PRICE_*, SIGNAL_TYPE, EARNINGS_*, FILING, TIME_*, AND/OR). The router
evaluates these deterministically — no LLM in the matching loop. The
LLM only runs after a trigger fires (tactical mode).

### What "the brief" becomes

In PR 3 the AI-consumed morning brief goes away. The same agent reads
signals, thesis library, and triggers directly. The brief generator
either deletes or repurposes to a daily journal artifact for a human
dashboard.

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
new ticker happens in housekeeping or discovery.

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

## PR 3 — Housekeeping + discovery + brief deletion + watchlist collapse

**Estimated scope:** ~2 days.
**Depends on:** PR 2 (or at least PR 1 + PR 2 staged together — PR 3 references trigger evaluator).
**Touches:** the morning run, watchlist data, the brief.

### Goal

Move from the current "morning research run does everything" model to:

- **Housekeeping** as the daily cadence — walk the book, validate
  theses against today's events, queue tactical actions for execution.
  No new coverage. No discovery.
- **Discovery** as a separate weekly cron. Mint new WATCHING theses.
  Optionally open small ACTIVE positions on highest-conviction picks.
- **Brief** deleted as AI input. The agent reads signals + theses
  directly. A daily journal artifact for the human dashboard takes
  over the brief's user-facing role.
- **Watchlist** collapses into `Thesis.status = WATCHING`. Same
  primitive, simpler model.

### File-by-file plan

#### New: `lib/inngest/functions/housekeeping-run.ts`

Replaces `morning-research.ts`. Same cron schedule (8am ET weekdays,
per-analyst). Flow:

1. Load analyst config (universe, intelligence policy).
2. Load active + watching theses with recent ThesisUpdate rows.
3. Load today's signals routed to this analyst.
4. Load today's "thesis triggers hit" pre-computed by PR 2.
5. Load portfolio + price data for covered tickers.
6. Create ResearchRun(mode='HOUSEKEEPING'). Spawn agent with housekeeping prompt.
7. Agent walks each thesis, decides per-thesis: update / no-change-but-review / queue-tactical-action.
8. On completion, write a daily journal artifact (replaces brief).

#### New: `lib/inngest/functions/discovery-run.ts`

Weekly cron. Schedule: `0 9 * * 0` (Sunday 9am ET).
Per analyst:

1. Load universe (sectors, industries, themes, exclusion).
2. Load week's signals NOT already cited by any active thesis (universe-fenced).
3. Load existing thesis tickers (so we don't re-cover names already covered).
4. Create ResearchRun(mode='DISCOVERY'). Spawn agent with discovery prompt.
5. Agent reviews candidates, creates new WATCHING theses (via record_thesis), occasionally promotes highest-conviction picks to ACTIVE with a place_trade.

#### New: `lib/agent/system-prompts/housekeeping.ts`

```
You are <analyst.name>. Daily housekeeping run. Your job is to walk
your thesis library, validate each thesis against today's events,
and decide per-thesis: update, review-only, or queue a tactical action.

YOU DO NOT MINT NEW THESES. Discovery is a separate run.
YOU DO NOT TRADE DIRECTLY (except for tactical actions queued by
triggers that already fired).

INPUT:
  Active + Watching theses (with last 3 ThesisUpdate rows each).
  Today's signals routed to you.
  Today's pre-computed trigger matches (from the router).
  Portfolio state.
  Recent prices for covered tickers.

WORKFLOW:
  1. Triggers first. For every trigger that fired today, you should
     ALREADY have a tactical run that handled it (or it's queued).
     Confirm and move on.
  2. Walk every ACTIVE thesis. For each:
     - Read the thesis state.
     - Read today's signals on this ticker.
     - Decide: did anything change? If yes → update_thesis with the
       changes. If no → update_thesis with empty patch + rationale =
       REVIEWED row.
  3. Walk every WATCHING thesis. Same flow but the question is "is
     this still worth watching, and are we close to promoting?"
  4. Watchlist hygiene: any WATCHING thesis whose nextReviewAt is
     long past + no signal activity → consider invalidating.
  5. Position management: if any thesis is invalidated, close its
     position. If any holding has been near target/stop, manage_position.

OUTPUT:
  - One update_thesis call per touched thesis.
  - Optional close_position / manage_position.
  - One record_run_summary at the end with the day's journal.
  - complete_run.

TOOLS: <allowlist below>
```

#### New: `lib/agent/system-prompts/discovery.ts`

```
You are <analyst.name>. Weekly discovery run. Your job is to find new
names worth covering — names within your universe that aren't already
in your thesis library.

YOU DO NOT TOUCH EXISTING THESES. Housekeeping is a separate run.

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
  - No updates to existing theses (housekeeping does that).
  - 25 step budget.

TOOLS: <allowlist below>
```

#### Modified: `lib/agent/modes.ts`

Add `"housekeeping"` and `"discovery"` modes:

```ts
"housekeeping": {
  // toolAllowlist: read intel + update_thesis + manage_position +
  //   close_position + manage_watchlist (still here for now — see PR 3 watchlist collapse note) +
  //   record_run_summary + complete_run.
  //   NO record_thesis. NO place_trade.
  maxSteps: 25,
  ...
}

"discovery": {
  // toolAllowlist: read intel + record_thesis + place_trade +
  //   record_run_summary + complete_run.
  //   NO update_thesis. NO close_position.
  maxSteps: 25,
  ...
}
```

#### Modified: `lib/inngest/functions/morning-brief-generator.ts`

Two paths to choose from during implementation:

**A. Delete it.** The morning brief was a scaffold from when humans
read it. The AI no longer needs it. The /intelligence dashboard can
render the same data live without a generated artifact.

**B. Repurpose it as the daily journal.** After housekeeping completes,
write the journal with: market context, theses touched today, decisions
made, watch-tomorrow flags. This is for the human dashboard, NOT
consumed by any AI.

I'd lean toward B — it gives the human something to scan each
morning ("here's what your analysts decided overnight"). Lower stakes
than generating an AI input.

In either case: `read_morning_brief` tool gets DELETED. The agent no
longer has it.

#### Modified: `lib/agent/tools/read-morning-brief.ts`

Delete.

#### Modified: `lib/agent/tools/manage-watchlist.ts`

Rewrite to use `Thesis` with `status='WATCHING'` instead of
`AnalystWatchlistItem`. ADD = create a WATCHING thesis. REMOVE = mark
INVALIDATED with the reason. UPDATE = update_thesis.

Or: deprecate `manage_watchlist` and have housekeeping/discovery use
`record_thesis` (with status=WATCHING) and `update_thesis` directly.
Cleaner, but requires more prompt rework. Decide during implementation.

#### New migration: `prisma/migrations/{date}_watchlist_to_thesis_collapse/`

```sql
-- Convert AnalystWatchlistItem rows to WATCHING-status Thesis rows.
-- Preserves expiry, conviction, target/stop, catalyst.
-- Keep AnalystWatchlistItem rows intact (don't drop the table) — mark
-- a `migratedAt` timestamp so we can trace the conversion.
ALTER TABLE "AnalystWatchlistItem" ADD COLUMN "migratedAt" TIMESTAMP(3);

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

-- ResearchRunId for the new theses: use a synthetic "MIGRATION" run
-- per analyst, OR set researchRunId to null if the column allows.
-- Likely need to relax the FK: ALTER COLUMN researchRunId DROP NOT NULL.

UPDATE "AnalystWatchlistItem" SET "migratedAt" = NOW() WHERE "status" = 'ACTIVE';
```

This is the trickiest piece of PR 3. The `Thesis.researchRunId` is
NOT NULL today — collapsing watchlist requires either:
(a) relaxing the FK to allow null, OR
(b) creating synthetic ResearchRun rows for migration purposes.

I'd go with (a). Relax `researchRunId` to nullable and update the few
places that assume it's set.

#### Modified: UI — watchlist tiles → WATCHING-thesis rendering

Find every place that renders `AnalystWatchlistItem` (dashboard,
intelligence page, analyst detail). Replace with WATCHING-status
thesis rendering. Most should re-use existing thesis-row /
thesis-card components.

#### Modified: `app/api/inngest/route.ts`

- Register `housekeepingRun` and `discoveryRun`.
- Deregister `morningResearch`.

### Test plan

- Manually trigger housekeeping and confirm it walks every active
  thesis, writes one ThesisUpdate per, doesn't mint new ones.
- Manually trigger discovery and confirm it produces new WATCHING
  theses (no updates to existing).
- After watchlist migration, confirm the dashboard renders the
  collapsed theses correctly.
- Confirm read_morning_brief is gone and the agent doesn't try to
  call it (system prompts have been updated).

### Known unknowns / open decisions

1. **Discovery cron day.** Sunday 9am ET is one option. Friday after
   close is another. Operator preference; ask before committing.
2. **Brief: delete vs repurpose.** Lean toward repurpose (option B
   above), but confirm with user.
3. **Watchlist UI vs thesis UI.** Do WATCHING theses get their own
   visual treatment (lighter color, "Watching" badge) or do they look
   identical to ACTIVE theses with just a status difference? Probably
   need at least the badge — operators want to see at a glance.
4. **Manage_watchlist tool.** Keep as a thin wrapper that delegates
   to record_thesis/update_thesis, OR delete and have the agent call
   the underlying tools directly? Cleaner is delete; safer (less
   prompt rework) is keep-as-wrapper.

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

1. Read this doc top to bottom.
2. Read PR 2's merged work — particularly the trigger evaluator, since housekeeping uses it.
3. Decide watchlist collapse strategy (option A vs B above) and confirm with user.
4. Write the migration SQL but DON'T APPLY IT. Show the user, get approval.
5. Build housekeeping prompt + run + mode wiring. Validate against a single analyst before unblocking the cron.
6. Build discovery the same way.
7. Brief deletion / repurpose last. It's the user-facing change with the highest "I miss it" risk if cut wrong.
