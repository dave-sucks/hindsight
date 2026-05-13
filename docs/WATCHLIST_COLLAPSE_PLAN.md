# WATCHLIST_COLLAPSE_PLAN.md

> **Status:** Spec, not yet implemented. Drafted 2026-05-13 after the
> 2026-05-11 Discovery rework (PR #253) surfaced that 13 of 36 Thesis
> rows had no matching `AnalystWatchlistItem` (36% drift) — and 5
> watchlist items had no matching thesis. Five different writers, only
> one (`manage_watchlist`) keeps both stores in sync. The fix is to
> delete `AnalystWatchlistItem` entirely and make `Thesis` the single
> store. This doc is the spec for that work.

---

## Problem statement

Today there are TWO stores for "tickers an analyst is tracking":

1. **`AnalystWatchlistItem`** — the legacy table. The UI's watchlist
   reads from here.
2. **`Thesis` with `status IN ('ACTIVE','WATCHING')`** — the durable
   model the agent's reasoning is built around. The trigger evaluator,
   daily run, tactical run, `get_theses` tool, and stock detail page
   read from here.

**Five entry points write watchlist data, and four of them are broken:**

| Writer | Writes `AnalystWatchlistItem` | Writes `Thesis(WATCHING)` |
|---|---|---|
| UI "Add Stock to Watchlist" button (`addWatchlistItem`) | ✅ | ❌ |
| Builder applies new analyst config (`createAnalystFromConfig`) | ✅ | ❌ |
| Editor updates existing analyst config (analyst update path) | ✅ | ❌ |
| `manage_watchlist` agent tool | ✅ | ✅ |
| `record_thesis` agent tool (discovery / daily-run / tactical) | ❌ | ✅ |

Result: the UI watchlist misses theses minted by the agent, and the
agent's thesis library misses tickers the user manually added or the
builder seeded. Drift compounds with every action.

---

## End-state architecture

`Thesis` is the **single source of truth**. The "watchlist" is a *view*
over `Thesis`:

```sql
SELECT * FROM "Thesis"
WHERE "agentConfigId" = $1   -- (via researchRun join)
  AND status IN ('ACTIVE','WATCHING')
ORDER BY "createdAt" DESC;
```

`AnalystWatchlistItem` is **deleted**. There is no second table.

Every entry point — UI button, builder, editor, agent tools — writes a
`Thesis` row. Drift is structurally impossible because there's only one
place to write.

---

## The new "PENDING" thesis state

Today's `Thesis.direction` enum is `LONG | SHORT | PASS`. Two of those
mean "I researched this and have an opinion." `PASS` means "I researched
this and decided not to trade — but I'm watching for a change of mind."

There's no value for "user/builder added this; nobody has researched it
yet." We need one. Two options:

### Option A — Add `direction = "PENDING"`

Cleanest. `PENDING` means "awaiting research." The daily-run prompt has
explicit handling for this state: pick it up on the per-thesis review
loop, do research, transition to LONG/SHORT (open coverage) or PASS
(researched, declined) via `update_thesis`.

### Option B — Reuse `direction = "PASS"` + a new `source_kind`

Use `PASS` for both "user-added pending review" and "researched and
declined." Disambiguate via `source_kind = "USER_ADDED" | "BUILDER_SEED"`.

**Recommendation: Option A.** Distinct directional state for "no opinion
yet" is clearer for both the agent and any human reading the data. PASS
should keep its meaning of "researched and declined."

---

## Required schema changes

### 1. Add `PENDING` to the direction enum

`prisma/schema.prisma` — `Thesis.direction` is currently a String column
typed as `"LONG" | "SHORT" | "PASS"`. Add `"PENDING"`.

### 2. Add new `source_kind` values

`source_kind` enum currently: `ROUTED_SIGNAL | WEB_SEARCH | WATCHLIST_REVIEW | POSITION_REVIEW`.
Add: `USER_ADDED | BUILDER_SEED | EDITOR_SEED`.

`USER_ADDED` = manual UI "Add Stock to Watchlist" click.
`BUILDER_SEED` = analyst creation transaction seeded this ticker.
`EDITOR_SEED` = analyst-edit chat session seeded this ticker.

### 3. (Optional) Add `pendingReason: String?` to Thesis

For PENDING theses, store the user's stated reason for adding
(`"Added manually from screener"`, `"Builder-seeded — fits Tech Momentum
edge"`, etc.). When the agent later flips PENDING → LONG/SHORT/PASS,
this can be folded into `reasoning_summary`. If we feel reasoning_summary
+ source_rationale already cover this, skip this field.

### 4. Schema constraints to relax for PENDING

Current `record_thesis` rejects directional WATCHING theses without
`target_price` (the ENTER trigger needs it). PENDING theses have no
target_price yet — they're awaiting research. Carve out: PENDING is
allowed to land without target/entry/stop/triggers; the rejection
gate only applies to LONG/SHORT.

Same for `core_belief`, `key_assumptions`, `invalidation_conditions` —
required for LONG/SHORT, exempted for PENDING (and already exempted
for PASS).

---

## Migration

One-shot migration script run as a Prisma migration:

### Step 1 — Backfill orphaned watchlist items into Thesis

For every `AnalystWatchlistItem` with status='ACTIVE' that has no
matching ACTIVE/WATCHING thesis on `(analystId, symbol)`:

```sql
-- Pseudocode; real implementation uses prisma.thesis.create with the
-- right ResearchRun anchor. Each backfilled thesis needs a ResearchRun
-- to live under (the FK is required). Two options:
--   (a) Create a synthetic "backfill" ResearchRun per analyst,
--   (b) Use the analyst's most recent COMPLETE run as the anchor.
-- Option (a) is cleaner; the run row carries source='BACKFILL'.
```

For each backfilled thesis:
- `status = 'WATCHING'`
- `direction = 'PENDING'`
- `source_kind = 'USER_ADDED' | 'BUILDER_SEED'` (mapped from
  `AnalystWatchlistItem.addedBy`: `'USER'` → `USER_ADDED`,
  `'BUILDER'` → `BUILDER_SEED`)
- `source_rationale = AnalystWatchlistItem.reason`
- `reasoning_summary = AnalystWatchlistItem.reason || "Backfilled from watchlist"`
- No entry/target/stop/triggers (PENDING is allowed to land bare)

Also write a `ThesisUpdate` row with `type = 'CREATED'` so the activity
log reflects the backfill.

### Step 2 — Verify zero drift

Post-backfill, the reconciliation query should return zero rows:

```sql
SELECT awi.id
FROM "AnalystWatchlistItem" awi
WHERE awi.status = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM "Thesis" t
    JOIN "ResearchRun" rr ON rr.id = t."researchRunId"
    WHERE rr."agentConfigId" = awi."analystId"
      AND t.ticker = awi.symbol
      AND t.status IN ('ACTIVE','WATCHING')
  );
```

If nonzero, hold the migration.

### Step 3 — Drop `AnalystWatchlistItem`

After all read sites are migrated (next section), drop the table and
its index. Also remove the `watchlist: String[]` legacy array on
`AgentConfig` (sync'd today via `syncLegacyWatchlist` — that helper goes).

---

## Backend writer changes (the four broken paths)

### 1. UI "Add Stock to Watchlist" — `addWatchlistItem`

`lib/actions/watchlist.actions.ts:193`. Rewrite to:

```ts
// 1. Find or create the analyst's "manual additions" ResearchRun anchor.
//    Manual UI clicks don't have a run context naturally, but Thesis.FK
//    requires one. Create a per-analyst long-lived run with mode='MANUAL'.
// 2. prisma.thesis.create with:
//      status='WATCHING', direction='PENDING',
//      source_kind='USER_ADDED', source_rationale=<user's reason>,
//      ticker=symbol, no entry/target/stop/triggers
// 3. writeThesisUpdate({ type: 'CREATED', summary: 'Manually added' })
// 4. revalidatePath
```

Idempotency: if an ACTIVE/WATCHING thesis already exists for
`(analystId, symbol)`, no-op (same shape as today's existing check).

### 2. Builder — `createAnalystFromConfig`

`lib/actions/analyst.actions.ts:1009 + 1023`. The transaction creates
`AnalystWatchlistItem` rows for the builder-suggested watchlist. Replace
with `Thesis` row creation under a fresh `ResearchRun` with
`source='BUILDER'`, `mode='BUILDER_SEED'`. Each thesis: `status='WATCHING'`,
`direction='PENDING'`, `source_kind='BUILDER_SEED'`.

### 3. Editor — analyst-update watchlist write

`lib/actions/analyst.actions.ts:1512`. Same shape as builder, with
`source_kind='EDITOR_SEED'`. Diff against current state: if the editor
*adds* a name, mint a PENDING thesis. If the editor *removes* a name,
call `update_thesis(change_status: 'INVALIDATED')` with rationale
"Removed from watchlist via editor chat."

### 4. `manage_watchlist` agent tool

`lib/agent/tools/manage-watchlist.ts`. Three options:

**(a) Delete the tool entirely.** Force every agent path through
`record_thesis` / `update_thesis`. The discovery + daily-run prompts
just say "when you want to add coverage, call record_thesis."

**(b) Keep it as a thin wrapper.** Internally it calls record_thesis
(for ADD) or update_thesis (for REMOVE). The prompt sees a
`manage_watchlist` tool with `action: ADD|REMOVE`; the implementation
does the right thesis writes underneath.

**Recommendation: (b).** It's a smaller agent-prompt change and matches
your stated UX — "as far as the prompt is concerned it is adding items
to watchlist." The tool name is the abstraction the agent uses; the
implementation handles the schema.

When `action: ADD`:
- `record_thesis` internally with `status='WATCHING'`, `direction='PENDING'`,
  `source_kind` derived from context (e.g. `WATCHLIST_REVIEW` if mid-daily-run,
  `ROUTED_SIGNAL` if the agent passes signal IDs).

When `action: REMOVE`:
- Look up the active Thesis for `(analystId, symbol)`.
- `update_thesis(change_status: 'INVALIDATED')` with the rationale.

### 5. `record_thesis` itself

`lib/agent/tools/record-thesis.ts`. **No write to AnalystWatchlistItem
needed (table is gone).** The existing flow stays; we just need to
relax the gates for `direction='PENDING'`:

- Allow `status='WATCHING' + direction='PENDING'` without target_price /
  stop_loss / entry_price / triggers / core_belief / key_assumptions /
  invalidation_conditions. Those become *required when the agent
  promotes PENDING → LONG/SHORT* via update_thesis on the next run.
- The cross-analyst overlap guard still applies.
- The provenance gate still applies (source_kind required; the new
  USER_ADDED/BUILDER_SEED/EDITOR_SEED satisfy it).

### 6. Default triggers for PENDING

`lib/agent/triggers/defaults.ts`. A PENDING thesis should get ONE
auto-attached trigger: a `TIME_ELAPSED` REVIEW trigger that fires on
the next daily run, so the agent picks it up promptly:

```ts
{
  kind: 'TIME_ELAPSED',
  days: 0,  // fires next cron tick
  action: 'REVIEW',
  rationale: 'PENDING thesis awaiting first research'
}
```

This guarantees PENDING theses don't sit unreviewed.

---

## Frontend read changes

Every site that reads `AnalystWatchlistItem` becomes a Thesis query.

### Audit of read sites

```bash
grep -rln "analystWatchlistItem\." lib/ app/
```

Known readers from the codebase:

- `lib/actions/watchlist.actions.ts` — `getWatchlistItems(analystId)`,
  `getAllWatchedAnalysts()`, plus the legacy sync helper.
- `lib/agent/run-input.ts:222` — the daily-run prompt's "Watchlist"
  section reads `AnalystWatchlistItem`.
- `lib/inngest/functions/portfolio-watchlist-monitor.ts` — the daily
  intelligence cron pulls watchlist tickers from this table.
- `lib/agent/tools/place-trade.ts` — references watchlist for context.
- `lib/agent/tools/update-thesis.ts` — references watchlist for context.
- `lib/inngest/functions/daily-run-digest.ts` — the morning email.
- `app/api/intelligence/monitors/route.ts`,
  `app/api/intelligence/health/route.ts` — intelligence dashboard.
- `components/analysts/AnalystDetailClient.tsx` — renders the watchlist
  section on the analyst detail page.

Each one becomes a Thesis query, filtered to status IN ('ACTIVE','WATCHING').

### Specific UI updates

#### Analyst detail page — Watchlist section

`/analysts/[id]` currently calls `getWatchlistItems(analystId)`. Rewrite
to return Thesis rows. Each row needs to render:

- Ticker + logo + current price
- **Direction badge** — LONG (green), SHORT (red), PASS (gray
  "watching"), **PENDING (yellow "awaiting review")**
- Target / stop preview (only for LONG/SHORT)
- Days on watchlist
- Click → opens existing `ThesisSheet` for that thesis

The "Add Stock to Watchlist" button stays. Clicking it still writes a
row, but now the row is a `Thesis(status:'WATCHING', direction:'PENDING')`.
The button could optionally show a small modal: "Adding $X to your
watchlist. Optional: add a one-line reason for the agent to research."

#### Stock detail page — Theses tab

`/stocks/[symbol]` already reads from Thesis. **No change needed.** It
will automatically show PENDING theses alongside LONG/SHORT/PASS.

#### Thesis sheet — open from analyst watchlist

`ThesisSheet` component. Needs to render PENDING theses correctly:

- Header badge: "Awaiting analyst review" instead of "Watching — long"
- Empty state for target/stop/triggers (or hide those sections)
- The "Most recent trigger" section should show the auto-attached
  TIME_ELAPSED trigger that fires the review.
- Activity log shows: "Added to watchlist by [user|builder|editor]" as
  the CREATED row.

#### Run summary card — show added/removed

This is the user's explicit ask. Today `RunSummaryCard` shows
`ranked_picks` (theses researched in the run). It needs to also show:

- **Added to watchlist:** any `ThesisUpdate` rows of `type='CREATED'`
  where the new thesis has `status='WATCHING'` and `direction IN
  ('LONG','SHORT','PENDING')`. Display as: "Added \$NVDA (LONG,
  target $220) — Tech Momentum thesis."
- **Removed from watchlist:** any `ThesisUpdate` rows of
  `type='INVALIDATED' | 'CLOSED'` for previously-WATCHING theses.
  Display: "Removed \$INTC — invalidated (guidance cut)."
- **Researched but passed:** `ThesisUpdate` rows of `type='CREATED'`
  with `direction='PASS'`. Display: "Researched \$AMD — passed (extended,
  no clean setup)." These are the discovery's institutional memory.

`record_run_summary` tool's `ranked_picks` schema may need a new field
for "action_taken" so the agent can categorize per-pick. Or derive it
server-side from the ThesisUpdate rows written during the run (cleaner
— no agent reasoning required).

#### Run detail page — visible action summary

`/runs/[id]` — the run replay UI. Add a top-of-page summary chip row:
"3 added · 1 removed · 4 researched-passed · 2 trades." Sourced from
ThesisUpdate rows scoped to this `runId`.

---

## Agent prompt changes

### Discovery run prompt

`lib/agent/system-prompts/discovery.ts`. Currently says:

> "Mint new theses with status='WATCHING' ... You CANNOT mint PASS
> theses (record_thesis direction=PASS rejected for discovery)."

**Flip this.** PASS theses ARE valid discovery outcomes. The user's
explicit ask:

> "the whole point of discovery ... it should be able to research 5-10
> stocks, write thesis's, and decide 7 of them arent worth watching"

New language:

> "For every candidate you researched, write a thesis. The thesis is
> your institutional memory of the work — whether you decided to track
> it or not.
>
> - **LONG/SHORT WATCHING** — composite ≥ 5, you want to track this and
>   want it on the analyst's watchlist for next week's daily review.
> - **PASS WATCHING** — you researched it and decided NOT to trade today,
>   but the invalidation conditions are concrete enough that you'd
>   reconsider if they flip. Stays on the watchlist as institutional
>   memory.
> - **PASS not minted** — composite < 3 or fundamentally outside your
>   edge. Narrate the pass in the run summary, don't write a thesis
>   row.
>
> Run summary will show three separate buckets: added to watchlist
> (LONG/SHORT), researched-passed (PASS), didn't bother (narrated only)."

Remove the "8 thesis cap" or raise it to ~15 since PASS theses are now
valid output. Real cap is "you researched what you researched; mint a
thesis for each."

Remove the "direction PENDING" instruction here — discovery agents don't
mint PENDING. Only user/builder/editor seeds use PENDING.

### Daily run prompt

`lib/agent/system-prompt.ts`. The Live Theses table already iterates
ACTIVE + WATCHING. Add a section for **PENDING theses** (user-added or
builder-seeded items awaiting first research):

> **PENDING theses — your inbox of names to research.**
> These were added to your watchlist by the user, by the builder when
> you were created, or by your editor chat. Nobody has researched them
> yet. For each PENDING thesis on the Live Theses table:
>
> 1. Call `get_stock_data` on the ticker.
> 2. Score on the 4-dim composite.
> 3. Call `update_thesis(thesis_id, ...)` to convert the PENDING into
>    a real thesis — pick direction (LONG / SHORT / PASS), set
>    target_price + stop_loss + entry_price (if LONG/SHORT), fill in
>    core_belief + key_assumptions + invalidation_conditions.
> 4. The auto-attached TIME_ELAPSED "PENDING awaiting research" trigger
>    is automatically dropped when direction flips off PENDING.

The current daily-run prompt's "Watchlist (legacy)" section
(`system-prompt.ts:294`) — DELETE entirely. The Live Theses table is
now the only source.

### Builder + Editor prompts

`lib/agent/modes.ts` BUILDER_SYSTEM_PROMPT and `buildEditorSystemPrompt`.
Currently say "Watchlist tickers in suggest_config MUST come from
discover_signals_for_fence.tickerFrequency."

This stays — the constraint on WHERE watchlist tickers come from is
correct. What changes is the *downstream* — the analyst-create
transaction (`createAnalystFromConfig`) now writes Thesis rows, not
AnalystWatchlistItem rows. **The builder/editor prompts don't need to
change.** They still say "watchlist: [...]"; the action layer handles
translation to PENDING theses.

### `manage_watchlist` tool

If we go with Option (b) — keep the tool as a wrapper — the agent
prompt language stays "call manage_watchlist with action: ADD." The
prompt doesn't need to know about Thesis schema. The tool implementation
does the translation.

If we go with Option (a) — delete the tool — every prompt that mentions
manage_watchlist needs updating to call record_thesis directly.

**Recommendation: (b).** Smaller prompt change.

---

## Run summary derivation

The run summary card today is hand-built by the agent via
`record_run_summary`. The "added/removed to watchlist" buckets the user
wants should NOT depend on the agent remembering to populate them
correctly. Derive server-side.

After `record_run_summary` lands, server-side enrichment:

```sql
-- Added to watchlist this run
SELECT ticker, direction, target_price
FROM "Thesis" t
JOIN "ThesisUpdate" tu ON tu."thesisId" = t.id
WHERE tu."runId" = $runId
  AND tu.type = 'CREATED'
  AND t.status = 'WATCHING'
  AND t.direction IN ('LONG','SHORT','PENDING');

-- Removed from watchlist this run
SELECT t.ticker, tu.summary
FROM "Thesis" t
JOIN "ThesisUpdate" tu ON tu."thesisId" = t.id
WHERE tu."runId" = $runId
  AND tu.type IN ('INVALIDATED','CLOSED','SUPERSEDED')
  AND t.status IN ('INVALIDATED','CLOSED','SUPERSEDED');

-- Researched-passed
SELECT ticker
FROM "Thesis" t
JOIN "ThesisUpdate" tu ON tu."thesisId" = t.id
WHERE tu."runId" = $runId
  AND tu.type = 'CREATED'
  AND t.direction = 'PASS';
```

Render these three buckets in the run summary card and the run feed
preview. No agent prompt work needed for this.

---

## Manage_watchlist tool — detailed redesign

If keeping as a wrapper (Option b):

```ts
// New manage_watchlist semantics

action: "ADD"
  args: { ticker, reason, direction?: "PENDING" | "LONG" | "SHORT",
          conviction?: number }
  behavior:
    - If direction omitted → defaults to PENDING (agent wants to track
      but hasn't done full research).
    - If direction = LONG/SHORT → agent already has a view, pass through
      to record_thesis with the structural fields (target/stop/etc.)
      required.
    - Internally: prisma.thesis.create(...) + writeThesisUpdate(CREATED)

action: "REMOVE"
  args: { ticker, reason }
  behavior:
    - Look up active Thesis for (analystId, ticker).
    - prisma.thesis.update(status='INVALIDATED', invalidReason=reason)
    - writeThesisUpdate(INVALIDATED, ...)

action: "UPDATE"
  args: { ticker, ...patch fields }
  behavior:
    - Pure wrapper around update_thesis on the matched thesis.
```

The `triggerCondition` field that manage_watchlist accepts today
becomes either:
- Discarded (the agent should call record_thesis with structured
  triggers if it wants them).
- Mapped to a single REVIEW trigger on the new thesis.

Pick the simpler path: discard. If the agent wants triggers, call
record_thesis directly with the structured triggers[] field.

---

## Migration sequencing

Three PRs, shipped in order. Each leaves the system working.

### PR 1 — Schema + backfill + writer dual-writes

- Add `PENDING` to direction enum, new `source_kind` values, relax
  PENDING field requirements.
- Migration: backfill orphaned `AnalystWatchlistItem` rows as PENDING
  theses; verify zero drift.
- **Every writer dual-writes both stores** during this transition:
  `addWatchlistItem`, `createAnalystFromConfig`, the editor update,
  `manage_watchlist` (already does), and `record_thesis` (NEW —
  upsert an AnalystWatchlistItem mirror).
- **No reader changes yet.**
- Result: both stores in lockstep going forward; the drift problem
  stops compounding.

### PR 2 — Reader migration

- Every read site flips from `AnalystWatchlistItem` to Thesis-with-
  status-IN.
- `getWatchlistItems`, `RunInput.watchlist`, intelligence cron, daily
  email, intelligence dashboard, analyst page UI.
- Render PENDING distinctly in the UI (yellow badge "awaiting review").
- Run summary card gets the three-bucket enrichment.
- Default trigger for PENDING (TIME_ELAPSED day=0) attaches.
- Daily-run prompt gets the PENDING section; discovery prompt allows
  PASS theses; "Watchlist (legacy)" section deleted from daily-run
  prompt.
- Result: UI and agent both read the unified store.

### PR 3 — Drop the table

- Remove all dual-writes from writers.
- Drop `AnalystWatchlistItem` table + indexes.
- Drop `AgentConfig.watchlist: String[]` legacy array.
- Delete `syncLegacyWatchlist` helper.
- Result: single store, no legacy code paths.

---

## Open questions to confirm before implementing

1. **`Thesis.researchRunId` FK constraint.** Every thesis row must
   reference a run. For user-added (`addWatchlistItem` from the UI),
   there's no natural run context. Two options:
   - (a) Create a synthetic long-lived `ResearchRun` per analyst with
     `source='USER'`, `mode='MANUAL'`, that all manually-added theses
     anchor to.
   - (b) Make `researchRunId` nullable on Thesis (schema change).
   Recommendation: (a) — preserves the FK invariant.

2. **PASS WATCHING vs PASS not-minted.** The discovery prompt rewrite
   distinguishes PASS theses (institutional memory, on the watchlist)
   from PASS that's narrated-only (didn't bother). Where's the line?
   Proposal: composite ≥ 3 + concrete invalidation conditions = mint
   the PASS thesis. Composite < 3 = narrate only.

