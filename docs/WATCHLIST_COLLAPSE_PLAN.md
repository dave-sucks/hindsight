# WATCHLIST_COLLAPSE_PLAN.md

> **Status: IMPLEMENTED 2026-05-13** (single-PR collapse, not the
> originally-planned 3-PR phasing). This doc is kept as historical
> context — the spec, the open questions, the firm-pass three-layer
> audit. For the **live thesis-system reference** (state machine,
> lifecycle scenarios, producers, consumers, run-summary derivation),
> go to [`THESIS_ARCHITECTURE.md`](./THESIS_ARCHITECTURE.md). That doc
> supersedes this one for day-to-day use.
>
> **What shipped:**
> - `AnalystWatchlistItem` table dropped.
> - `AgentConfig.watchlist` String[] dropped.
> - `manage_watchlist` tool deleted (24 tools, down from 25).
> - `syncLegacyWatchlist` + `graduateWatchlistItem` deleted.
> - `Thesis.direction = 'PENDING'` added for user/builder/editor seeds.
> - `Thesis.status = 'ARCHIVED'` added for terminal-without-trade.
> - Legal `(direction, status)` pair validation in `record_thesis` /
>   `update_thesis`.
> - `update_thesis` gained `change_status: 'ARCHIVED'` path.
> - `place_trade` writes a `STATUS_CHANGED` audit row on WATCHING → ACTIVE.
> - `get_theses.needsAction` surfaces PENDING via `REVIEW_DUE` with
>   `pendingFirstReview: true`.
> - Migration backfills orphan watchlist rows + flips existing PASS
>   WATCHING to PASS ARCHIVED, verifies zero drift, then drops the table.
>
> **Original spec follows — kept for historical reference only.**

---

# Original spec (historical)
>
> **Lifecycle update 2026-05-13:** PASS is always terminal. The plan's
> earlier "PASS WATCHING for institutional memory" framing was wrong —
> it conflated two meanings of PASS and created the same ambiguity
> we're trying to eliminate. New status `ARCHIVED` introduced for
> terminal-without-trade. See "Lifecycle and state machine" below.
>
> **Architectural alignment 2026-05-13:** firm pass to make this plan
> consistent with `MORNING_RUN_V2_DESIGN.md`'s three-layer principle —
> Layer 1 tool gates, Layer 2 tool result shape, Layer 3 prompt as
> judgment only. Every lifecycle invariant in this plan is enforced
> tool-side or schema-side. The agent prompt describes WHAT and WHY,
> never HOW. Specifically:
>
> - PENDING review cadence uses the existing `nextReviewAt` + horizon
>   pipeline, NOT a new day=0 TIME_ELAPSED trigger. No parallel logic.
> - Direction flips are one atomic tool call (`record_thesis` with
>   `supersedes` arg), not two prompt-coordinated calls.
> - Trigger lifecycle is automatic in `record_thesis` / `update_thesis`
>   based on (direction, status) transitions. Agent never manages triggers
>   for status changes.
> - PASS theses reject `triggers[]` at write — schema-level rejection,
>   not prompt instruction.
> - `manage_watchlist` is DELETED (Option a). With one store, the
>   wrapper adds no value; Discovery uses `record_thesis` / `update_thesis`
>   directly. Daily Run's allowlist (which already excludes both per
>   MORNING_RUN_V2 Fix #5) is unchanged.
>
> **Revises two THESIS_ARCHITECTURE §9 "intentionally not done" items:**
> "Did not kill PASS direction" and "Did not collapse manage_watchlist."
> Both are revisited here as part of one coherent simplification.

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

## Lifecycle and state machine

Read this section before touching anything else. The lifecycle is the
contract every writer, every prompt, and every read query is enforcing.

### Direction (analyst's view)

| Direction | Meaning |
|---|---|
| `PENDING` | Seed state. User/builder/editor added the ticker; nobody has researched it yet. |
| `LONG`    | Committed bullish view, with target/stop/triggers. |
| `SHORT`   | Committed bearish view, with target/stop/triggers. |
| `PASS`    | Researched, decided not to take a tradeable view. **Terminal.** |

### Status (what the system is doing)

| Status | Meaning | On watchlist? |
|---|---|---|
| `WATCHING`     | Active tracking; triggers maintained; reviewed on cadence. | **Yes** |
| `ACTIVE`       | Position open via Alpaca. | No — shown in Positions |
| `CLOSED`       | Position was opened and closed. Terminal. | No |
| `INVALIDATED`  | Held a view, view was disproven. Terminal. | No |
| `ARCHIVED`     | Terminal without trade or view-invalidation. Used for: PASS at write, manual removal via UI, removal via editor chat. | No |
| `SUPERSEDED`   | Replaced by a newer thesis on same ticker (direction flip on a live name). Terminal. | No |

### Valid (direction, status) pairs

```
(PENDING, WATCHING)                    seed
(LONG,    WATCHING|ACTIVE|CLOSED|INVALIDATED|ARCHIVED|SUPERSEDED)
(SHORT,   WATCHING|ACTIVE|CLOSED|INVALIDATED|ARCHIVED|SUPERSEDED)
(PASS,    ARCHIVED)                    terminal at write
```

Anything else is a write-time error.

### State machine

```
PENDING + WATCHING  (seed — user/builder/editor add)
  │
  ├─→ LONG  + WATCHING   (agent commits bullish, target/stop/triggers set)
  ├─→ SHORT + WATCHING   (agent commits bearish, target/stop/triggers set)
  └─→ PASS  + ARCHIVED   (agent researched, declined)  [terminal]


LONG/SHORT + WATCHING   (on the watchlist, has triggers)
  │
  ├─→ LONG/SHORT + ACTIVE        (place_trade fires)
  ├─→ LONG/SHORT + INVALIDATED   (view disproven — guidance cut, miss, breakdown)  [terminal]
  ├─→ LONG/SHORT + ARCHIVED      (manually removed via UI/editor chat)             [terminal]
  └─→ LONG/SHORT + SUPERSEDED    (direction flip; new thesis chains via parentThesisId)  [terminal]


LONG/SHORT + ACTIVE   (position open)
  │
  └─→ LONG/SHORT + CLOSED        (close_position fires — manual, agent, or stop/target)  [terminal]


PASS + ARCHIVED   [terminal at write — no transitions out]
  When ticker re-encountered later, the agent reads the prior PASS via
  get_theses(include_history:true) and mints a fresh thesis chained via
  parentThesisId. The old PASS stays ARCHIVED — it's history, not waking up.
```

### Entry points

Where a Thesis row first comes into being:

