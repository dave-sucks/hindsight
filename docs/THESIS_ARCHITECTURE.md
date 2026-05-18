# Hindsight — Thesis Architecture

> **What this is:** the live reference for how the thesis system works.
> Updated 2026-05-13 to reflect the watchlist collapse (PR #265) and the
> complete_run preflight (PR #266). Update this doc whenever a thesis-system
> component changes. For target state, read [`VISION.md`](./VISION.md). For
> known gaps, read [`GAPS.md`](./GAPS.md).
>
> **Last verified:** 2026-05-13

---

## 1. What a thesis is

> **A thesis is the analyst's durable, structured belief about a single ticker** — what's true, what must remain true, what would prove it wrong, and what we'll do about it.

It's the load-bearing object in the system: the unit the trigger evaluator fires against, the unit the daily run reviews, the unit the trade evaluator grades, the only thing that explains why a Position is being held — and (since the 2026-05-13 collapse) **the single store backing the watchlist**.

Distinct from the supporting cast:

- **Position** — what we OWN (qty, avgCost, P&L). A consequence of an ACTIVE thesis. A thesis can exist without a position (WATCHING) but a position should never exist without a thesis.
- **Signal** — a normalized piece of evidence from the world. Theses cite signals (`sourceSignalIds`); signals don't own theses. One thesis cites many signals over time via the `ThesisUpdate` activity log.
- **Watchlist** — *not a table.* The watchlist is the query `Thesis WHERE status='WATCHING'`. PENDING (seeded, awaiting first research), LONG WATCHING, and SHORT WATCHING are the only states that appear on it.

**Cardinality rule:** at most one ACTIVE-or-WATCHING thesis per (analyst, ticker, direction). Direction flips create a new row with the parent SUPERSEDED. INVALIDATED/CLOSED/SUPERSEDED/ARCHIVED rows are immutable history.

---

## 2. The four-part contract

Every thesis lives inside a four-part contract. Doesn't matter if it's a 5-minute scalp or a 5-year compounder — the same four sections exist, just with different shapes.

1. **WATCH** — why this ticker is on the radar. What we're waiting for. The IF.
2. **ENTER** — what specifically would make us buy/short. At what level. In what size. The THEN.
3. **HOLD** — the premise. Why we keep holding. What we tolerate (noise) vs react to (real change). How often we look.
4. **EXIT** — what closes the position. Price level / time / event / broken belief.

In the code, these four parts are encoded across **structured triggers** (the actionable predicates) plus **structural belief fields** (the durable claim) plus **horizon** (the discriminator that gives every other field its shape). Triggers are the implementation primitive; the four-part contract is the conceptual frame for reading the system.

---

## 3. The state machine — direction × status

### Direction (the analyst's view)

| Direction | Meaning |
|---|---|
| `PENDING` | Seed state. User/builder/editor added the ticker; nobody has researched it yet. Promoted to LONG/SHORT/PASS on first research. |
| `LONG`    | Committed bullish view, with target/stop/triggers/belief. |
| `SHORT`   | Committed bearish view, with target/stop/triggers/belief. |
| `PASS`    | Researched, decided no tradeable view. **Terminal at write.** Institutional memory. |

### Status (what the system is doing)

| Status         | Meaning                                                                 | On watchlist? |
|----------------|-------------------------------------------------------------------------|---------------|
| `WATCHING`     | Active tracking; triggers maintained; reviewed on cadence.              | **Yes**       |
| `ACTIVE`       | Position open via Alpaca.                                               | No — in Positions |
| `PROMOTED`     | Conviction-pause. ACTIVE+held → user promoted analyst PAPER→LIVE → paper position force-closed → awaiting first-live-run resolution. Set only by the promote-analyst action; rejected by `record_thesis` / `update_thesis` at the Zod layer. | Surfaces as "Awaiting live entry" |
| `CLOSED`       | Position was opened and closed.                                         | No            |
| `INVALIDATED`  | Held a view; evidence disproved it.                                     | No            |
| `ARCHIVED`     | Terminal without trade or view-invalidation. PASS at write, manual remove, editor remove, walk-away. | No |
| `SUPERSEDED`   | Replaced by a newer thesis on the same ticker (direction flip).         | No            |

### Legal `(direction, status)` pairs

Enforced at write in `record_thesis`, `update_thesis`, and the promote-analyst action:

```
(PENDING,     WATCHING)                          seed
(LONG,        WATCHING|ACTIVE|PROMOTED|CLOSED|INVALIDATED|ARCHIVED|SUPERSEDED)
(SHORT,       WATCHING|ACTIVE|PROMOTED|CLOSED|INVALIDATED|ARCHIVED|SUPERSEDED)
(PASS,        ARCHIVED)                          terminal at write
```

PROMOTED is set only by the promote-analyst action (not by `record_thesis` / `update_thesis`). Its only legal exits are PROMOTED → ACTIVE (re-enter via place_trade) or PROMOTED → WATCHING (defer via update_thesis). INVALIDATED / CLOSED / ARCHIVED transitions from PROMOTED are rejected at the tool layer — the analyst held the name with conviction; the user explicitly chose to graduate the analyst; killing the thesis without revisiting it is the wrong shape.

Anything else is rejected with a structured error.

### State diagram

```
PENDING + WATCHING  (seed — user/builder/editor add)
  │
  ├─→ LONG  + WATCHING    (agent commits bullish; target/stop/triggers set)
  ├─→ SHORT + WATCHING    (agent commits bearish; target/stop/triggers set)
  └─→ PASS  + ARCHIVED    (agent researched, declined)        [terminal]


LONG/SHORT + WATCHING   (on the watchlist; has triggers)
  │
  ├─→ LONG/SHORT + ACTIVE        (place_trade fires)
  ├─→ LONG/SHORT + INVALIDATED   (view disproven — miss, breakdown)  [terminal]
  ├─→ LONG/SHORT + ARCHIVED      (manually removed via UI/editor)    [terminal]
  └─→ LONG/SHORT + SUPERSEDED    (direction flip; new thesis chains) [terminal]


LONG/SHORT + ACTIVE   (position open)
  │
  ├─→ LONG/SHORT + CLOSED        (close_position fires)              [terminal]
  └─→ LONG/SHORT + PROMOTED      (user promotes analyst PAPER→LIVE; paper
                                  position force-closed; conviction context
                                  frozen on the row)


LONG/SHORT + PROMOTED   (held in paper, just promoted to live)
  │
  ├─→ LONG/SHORT + ACTIVE        (place_trade fires; live entry — default)
  └─→ LONG/SHORT + WATCHING      (update_thesis change_status: "WATCHING";
                                  defer re-entry — only legal opt-out)

  ❌ NOT ALLOWED from PROMOTED: INVALIDATED, CLOSED, ARCHIVED. Tool rejects.


PASS + ARCHIVED   [terminal at write — no transitions out]
  When the ticker is re-encountered later (next discovery cron, etc.),
  the agent reads the prior PASS via get_theses(include_history) and
  mints a fresh thesis chained via parentThesisId. The old PASS stays
  ARCHIVED — it's history, not waking up.
```

---

## 3a. The user-facing mapping (what each pair means in plain language)

Two axes:
- **Direction** = the analyst's view — what they think about the stock
- **Status** = where it is in the lifecycle — watchlist / holding / done

### Full matrix

Each cell is what a `(direction, status)` pair MEANS in plain language. Empty cells are illegal pairs (rejected at write time):

| | WATCHING | ACTIVE | CLOSED | INVALIDATED | ARCHIVED | SUPERSEDED |
|---|---|---|---|---|---|---|
| **PENDING** | "Added to watchlist, not yet researched" | — | — | — | — | — |
| **LONG** | "Bullish, waiting for entry trigger" | "Holding the long position" | "Had a long, exited" | "Was bullish, evidence broke the view" | "Walked away from coverage (no view-break)" | "Replaced by a newer thesis on this ticker" |
| **SHORT** | "Bearish, waiting for entry trigger" | "Holding the short position" | "Had a short, covered" | "Was bearish, evidence broke the view" | "Walked away" | "Replaced by newer thesis" |
| **PASS** | — | — | — | — | "Researched, decided no view" | — |

### What appears where in the UI

| User-facing surface | Query |
|---|---|
| **Analyst's watchlist sidebar** | `status = 'WATCHING'` (any direction: PENDING, LONG, SHORT) |
| **Analyst's open positions** | `status = 'ACTIVE'` |
| **Trade history / closed positions** | `status = 'CLOSED'` |
| **Stock detail page (every analyst that's ever looked)** | No filter — shows everything including terminal rows |
| **Institutional memory on a ticker** | `status IN ('CLOSED','INVALIDATED','ARCHIVED','SUPERSEDED')` |

### How transitions happen — who sets what, where

**Entering the system (status starts at WATCHING):**

| Path | Produces | Mechanism |
|---|---|---|
| User clicks "Add to Watchlist" | `PENDING + WATCHING` | `addWatchlistItem` server action |
| Builder seeds analyst with watchlist | `PENDING + WATCHING` | `createAnalystFromConfig` |
| Editor chat adds a ticker | `PENDING + WATCHING` | analyst-update path |
| Discovery decides to track | `LONG/SHORT + WATCHING` | agent calls `record_thesis(direction, status='WATCHING', target/stop/triggers/belief)` |
| Discovery decides NOT to track | `PASS + ARCHIVED` | agent calls `record_thesis(direction='PASS', invalidation_conditions)` — tool auto-flips status to ARCHIVED |

**Moving along the lifecycle:**

| Transition | Trigger | Who fires it |
|---|---|---|
| `PENDING + WATCHING` → `LONG/SHORT + WATCHING` | Agent commits direction after first research | `update_thesis(direction: 'LONG', horizon, target/stop/entry, belief, key_assumptions, invalidation_conditions, triggers)` |
| `PENDING + WATCHING` → `PASS + ARCHIVED` | Agent researches, declines | `update_thesis(direction: 'PASS', invalidation_conditions)` — auto-flips status to ARCHIVED + clears triggers |
| `LONG/SHORT + WATCHING` → `LONG/SHORT + ACTIVE` | Position opens | `place_trade` (auto-flips status) |
| `LONG/SHORT + ACTIVE` → `LONG/SHORT + CLOSED` | Position closes | `close_position` (auto-flips status) |
| `LONG/SHORT + WATCHING/ACTIVE` → `INVALIDATED` | Evidence broke the view | `update_thesis(change_status: 'INVALIDATED', invalidReason)` |
| `LONG/SHORT + WATCHING` → `ARCHIVED` | User/agent walked away (no view-break) | `update_thesis(change_status: 'ARCHIVED', rationale)` — typically from removeWatchlistItem |
| `LONG/SHORT + WATCHING/ACTIVE` → `SUPERSEDED` | New thesis on same ticker | `record_thesis(parent_thesis_id, direction)` — old gets auto-superseded |

### Guardrails (where each rule is enforced)

**Hard tool gates** (deterministic, can't be bypassed):

| Gate | Where | What it blocks |
|---|---|---|
| **Legal-pair validation** | `record_thesis`, `update_thesis` | Illegal `(direction, status)` writes (e.g. `PASS + WATCHING`) |
| **Agent can't mint PENDING** | `record_thesis` | Agent calling `record_thesis(direction: 'PENDING')` — reserved for UI/builder/editor |
| **PASS has no triggers** | `record_thesis` | Passing `triggers[]` on `direction='PASS'` — PASS is terminal, no wake-up |
| **PASS requires invalidation_conditions** | `record_thesis` | PASS with no flip-criteria — unreadable as institutional memory |
| **LONG/SHORT requires full structural belief** | `record_thesis` | LONG/SHORT WATCHING without core_belief + ≥2 key_assumptions + ≥2 invalidation_conditions + target/stop/entry + horizon |
| **ENTER trigger required on LONG/SHORT WATCHING** | `record_thesis` | A bullish/bearish watchlist thesis with no entry trigger (would sit inert forever) |
| **Direction change only from PENDING** | `update_thesis` | `update_thesis(direction: …)` when current direction is LONG/SHORT/PASS — those flips must chain via `record_thesis(parent_thesis_id)` |
| **PENDING update requires direction** | `update_thesis` | Any `update_thesis` on a PENDING that doesn't include `direction` — forces commitment |
| **Terminate ACTIVE-with-position requires close** | `update_thesis` | `change_status: 'INVALIDATED'` OR `'ARCHIVED'` on an ACTIVE thesis with an open Position, unless `close_position` fired in the same run. Prevents zombies (open position with no live thesis). |
| **place_trade rejects PENDING thesis** | `place_trade` | Trading on an uncommitted thesis (no target/stop/triggers backing it) |
| **No-PASS-on-held** | `record_thesis` | Minting a PASS thesis on a ticker the analyst already holds |
| **Cross-analyst overlap (DAY-only)** | `record_thesis` | DAY-trader analyst minting on a ticker already covered by another analyst |
| **Shape gate** | `record_thesis`, `update_thesis` | LONG: target > entry > stop. SHORT: target < entry < stop |
| **Goalpost-moving** | `update_thesis` | Raising target on WATCHING when entry condition is currently met |
| **Confidence ≥ minConfidence** | `place_trade` | Trading a thesis below the analyst's stated minimum confidence |
| **maxOpenPositions** | `place_trade` | Opening a position beyond the analyst's slot budget |

**Soft prompt guidance** (the agent might violate; tool gates catch it):
- Daily-run prompt teaches when to commit PENDING via `update_thesis(direction, …)`
- Discovery prompt teaches PASS is valid output (institutional memory)
- Both prompts describe when to use INVALIDATED vs ARCHIVED vs close + INVALIDATED

### The mental shortcut

> **`status` answers "where is this thesis in its lifecycle?"** (watchlist / open position / closed position / dead-historical)
> **`direction` answers "what does the analyst think?"** (no opinion yet / bullish / bearish / researched-and-declined)

The four lifecycle stages:

1. **Awaiting research** (`PENDING + WATCHING`) — seeded, no view yet
2. **Active tracking** (`LONG/SHORT + WATCHING`) — has a view, waiting for entry signal
3. **Open position** (`LONG/SHORT + ACTIVE`) — holding the trade
4. **Terminal / history** (anything CLOSED / INVALIDATED / ARCHIVED / SUPERSEDED) — story over, kept as record

PASS theses skip stages 2–3 entirely and go straight to terminal-as-memory.

### Note on the terminal-status zoo

There are four terminal statuses (CLOSED / INVALIDATED / ARCHIVED / SUPERSEDED). The semantic difference:

- **CLOSED** — tied to position lifecycle (1:1 with `close_position` firing). Distinct from "view broke" because closing happens for many reasons (target, stop, time exit, manual). Useful for analytics.
- **SUPERSEDED** — structural pointer paired with `parentThesisId`. Means "there's a newer thesis chained from this one — look at the child." Pairs with the cardinality rule (one ACTIVE-or-WATCHING per analyst+ticker+direction).
- **INVALIDATED** — "evidence broke the view" (uses `invalidReason` field). Specific narrative.
- **ARCHIVED** — "walked away without evidence-driven view-break" (uses `closeReason` field). Used for PASS at write, manual removes, editor removes, and agent walk-aways.

**The INVALIDATED vs ARCHIVED distinction is the weakest.** Both mean "terminal without a clean trade outcome"; both should be guarded the same way against zombie positions (which is what the F2 extension in PR #270 does). They might warrant collapsing into a single status with the narrative living in the rationale field. Tracked as tech-debt in GAPS; not a blocker.

---

## 4. End-to-end lifecycle scenarios

These are the canonical flows. If your code path doesn't fit one of these, it's a bug.

### Scenario A — Discovery picks up $NVDA, agent likes it.

1. Sunday 9am cron. Discovery agent calls `read_signals`; $NVDA appears.
2. Research: `get_stock_data`, `get_market_context`, optional `web_search`.
3. Scores on the 4-dim composite → 6.5. Setup is clean.
4. `record_thesis({ ticker: 'NVDA', direction: 'LONG', status: 'WATCHING', target_price: 220, stop_loss: 180, entry_price: 195, triggers: [...], core_belief, key_assumptions, invalidation_conditions })`.
5. Thesis row created. `ThesisUpdate(type='CREATED')` written. **Now on the watchlist.**
6. Run summary bucket: **Added to watchlist**.

### Scenario B — Discovery picks up $AMD, agent passes.

1. Same setup. Research happens.
2. Score 3.5. Extended, no clean entry.
3. `record_thesis({ ticker: 'AMD', direction: 'PASS', reasoning_summary: 'Extended past entry, RSI 78, no edge here', invalidation_conditions: ['Pullback to 50d MA with volume reset'] })`. Tool maps direction PASS → `status: 'ARCHIVED'` automatically.
4. Thesis row terminal at write. ThesisUpdate `CREATED` written. **Not on the watchlist.** Visible on `/stocks/AMD` as institutional memory.
5. Run summary bucket: **Researched, passed**.
6. Three weeks later, $AMD hits a signal. Next discovery run calls `get_theses({ ticker: 'AMD', include_history: true })` → reads prior PASS reasoning. Conditions changed. Mints fresh `LONG + WATCHING` with `parent_thesis_id` chained to the ARCHIVED PASS.

### Scenario C — User manually adds $TSLA to an analyst's watchlist.

1. User clicks "Add Stock to Watchlist" on `/analysts/[id]`.
2. `addWatchlistItem` server action runs:
   - Resolves the analyst's synthetic `manual-<analystId>` ResearchRun (creates it on first use).
   - Mints `Thesis({ direction: 'PENDING', status: 'WATCHING', source_kind: 'USER_ADDED', nextReviewAt: now })`.
   - Writes `ThesisUpdate(type='CREATED')`.
3. Sidebar row shows `$TSLA — Awaiting review`.
4. Next morning's 8am daily run: `get_theses` returns the PENDING thesis with `needsAction = { kind: 'REVIEW_DUE', daysOverdue: 0, pendingFirstReview: true }`.
5. Agent researches: `get_stock_data`, scoring, etc.
6. Calls `update_thesis(thesis_id, ...)` with one of three outcomes:
   - `direction: 'LONG', target_price, stop_loss, triggers, core_belief, …` — promotes PENDING → LONG WATCHING. Stays on watchlist.
   - `direction: 'SHORT', …` — same, bearish.
   - `change_status: 'ARCHIVED'` with rationale — declined coverage. Falls off the watchlist. Shows in run summary's *Removed/Researched-passed* bucket.

### Scenario D — Daily run on cadence; $NVDA WATCHING triggers an entry.

1. Hourly trigger evaluator fires; entry trigger predicate matches.
2. `app/thesis.trigger.fired` event → `tactical-run` wakes.
3. Tactical agent re-validates the setup with fresh data, calls `place_trade(thesis_id: nvda_id, …)`.
4. Alpaca paper order placed; `Position` row created.
5. Inside `place_trade`: Thesis WATCHING → ACTIVE. `ThesisUpdate(type='STATUS_CHANGED', summary='Promoted NVDA LONG WATCHING → ACTIVE on place_trade', tradeId: position.id)` written.
6. Run summary bucket: **Promoted (now active)**.

### Scenario E — Position stops out.

1. `price-monitor` hourly cron sees NVDA hit stop (or the agent decides to close, or `tactical-run` decides on an EXIT trigger).
2. `close_position(thesis_id: nvda_id, reason: STOP_HIT)` → Alpaca close order.
3. Position closes. Thesis ACTIVE → CLOSED. `ThesisUpdate(type='CLOSED')` written.
4. `trade-evaluator` cron runs later, fills `position.agentEvaluation` with the GPT-4o post-mortem grading against `coreBelief / keyAssumptions / invalidationConds`.

### Scenario F — Daily run finds $NVDA view broken before entry.

1. NVDA was LONG WATCHING. Earnings miss + guidance cut overnight.
2. Daily run reviews the thesis. Invalidation condition tripped.
3. `update_thesis({ thesis_id, change_status: 'INVALIDATED', invalidReason: 'Guidance cut; deceleration confirmed' })`.
4. Thesis WATCHING → INVALIDATED. `ThesisUpdate(type='INVALIDATED')`. Off the watchlist.
5. Run summary bucket: **Removed (invalidated)**.

### Scenario G — User removes $INTC from watchlist via editor chat.

1. User edits analyst via editor chat, removes INTC from the suggested watchlist.
2. Editor analyst-update path runs:
   - `update_thesis({ thesis_id, change_status: 'ARCHIVED', rationale: 'Removed via editor chat' })`.
3. Thesis WATCHING → ARCHIVED. `ThesisUpdate(type='STATUS_CHANGED', fieldChanges: { status: { from: 'WATCHING', to: 'ARCHIVED' } })`. Off the watchlist.
4. Run summary bucket: **Removed (archived)**.
5. The prior INTC thesis stays visible on `/stocks/INTC` for history.

### Scenario H — Direction flip on a live name ($NVDA was LONG, view breaks; later a fresh SHORT view emerges).

Two stages, in different runs. Mode allowlists forbid Daily/Tactical from minting fresh theses — that's Discovery's job.

**Stage 1 — Daily or Tactical Run: view breaks.**
1. Agent reviews $NVDA. Evidence says the bull thesis is dead.
2. `update_thesis({ thesis_id: old_nvda, change_status: 'INVALIDATED', invalidReason: 'Guidance cut + multiple compression' })`.
3. Old thesis WATCHING → INVALIDATED. Run summary bucket: **Removed**.

**Stage 2 — Sunday Discovery: SHORT view emerges.**
1. Discovery re-encounters $NVDA via a fresh signal.
2. Calls `get_theses({ ticker: 'NVDA', include_history: true })` → reads the prior INVALIDATED LONG thesis.
3. Researches the new SHORT setup.
4. `record_thesis({ ticker: 'NVDA', direction: 'SHORT', status: 'WATCHING', parent_thesis_id: old_nvda, … })` — new row chained.

### Scenario I — Builder seeds a fresh analyst.

1. User completes the builder chat with watchlist `[NVDA, AMD, AVGO]`.
2. `createAnalystFromConfig` server action runs inside a single transaction:
   - Creates the `AgentConfig` row.
   - Creates a `BUILDER_SEED` ResearchRun.
   - Mints three `Thesis({ direction: 'PENDING', status: 'WATCHING', source_kind: 'BUILDER_SEED' })` rows under that run.
   - Writes one `ThesisUpdate(type='CREATED')` per seed.
3. First daily run's `get_theses` returns all three PENDINGs with `needsAction = REVIEW_DUE / pendingFirstReview`. Agent researches them on Day 1.

### Scenario J — User promotes an analyst PAPER → LIVE.

Analyst has been running in paper for a while. Two open paper positions: $NVDA LONG, $AMD LONG. Three WATCHING theses. One ARCHIVED PASS (institutional memory).

1. User clicks "Promote to live" on the analyst detail page → confirms in dialog by typing the analyst name.
2. `promoteAnalystToLive` server action runs:
   - Resolves live Alpaca creds and verifies via `getAccount`. Refuses if the live key isn't saved or doesn't authenticate.
   - Refuses if a `ResearchRun(status='RUNNING')` exists for the analyst.
   - For each open paper position, in order:
     - `closeOpenPosition(pos.id, "MANUAL", ...)` — closes at market in the **paper** Alpaca account (creds resolved from `Position.environment`).
     - Marks `Position.closeReason = "PROMOTED"`.
     - Transitions the linked `ACTIVE` thesis to `PROMOTED`, freezing conviction context: `promotedAt`, `paperTenureDays`, `paperRealizedPnl` (cumulative across all paper closes on this ticker), `paperReviewCount` (count of UPDATED/REVIEWED audit rows on the thesis).
     - Writes one `ThesisUpdate(type='STATUS_CHANGED', fieldChanges: { status: { from: 'ACTIVE', to: 'PROMOTED' } })`.
   - Each (close, position update, thesis transition) commits before moving to the next ticker — a mid-flight Alpaca failure leaves a coherent state and the user can retry.
   - Marks any ACTIVE-orphan theses (LONG/SHORT, no open position) as PROMOTED too — same conviction shape; the close step is a no-op.
   - Flips `AgentConfig.tradingEnvironment` to `LIVE` (optionally updates `realMaxPosition` from the dialog).
3. WATCHING theses are untouched. The PASS ARCHIVED stays ARCHIVED. The watchlist seeds (PENDING WATCHING) stay PENDING WATCHING.
4. Next daily run (now in LIVE mode) sees: 0 ACTIVE theses, 2 PROMOTED theses ($NVDA, $AMD), 3 WATCHING theses, 1 PENDING WATCHING (seed). Structurally different from any prior run — the agent's whole job that morning is graduating PROMOTED + WATCHING to live positions.
5. Per-thesis review:
   - PROMOTED $NVDA: `get_stock_data` → recompute target/stop relative to today's price → `update_thesis(change_status: "ACTIVE", target_price: ..., stop_loss: ...)` → `place_trade`. Trade fills live. Thesis is now ACTIVE.
   - PROMOTED $AMD: $AMD has run +9% past the paper-era target while the user was reviewing the dialog. Agent calls `update_thesis(change_status: "WATCHING", rationale: "Captured the move; let the WATCHING flow re-enter if it pulls back to N")`. Thesis is now WATCHING with old ENTER trigger.
   - WATCHING theses: walked the normal way; some get promoted, some stay watching.
   - PENDING WATCHING: gets researched and committed exactly like Scenario A — but the resulting LONG/SHORT lands in the live account on next entry.
6. If user later demotes LIVE → PAPER (`demoteAnalystToPaper` or `closeAllLivePositionsAndDemote`), any remaining PROMOTED theses revert to WATCHING with a STATUS_CHANGED audit row. Conviction context fields stay on the row for later reference; `promotedAt` clears.

---

## 5. Where each user-visible view comes from

| View | Query |
|---|---|
| **Analyst watchlist** (`/analysts/[id]` sidebar) | `Thesis WHERE researchRun.agentConfigId = X AND status = 'WATCHING'`. Includes PENDING + LONG + SHORT WATCHING. |
| **Analyst Positions** | `Position WHERE analystId = X AND status = 'OPEN'`, joined to its ACTIVE Thesis. |
| **Stock detail** (`/stocks/[symbol]`) | `Thesis WHERE ticker = X` — no status filter. Shows everything from every analyst, terminal rows included as history. |
| **Activity log** (per thesis) | `ThesisUpdate WHERE thesisId = X` ordered by timestamp desc. |
| **Run summary (5 buckets)** | All derived server-side from `ThesisUpdate WHERE runId = $runId`. See §11. |

---

## 6. The horizons

Every LONG/SHORT thesis carries `horizon` — the discriminator that gives every other field its shape. Four values:

| Horizon       | What it is                                                                 | Hold                       | Default review cadence | Exit policy |
|---------------|----------------------------------------------------------------------------|----------------------------|------------------------|-------------|
| **CATALYST**  | Trade built around a binary event (FDA decision, M&A close, named earnings, court ruling) | Days around event | Daily | Hold to event resolution OR 30d past `catalystDate` |
| **TRADE**     | Momentum/pattern setup with a tight stop                                    | Days-to-weeks, bounded by `maxHoldDays` | Daily | Stop, target, or maxHoldDays — whichever fires first |
| **TARGET**    | Swing trade with a defined upside number                                    | Weeks-to-months            | Weekly                 | Stop, target, or thesis invalidation. No time stop. |
| **COMPOUNDER**| Long-term hold based on durable business quality                            | Months-to-years            | Quarterly              | Broken thesis only. Ignore intra-quarter noise. |

PENDING and PASS theses carry no horizon (`horizon = null`). PENDING gets one when promoted to LONG/SHORT; PASS never needs one.

**Where DAY fits:** there's no `DAY` horizon enum value today. Intraday Momentum Scalper uses `horizon=TRADE` + the EOD-flatten cron for the no-overnight rule. This is intentional.

The constants live in [`lib/agent/horizon-policy.ts`](../lib/agent/horizon-policy.ts) — `HORIZON_REVIEW_DAYS`, `HORIZON_REVIEW_CADENCE`, `HORIZON_EXIT_POLICY`. `record_thesis` imports the day constants for `nextReviewAt` math; the daily-run prompt imports the cadence + policy strings for per-thesis hint rendering.

---

## 7. Per-horizon shape (the matrix)

The horizon doesn't just label the trade — it constrains the shape of every other field. Concrete cells:

### CATALYST / WATCHING / LONG (biotech-event scenario)
- `catalyst_date` REQUIRED
- `target_price` = pre-event accumulation level (the ENTER trigger threshold)
- `stop_loss` = invalidation level
- Default triggers: PRICE_ABOVE(target) → ENTER (cd=1), OR(8-K, 10-Q, 10-K) → REVIEW (cd=1), EARNINGS_BEAT/MISS → REVIEW (cd=7), 14d hygiene
- `key_assumptions` must include something falsifiable about the event
- `invalidation_conditions` must include "event canceled / event already played"

### CATALYST / ACTIVE / LONG
- ENTER fired and the agent promoted via `place_trade`
- Triggers: PRICE_BELOW(stop) → EXIT (cd=0); OR(filings) → REVIEW; "30d past catalystDate" exit policy

### TRADE / ACTIVE / LONG (swing breakout)
- `max_hold_days` REQUIRED (no default; agent declares the window)
- Triggers: PRICE_BELOW(stop) → EXIT (cd=0), PRICE_ABOVE(target) → EXIT (cd=0), TIME_ELAPSED(maxHoldDays) → REVIEW
- `core_belief` is setup-specific ("$NVDA breaks $185 base on volume")

### TARGET / ACTIVE / LONG (the 6-month / +150% / -5% anchor)
- `target_price` = entry × 2.5; `stop_loss` = entry × 0.95
- Triggers: PRICE_BELOW(stop) → EXIT (cd=0), PRICE_ABOVE(target) → REVIEW, EARNINGS_BEAT/MISS → REVIEW (cd=7), 30d hygiene
- `max_hold_days` not set (TARGET is open-ended)

### TARGET / WATCHING / SHORT
- ENTER trigger is PRICE_BELOW(target) — mirror of LONG
- Note: support-REVIEW path is LONG-only today; SHORT mirror remains a known gap

### COMPOUNDER / ACTIVE / LONG (megacap secular)
- Wider stop (-15% to -20%)
- `key_assumptions` are secular drivers (capex, demand, regulatory, moat)
- `invalidation_conditions` are structural breaks (regulatory, business-model, CFO departure, two consecutive guidance cuts)
- 90d hygiene cadence

### COMPOUNDER / WATCHING / LONG
- ENTER trigger uses 7d cooldown (patient — short-term spikes through the breakout level are noise on a multi-year hold)

### PENDING / WATCHING (any seed)
- No horizon, no target/stop/entry, no triggers, no belief fields
- `nextReviewAt = createdAt` so the next daily run picks it up via `needsAction.REVIEW_DUE` with `pendingFirstReview: true`
- `source_kind` is `USER_ADDED` (manual UI), `BUILDER_SEED` (analyst create), or `EDITOR_SEED` (editor chat)

### PASS / ARCHIVED (terminal-at-write institutional memory)
- No horizon, no target/stop/entry, no triggers
- `reasoning_summary` REQUIRED — what was researched, why it didn't fit
- `invalidation_conditions` REQUIRED — what would change the verdict (so a future encounter can compare)

---

## 8. Fields

The Thesis row has three logical sections: **durable belief**, **operational state**, **provenance**. The split matters because each section has a different write discipline.

### Durable belief — set at create, refined rarely

| Field | Required for | Notes |
|---|---|---|
| `coreBelief`         | LONG/SHORT | ONE sentence stating WHAT will happen and why. The load-bearing claim. Distinct from `reasoningSummary` (current-state framing, refreshed often). |
| `keyAssumptions`     | LONG/SHORT (≥2) | Falsifiable premises that must remain true. Generic prose insufficient. |
| `invalidationConds`  | LONG/SHORT (≥2); PASS (≥1) | Concrete things that would prove the belief wrong. On PASS theses, double as flip-criteria. |

The **structural-belief gate** (`record_thesis`) and the **structural-unchanged-reason gate** (`update_thesis`) enforce the discipline. Substantive non-belief patches without touching at least one belief field are rejected unless `structural_unchanged_reason` is supplied. PENDING and PASS are exempt from these gates.

### Operational state — mutated freely

| Field | Notes |
|---|---|
| `horizon` | Required for LONG/SHORT. CATALYST/TRADE/TARGET/COMPOUNDER. Null for PENDING/PASS. |
| `entryPrice`, `targetPrice`, `stopLoss` | Required for LONG/SHORT WATCHING. Validated via [`thesis-shape.ts`](../lib/agent/thesis-shape.ts) (LONG: target > entry > stop). |
| `confidenceScore` | 0-100. Calibration tracking. |
| `triggers` | JSONB array of structured predicates. See [`triggers/types.ts`](../lib/agent/triggers/types.ts). Auto-merged with horizon defaults from [`triggers/defaults.ts`](../lib/agent/triggers/defaults.ts). **Empty for PENDING and PASS theses.** |
| `catalystDate` | REQUIRED when `horizon=CATALYST`. |
| `maxHoldDays` | REQUIRED when `horizon=TRADE` (no silent default). |
| `nextReviewAt` | Derived from horizon if not supplied. Drives the overdue-review cron + `REVIEW_DATE_HIT` trigger. For PENDING, set to `createdAt` so first review fires immediately. |
| `targetSizePct`, `scalingPlan` | Optional. Position sizing intent + scale-in/out ladder. |

### Provenance

| Field | Notes |
|---|---|
| `sourceKind` | `ROUTED_SIGNAL` / `WEB_SEARCH` / `WATCHLIST_REVIEW` / `POSITION_REVIEW` / `USER_ADDED` / `BUILDER_SEED` / `EDITOR_SEED`. The last three are reserved for non-agent code paths (UI manual add, analyst-creation, editor chat). |
| `sourceSignalIds` | When `sourceKind=ROUTED_SIGNAL`, must be non-empty AND every ID must come from this analyst's routed inbox today (validated against `AnalystSignalRoute`). Drives the Monitor ROI tracer. |
| `sourceRationale` | Required for non-ROUTED_SIGNAL kinds. |

### Lifecycle bookkeeping

`status`, `parentThesisId`, `invalidatedAt`/`invalidReason`, `closedAt`/`closeReason`, `createdAt`/`updatedAt` — standard. `closedAt`/`closeReason` are also used for `ARCHIVED` (the column was reused since ARCHIVED is terminal-at-walk-away semantically similar).

### Activity log — `ThesisUpdate`

One row per state change. Type: `CREATED` / `UPDATED` / `TRIGGER_FIRED` / `REVIEWED` / `ACTED` / `INVALIDATED` / `CLOSED` / `SUPERSEDED` / `STATUS_CHANGED`. Carries `fieldChanges` diff, `priceAtTime`, `positionAtTime`, `triggerId`, `signalIds`, `runId`, `tradeId`. The activity log IS the thesis chain — `parentThesisId` exists only for direction flips.

ARCHIVED transitions write `type='STATUS_CHANGED'` (not a dedicated ARCHIVED type — the from/to is in `fieldChanges`). WATCHING → ACTIVE promotions written by `place_trade` use the same shape.

---

## 9. Producers + gates

### `record_thesis` — mints new theses

Required: ticker, direction, confidence_score, reasoning_summary, thesis_bullets, risk_flags, signal_types. Plus per-direction:
- **LONG/SHORT**: horizon, entry/target/stop satisfying shape, **core_belief**, **≥2 key_assumptions**, **≥2 invalidation_conditions**, provenance
- **PASS**: reasoning_summary + ≥1 invalidation_condition (the flip-criteria for a future encounter). Triggers[] rejected at write.

**Agents cannot mint `direction='PENDING'`** — the tool rejects with instructions pointing at `update_thesis` (for promoting an existing PENDING seed) or LONG/SHORT/PASS (for net-new coverage). PENDING is reserved for non-agent server actions (`addWatchlistItem`, `createAnalystFromConfig`, editor analyst-update).

Horizon-conditional requireds:
- **horizon=CATALYST** → catalyst_date REQUIRED
- **horizon=TRADE** → max_hold_days REQUIRED (no silent default)

Gates (in order): shape · belief · provenance · no-PASS-on-held · researched-before · ROUTED_SIGNAL validation · legal-pair · same-direction reject (redirects to update_thesis) · DAY-only cross-analyst overlap · ENTER-trigger guard (LONG/SHORT WATCHING only).

`parent_thesis_id` chains direction flips. Tool transactionally marks the parent SUPERSEDED (or INVALIDATED if the new thesis is PASS) and writes the audit row.

### `update_thesis` — patches existing theses

Required: thesis_id, rationale (≥10 chars). Optional: any field on the row, plus:
- `change_status` (`ACTIVE` / `INVALIDATED` / `CLOSED` / `ARCHIVED`)
- `direction` (`LONG` / `SHORT` / `PASS`) — **PENDING-promotion only.** Allowed only when existing.direction === 'PENDING'.
- `entry_price` — required when promoting PENDING → LONG/SHORT.
- `triggers` (wholesale replace), `signal_ids`, `trigger_id`, `trade_id`, `structural_unchanged_reason`.

Gates:
- **Terminal-status block** — can't update INVALIDATED/CLOSED/SUPERSEDED/ARCHIVED.
- **Direction-change guard** — `direction` arg is only legal when existing.direction === 'PENDING'. Direction flips on committed (LONG ↔ SHORT) theses go through `record_thesis` with `parent_thesis_id`.
- **PENDING-promotion structural fields** — flipping PENDING → LONG/SHORT requires horizon + target_price + stop_loss + entry_price + core_belief + ≥2 key_assumptions + ≥2 invalidation_conditions in the same call. PENDING → PASS requires ≥1 invalidation_condition (the flip-criteria).
- **Zero-trigger guard** — review-only updates on theses with no triggers are rejected; agent must add triggers OR close via `change_status: 'INVALIDATED'` or `'ARCHIVED'`. PENDING is exempt (zero triggers is the expected state; promotion attaches them).
- **Goalpost-moving guard** — refuses to raise `target_price` on a WATCHING thesis whose entry condition is currently met. Bypassed for `change_status: 'ACTIVE'` (legitimate target raise on promotion).
- **Shape gate** — post-patch (entry, target, stop) satisfies direction-relative ordering. Uses the resulting direction (after `direction` patch) for the check.
- **Structural-unchanged-reason gate** — patches that change confidence/target/stop without belief changes AND without `structural_unchanged_reason` are rejected. Bypassed on any `change_status` or `direction` transition.
- **ACTIVE promotion requires** `existing.status === 'WATCHING'` and recomputed `target_price` + `stop_loss`.

**PENDING → PASS auto-flips status to ARCHIVED and clears triggers** in the same patch.

### `place_trade` — opens an Alpaca position from a committed thesis

Required: thesis_id (must be LONG or SHORT, never PENDING), direction, entry_price, target_price, stop_loss, share count or notional.

Gates (in order):
- **PENDING reject** — thesis_id pointing at a PENDING thesis is rejected with instructions to promote via `update_thesis` first.
- Confidence ≥ analyst's minConfidence.
- Open positions < maxOpenPositions.
- No existing OPEN position on (analyst, ticker).
- Shape, sizing, available buying power.

On success: creates Position, **atomically flips paired WATCHING thesis → ACTIVE** (PR #265 — inside the same transaction), sets `thesis.entryPrice / targetPrice / stopLoss` from the trade arguments, writes `ThesisUpdate(type='STATUS_CHANGED', summary='Promoted … WATCHING → ACTIVE on place_trade')` with tradeId.

**Position-thesis desync class (closed by PR #265):** before this auto-promotion was added, `place_trade` created the Position but left the thesis in WATCHING status. This caused the agent to read `get_theses` (WATCHING) and `get_portfolio_context` (position OPEN) simultaneously and treat an already-held name as a watchlist candidate needing entry. Symptoms: agent narrates "Entry executed…" in `reasoningSummary` while `status = WATCHING`, then re-evaluates an ENTER trigger on a position it already holds. Four production theses (AMD, AVGO, GOOGL, TSM) required a manual DB patch on 2026-05-13 (`mfix*` ThesisUpdate IDs). PR #265 makes this impossible for new trades by doing the flip inside the same transaction as the Alpaca order.

### `complete_run` — marks a ResearchRun COMPLETE (PR #266 preflight)

Before flipping `status: RUNNING → COMPLETE`, `complete_run` runs a Layer-1 preflight that refuses if any of the following are true:

- **`record_run_summary` not called** — the run has no summary written yet. Agent must call `record_run_summary` first.
- **Run already FAILED** — if a prior gate (narration-gate, promotion gate) already marked the run FAILED, `complete_run` is rejected. The run can't be retroactively completed.
- **Unaddressed `needsAction` theses** — any ACTIVE or WATCHING thesis for this analyst that `computeNeedsAction` marks non-null (TRIGGER_FIRED / TRIGGER_MATCHING_NOW / REVIEW_DUE) AND that has no `update_thesis` call recorded in this run's tool calls is flagged. The agent must address all triggered theses before completing.

The preflight uses the same `computeNeedsAction` logic as `get_theses` (no more Layer-1 / Layer-2 inconsistency on cooldown math or quote sources).

### Non-agent writers (server actions)

All ultimately produce Thesis rows; no parallel table.

| Writer | Mints | Anchored to |
|---|---|---|
| `addWatchlistItem` (UI manual add) | `Thesis({ direction: 'PENDING', status: 'WATCHING', source_kind: 'USER_ADDED' })` | Per-analyst synthetic `manual-<analystId>` ResearchRun |
| `createAnalystFromConfig` (builder) | one `Thesis({ direction: 'PENDING', status: 'WATCHING', source_kind: 'BUILDER_SEED' })` per seed | Fresh `BUILDER_SEED` ResearchRun in the same transaction |
| Editor analyst-update path | adds → `Thesis(PENDING/WATCHING, source_kind='EDITOR_SEED')`; removes → `Thesis(status='ARCHIVED')` | Fresh `EDITOR_SEED` ResearchRun per edit |
| `removeWatchlistItem` (UI remove) | flips existing Thesis to `status='ARCHIVED'` | — |
| `place_trade` (WATCHING → ACTIVE promotion) | flips Thesis status; writes `ThesisUpdate(STATUS_CHANGED)` with `tradeId` | — |
| `close_position` (ACTIVE → CLOSED) | flips Thesis status; writes `ThesisUpdate(CLOSED)` | — |

`manage_watchlist` does not exist. It was deleted in the 2026-05-13 collapse.

---

## 10. Consumers

| Consumer | Reads | Contract |
|---|---|---|
| **Daily-run prompt V1** ([`system-prompt.ts`](../lib/agent/system-prompt.ts) → `buildV2SystemPrompt`) | Live Theses table (ACTIVE + WATCHING, including PENDING). Per-thesis line: belief preview + horizon exit-policy hint. | Agent walks each thesis with all the structured shape visible. |
| **Daily-run prompt V2** ([`system-prompt.ts`](../lib/agent/system-prompt.ts) → `buildDailyRunSystemPromptV2`) | Identity + edge + universe + yesterday's standup + horizon glossary. ~80 lines total. | Agent reads per-thesis state through `get_theses.needsAction` instead of rendered prompt blocks. Gated on `AgentConfig.useV2Prompt`. |
| **`get_theses.needsAction`** ([`needs-action.ts`](../lib/agent/needs-action.ts)) | Per-thesis: `direction`, `triggers[]`, `nextReviewAt`, latest `ThesisUpdate` row, fresh quote. | Returns `TRIGGER_FIRED` / `TRIGGER_MATCHING_NOW` / `REVIEW_DUE` / null. PENDING theses surface as `REVIEW_DUE` with `pendingFirstReview: true`. Trigger-driven only — no hardcoded proximity. |
| **Tactical-run prompt** ([`intraday-tactical.ts`](../lib/agent/system-prompts/intraday-tactical.ts)) | Full thesis: id, ticker, direction, horizon, **coreBelief, keyAssumptions, invalidationConds**, entry/target/stop, targetSizePct, scalingPlan, recentUpdates. Plus the firing trigger and signal payload. | Validates trigger → scores against keyAssumptions → executes the action. |
| **Discovery-run prompt** ([`discovery.ts`](../lib/agent/system-prompts/discovery.ts)) | `existingTickers` (already-covered set) + analyst config. | Mints LONG/SHORT WATCHING or PASS ARCHIVED. Cannot update or close. |
| **Trigger evaluator** ([`evaluate.ts`](../lib/agent/triggers/evaluate.ts)) | `triggers[]`, `nextReviewAt`, `createdAt`. | Pure predicate matching. No belief reading. PENDING and PASS rows have empty triggers and are naturally skipped. |
| **Trade evaluator** ([`trade-evaluator.ts`](../lib/inngest/functions/trade-evaluator.ts)) | `direction`, `horizon`, **`coreBelief`, `keyAssumptions`, `invalidationConds`**, `sourceSignalIds`, `reasoningSummary`, `signalTypes`, `thesisBullets`. | GPT-4o post-mortem grades against the BELIEF: did each `keyAssumption` hold? Did any `invalidationCondition` come true? |
| **Briefing agent** | Run transcript + portfolio. | Doesn't crack open thesis-level belief fields today. Future enhancement. |
| **ThesisSheet UI** ([`ThesisSheet.tsx`](../components/agent/sheets/ThesisSheet.tsx)) | direction, confidence, reasoning, bullets, risks, entry/target/stop, hold_duration, signal_types, fundamentals, status. Plus separate fetch for triggers/horizon/nextReviewAt via `/api/theses/[id]/triggers`. | Renders the trade card. |
| **Analyst sidebar watchlist** ([`AnalystDetailClient.tsx`](../components/analysts/AnalystDetailClient.tsx) + [`WatchlistRow`](../components/ui/trade-row.tsx)) | `Thesis WHERE status='WATCHING'`. Each row renders ticker + price + direction-aware subline ("Awaiting review" for PENDING, "Watching — long/short" for committed views). | The watchlist UI. Remove action calls `removeWatchlistItem` → flips to ARCHIVED. |
| **Price monitor + trade-exit** | Position fields only. | TRAILING-only (post Morning Run V2 Fix #0). Per-thesis triggers in `lib/agent/triggers/*` are the single source of truth for "should this position close?" |

---

## 11. Run summary — five derived buckets

All five derived server-side from `ThesisUpdate WHERE runId = $runId`. No agent prompt work required.

| Bucket | Filter |
|---|---|
| **Added to watchlist**       | `type='CREATED'` AND `Thesis.status='WATCHING'` AND `direction IN (LONG, SHORT, PENDING)` |
| **Researched, passed**       | `type='CREATED'` AND `Thesis.direction='PASS'` AND `Thesis.status='ARCHIVED'` |
| **Promoted (now active)**    | `type='STATUS_CHANGED'` with `tradeId` set AND `Thesis.status='ACTIVE'` |
| **Removed from watchlist**   | `type IN ('INVALIDATED','STATUS_CHANGED','SUPERSEDED')` resulting in terminal status, **without** an accompanying CLOSED on the same thesisId in the same run |
| **Closed positions**         | `type='CLOSED'` AND `Thesis.status='CLOSED'` |

Discovery runs typically only populate buckets 1+2. Daily and tactical runs can populate any of the five.

---

## 12. What's intentionally not done

The redesign considered several larger changes that were deliberately NOT pursued. Recorded so future sessions don't re-add them.

- **Did not rename horizon → style.** Horizon already names the thing; renaming was churn.
- **Did not split Thesis into watch/enter/hold/exit JSON columns.** Triggers + horizon already encode this. The four-part contract is a conceptual frame, not a schema shape.
- **Did not add `analystId` FK.** The JOIN-via-ResearchRun pattern is ugly but works. Defer until a query-perf gap actually appears.
- **Did not add a DAY horizon.** Intraday Momentum works via `horizon=TRADE` + EOD-flatten cron. Adding DAY is real work for marginal clarity.
- **Did not ship horizon-aware price-monitor / trade-exit.** Constants are in `horizon-policy.ts` but the runtime branching in `price-monitor.ts` and `trade-exit.ts` is not yet wired. That's GAPS P0-5b/c.

### Done since (2026-05-13)

- **Collapsed `manage_watchlist` + `AnalystWatchlistItem` (PR #265).** Thesis is the single store. PENDING direction + ARCHIVED status added. UI, prompts, crons, intelligence routes all flipped to Thesis queries. Tool count drops to 18.
  - **`PENDING` direction** — new state for user/builder/editor-added tickers awaiting first research. Agent's first action on a PENDING thesis is `update_thesis(direction: LONG|SHORT|PASS, …)`. PASS auto-flips status to ARCHIVED and clears triggers.
  - **`ARCHIVED` status** — terminal state for tickers removed from the watchlist without a trade. Covers PASS theses at write, manual UI removes, editor removes, and explicit "walk away" decisions (`change_status: 'ARCHIVED'`). Replaces the deleted `manage_watchlist` for all removal paths.
- **`place_trade` auto-promotes WATCHING → ACTIVE (PR #265).** Atomic; the thesis flip, entryPrice/targetPrice/stopLoss assignment, and ThesisUpdate audit row all happen in the same DB transaction as the Alpaca order. Closes the position-thesis desync class of bugs.
- **`complete_run` preflight (PR #266).** Enforces record_run_summary called + run not already FAILED + no unaddressed needsAction theses before the RUNNING→COMPLETE transition. See producers §`complete_run` above for the full gate spec.
- **Killed "PASS WATCHING" as institutional memory.** PASS is always ARCHIVED at write. Institutional-memory value preserved via stock-page visibility + `get_theses(include_history)` + `parentThesisId` chains on re-encounter.

The principle: **the system was fundamentally sound, not fundamentally broken.** Triggers were the right primitive; horizon was the right discriminator; the lifecycle states worked; the audit log worked. What was missing was structural-belief discipline, the promotion enum, surfacing in the daily-run prompt, the trade evaluator reading the belief, and a single watchlist store. Those have shipped.

---

## See also

- [`VISION.md`](./VISION.md) Pillar 2 — what "thesis quality" is supposed to look like
- [`GAPS.md`](./GAPS.md) — the open punch list
- [`PRINCIPLES.md`](./PRINCIPLES.md) — the three-layer principle (tool gates / tool result shape / prompt as judgment only) that drives where each invariant lives
- [`plans/MORNING_RUN_V2_DESIGN.md`](./plans/MORNING_RUN_V2_DESIGN.md) — the V2 prompt rewrite that applied the three-layer principle to the daily run
- [`legacy/WATCHLIST_COLLAPSE_PLAN.md`](./legacy/WATCHLIST_COLLAPSE_PLAN.md) — the implementation plan for the 2026-05-13 collapse (closed; this doc supersedes it)
- [`/agent-workflow`](../app/(root)/agent-workflow/page.tsx) — the live operational view, driven by [`workflow-registry.ts`](../lib/agent/workflow-registry.ts)
