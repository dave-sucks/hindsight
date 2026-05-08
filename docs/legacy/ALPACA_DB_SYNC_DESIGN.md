# Alpaca ↔ Postgres Sync: Design Doc

**Status:** Draft for approval. Successor to `docs/ALPACA_DB_SYNC_HANDOFF.md` (the postmortem). This doc is the long-term solve.

**Scope:** every financial state surface in the app — positions, orders, account cash/buying-power/equity, realized/unrealized P&L, cost basis. Not scoped: intelligence pipeline, agent prompts, UI design.

**Non-goal:** "eventually consistent." Every async path needs a bounded SLA and a heartbeat that closes the gap inside that SLA.

---

## 0. Disagreement with the handoff doc's ordering — read before approving

The handoff lays out four workstreams (A heartbeat → B DB-first writes → C WebSocket → D Alpaca-authoritative). I agree with A and B. **I want to defer C and D.** Reasoning:

- **Workstream C (Alpaca trade-updates WebSocket)** requires a long-lived TCP connection. Vercel serverless functions can't host one (max execution ~5 min, no socket persistence). The realistic options are (a) a dedicated worker on Railway/Fly — explicitly banned — or (b) an Inngest "infinite step" pattern, which Inngest doesn't support. The remaining path is to keep doing REST-poll reconciliation. With paper-trading volume in single digits per day and a tightened heartbeat (1 min during RTH), the 5-min-poll latency is fine. **Recommend: do not build C unless we hit a measurable SLA breach we can attribute to polling latency.**
- **Workstream D (replace `Position.status` with computed `isOpen` from order history)** is a schema migration that earns its keep only if B+C still leak edge cases. With B done correctly (idempotency key + DB-first write + heartbeat covering everything), drift count goes to zero and D becomes a stylistic refactor. **Defer until A+B run clean for 30 days.**

I also found a third drift source the handoff didn't enumerate: see §3.4 (`trade-exit.ts` price-monitor close path bypasses Alpaca entirely). This needs to be fixed in B.

**Net plan:** A, then B (expanded to fix the trade-exit bug), then stop and measure. Ship C/D only on evidence.

---

## 1. Invariants

These are the contract. Each is verifiable by a single SQL query or a short script. The heartbeat (§5) runs them and alerts on any violation.

| ID | Invariant | Tolerance | Verifiable by |
|----|-----------|-----------|---------------|
| I1a | Every `Position.status='OPEN'` matches an Alpaca position with same (symbol, direction). | exact | `reconcile-alpaca-positions.ts` |
| I1b | Every Alpaca position matches exactly one OPEN `Position` row. | exact | same |
| I1c | Sum of DB rows' `quantity` for (symbol, direction) == Alpaca `qty`. | abs Δ < 0.0001 | same |
| I2a | Every `Order.status='FILLED'` matches Alpaca `order.status='filled'` with matching `filledQty`/`filledPrice`. | filledQty exact, filledPrice abs Δ < $0.01 | new heartbeat check |
| I2b | Every `Order.status='PENDING'` either resolves or is alerted within SLA (5 min RTH, 60 min off-hours). | SLA-bounded | heartbeat |
| I2c | No Alpaca order exists without a corresponding `Order` row keyed by `client_order_id`. | exact | heartbeat (requires Workstream B) |
| I3 | `SUM(Position.quantity * Position.avgCost) WHERE status='OPEN'` == Alpaca `cost_basis` (sum of position cost_basis). | abs Δ < $1.00 (float drift) | heartbeat |
| I4 | UI-rendered `cash` / `buying_power` / `equity` are pulled live from `getAccount()` at render time. **No cached values.** | render-time fetch only | code review + lint rule (§7) |
| I5a | Aggregated UI-rendered realized P&L == `SUM(Position.realizedPnl) WHERE status='CLOSED'`. | exact | render-time computation |
| I5b | That sum, over a date window, == Alpaca trade history P&L for the same window. | abs Δ < $1.00 | weekly heartbeat |
| I6 | No state where Alpaca has a fill we don't know about, OR we have a position Alpaca doesn't. | zero | I1+I2 together |

If any invariant cannot be verified by an automated check, the invariant doesn't exist.

---

## 2. Source of truth, per surface

The rule: **Alpaca is authoritative for what the broker did. The DB is authoritative for what we decided and why.** When they disagree about what's currently held, Alpaca wins.