| Entry point | Initial direction | Initial status | source_kind | Tool |
|---|---|---|---|---|
| UI "Add Stock to Watchlist" | PENDING | WATCHING | `USER_ADDED` | `addWatchlistItem` server action → `prisma.thesis.create` |
| Builder analyst-create transaction | PENDING | WATCHING | `BUILDER_SEED` | `createAnalystFromConfig` → `prisma.thesis.create` |
| Editor chat watchlist add | PENDING | WATCHING | `EDITOR_SEED` | analyst-update path → `prisma.thesis.create` |
| Discovery `record_thesis` — kept (net-new) | LONG / SHORT | WATCHING | `ROUTED_SIGNAL` / `WEB_SEARCH` | `record_thesis` |
| Discovery `record_thesis` — passed (net-new) | PASS | ARCHIVED | `ROUTED_SIGNAL` / `WEB_SEARCH` | `record_thesis` |
| Discovery `record_thesis` — direction flip on re-encounter | LONG / SHORT | WATCHING | `ROUTED_SIGNAL` | `record_thesis` with `supersedes: <oldId>` (atomic) |

**Per MORNING_RUN_V2 Fix #5, only Discovery has `record_thesis` in its
allowlist.** Daily Run and Tactical Run BOTH exclude it. That means:

- **Daily Run can't mint new coverage** (correct — it manages the book).
- **Daily Run can't direction-flip a live thesis.** If the agent concludes
  NVDA's bull thesis is dead, Daily Run does `update_thesis(change_status:
  'INVALIDATED')` — NVDA falls off the watchlist. The fresh SHORT view
  comes when Sunday Discovery re-encounters $NVDA via a signal and mints
  the new thesis with `supersedes` chained to the INVALIDATED parent.
- **Tactical Run can't direction-flip either** (same exclusion). If a
  fired ENTER trigger re-validates as "actually no, view broken,"
  Tactical does `update_thesis(change_status: 'INVALIDATED')` and walks
  away. The flip happens next Discovery cycle if at all.

`manage_watchlist` is deleted, so it doesn't appear here. The
analyst-mode separation is a hard architectural rule enforced by tool
allowlists in `lib/agent/modes.ts`, not by prompt prose.

### End-to-end lifecycle, one ticker at a time

**Scenario A — Discovery picks up $NVDA, agent likes it.**
1. Sunday 9am cron. Agent calls `read_signals` → $NVDA appears.
2. Research: `get_stock_data`, `get_market_context`, optional `web_search`.
3. Score on 4-dim composite → 6.5. Setup is clean.
4. `record_thesis(ticker: NVDA, direction: LONG, status: WATCHING, target_price: 220, stop_loss: 180, entry_price: 195, triggers: [...])`
5. Thesis row created. ThesisUpdate `CREATED`. Now on the watchlist.
6. Run summary bucket: **Added to watchlist**.

**Scenario B — Discovery picks up $AMD, agent passes.**
1. Same setup. Research happens.
2. Score 3.5. Extended, no clean entry.
3. `record_thesis(ticker: AMD, direction: PASS, status: ARCHIVED, reasoning_summary: "Extended past entry, RSI 78, no edge here", invalidation_conditions: "Pullback to 50d MA with volume reset")`
4. Thesis row terminal at write. ThesisUpdate `CREATED` with type-tag derived. **Not on the watchlist.** Visible on `/stocks/AMD` as institutional memory.
5. Run summary bucket: **Researched, passed**.
6. Three weeks later, $AMD hits a signal. Agent calls `get_theses(ticker: AMD, include_history: true)` → reads prior PASS reasoning. Conditions changed. Mints fresh `LONG + WATCHING` with `parentThesisId` chained to the ARCHIVED PASS.

**Scenario C — User manually adds $TSLA to an analyst's watchlist.**
1. User clicks "Add Stock to Watchlist" on `/analysts/[id]`.
2. `addWatchlistItem` mints `Thesis(direction: PENDING, status: WATCHING, source_kind: USER_ADDED)`.
3. Auto-attached `TIME_ELAPSED` day=0 REVIEW trigger.
4. Next morning's 8am daily run: trigger fires. Agent sees PENDING + WATCHING in `get_theses`.
5. Agent researches: `get_stock_data`, scoring, etc.
6. `update_thesis(thesis_id, direction: LONG, target_price: ..., stop_loss: ..., triggers: [...])` — flips PENDING to a real LONG thesis. Day=0 trigger replaced by entry triggers.
   - OR `update_thesis(thesis_id, direction: PASS, change_status: ARCHIVED)` — analyst declined coverage. Off the watchlist. User sees this in the run summary's *Removed/Researched-passed* bucket.

**Scenario D — Daily run on cadence, $NVDA (LONG WATCHING) triggers an entry.**
1. Hourly trigger evaluator fires; entry trigger matches.
2. `app/thesis.trigger.fired` → tactical run wakes.
3. Tactical agent verifies setup with fresh data, calls `place_trade(thesis_id: nvda_id, ...)`.
4. Alpaca order; Position row created.
5. Thesis WATCHING → ACTIVE. ThesisUpdate `PROMOTED`.
6. Run summary bucket: **Promoted**.

**Scenario E — Position stops out.**
1. price-monitor hourly cron sees NVDA hit stop.
2. `close_position(thesis_id: nvda_id, reason: STOP_HIT)` → Alpaca close order.
3. Position closes. Thesis ACTIVE → CLOSED. ThesisUpdate `CLOSED`.
4. trade-evaluator cron runs later, fills `position.agentEvaluation`.
5. Run summary bucket (for whatever run triggered the close): **Closed**.

**Scenario F — Daily run finds the $NVDA view broken before entry.**
1. NVDA was LONG WATCHING. Earnings miss + guidance cut overnight.
2. Daily run reviews the thesis. Invalidation conditions tripped.
3. `update_thesis(thesis_id, change_status: INVALIDATED, invalidReason: "Guidance cut; deceleration confirmed")`.
4. Thesis WATCHING → INVALIDATED. ThesisUpdate `INVALIDATED`. Off the watchlist.
5. Run summary bucket: **Removed**.

**Scenario G — User removes $INTC from watchlist via editor chat.**
1. User edits analyst, removes INTC from the suggested watchlist.
2. Editor's analyst-update path: `update_thesis(thesis_id, change_status: ARCHIVED, summary: "Removed via editor chat")`.
3. Thesis WATCHING → ARCHIVED. ThesisUpdate `ARCHIVED`.
4. Off the watchlist. INTC's prior thesis still visible on `/stocks/INTC` for history.

**Scenario H — Direction flip on a live name ($NVDA was LONG, view breaks; later a fresh SHORT view emerges).**

Two stages, in different runs, because mode separation forbids minting in Daily/Tactical:

*Stage 1 — Daily or Tactical Run (any day): view breaks.*
1. Agent reviews $NVDA. Evidence says the bull thesis is dead.
2. `update_thesis(old_nvda_id, change_status: 'INVALIDATED', invalidReason: "Guidance cut + multiple compression")`.
3. Old thesis WATCHING → INVALIDATED. Off the watchlist. Run summary bucket: **Removed**.

*Stage 2 — Sunday Discovery (later): SHORT view emerges.*
1. Discovery re-encounters $NVDA via a signal. Agent reads the prior INVALIDATED thesis via `get_theses(include_history)`.
2. Researches the new SHORT setup.
3. `record_thesis(ticker: 'NVDA', direction: 'SHORT', status: 'WATCHING', supersedes: old_nvda_id, ...)` — ONE atomic tool call. Inside the tool's Prisma transaction: old INVALIDATED thesis gets `parentThesisId` chain set on the new row, new thesis created with full LONG/SHORT WATCHING requirements (target/stop/triggers/belief/horizon). Run summary bucket (in that discovery run): **Added**.

The `supersedes` arg is an *atomic mint chained to a prior terminal row* — not an active→active flip in one step. That separation is enforced by the mode allowlists, which is the right place for it.

If the agent ever needs to truly flip an active position direction same-day (rare — usually means closing first), the path is: Daily Run `close_position` (ACTIVE → CLOSED) + `update_thesis(change_status: 'INVALIDATED')`, then wait for Discovery to mint the reverse.

### Reads (where each view comes from)

- **Analyst watchlist** (`/analysts/[id]` sidebar): `Thesis WHERE agentConfigId = X AND status = 'WATCHING'`. Includes PENDING + LONG WATCHING + SHORT WATCHING. Excludes ACTIVE (shown in Positions) and all terminal states.
- **Stock detail** (`/stocks/[symbol]`): `Thesis WHERE ticker = X` — no status filter. Shows everything from every analyst.
- **Analyst Positions tab**: `Thesis WHERE agentConfigId = X AND status = 'ACTIVE'`, joined to Position.

### Run summary — five derived buckets

All five derived server-side from `ThesisUpdate WHERE runId = $runId`. No agent prompt work required.

| Bucket | Filter |
|---|---|
| **Added to watchlist**       | `ThesisUpdate.type='CREATED'` AND `Thesis.status='WATCHING'` AND `direction IN (LONG, SHORT, PENDING)` |
| **Researched, passed**       | `ThesisUpdate.type='CREATED'` AND `Thesis.direction='PASS'` AND `Thesis.status='ARCHIVED'` |
| **Promoted (now active)**    | `ThesisUpdate.type='PROMOTED'` AND `Thesis.status='ACTIVE'` |
| **Removed from watchlist**   | `ThesisUpdate.type IN ('INVALIDATED','ARCHIVED','SUPERSEDED')` (without an accompanying PROMOTED/CLOSED in the same run) |
| **Closed positions**         | `ThesisUpdate.type='CLOSED'` AND `Thesis.status='CLOSED'` |

Discovery runs typically only populate Added + Researched-passed.
Daily and tactical runs can populate any of the five.

### ThesisUpdate types (audit log)

| Type | When written |
|---|---|
| `CREATED`     | `record_thesis` mints a new row (any direction). |
| `UPDATED`     | `update_thesis` patches fields (target, stop, triggers, reasoning). |
| `REVIEWED`    | `update_thesis` with no field changes — just acknowledged on cadence. |
| `PROMOTED`    | `place_trade` fires; thesis status flips WATCHING → ACTIVE. |
| `INVALIDATED` | `update_thesis(change_status='INVALIDATED')` — view disproven. |
| `ARCHIVED`    | `update_thesis(change_status='ARCHIVED')` — manual removal, OR PASS minted (CREATED + ARCHIVED). |
| `CLOSED`      | `close_position` fires; thesis status flips ACTIVE → CLOSED. |
| `SUPERSEDED`  | `update_thesis(change_status='SUPERSEDED')` — direction flip; new thesis follows. |

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

### 2. Add `ARCHIVED` to the status enum

`Thesis.status` currently: `ACTIVE | WATCHING | CLOSED | INVALIDATED | SUPERSEDED`.
Add `ARCHIVED` — terminal-without-trade-or-invalidation. Used for:
- PASS theses at write (terminal at write time).
- Manual UI removal from watchlist.
- Editor-chat removal from watchlist.

Reasoning: `INVALIDATED` implies the view was held and disproven; `CLOSED`
implies a position existed; neither fits "researched and declined" or
"user removed from watchlist." `ARCHIVED` is the right semantic for both.

### 3. Add new `source_kind` values

`source_kind` enum currently: `ROUTED_SIGNAL | WEB_SEARCH | WATCHLIST_REVIEW | POSITION_REVIEW`.
Add: `USER_ADDED | BUILDER_SEED | EDITOR_SEED`.

`USER_ADDED` = manual UI "Add Stock to Watchlist" click.
`BUILDER_SEED` = analyst creation transaction seeded this ticker.
`EDITOR_SEED` = analyst-edit chat session seeded this ticker.

### 4. Add new `ThesisUpdate.type` values

Current: `CREATED | UPDATED | REVIEWED | INVALIDATED | CLOSED`.
Add: `PROMOTED` (WATCHING → ACTIVE, written by `place_trade`),
`ARCHIVED` (manual remove, or written alongside CREATED for PASS),
`SUPERSEDED` (direction flip, written before the new thesis is minted).

The run-summary derivation queries depend on these types being clean
and 1:1 with state transitions.

### 5. (Optional) Add `pendingReason: String?` to Thesis

For PENDING theses, store the user's stated reason for adding
(`"Added manually from screener"`, `"Builder-seeded — fits Tech Momentum
edge"`, etc.). When the agent later flips PENDING → LONG/SHORT/PASS,
this can be folded into `reasoning_summary`. If we feel reasoning_summary
+ source_rationale already cover this, skip this field.

