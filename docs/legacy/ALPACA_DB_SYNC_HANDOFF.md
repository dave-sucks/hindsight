# Alpaca ↔ DB Sync: Handoff Brief

**Status as of 2026-04-24 EOD:** stopgap fixes shipped (PRs [#183](https://github.com/dave-sucks/hindsight/pull/183), [#185](https://github.com/dave-sucks/hindsight/pull/185) merged). Analysts re-enabled. Drift *should* no longer accumulate silently, but we have **no heartbeat, no dashboard, and no prevention** — only better detection. This doc exists so the next session can build the actual long-term solve.

---

## 1. What happened (the incident)

The user opened the Trades page and saw ~40 open positions. The Alpaca paper account showed **12**. On closer look the real Alpaca count was actually around **8 distinct positions** — we had bought and never-recorded a bunch, and recorded-as-closed-but-not-closed a bunch, over several weeks of autonomous 8 AM cron runs.

Supabase inspection found:

- **`IN_ALPACA_NOT_IN_DB`** — Alpaca holdings with no matching `Position` row. ~10 orphans. The agent had called Alpaca, Alpaca filled, the DB `$transaction` failed (or never ran), and the position was invisible in the app forever.
- **`IN_DB_NOT_IN_ALPACA`** — `Position` rows with `status='OPEN'` that Alpaca had already closed days/weeks earlier. The `reconcile-orders` Inngest job had not caught up.
- **`DUPLICATE_DB_ROWS`** — multiple OPEN `Position` rows for the same `(symbol, direction)` pair. `MU` had 4. This was the loudest signal — the dedupe script's original `Map<key, row>` silently collapsed them; we wrote them all and none of them ever got closed.
- **`QUANTITY_MISMATCH`** — matched symbol+direction, but Alpaca qty ≠ sum of DB rows.

Root cause (plain English): **every tool that mutated both Alpaca and Postgres did Alpaca first, then the DB transaction, with nothing holding them together.** The tools were `place_trade`, `close_position` (via `closeOpenPosition`), and `manage_position` (`partial_close`, `add_to_position`). Any Postgres blip in the 1-5s window between the two writes leaked orphans. Over thousands of tool calls across weeks, that's how we got here.

## 2. What we fixed (the stopgaps)

### PR [#183](https://github.com/dave-sucks/hindsight/pull/183) — dedupe/reconcile scripts

- `scripts/reconcile-alpaca-positions.ts` — read-only diagnostic. Now groups DB rows into `Map<key, Array<row>>` so duplicates aren't silently collapsed. Reports `DUPLICATE_DB_ROWS` up top. Compares Alpaca qty against the **sum** of matching DB rows, not just one.
- `scripts/dedupe-alpaca-positions.ts` — mutating cleanup. Groups duplicates the same way. Keeps the most-recently-opened row per `(symbol, direction)`; marks the older duplicates `status='CLOSED'`, `closeReason='RECONCILE_DUPLICATE'`, `realizedPnl=0`. Sync qty/avgCost from Alpaca on the keeper. Requires `--execute` to mutate.

### Manual cleanup (via Supabase MCP)

Done directly against the Hindsight project (`zomxxtqiszpkqrjrqqat`):

- Neutralized all duplicate OPEN rows.
- Synced matched positions' qty + avgCost to Alpaca values.
- Closed DB-only stale rows with `closeReason='RECONCILE_MANUAL'`.
- Left 4 legit OPEN positions: **AVGO, CAPR, MU, NIO** — those match Alpaca 1:1.
- User queued 8 liquidation orders on Alpaca for the orphans (filled at Monday open 2026-04-28).

### PR [#185](https://github.com/dave-sucks/hindsight/pull/185) — tool-level saga / retry

- **`place_trade`** ([lib/agent/tools/place-trade.ts](../lib/agent/tools/place-trade.ts)) — compensating Alpaca rollback. If the post-Alpaca `$transaction` fails, we `cancelOrder()` (unfilled path) + `closePosition()` (filled path). Whichever is a no-op throws and is swallowed. **Closes the orphan-creation path.**
- **`closeOpenPosition`** ([lib/actions/closeTrade.actions.ts](../lib/actions/closeTrade.actions.ts)) — Alpaca close can't be "uncancelled", so we retry the DB finalize 3× with exponential backoff (250/500/1000 ms). On final failure: `CRITICAL` log with `positionId` + `alpacaOrderId` so reconcile can find the stuck row. **Reduces stuck-OPEN drift, doesn't eliminate it.**
- **`manage_position`** ([lib/agent/tools/manage-position.ts](../lib/agent/tools/manage-position.ts)) — factored `commitOrLogCritical()` helper. Applied to `partial_close` and `add_to_position`. `full_close` delegates to `closeOpenPosition` so it inherits that retry. `update_targets` / `move_stop_to_breakeven` / `set_trailing_stop` are DB-only, no wrapper needed.

### What these fixes do *not* do

- **They don't prevent drift, only reduce it.** Retry 3× and log doesn't help if the DB is down for 30s. The `CRITICAL` log is an alert, not a fix. We **trust** that `reconcile-orders` will eventually catch up — which is the same trust that failed us the first time.
- **`place_trade`'s rollback is best-effort.** If the rollback Alpaca call *also* fails, we still leak.
- **Nothing polls for divergence.** A new orphan would live silently until the user notices.

---

## 3. What "truly in sync" looks like (the design goal)

At any point in time, the following invariant should hold:

> For every `Position` row with `status='OPEN'`, Alpaca has a matching position with the same symbol, direction, and (≈) quantity. And vice versa.

Today we achieve this **by convention** — every tool is *supposed* to keep both sides aligned. Convention is how we ended up with 40 rows for 8 real positions. The long-term solve needs to make the invariant **structurally true**, not convention-enforced.

---

## 4. Long-term solution (the plan)

Four workstreams, ordered by blast radius × effort ratio.

### Workstream A — Reconcile heartbeat (ship first, ~2 hrs)

**Goal:** turn `scripts/reconcile-alpaca-positions.ts` into a cron that runs every 15 min, logs drift count, and alerts when non-zero.

1. Create `lib/inngest/functions/reconcile-heartbeat.ts` — port the script's diagnostic logic. Do **not** mutate; just count.
2. Emit the counts: `orphans_alpaca_not_in_db`, `stale_db_not_in_alpaca`, `duplicate_db_rows`, `quantity_mismatches`.
3. Persist to a new `SyncHealthSnapshot` table (timestamp, each count, JSON of affected ids).
4. If any count > 0, trigger a Vercel log with `CRITICAL-SYNC-DRIFT` prefix. (Email alert optional — user reads Vercel logs already.)
5. Schedule: every 15 min during market hours, every hour off-hours.
6. Surface the latest snapshot on `/intelligence` (or a new `/health` page) as 4 stat cards.

**Why first:** cheap, makes drift *visible* within 15 min instead of weeks. Everything else depends on knowing drift exists.

### Workstream B — Flip the write order (DB-first, ~1–2 days)

**Goal:** remove the "Alpaca committed but DB didn't" class of bug structurally.

1. In `place_trade`: before calling Alpaca, write a `PENDING` `Order` row + a `PENDING` `Position` row. Tag with a client-generated `idempotencyKey`.
2. Pass `idempotencyKey` to Alpaca as `client_order_id` — Alpaca dedupes on this, so retrying the same call is safe.
3. Call Alpaca. On success: promote `Order` → `FILLED`, `Position` → `OPEN`. On known failure: mark `Order` → `FAILED`, `Position` → `CANCELLED`. On unknown failure (network): leave `PENDING` — the heartbeat from Workstream A will resolve it.
4. Same pattern for close / partial_close / add: write `PENDING` audit + state-transition intent rows first.
5. Now a crash mid-flow leaves a `PENDING` row we can reconcile, never an orphaned Alpaca position.

**Why second:** this is the real architectural fix. Everything else is defense in depth around a system that still has the race condition.

### Workstream C — Alpaca trade-update WebSocket (~2–3 days)

**Goal:** kill the 5-second fill-polling window. Replace with event-driven updates.

- Alpaca streams `trade_updates` events: `new`, `fill`, `partial_fill`, `canceled`, `expired`, `rejected`, `replaced`.
- Stand up a long-lived connection (Inngest `step.sleep` loop, or a lightweight Node worker on a single Vercel serverless instance — Alpaca's connection limit means only one subscriber).
- On each event: look up `Position` by `client_order_id` (from Workstream B), apply the state transition in a single tx.
- `place_trade` / `closeOpenPosition` stop polling; they just submit the order and return the `PENDING` state. The stream does the finalization.
- Net result: fills are reflected in DB in milliseconds, and there's no polling window to lose races in.

**Why third:** WebSockets require operational care (reconnects, missed events). Workstream A gives us the safety net to catch anything this layer misses while we build it.

### Workstream D — Make Alpaca authoritative for "is it open" (~1 day, optional)

**Goal:** remove the possibility of "DB says OPEN, Alpaca says no" by removing the independent DB claim.

- Keep `Position` row as metadata (analyst, thesis, runId, avgCost, targets).
- Replace `Position.status` with a computed `isOpen` derived from the latest known `Order` state (from Workstreams B+C). Or cache it, but source-of-truth is orders.
- Views/queries asking "what's open right now" join through orders, not `Position.status` directly.
- This is a schema change and a migration, so lower priority — only worth it if Workstreams B + C still leave edge cases.

---

## 5. Recommended sequencing

| Week | Ship | Why |
|------|------|-----|
| 1 | Workstream A (heartbeat) | Visibility first. Cheap. Catches regressions from Workstream B. |
| 1–2 | Workstream B (DB-first writes) | The actual fix. Ships behind A's heartbeat so we see if anything slips. |
| 2–3 | Workstream C (WebSocket fills) | Performance + race elimination. Requires A and B to already be stable. |
| 4+ | Workstream D (authoritative reads) | Only if B+C leave edge cases. |

After Workstream A: re-audit the drift numbers. If B isn't blocking anything, we may not need C and D at all.

---

## 6. Context the next session needs

### Files that matter

- [lib/agent/tools/place-trade.ts](../lib/agent/tools/place-trade.ts) — has compensating rollback. `idempotencyKey` / DB-first flow needs to be added here.
- [lib/actions/closeTrade.actions.ts](../lib/actions/closeTrade.actions.ts) — `closeOpenPosition`. Has retry+CRITICAL. Same DB-first treatment needed.
- [lib/agent/tools/manage-position.ts](../lib/agent/tools/manage-position.ts) — `commitOrLogCritical()` helper at top. 5 action branches; partial_close and add_to_position are the Alpaca-mutating ones.
- [scripts/reconcile-alpaca-positions.ts](../scripts/reconcile-alpaca-positions.ts) — read-only diagnostic, good base for Workstream A.
- [scripts/dedupe-alpaca-positions.ts](../scripts/dedupe-alpaca-positions.ts) — mutating cleanup, keep around for emergencies. Do not run without `--execute`.
- [lib/inngest/functions/](../lib/inngest/functions) — all crons live here, incl. the existing `reconcile-orders` job that we now know isn't sufficient on its own.
- [lib/alpaca.ts](../lib/alpaca.ts) — Alpaca client. `placeMarketOrder`, `closePosition`, `cancelOrder`, `getOrder`, `getLatestPrice`, `getAllPositions`.
- `prisma/schema.prisma` — `Position`, `Order`, `PositionEvent`, `PositionManagementAction`. Note: `Position.status` is a `String`, not an enum — possible values observed: `OPEN`, `CLOSED`, `CANCELLED`.

### Known quirks

- `Position.status = 'OPEN'` does not imply Alpaca agrees. That's the whole incident.
- The existing `reconcile-orders` Inngest job handles order fill reconciliation but apparently has gaps; audit before assuming it covers Workstream B's `PENDING` rows.
- Alpaca's `client_order_id` is a Workstream B prerequisite — confirm our Alpaca client passes it through (`lib/alpaca.ts`).
- Analysts only fire on the 8 AM ET Mon-Fri Inngest cron (`morning-research.ts`) OR the manual Run button. They do not autonomously fire otherwise — so disabling `AgentConfig.enabled = false` is a reliable kill switch. All 6 analysts are enabled right now.
- `/intelligence/health` page exists but is minimal ([docs hint in commit 6a51a88](https://github.com/dave-sucks/hindsight/commit/6a51a88)) — candidate landing spot for Workstream A's dashboard.

### What's in Supabase right now (as of commit of this doc)

- 4 OPEN Position rows: AVGO, CAPR, MU, NIO. qty + avgCost match Alpaca.
- 8 Alpaca liquidation orders queued for Monday 2026-04-28 market open.
- 6 AgentConfig rows, all `enabled=true`. They will run at 2026-04-28 8 AM ET.

### How to validate after Workstream A ships

```bash
npx tsx scripts/reconcile-alpaca-positions.ts
# Expect: 0 orphans, 0 stale, 0 duplicates, 0 mismatches.
```

If the heartbeat reports drift after any cron run, Workstream B's urgency goes up.

---

## 7. Open questions for the next session

1. **Does `reconcile-orders` handle `PENDING` Order rows, or only fills for non-PENDING orders?** Audit before Workstream B assumes it'll cover the `PENDING → FILLED` reconciliation path.
2. **Is a single WebSocket subscriber on Vercel serverless workable, or does Workstream C need a dedicated worker (Railway, Fly, etc.)?** Vercel functions time out; a long-lived WS doesn't naturally fit.
3. **Does the user want email alerts from Workstream A, or just Vercel logs?** Affects whether we bolt on Resend or not.
4. **Should `Position.status` become an enum in Prisma?** Low-cost refactor that would make Workstream D cleaner. Do it whenever.