| Surface | Source of truth | DB role | Read pattern |
|---|---|---|---|
| Open positions (qty, avgCost, side) | Alpaca | mirror, with attribution metadata | DB join with Alpaca-driven `client_order_id`; heartbeat reconciles |
| Order state (PENDING/FILLED/CANCELLED) | Alpaca | mirror | DB-first write with `client_order_id`; reconcile cron resolves PENDING |
| Position metadata (analyst, thesis, target, stop, exitStrategy) | DB | authoritative | DB read |
| `cash` / `buying_power` / `equity` / `portfolio_value` | Alpaca | never store | live fetch on every render via `getAccount()` |
| Cost basis (open positions) | Alpaca aggregated; DB per-row | mirror | computed from DB; heartbeat checks against Alpaca |
| Realized P&L (per closed position) | DB (`Position.realizedPnl`) | authoritative | computed at close; reconciled against Alpaca trade history weekly (I5b) |
| Realized P&L (aggregate UI) | DB sum | authoritative | live aggregation, no caching |
| Unrealized P&L | derived (live price − avgCost) × qty | not stored | computed on read |
| Equity curve (history) | Alpaca `getPortfolioHistory()` | not stored | live fetch |
| Peak/trough watermarks | DB (`Position.peakPrice`/`troughPrice`) | authoritative | maintained by price-monitor |

---

## 3. Audit findings — every read/write of financial state

Compiled by reading every file in §4 of the handoff plus an exhaustive grep across `lib/`, `app/`, `scripts/`. Format: (surface, source of truth, current sync mechanism, failure mode, fix).

### 3.1 Write paths to (Alpaca + DB)