### 6. Schema constraints to relax for PENDING

Current `record_thesis` rejects directional WATCHING theses without
`target_price` (the ENTER trigger needs it). PENDING theses have no
target_price yet — they're awaiting research. Carve out: PENDING is
allowed to land without target/entry/stop/triggers; the rejection
gate only applies to LONG/SHORT.

Same for `core_belief`, `key_assumptions`, `invalidation_conditions` —
required for LONG/SHORT WATCHING, exempted for PENDING (awaiting
research) and PASS ARCHIVED (terminal, agent must still write
`reasoning_summary` and ideally `invalidation_conditions` so a future
look can decide if conditions changed).

### 7. Write-time validation: legal (direction, status) pairs

The `record_thesis` and `update_thesis` tools should reject any write
where `(direction, status)` is not in the valid pair table above.
Specifically:
- `PENDING` → only `WATCHING` allowed.
- `PASS` → only `ARCHIVED` allowed.
- `LONG`/`SHORT` → any non-`PENDING`-only status allowed.

Enforce in the tool execute fn; surface a clear error if violated.

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
- `horizon = null` (no horizon yet — agent commits to one on first research)
- `source_kind = 'USER_ADDED' | 'BUILDER_SEED'` (mapped from
  `AnalystWatchlistItem.addedBy`: `'USER'` → `USER_ADDED`,
  `'BUILDER'` → `BUILDER_SEED`)