3. **Do PENDING theses count against the analyst's slot budget?** The
   agent has `maxOpenPositions`. PENDING is awaiting research, not a
   trade — so no. But what about the watchlist size? Today there's no
   cap. Continue with no cap, or add `maxWatchlistSize`?

4. **Editor remove → INVALIDATED or CLOSED?** When the editor chat
   removes a watchlist name, the corresponding thesis transitions to
   what? INVALIDATED implies "thesis was proven wrong"; CLOSED implies
   "we exited a position." Neither fits "user removed from watchlist."
   Proposal: add a new status value `REMOVED` or `DEPRECATED`, OR use
   INVALIDATED with invalidReason="Removed by user."

5. **Manual UI Add flow — does it open a thesis modal?** When the user
   clicks "Add Stock to Watchlist" today, it's a single-click action.
   In the new world, should it stay single-click (just creates PENDING
   thesis) or open a small modal asking for direction/reason? Proposal:
   stay single-click. The agent will research on next run.

6. **`AnalystWatchlistItem.thesisDirection` field on the legacy table.**
   It carried a direction hint for the watchlist item. After migration,
   PENDING theses don't have a direction — but the user might want to
   say "I'm adding NVDA LONG" up front. Proposal: support optional
   `direction` arg on `addWatchlistItem` — if provided, mint as
   `direction=LONG/SHORT` with empty target/stop awaiting research; if
   omitted, mint as PENDING.