| Path | Files | Current flow | Failure mode | Fix |
|---|---|---|---|---|
| Open position | [lib/agent/tools/place-trade.ts:192,247](../lib/agent/tools/place-trade.ts) | Alpaca-first, then `$transaction`, with PR #185 saga rollback. No `client_order_id`. | Rollback Alpaca call may itself fail. No idempotency for retried agent steps. | Workstream B: DB-first PENDING → set `client_order_id` from row id → call Alpaca → promote to FILLED. |
| Full close (agent) | [lib/agent/tools/manage-position.ts:214](../lib/agent/tools/manage-position.ts) → `closeOpenPosition` | delegates to closeOpenPosition (below) | inherits | inherits |
| Full close (action) | [lib/actions/closeTrade.actions.ts:104](../lib/actions/closeTrade.actions.ts) | Alpaca-first, poll 5s, retry DB tx 3× w/ CRITICAL log on failure (PR #185). | Alpaca close cannot be undone. DB stuck-OPEN if all retries fail. | Workstream B: write CLOSE-PENDING `Order` first with `client_order_id`, then call Alpaca, then promote on confirm. Heartbeat sweeps stuck. |
| Partial close | [lib/agent/tools/manage-position.ts:316](../lib/agent/tools/manage-position.ts) | Alpaca-first w/ `commitOrLogCritical`. | Same as full close. | Same as full close. |
| Add to position | [lib/agent/tools/manage-position.ts:471](../lib/agent/tools/manage-position.ts) | Alpaca-first w/ `commitOrLogCritical`. | Same. | Same. |
| Cancel pending position | [lib/actions/closeTrade.actions.ts:325](../lib/actions/closeTrade.actions.ts) | Alpaca cancel → DB tx. | Cancel Alpaca call may fail; DB rolls forward anyway. | Workstream B: write CANCEL-PENDING first; cancel Alpaca; promote. |
| **Auto-exit (price-monitor)** ⚠️ | [lib/trade-exit.ts:226](../lib/trade-exit.ts) → `closeOpenPosition(positionId, reason, currentPrice, …)` | `closeOpenPosition` sees `closePriceOverride !== undefined` → **skips Alpaca entirely**, marks DB CLOSED at currentPrice. | **Every TARGET/STOP/TIME exit creates IN_DB_NOT_IN_ALPACA drift on purpose.** This is a bug the handoff doc didn't call out. | Workstream B: remove the `closePriceOverride` shortcut. Always call Alpaca. Use the price for the local fallback only when Alpaca returns no fill. |
| Position update (targets/stop/trailing) | [lib/agent/tools/manage-position.ts:587–778](../lib/agent/tools/manage-position.ts) | DB-only — no Alpaca side. | None — these don't touch Alpaca by design. | Keep as-is. |

### 3.2 Read-then-write paths (must reconcile after each cycle)

| Path | File | Reads | Writes | Risk |
|---|---|---|---|---|
| Pending order reconcile | [lib/inngest/functions/reconcile-orders.ts](../lib/inngest/functions/reconcile-orders.ts) | Alpaca order state for every PENDING `Order.alpacaOrderId` | Order → FILLED/CANCELLED/REJECTED, Position → OPEN/CLOSED/CANCELLED | Today: works for PENDING orders that have an `alpacaOrderId`. After Workstream B: also covers DB-first PENDING rows whose Alpaca call failed mid-flight (because they'll be looked up by `client_order_id` instead). |
| Hourly price monitor | [lib/inngest/functions/price-monitor.ts](../lib/inngest/functions/price-monitor.ts) | Alpaca quotes for OPEN positions | PositionEvent (PRICE_CHECK), Position (peakPrice, status=CLOSED via trade-exit) | Triggers the §3.1 ⚠️ bug above. Fix at source. |
| EOD evaluation | [lib/inngest/functions/eod-evaluation.ts](../lib/inngest/functions/eod-evaluation.ts) | Alpaca quotes | PositionEvent (EOD_CHECK), `trade/closed` events | Idempotent. No Position-status mutation. Safe. |
| Trade evaluator | [lib/inngest/functions/trade-evaluator.ts](../lib/inngest/functions/trade-evaluator.ts) | Position + Thesis | Position.agentEvaluation, Monitor success counters | No financial mutation. Safe. |
| Inline dashboard reconcile | [lib/actions/portfolio.actions.ts:665](../lib/actions/portfolio.actions.ts) | Alpaca order status for any PENDING orders for this user | Promotes them to FILLED on render | "Fix on read" — masks problems. **Replace with read-only display + heartbeat.** |

### 3.3 Read-only paths (display surfaces, must satisfy I4–I5)

| Surface | File | Source | Verdict |
|---|---|---|---|
| Dashboard PortfolioStats: cash, buying_power, equity | [lib/actions/portfolio.actions.ts:659](../lib/actions/portfolio.actions.ts) → `getAccount()` | Alpaca live | I4 ✓ |
| Dashboard realized P&L | derived from `Position.realizedPnl` sum (DB) | DB | I5a ✓; I5b not yet checked |
| Dashboard unrealized P&L | (live price − avgCost) × qty | Alpaca live prices + DB | OK |
| Equity curve | `getPortfolioHistory()` | Alpaca live | OK |
| Trade detail page | DB `Position.realizedPnl` + live price | DB + Alpaca live | OK |
| Agent prompt portfolio context | [lib/agent/run-input.ts:194](../lib/agent/run-input.ts), [lib/agent/tools/get-portfolio-context.ts](../lib/agent/tools/get-portfolio-context.ts) | `getAccount()` + `getLatestPrices()` live | OK; depends on DB `Position` rows being correct |
| Activity feed | DB `PositionEvent` | DB | OK |
| Intelligence /health page | [app/api/intelligence/health/route.ts](../app/api/intelligence/health/route.ts) | Prisma only | No financial display today. Add SyncHealthSnapshot panel here (§5). |

### 3.4 Other findings worth fixing in B

- **Zero callers set `client_order_id`** when invoking Alpaca. `placeMarketOrder` ([lib/alpaca.ts:126](../lib/alpaca.ts)) doesn't pass it through. Required prerequisite for idempotency.
- **`Position.status` is a `String`**, not a Prisma enum. Cheap to convert in the same migration that adds `idempotencyKey`. See handoff Q4.
- **`scripts/dedupe-alpaca-positions.ts` is not idempotent for matched rows** if Alpaca and DB already agree — it's a no-op, which is fine. Keep it. Promote it from `--execute` to `--dry-run` default (already is).

---

## 4. The fix — Workstream B in detail (post-A)

### 4.1 Schema additions

Single migration, additive only:

```prisma
model Order {
  // …existing fields…
  idempotencyKey String   @unique  // server-generated cuid; passed to Alpaca as client_order_id
  intent         String   // "OPEN" | "CLOSE" | "PARTIAL_CLOSE" | "ADD" | "CANCEL"
  alpacaSubmittedAt DateTime?      // when we attempted the Alpaca call
  alpacaConfirmedAt DateTime?      // when we got a non-error response back
  // status enum stays a String for now; convert in a follow-up
}

model Position {
  // status stays String; convert in a follow-up
}

model SyncHealthSnapshot {
  id                          String   @id @default(cuid())
  capturedAt                  DateTime @default(now())
  orphansAlpacaNotInDb        Int
  staleDbNotInAlpaca          Int
  duplicateDbRows             Int
  quantityMismatches          Int
  pendingOrdersOverSla        Int
  costBasisDriftDollars       Float
  affectedIds                 Json     // { orphans: [], stale: [], duplicates: [], … }
  alpacaAccountSnapshot       Json     // { cash, buyingPower, equity, costBasis }
  @@index([capturedAt])
}
```

### 4.2 Write-path flow (the canonical pattern)

For every action that mutates Alpaca + DB:

```
1. Begin DB tx:
   a. Generate idempotencyKey = cuid()
   b. INSERT Position (PENDING) and/or UPDATE Position (target intent)
   c. INSERT Order { intent, idempotencyKey, status='PENDING', alpacaOrderId=null }
   d. INSERT PositionEvent (intent log)
2. Commit tx. → returns row ids.
3. Call Alpaca with client_order_id=idempotencyKey.
   - On 2xx: UPDATE Order SET alpacaOrderId=resp.id, alpacaSubmittedAt=now()
   - On 4xx (rejected, validation): UPDATE Order SET status='REJECTED'; UPDATE Position SET status='CANCELLED'
   - On 5xx / network / timeout: leave Order PENDING. Do NOT retry inline.
4. Poll Alpaca up to 5s for fill. If filled: UPDATE Order SET status='FILLED', filledPrice, filledAt; UPDATE Position SET status='OPEN' (or CLOSED for sells), avgCost.
5. Return success or "PENDING — will reconcile" to caller.
```

Why this works:

- A crash between (2) and (3) leaves a PENDING Order with no `alpacaOrderId`. Reconcile-orders v2 (§4.3) looks up by `client_order_id` via the Alpaca orders endpoint. If Alpaca has it, we fetched the wrong response — Alpaca knows the order. If Alpaca doesn't have it, the call never landed; mark REJECTED safely.
- A crash between (3) and (4) leaves a PENDING Order *with* an `alpacaOrderId`. Reconcile-orders v2 (existing code path, slightly extended) handles this.
- An agent retry (model decides to call `place_trade` twice) replays the same step but generates a *fresh* idempotencyKey. The Alpaca side dedupes by client_order_id only within a request. We dedupe at our level by checking for an open Position row up front (already done in `place_trade`).
- The compensating-rollback code from PR #185 stays in place during the migration window, then is removed in the final cleanup commit.

### 4.3 Reconcile-orders v2

Today: looks up PENDING orders by `alpacaOrderId`. After B: also looks up PENDING orders by `client_order_id` via `GET /v2/orders?client_order_id=…`. This catches the (2)→(3) crash gap.

Add: alert when an Order is PENDING for > SLA (5 min RTH, 60 min off-hours).

### 4.4 Fix the price-monitor auto-close bug

In `closeOpenPosition`, remove the `closePriceOverride` "skip Alpaca" branch. The override stays as a hint for the local fallback price *only when Alpaca's response is unavailable*. Update `trade-exit.ts:226` to call without an override (the function will fetch the latest price itself). Net: every auto-exit goes through Alpaca, just like every agent-driven close.

### 4.5 Pass client_order_id through Alpaca client

`lib/alpaca.ts` `placeMarketOrder` adds optional `clientOrderId` param. All callers in §3.1 set it from their freshly-created Order row's `idempotencyKey`.

---

## 5. Workstream A — heartbeat (ships first)

### 5.1 Cron

`lib/inngest/functions/sync-heartbeat.ts`. Schedule: every minute during RTH (9:30–16:00 ET Mon-Fri), every 15 min outside RTH.

### 5.2 What it checks

Six invariant queries (I1a/b/c, I2b, I2c, I3). All read-only. Persist a `SyncHealthSnapshot` row per run.

### 5.3 What it auto-heals vs escalates

- **Auto-heal (idempotent, narrow):** none in v1. Detection only. We've been burned by automated mutations; the bar for adding self-healing is "we ran A for 30 days and trust it."
- **Escalate (always):** any non-zero invariant violation → `console.error` with `CRITICAL-SYNC-DRIFT` prefix + Vercel webhook → email via Resend (handoff Q3 — recommend email; Vercel logs aren't sufficient for a P0 paper-money invariant).

### 5.4 Surface

Add a "Sync health" panel to `/intelligence/health`. Four stat cards + last 24h timeline of snapshots. Latest snapshot's `affectedIds` is one click away.

### 5.5 The "is the system healthy right now?" query

Single SQL view, `v_sync_health_now`:

```sql
CREATE VIEW v_sync_health_now AS
SELECT
  capturedAt                              AS last_check,
  orphansAlpacaNotInDb                    AS orphans,
  staleDbNotInAlpaca                      AS stale,
  duplicateDbRows                         AS duplicates,
  quantityMismatches                      AS qty_mismatches,
  pendingOrdersOverSla                    AS stuck_pending,
  costBasisDriftDollars                   AS cost_basis_drift,
  CASE
    WHEN orphansAlpacaNotInDb + staleDbNotInAlpaca + duplicateDbRows
         + quantityMismatches + pendingOrdersOverSla = 0
         AND ABS(costBasisDriftDollars) < 1.00
    THEN 'HEALTHY' ELSE 'DRIFT'
  END                                     AS overall
FROM "SyncHealthSnapshot"
ORDER BY capturedAt DESC LIMIT 1;
```

You can run this any time. `SELECT * FROM v_sync_health_now;` — one row, "HEALTHY" or "DRIFT".

---

## 6. WebSocket trade-updates — explicit rejection (Workstream C)

I'm proposing not to build this. Justification:

- Vercel hosts every API route on serverless functions with hard execution caps. A WebSocket subscriber needs a long-lived process. The handoff suggests "single Node worker on Vercel serverless instance" — that doesn't exist as a runtime; functions terminate.
- Inngest doesn't expose a "long-lived consumer" primitive either. Step-sleep loops are bounded.
- Constraints rule out Railway/Fly.
- Paper-trading volume on Hindsight is < 20 orders/day across 6 analysts. The reconcile-orders cron at 5-min cadence handles this. After A+B, the heartbeat catches anything reconcile misses, within 1 minute during RTH.

If the user later disagrees and wants C: the path is a single dedicated worker (Railway is the cheapest) running `subscribeTradeUpdates()` and writing to the same DB. Cost: ~$5/mo on Railway hobby. Operational cost: a process to monitor + reconnect logic. This decision is reversible — nothing in A/B precludes it.

---

## 7. Migration plan

No feature flags, no migration modes. Each step is a discrete PR that is provably safe to deploy and provably leaves the system more correct than before.

| Step | PR | Ships | Validates by | Rollback |
|---|---|---|---|---|
| 1 | Schema migration: add `SyncHealthSnapshot`, `Order.idempotencyKey/intent/alpacaSubmittedAt/alpacaConfirmedAt`. All additive, all nullable until B. | Workstream A prereq | `npx prisma migrate diff` clean; existing reads/writes unaffected. | `prisma migrate resolve --rolled-back` + revert PR. Additive columns are safe to leave. |
| 2 | Heartbeat cron + `/intelligence/health` "Sync health" panel + email alert wiring (Resend). | Workstream A | Run for 24 h; expect 0 drift on the freshly-cleaned book. | Disable cron, remove panel, keep schema. |
| 3 | Pass `client_order_id` through `lib/alpaca.ts` (no callers use it yet — pure plumbing). | Workstream B prereq | Existing tests pass; integration test against paper account places one order with a known client_order_id and reads it back. | Revert PR; column unused. |
| 4 | Convert `place_trade` to DB-first flow. Wire `idempotencyKey`. **Keep PR #185's saga rollback as belt-and-suspenders.** | Workstream B (1/4) | Adversarial test (§9) for `place_trade` passes against paper account. Heartbeat reports 0 drift across the next 8 AM cron. | Revert PR; saga rollback still protects the old path. |
| 5 | Convert `closeOpenPosition` to DB-first flow. Remove `closePriceOverride` skip-Alpaca branch. Fix `trade-exit.ts` caller. | Workstream B (2/4) | Adversarial test for close. Heartbeat clean across 1 RTH session with auto-exits firing. | Revert PR; restore override branch. |
| 6 | Convert `manage_position` partial_close + add_to_position to DB-first flow. | Workstream B (3/4) | Manual test of each action against paper account. Heartbeat clean across one cron cycle that exercises both. | Revert. |
| 7 | Convert `cancelPosition` to DB-first flow. Update reconcile-orders to look up by `client_order_id` when `alpacaOrderId` is null. | Workstream B (4/4) | Heartbeat clean across the next full week. | Revert. |
| 8 | Remove PR #185's saga rollback + `commitOrLogCritical` retry helpers. Delete the inline reconcile in `portfolio.actions.ts:665` (read-only dashboard). | Cleanup | All preceding heartbeats green for 7 consecutive days. | Re-add helpers; they were defensive-only by then. |
| 9 (later) | Convert `Position.status` to Prisma enum. | Polish | Schema diff + runtime tests. | Standard prisma rollback. |

**Order matters.** Each step inherits the previous step's safety net. The book is never exposed.

---

## 8. Observability

### 8.1 Metrics persisted (per heartbeat run)

Already covered in `SyncHealthSnapshot`. Six counts + cost-basis drift + a JSON of affected ids + Alpaca account snapshot. 1 row/min during RTH = ~390 rows/day. Cheap to keep 90 days.

### 8.2 Logs

Existing CRITICAL prefixes from PR #185 stay in place. New: `CRITICAL-SYNC-DRIFT` from the heartbeat. Standardize on the `CRITICAL-` prefix; `/intelligence/health` can grep recent Vercel logs for it via the existing log access pattern.

### 8.3 Alerts

Resend email to the user's auth email when the heartbeat finds non-zero drift. One email per drift episode (debounce: don't re-alert if `affectedIds` overlaps the last alert sent < 60 min ago).

### 8.4 The single healthcheck query

`SELECT * FROM v_sync_health_now;` — see §5.5. Returns one row. Good or bad.

---

## 9. Validation before we call it done

### 9.1 Continuous

- Heartbeat reports 0 drift for 7 consecutive trading days, including at least one full live 8 AM cron cycle that opens, manages, and closes positions.
- Weekly: I5b — `SUM(Position.realizedPnl) WHERE closedAt within last 7 days` matches Alpaca trade-history P&L for the same window within $1.

### 9.2 Adversarial — must each pass at least once

| Test | How | Expected |
|---|---|---|
| Kill DB during `place_trade` | Pause Supabase mid-call (paper environment), trigger one `place_trade`, restore DB. | After heartbeat fires: Alpaca order is reflected; PENDING Order resolves via reconcile within SLA; no orphan; no duplicate. |
| Force Alpaca fill before DB row exists (preempts WebSocket scenario) | Manually `placeMarketOrder` against paper API with a known `client_order_id`, then have agent code attempt the same op. | Lookup-by-client_order_id finds the existing order; we adopt it; no second order placed; Position row is correctly attributed. |
| Auto-exit fires with Alpaca down | Set a position's stop just above current price; bring Alpaca to 503 via firewall rule for 60 s; let price-monitor fire. | Order PENDING; heartbeat alerts after 5 min; reconcile resolves on Alpaca recovery; DB and Alpaca agree at the end. |
| Duplicate place_trade in same step | Force agent to call `place_trade` twice for the same ticker in one run. | Second call fails the existing-OPEN-position guard already in place. No second Alpaca order. |
| Partial close mid-flight crash | Trigger partial_close, kill the function process between Alpaca fill and DB tx. | Reconcile picks up the FILLED order via `client_order_id`; Position qty corrected on next pass. |

### 9.3 Eyeball validation

- Dashboard cash/buying_power/equity match Alpaca paper account web UI to the cent on at least 5 random checks across 3 trading days.
- `/intelligence/health` Sync panel shows HEALTHY for 7 consecutive RTH days.

---

## 10. Open questions for the user

1. **Email alerts via Resend**: yes / Vercel logs only? (handoff Q3) — I assumed yes for P0 invariants.
2. **`Position.status` enum conversion** — happy to bundle into Step 9 of the migration. Worth doing?
3. **Heartbeat frequency**: 1-min during RTH, 15-min off-hours. Is the 15-min off-hours fine, or do you want 5-min off-hours given that after-hours fills happen?
4. **Dedicated WebSocket worker**: I'm recommending we don't build it. If you want it anyway, I'll spec the Railway worker — but it's the only piece in this plan that adds a new runtime.
5. **`portfolio.actions.ts:665` inline reconcile removal** — Step 8 deletes this. Is there any reason to keep it (e.g. you like that the dashboard "fixes itself" on render)? Removing it is the clean answer; the heartbeat covers the reconcile job instead.

---

## 11. What this doc replaces / supersedes

- `docs/ALPACA_DB_SYNC_HANDOFF.md` — keep as historical postmortem. After Workstream B Step 8 ships clean for 7 days, mark it `Status: superseded by ALPACA_DB_SYNC_DESIGN.md` and stop updating.
- The 4-workstream sequencing in the handoff. Replaced by §0 + §7.

---

**Approval requested before any code change.** Open questions in §10 are blocking; everything else is detail I'll match to your call on §10.