- `source_rationale = AnalystWatchlistItem.reason`
- `reasoning_summary = AnalystWatchlistItem.reason || "Backfilled from watchlist"`
- No entry/target/stop/triggers (PENDING is allowed to land bare)
- `nextReviewAt = createdAt` (set to "now" so the existing REVIEW_DUE
  pipeline picks it up on the next daily run via `needsAction`). NO
  special TIME_ELAPSED day=0 trigger — that would be parallel logic
  per the three-layer principle.

Also write a `ThesisUpdate` row with `type = 'CREATED'` so the activity
log reflects the backfill.

### Step 1b — Existing PASS WATCHING rows in the Thesis table

Pre-migration, the Thesis table already has rows with
`direction='PASS'` + `status='WATCHING'` (e.g. FIVN and MSFT in the
2026-05-13 audit). Under the new model these are an illegal pair.

Migration must transition every existing PASS WATCHING row to
`status='ARCHIVED'` in-place. Also write a `ThesisUpdate` row with
`type='ARCHIVED'` and `summary='Backfill: PASS theses are terminal under
new lifecycle model'`. These theses then live in the same way as any
other ARCHIVED PASS — invisible on the watchlist, visible on the stock
detail page, readable by the agent via `get_theses(include_history)`.

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
*adds* a name, mint a PENDING WATCHING thesis. If the editor *removes*
a name, call `update_thesis(change_status: 'ARCHIVED')` with rationale
"Removed from watchlist via editor chat."

**Not** INVALIDATED — INVALIDATED reflects a view being disproven by
evidence. User-driven removal is "no longer want to track," which is
ARCHIVED. INVALIDATED stays reserved for evidence-driven view-breaks
(guidance cut, miss, breakdown).

### 4. `manage_watchlist` agent tool — DELETED

`lib/agent/tools/manage-watchlist.ts` is **deleted entirely** (Option a
from the earlier draft). Rationale:

- With one store, the wrapper-over-record_thesis pattern adds indirection
  without value. Every "ADD to watchlist" was always going to be
  `record_thesis(status='WATCHING')`; every "REMOVE" was always going
  to be `update_thesis(change_status='ARCHIVED')`. Renaming those calls
  through a wrapper just teaches the agent two names for one operation.
- Discovery's allowlist already includes both `record_thesis` and
  `update_thesis`. No prompt-level capability is lost.
- Daily Run's allowlist (per MORNING_RUN_V2 Fix #5) already excludes
  both `record_thesis` and `manage_watchlist`. Deleting the latter
  doesn't change Daily Run's behavior.
- Per the three-layer principle: the tool surface should be a clean
  set of primitives, not aliases for the same primitive.

Files removed:
- `lib/agent/tools/manage-watchlist.ts`
- Tool registration in `lib/agent/tools/index.ts`
- Mode allowlist entries in `lib/agent/modes.ts`

The Discovery prompt's existing "call manage_watchlist with action: ADD"
language is rewritten to "call record_thesis with status='WATCHING'"
(see Discovery prompt section below).

The agent-tool COUNT in CLAUDE.md drops from 19 to 18.

### 5. `record_thesis` itself

`lib/agent/tools/record-thesis.ts`. **No write to AnalystWatchlistItem
needed (table is gone).** The existing flow stays, but with these
changes:

**Validate (direction, status) pairs at write time.** Reject anything
not in the legal-pairs table from the Lifecycle section above. Specifically:
- `PENDING` → only `WATCHING`.
- `PASS` → only `ARCHIVED` (PASS WATCHING is no longer legal — PASS is
  terminal at write).
- `LONG`/`SHORT` → any non-`PENDING`-only status.

**Relax field requirements per (direction, status):**
- `PENDING + WATCHING` — no target/stop/entry/triggers/core_belief/key_assumptions/
  invalidation_conditions/horizon required. Those become required when
  `update_thesis` later promotes PENDING → LONG/SHORT.
- `LONG + WATCHING` / `SHORT + WATCHING` — target_price, stop_loss,
  entry_price, triggers[], core_belief, key_assumptions, invalidation_conditions,
  horizon all required (unchanged from today). For horizon=CATALYST
  also `catalyst_date`; for horizon=TRADE also `max_hold_days`
  (unchanged from today).
- `PASS + ARCHIVED` — `reasoning_summary` required AND `invalidation_conditions`
  REQUIRED (≥1, vs ≥2 for LONG/SHORT). Rationale: a PASS thesis is
  institutional memory; the *value* of the memory is "what would change
  my mind." A PASS without invalidation_conditions is unreadable to a
  future look. No target/stop/entry/triggers (terminal, never entered).
  Triggers[] is rejected at write (§6c above).

**ENTER-trigger guard** carve-out: the existing guard requires LONG/SHORT
WATCHING theses to carry at least one ENTER trigger. Carve out PENDING
(no view yet → no ENTER predicate possible) and PASS (terminal).

**Cross-analyst overlap guard** still applies (no two analysts holding
the same WATCHING + LONG/SHORT thesis on the same ticker — PENDING is
exempt since it's not a committed view, PASS is exempt since it's terminal).

**Provenance gate** still applies (`source_kind` required; the new
`USER_ADDED`/`BUILDER_SEED`/`EDITOR_SEED` satisfy it).

### 5b. `record_thesis` gains a `supersedes` arg for atomic direction flips

Today a direction flip on a live name requires two coordinated tool
calls: `update_thesis(change_status: 'SUPERSEDED')` on the old, then
`record_thesis(parentThesisId: ...)` for the new. Agent-coordinated
atomicity is exactly the kind of prompt-managed brittleness this plan
is removing.

Add `supersedes?: string` arg to `record_thesis`. When provided:
1. Look up the prior thesis. Validate: belongs to this analyst, same
   ticker, status IN ('WATCHING','ACTIVE'). Reject otherwise.
2. In a single Prisma transaction:
   - Mark prior thesis `status='SUPERSEDED'`, write `ThesisUpdate(type='SUPERSEDED')`.
   - Create new thesis with `parentThesisId = prior.id`, status as
     specified (WATCHING typically), all standard validation gates.
   - Write `ThesisUpdate(type='CREATED')` for the new row.
3. If validation fails on either side, the transaction rolls back. Old
   thesis stays live; no orphan SUPERSEDED.

The agent's prompt then says only: "to flip direction, call record_thesis
with supersedes=<old_id> and the new direction." One tool call. The
atomicity guarantee is schema-side.

### 6. PENDING review cadence — use existing `nextReviewAt` pipeline