7. **`Thesis.parentThesisId` chain.** When user removes a watchlist
   item and re-adds it later, do those theses chain (parent/superseded)?
   Proposal: yes, follow the existing same-ticker chaining rule. A
   re-add after a previous INVALIDATED reads as a fresh PENDING with
   parentThesisId set to the previous invalidated thesis.

8. **Intelligence pipeline impact.** `portfolio-watchlist-monitor.ts`
   reads watchlist tickers to fan out Sonar searches. After migration,
   it reads from Thesis. PENDING theses should also be monitored (the
   agent wants per-ticker news on names it's about to research). LONG
   and SHORT WATCHING also monitored as today. PASS WATCHING — also
   monitor? Probably yes; PASS theses watch for invalidation flips.

---

## Implementation prompt for a fresh session

Copy-paste into a new Claude session:

> Read this entire file: `docs/WATCHLIST_COLLAPSE_PLAN.md`. Then read
> the current implementation:
> - `lib/actions/watchlist.actions.ts`
> - `lib/agent/tools/manage-watchlist.ts`
> - `lib/agent/tools/record-thesis.ts`
> - `lib/actions/analyst.actions.ts` (the `createAnalystFromConfig` +
>   analyst-update transactions)
> - `lib/agent/run-input.ts` (the watchlist section)
> - `lib/agent/system-prompts/discovery.ts`
> - `lib/agent/system-prompt.ts` (the Live Theses + Watchlist sections)
> - `components/analysts/AnalystDetailClient.tsx` (the watchlist render)
> - `prisma/schema.prisma` (Thesis + AnalystWatchlistItem models)
>
> Then resolve the 8 open questions in
> `docs/WATCHLIST_COLLAPSE_PLAN.md` § "Open questions to confirm" by
> asking the user. Don't decide unilaterally.
>
> Then implement PR 1 — Schema + backfill + writer dual-writes.
> Verify with a SQL query showing zero drift before merging.
>
> DO NOT skip to PR 2 or PR 3 in the same PR. Each PR ships
> independently and leaves the system working.
>
> Frontend updates in PR 2 must handle the user's stated journey:
> "I'm supposed to be able to see watching stocks on each analyst.
> Click to go to any stocks page and see any thesis's for it below,
> click the thesis sheet from there." Verify this journey works
> end-to-end in PR 2 before merging.
>
> Run summaries (discovery + daily) MUST surface three buckets via
> server-side derivation from ThesisUpdate rows: added to watchlist,
> removed from watchlist, researched-passed. Do not rely on the agent
> remembering to populate them.
>
> The discovery prompt's "never PASS" rule is wrong. PASS theses ARE
> valid discovery output (institutional memory). Flip the prompt in
> PR 2.

---

## Pre-PR-1 sanity checks

Before opening PR 1, the implementer should:

1. Run the drift query at the top of this doc — confirm the 13 + 5 = 18
   drift rows (the count may have grown since 2026-05-13).
2. Confirm with the user the resolution to the 8 open questions.
3. Confirm with the user whether PASS WATCHING (FIVN/MSFT in the
   2026-05-13 audit) should stay on the watchlist or disappear after
   migration. Earlier conversation suggested they should stay (matches
   the FIVN thesis sheet's "Watching — previously rejected" framing).
4. Confirm the synthetic `ResearchRun` shape for manual user adds.

Drafted 2026-05-13. Not implemented.