**Do NOT add a special TIME_ELAPSED day=0 trigger.** That would be
parallel logic. The existing system already has:
- `nextReviewAt` field on Thesis (horizon-derived)
- `needsAction.REVIEW_DUE` kind in `lib/agent/needs-action.ts`
  (MORNING_RUN_V2 Fix #2)
- Horizon-keyed default cadence in `lib/agent/horizon-policy.ts`

PENDING uses this pipeline directly:
- At write time: `nextReviewAt = createdAt` (immediate). No horizon set
  yet (PENDING hasn't been researched; horizon is the agent's commitment
  to a hold style, which requires a view).
- `needsAction` computes `REVIEW_DUE` when `nextReviewAt < now AND
  direction = 'PENDING'` (special case — for PENDING, REVIEW_DUE means
  "needs first research," not "scheduled review").
- No trigger row needed. The agent sees PENDING + REVIEW_DUE through
  `get_theses` and acts.

This is consistent with the principle: don't invent new primitives when
the existing primitive does the job. The TIME_ELAPSED-day=0 approach
was bug-shaped — it would have created a never-fires trigger pattern
(action: REVIEW with no clear when-to-clear-it semantic) just to use
the trigger machinery for something nextReviewAt already does.

### 6b. Trigger lifecycle on direction/status transitions — automatic

**The agent never manages triggers for status transitions.** All of
this happens in `update_thesis` based on the (oldDirection, oldStatus)
→ (newDirection, newStatus) transition:

| Transition | Trigger handling |
|---|---|
| PENDING WATCHING → LONG/SHORT WATCHING | Auto-merge horizon defaults from `triggers/defaults.ts` (existing behavior). Agent-supplied triggers in the patch override defaults per key. |
| PENDING WATCHING → PASS ARCHIVED | All triggers cleared. PASS is terminal, no review cadence. |
| LONG/SHORT WATCHING → LONG/SHORT ACTIVE | Triggers retained as-is (entry trigger has fired; exit/review triggers continue to apply against the position). |
| LONG/SHORT ACTIVE → LONG/SHORT CLOSED | All triggers cleared. Terminal. |
| LONG/SHORT (any) → INVALIDATED | All triggers cleared. Terminal. |
| LONG/SHORT (any) → ARCHIVED | All triggers cleared. Terminal. |
| LONG/SHORT WATCHING → SUPERSEDED | All triggers cleared. Old row is terminal; new row carries its own. |

Codify in the `update_thesis` execute fn — a single `applyTransitionRules(prev, next)`
helper called before the write. The agent passes whatever triggers it
wants for the LIVE state; the transition rule clears them on terminal
states regardless of what the agent passed.

### 6c. `record_thesis` rejects triggers on PASS at write

`record_thesis` with `direction='PASS'` and any non-empty `triggers[]`
arg is REJECTED with a clear error. Schema-level rejection — not
prompt instruction. Same principle as the existing shape/belief gates.

### 7. `place_trade` — WATCHING → ACTIVE transition

`lib/agent/tools/place-trade.ts`. The trade-side flow already creates
the Position row and updates Thesis. New requirement: write a
`ThesisUpdate` row with `type='PROMOTED'` and summary that includes
the order size + entry price. This is the audit row the run summary's
*Promoted* bucket derives from.

Also: enforce that `place_trade` only succeeds when the linked thesis
is `(LONG|SHORT) + WATCHING`. Calling it on a PENDING thesis (no
target/stop) or an already-ACTIVE thesis should fail with a clear error.

### 8. `close_position` — ACTIVE → CLOSED transition

`lib/agent/tools/close-position.ts`. Same shape: position close happens,
thesis flips ACTIVE → CLOSED, write `ThesisUpdate` with `type='CLOSED'`.
The trade-evaluator cron fills `agentEvaluation` post-close. No change
needed here under the new model — just confirming this is the only path
from ACTIVE to terminal.

### 9. UI "Remove from Watchlist" — new action

If the analyst detail page exposes a per-row remove button (or
right-click "remove"), it calls the same code path as the editor remove:
`update_thesis(change_status: 'ARCHIVED', summary: 'Removed manually
from watchlist')`. Off the watchlist, visible on the stock page for
history.

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

Each one becomes a Thesis query, filtered by status:

- **Watchlist views** → `status = 'WATCHING'` (includes PENDING + LONG + SHORT).
- **Positions views** → `status = 'ACTIVE'`.
- **Stock detail / activity log** → no status filter, sorted by createdAt desc.

PASS ARCHIVED theses NEVER appear on the watchlist (that's the whole point
of ARCHIVED). They show on the stock detail page and the analyst's
activity log only.

### Specific UI updates

#### Analyst detail page — Watchlist section

`/analysts/[id]` currently calls `getWatchlistItems(analystId)`. Rewrite
to return `Thesis WHERE status = 'WATCHING'`. Each row needs to render:

- Ticker + logo + current price
- **Direction badge** — LONG (green), SHORT (red), **PENDING (yellow "awaiting review")**.
  PASS never appears here (PASS is ARCHIVED, off the watchlist).
- Target / stop preview (only for LONG/SHORT)
- Days on watchlist
- Click → opens existing `ThesisSheet` for that thesis

The "Add Stock to Watchlist" button stays. Clicking it still writes a
row, but now the row is a `Thesis(status:'WATCHING', direction:'PENDING')`.
The button could optionally show a small modal: "Adding $X to your
watchlist. Optional: add a one-line reason for the agent to research."

A per-row "Remove" action (X button on hover, or right-click menu)
calls `update_thesis(change_status: 'ARCHIVED', summary: 'Removed
manually from watchlist')`. The row disappears from the watchlist view;
the thesis stays in the DB for history.

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

#### Run summary card — five derived buckets

This is the user's explicit ask. Today `RunSummaryCard` shows
`ranked_picks` (theses researched in the run). It needs to also show
five derived buckets, **all derived server-side from `ThesisUpdate`
WHERE runId = $runId**. No agent prompt work — no field on
`record_run_summary` to categorize picks. The audit log is the source.

- **Added to watchlist:** `type='CREATED'` AND `Thesis.status='WATCHING'`
  AND `direction IN ('LONG','SHORT','PENDING')`.
  Display: "Added \$NVDA (LONG, target $220) — Tech Momentum thesis."
- **Researched, passed:** `type='CREATED'` AND `Thesis.direction='PASS'`
  AND `Thesis.status='ARCHIVED'`. Discovery's institutional memory.
  Display: "Researched \$AMD — passed (extended, no clean setup)."
- **Promoted (now active):** `type='PROMOTED'` AND `Thesis.status='ACTIVE'`.
  Display: "Promoted \$NVDA → LONG @ $195, 100 sh."
- **Removed from watchlist:** `type IN ('INVALIDATED','ARCHIVED','SUPERSEDED')`
  without a matching PROMOTED/CLOSED on the same thesisId in the same run.
  Display: "Removed \$INTC — invalidated (guidance cut)." or
  "Removed \$BABA — archived (manually removed)."
- **Closed positions:** `type='CLOSED'` AND `Thesis.status='CLOSED'`.
  Display: "Closed \$AAPL @ $185 (+8.2%)."

Discovery runs typically only populate buckets 1+2. Daily and tactical
runs can populate any of the five.

#### Run detail page — visible action summary

`/runs/[id]` — the run replay UI. Add a top-of-page summary chip row:
"3 added · 1 removed · 4 researched-passed · 2 promoted · 1 closed."
Sourced from ThesisUpdate rows scoped to this `runId`.

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
> - **LONG/SHORT + WATCHING** — composite ≥ 5, you want to track this
>   and want it on the analyst's watchlist for next week's daily review.
>   Requires `target_price`, `stop_loss`, `entry_price`, `triggers[]`,
>   `core_belief`, `key_assumptions`, `invalidation_conditions`.
> - **PASS + ARCHIVED** — you researched it and decided no tradeable
>   view. Terminal at write — this thesis row will not be reviewed on
>   cadence; it won't appear on the watchlist; it WILL appear on
>   `/stocks/[ticker]` as institutional memory; and if the ticker
>   comes back up in a future signal, you'll read this thesis via
>   `get_theses(include_history:true)` to inform a fresh look.
>   Requires `reasoning_summary` and ideally `invalidation_conditions`
>   (so a future look knows what would change the verdict).
> - **Not minted** — composite < 3, or fundamentally outside your edge
>   (sector fence, market-cap fence, exclusion list). Narrate the
>   dismissal in your scratchpad, don't write a thesis row.
>
> The 'PASS WATCHING' state from prior versions no longer exists.
> PASS is always ARCHIVED. If you genuinely want to *watch* a name
> for a setup but aren't taking it today, that's a LONG or SHORT
> WATCHING thesis with the entry trigger set to the conditions you'd
> need to see — NOT a PASS.
>
> Run summary will show two buckets for discovery: added to watchlist
> (LONG/SHORT WATCHING), and researched-passed (PASS ARCHIVED)."

Remove the "8 thesis cap" or raise it to ~15 since PASS theses are now
valid output. Real cap is "you researched what you researched; mint a
thesis for each."

Remove the "direction PENDING" instruction here — discovery agents don't
mint PENDING. Only user/builder/editor seeds use PENDING.

### Daily run prompt

`lib/agent/system-prompt.ts`. Under the MORNING_RUN_V2 V2 prompt
(`buildDailyRunSystemPromptV2`, ~80 lines), the agent reads per-thesis
state through `get_theses.needsAction` — there are no priority blocks
in the prompt. The watchlist-collapse change adds ONE bullet to the
existing "Your job" → "Act on every thesis where needsAction is non-null"
action map:

> **REVIEW_DUE on a PENDING thesis** — first-research entry point.
> User/builder/editor added this ticker; you haven't researched it yet.
> Call `get_stock_data` (and any other research you need), then call
> `update_thesis(thesis_id, ...)` with one of three outcomes:
> - `direction: 'LONG', horizon: ..., target_price, stop_loss, entry_price,
>   triggers, core_belief, key_assumptions, invalidation_conditions` —
>   commit to a bullish view. Stays on the watchlist.
> - `direction: 'SHORT', horizon: ..., target_price, stop_loss, entry_price,
>   triggers, core_belief, key_assumptions, invalidation_conditions` —
>   commit to a bearish view. Stays on the watchlist.
> - `direction: 'PASS', change_status: 'ARCHIVED', reasoning_summary,
>   invalidation_conditions` — decline coverage. Falls off the watchlist;
>   stays as institutional memory on `/stocks/[ticker]`.

The trigger lifecycle (clearing the PENDING placeholder, merging horizon
defaults, etc.) happens inside `update_thesis` automatically — the agent
doesn't manage triggers around the transition.

`manage_watchlist` references in the V1 prompt are removed (tool deleted).
Anywhere the V1 prompt said "call manage_watchlist with action: REMOVE,"
it now says "call update_thesis with change_status: ARCHIVED."

The current daily-run prompt's "Watchlist (legacy)" section
(`system-prompt.ts:294`) — DELETE entirely. The Live Theses table is
now the only source (and under V2 the Live Theses block is gone entirely
in favor of `needsAction`).

#### `needsAction` carve-out for PENDING

Per MORNING_RUN_V2 Fix #2, `needsAction` is purely trigger-driven —
no hardcoded thresholds. PENDING theses have no triggers (and no
horizon yet, so no horizon-cadence). They surface as `REVIEW_DUE` via
the same nextReviewAt mechanism, with a special case in
`computeNeedsAction`:

```ts
// In lib/agent/needs-action.ts
if (thesis.direction === 'PENDING' && thesis.status === 'WATCHING') {
  // PENDING is REVIEW_DUE from the moment it's created.
  // nextReviewAt = createdAt at mint time; check against now.
  if (thesis.nextReviewAt <= now) {
    return { kind: 'REVIEW_DUE', daysOverdue: 0, pendingFirstReview: true };
  }
}
```

The optional `pendingFirstReview: true` discriminator lets the UI
render "First research" instead of "Review overdue" for PENDING rows.
Same machinery; no new kind.

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

-- Removed from watchlist this run (off the watchlist, NOT via trade)
SELECT t.ticker, t.status, tu.summary
FROM "Thesis" t
JOIN "ThesisUpdate" tu ON tu."thesisId" = t.id
WHERE tu."runId" = $runId
  AND tu.type IN ('INVALIDATED','ARCHIVED','SUPERSEDED')
  AND t.status IN ('INVALIDATED','ARCHIVED','SUPERSEDED')
  AND NOT EXISTS (
    -- Exclude theses that also got PROMOTED or CLOSED in the same run
    -- (those belong in the Promoted / Closed buckets instead).
    SELECT 1 FROM "ThesisUpdate" tu2
    WHERE tu2."thesisId" = t.id
      AND tu2."runId" = $runId
      AND tu2.type IN ('PROMOTED','CLOSED')
  );

-- Researched-passed this run (Discovery's PASS theses, terminal at write)
SELECT t.ticker, t.reasoning_summary
FROM "Thesis" t
JOIN "ThesisUpdate" tu ON tu."thesisId" = t.id
WHERE tu."runId" = $runId
  AND tu.type = 'CREATED'
  AND t.direction = 'PASS'
  AND t.status = 'ARCHIVED';

-- Promoted to ACTIVE this run (WATCHING → ACTIVE via place_trade)
SELECT t.ticker, t.direction
FROM "Thesis" t
JOIN "ThesisUpdate" tu ON tu."thesisId" = t.id
WHERE tu."runId" = $runId
  AND tu.type = 'PROMOTED'
  AND t.status = 'ACTIVE';

-- Closed positions this run (ACTIVE → CLOSED via close_position)
SELECT t.ticker, t.direction, p.outcome
FROM "Thesis" t
JOIN "ThesisUpdate" tu ON tu."thesisId" = t.id
LEFT JOIN "Position" p ON p."thesisId" = t.id
WHERE tu."runId" = $runId
  AND tu.type = 'CLOSED'
  AND t.status = 'CLOSED';
```

Render these five buckets in the run summary card and the run feed
preview. No agent prompt work needed for this — the audit log is the
source.

---

## manage_watchlist redesign — N/A (tool deleted)

Earlier drafts of this plan kept `manage_watchlist` as a thin wrapper
around `record_thesis` + `update_thesis`. The 2026-05-13 firm-pass
revision deletes the tool entirely (see §"Backend writer changes" §4
above). Discovery uses `record_thesis` directly to mint; both Discovery
and Daily Run use `update_thesis(change_status: 'ARCHIVED')` to remove.

The `triggerCondition` field that `manage_watchlist` accepted is gone
with the tool. Triggers on minted theses are passed via
`record_thesis(triggers: [...])`, where the existing horizon-default
auto-merge logic does the right thing.

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

2. **PASS WATCHING vs PASS not-minted.** ~~The discovery prompt rewrite
   distinguishes PASS theses (institutional memory, on the watchlist)
   from PASS that's narrated-only (didn't bother).~~ **RESOLVED 2026-05-13:**
   PASS theses are always `status='ARCHIVED'`, never `WATCHING`. They're
   terminal at write, off the watchlist, but visible on the stock detail
   page and via `get_theses(include_history)`. The line between minted-PASS
   and narrated-only stays at "did you do real research?" — composite ≥ 3
   with concrete invalidation conditions = mint PASS ARCHIVED; composite < 3
   or sector/cap/exclusion-fence dismissal = narrate only.

3. **Do PENDING theses count against the analyst's slot budget?** The
   agent has `maxOpenPositions`. PENDING is awaiting research, not a
   trade — so no. But what about the watchlist size? Today there's no
   cap. Continue with no cap, or add `maxWatchlistSize`?

4. **Editor remove → INVALIDATED or CLOSED?** ~~When the editor chat
   removes a watchlist name, the corresponding thesis transitions to
   what?~~ **RESOLVED 2026-05-13:** New status `ARCHIVED` added.
   Editor-remove (and manual UI remove, and agent `manage_watchlist`
   REMOVE) all transition to `status='ARCHIVED'`. `INVALIDATED` is
   reserved for evidence-driven view-breaks; `CLOSED` is reserved for
   "had a position, closed it." `ARCHIVED` is the right semantic for
   "agent or user walked away from coverage" and for PASS theses at
   write time.

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
   and SHORT WATCHING also monitored as today. PASS theses no longer
   exist as WATCHING under the new model (they're ARCHIVED) — so the
   monitor pool is `status='WATCHING'` (PENDING + LONG + SHORT) plus
   `status='ACTIVE'`. ARCHIVED theses aren't monitored — by definition
   nobody's tracking them for an entry; if conditions flip enough to
   matter, the discovery cron re-encounters the ticker via signals.

---

## Three-layer audit (alignment with MORNING_RUN_V2 + THESIS_ARCHITECTURE)

Every invariant in this plan, mapped to which layer enforces it. Use
this table to verify nothing has drifted back to prompt-managed during
implementation.

| Invariant | Layer | Enforcement site |
|---|---|---|
| Legal `(direction, status)` pairs | 1 — tool gate | `record_thesis` + `update_thesis` execute fns reject illegal pairs |
| PENDING field requirements relaxed (no target/stop/triggers/belief/horizon) | 1 — tool gate | `record_thesis` schema validation, conditional on direction='PENDING' |
| LONG/SHORT WATCHING field requirements (target/stop/triggers/belief/horizon/etc.) | 1 — tool gate | Existing `record_thesis` belief + shape + ENTER-trigger gates, unchanged |
| PASS ARCHIVED requires `reasoning_summary` + `invalidation_conditions` (≥1) | 1 — tool gate | `record_thesis` execute fn, conditional on direction='PASS' |
| PASS rejects `triggers[]` | 1 — tool gate | `record_thesis` execute fn |
| ENTER-trigger guard exempts PENDING + PASS | 1 — tool gate | Carve-out in existing ENTER-trigger guard |
| Cross-analyst overlap guard exempts PENDING + PASS | 1 — tool gate | Carve-out in existing same-(ticker,direction) guard |
| Trigger lifecycle on (direction, status) transitions (clear on terminal; horizon-defaults on PENDING→LONG/SHORT) | 1 — tool gate | `applyTransitionRules(prev, next)` helper in `update_thesis` |
| Atomic direction flip (one tool call, transactional) | 1 — tool gate | `record_thesis` with `supersedes: <oldId>` arg, single Prisma transaction |
| `place_trade` rejects non-`(LONG\|SHORT) WATCHING` theses | 1 — tool gate | `place_trade` execute fn (already exists; confirm coverage of new states) |
| ACTIVE → CLOSED is `close_position`-only | 1 — tool gate | `update_thesis` rejects `change_status='CLOSED'` on ACTIVE (already exists; confirm) |
| Watchlist view returns only `status='WATCHING'` | 2 — tool result shape | `getWatchlistItems` / analyst-detail query filter |
| Stock detail page shows all theses for a ticker | 2 — tool result shape | `/stocks/[symbol]` query, no status filter |
| `needsAction` surfaces PENDING REVIEW_DUE without a new kind | 2 — tool result shape | `computeNeedsAction` carve-out for direction='PENDING' |
| Run summary 5 buckets derived server-side from `ThesisUpdate` | 2 — tool result shape | `record_run_summary`-adjacent enrichment query, no agent input |
| nextReviewAt drives PENDING first-review | 2 — tool result shape | Set `nextReviewAt = createdAt` at PENDING mint; existing REVIEW_DUE pipeline catches it |
| `place_trade` writes `ThesisUpdate(type='PROMOTED')` | 2 — audit shape | `place_trade` execute fn, in the same transaction as the Position create |
| `update_thesis(change_status='ARCHIVED')` writes `ThesisUpdate(type='ARCHIVED')` | 2 — audit shape | `update_thesis` execute fn |
| Discovery's choice of direction (LONG / SHORT / PASS) | 3 — prompt | Discovery system prompt |
| Discovery's composite-score threshold (≥5 mint LONG/SHORT, ≥3 mint PASS, <3 narrate) | 3 — prompt | Discovery system prompt |
| Daily Run's choice to INVALIDATE vs ARCHIVE | 3 — prompt | Daily-run V2 prompt's action map |
| When to research a candidate at all | 3 — prompt | Discovery system prompt + agent judgment |
| User-facing copy ("Awaiting review" vs "Removed manually") | 3 — UI | Renderer components |

If during implementation you find yourself adding a rule to the prompt
that ought to be enforced by a tool gate, stop and move it to the tool.
That's the load-bearing principle.

### THESIS_ARCHITECTURE §9 revisions

This plan revises two items from THESIS_ARCHITECTURE.md §9 "What's
intentionally not done":

- **"Did not kill PASS direction. It works as institutional memory;
  corner-case logic was not worth the simplification cost."** —
  Revised. PASS direction is kept (still the agent's view), but the
  "PASS WATCHING for institutional memory" pattern is removed. PASS is
  always `status='ARCHIVED'`. The institutional-memory value is preserved
  via stock-page visibility + `get_theses(include_history)` + `parentThesisId`
  chains on re-encounter. The cost-of-corner-case was real; this plan
  pays it via the new ARCHIVED status + clear (direction, status) legal-pairs.
- **"Did not collapse manage_watchlist. Dual-store works today;
  collapsing is a separate follow-up."** — That follow-up is this plan.
  Collapse the dual store; delete `manage_watchlist`; one primitive set
  (`record_thesis` + `update_thesis`) per the three-layer principle.

When THESIS_ARCHITECTURE.md is updated post-implementation, both §9
items should be removed (work has been done) and §3 "Lifecycle" should
be redrawn to include the PENDING entry-state and ARCHIVED terminal-state.

---

## Implementation prompt for a fresh session

Copy-paste into a new Claude session:

> Read these three docs end-to-end before touching code. They are
> mutually load-bearing:
> 1. `docs/WATCHLIST_COLLAPSE_PLAN.md` (this file) — the unified-store
>    lifecycle and the firm-pass three-layer audit.
> 2. `docs/MORNING_RUN_V2_DESIGN.md` — the three-layer principle (tool
>    gates / tool result shape / prompt-as-judgment-only) plus the
>    mode-allowlist architecture (Daily/Discovery/Tactical separation).
> 3. `docs/THESIS_ARCHITECTURE.md` — existing thesis lifecycle, gates,
>    audit-type taxonomy, horizon system, ThesisUpdate.fieldChanges shape.
>
> Then read the current implementation:
> - `lib/actions/watchlist.actions.ts`
> - `lib/agent/tools/manage-watchlist.ts` (slated for deletion)
> - `lib/agent/tools/record-thesis.ts`
> - `lib/agent/tools/update-thesis.ts`
> - `lib/agent/tools/place-trade.ts`
> - `lib/agent/needs-action.ts` (the `computeNeedsAction` helper from
>   MORNING_RUN_V2 Fix #2)
> - `lib/agent/triggers/defaults.ts`
> - `lib/agent/horizon-policy.ts`
> - `lib/actions/analyst.actions.ts` (the `createAnalystFromConfig` +
>   analyst-update transactions)
> - `lib/agent/run-input.ts` (the watchlist section)
> - `lib/agent/system-prompts/discovery.ts`
> - `lib/agent/system-prompt.ts` (the Live Theses + Watchlist sections;
>   the V2 builder if it has landed)
> - `lib/agent/modes.ts` (allowlists per mode)
> - `components/analysts/AnalystDetailClient.tsx` (the watchlist render)
> - `prisma/schema.prisma` (Thesis + AnalystWatchlistItem + ThesisUpdate)
>
> Then resolve the remaining open questions in
> `docs/WATCHLIST_COLLAPSE_PLAN.md` § "Open questions to confirm" by
> asking the user. Questions #2 and #4 are already RESOLVED in the doc;
> don't re-ask them. Don't decide the rest unilaterally.
>
> Then implement PR 1 — Schema + backfill + writer dual-writes.
> Verify with a SQL query showing zero drift before merging.
>
> DO NOT skip to PR 2 or PR 3 in the same PR. Each PR ships
> independently and leaves the system working.
>
> **Architectural guardrails — non-negotiable, from the firm-pass audit:**
>
> - Every (direction, status) pair is gated at write in `record_thesis`
>   and `update_thesis` execute fns. Not in prose.
> - PENDING uses `nextReviewAt = createdAt` to surface via the existing
>   `needsAction` REVIEW_DUE pipeline. NO special TIME_ELAPSED day=0
>   trigger — that would be parallel logic.
> - Trigger lifecycle on (direction, status) transitions is handled by
>   `applyTransitionRules(prev, next)` inside `update_thesis`. The
>   agent never manages triggers for transitions; the tool does.
> - `record_thesis(direction: 'PASS')` rejects any `triggers[]` arg.
>   Tool-side rejection, not prompt instruction.
> - Direction flips on the live book go through `record_thesis(supersedes:
>   <oldId>)` — ONE atomic Prisma transaction. The agent never makes
>   two coordinated tool calls for a flip. (Note: direction flips only
>   happen in Discovery per mode allowlists. Daily/Tactical agents
>   INVALIDATE the old thesis; the fresh-direction mint waits for
>   next Discovery cron.)
> - `manage_watchlist` is DELETED. Use `record_thesis` + `update_thesis`.
> - Run summary 5 buckets are derived server-side from `ThesisUpdate`.
>   NEVER rely on the agent populating an action_taken field.
>
> If you find yourself adding any of the above to the system prompt
> instead of the tool, stop. Move it to the tool. The prompt describes
> WHAT and WHY; tools and schemas handle HOW.
>
> Frontend updates in PR 2 must handle the user's stated journey:
> "I'm supposed to be able to see watching stocks on each analyst.
> Click to go to any stocks page and see any thesis's for it below,
> click the thesis sheet from there." Verify this journey works
> end-to-end in PR 2 before merging.
>
> Run summaries (discovery + daily) MUST surface the five buckets
> (Added / Researched-passed / Promoted / Removed / Closed) via
> server-side derivation from `ThesisUpdate` rows. Do not rely on the
> agent remembering to populate them.
>
> The discovery prompt's "never PASS" rule is wrong. PASS theses ARE
> valid discovery output, terminal at write as `status='ARCHIVED'`.
> Flip the prompt in PR 2.
>
> Post-merge: update `docs/THESIS_ARCHITECTURE.md` to remove the §9
> items "Did not kill PASS direction" and "Did not collapse
> manage_watchlist" (both have been done). Redraw §3 "Lifecycle" to
> include PENDING entry-state and ARCHIVED terminal-state. Bump
> `LAST_VERIFIED_AT` in `lib/agent/workflow-registry.ts`.

---

## Pre-PR-1 sanity checks

Before opening PR 1, the implementer should:

1. Run the drift query at the top of this doc — confirm the 13 + 5 = 18
   drift rows (the count may have grown since 2026-05-13).
2. Confirm with the user the resolution to the 8 open questions.
3. ~~Confirm with the user whether PASS WATCHING (FIVN/MSFT in the
   2026-05-13 audit) should stay on the watchlist or disappear after
   migration.~~ **RESOLVED 2026-05-13:** PASS WATCHING is no longer a
   legal pair. Existing PASS WATCHING rows (FIVN, MSFT, plus any
   others) get transitioned to `status='ARCHIVED'` in-place during
   Step 1b of the migration. They disappear from the watchlist, stay
   visible on `/stocks/[symbol]` as history.
4. Confirm the synthetic `ResearchRun` shape for manual user adds.

Drafted 2026-05-13. Not implemented.
