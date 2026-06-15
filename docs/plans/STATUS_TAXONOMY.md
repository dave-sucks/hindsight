# Status Taxonomy — implementation plan (P1-24) · LOCKED

> Fresh-lens rethink, **locked 2026-06-09**. Each entity owns ONE clean status; the UI renders real statuses **directly**; no mapping file invents a fictional status.
>
> **In-place value migration — keep the `direction` and `status` fields, fix their values.** No rename to stance/state (that's pure churn — it touches every reference and buys only tidier names). The real work is fixing the *values* and killing the fictional UI mapping.

---

## The model

### Thesis = the View
- **`direction`**: `LONG` | `SHORT` | `null`. Which way you lean. `null` = on the watchlist, not yet researched. **PASS and PENDING removed from this field.**
- **`status`**: a 4-state machine + the PROMOTED special case:
  - **WATCHING** — on the radar, tracking for entry (researched-with-a-view, or just-added/unresearched).
  - **HOLDING** — on the radar + an open position. *(= today's ACTIVE, renamed. Execution-owned, never agent-set — the #407 discipline.)*
  - **PASSED** — reviewed, declined to track. Never made the radar. Institutional memory.
  - **RETIRED** — was on the radar (watched and/or held), now done. Carries **`retiredReason`** (`DROPPED` | `SOLD` | `INVALIDATED` | `REPLACED`).
  - **PROMOTED** — kept as-is (paper→live conviction-pause; load-bearing "decide-today" + frozen conviction context).

### State machine
```
Birth → PASSED | WATCHING
WATCHING → HOLDING (bought)  |  RETIRED:DROPPED (stopped watching)  |  PASSED (first research declines an unresearched watch)
HOLDING  → RETIRED:SOLD (sold)  |  WATCHING (sold but re-entry candidate — explicit)
PASSED | RETIRED → WATCHING  (re-activate anytime)
PROMOTED → HOLDING (re-enter) | WATCHING (defer)        [special case]
```
**2 live states** (WATCHING, HOLDING), **2 resting states** (PASSED, RETIRED) — both revisitable — with a **reason on RETIRED**. "Did I buy it?" is **always** the Position's fact (or `retiredReason=SOLD`), never encoded in which bucket the thesis sits in.

### Position & Order — unchanged, rendered directly
- **Position**: `PENDING_APPROVAL` | `OPEN` | `CLOSED` | `CANCELLED`.
- **Order**: `AWAITING_APPROVAL` | `PENDING` | `FILLED` | `REJECTED` | `EXPIRED` | `CANCELLED`, × `intent` (`OPEN`/`CLOSE`/`ADD`/`PARTIAL_CLOSE`).

Already clean. The UI shows them as-is.

---

## Field mapping (current → target)

| Current | Target |
|---|---|
| `direction = PASS` | `direction` = its lean (LONG/SHORT) or `null`; `status = PASSED` |
| `direction = PENDING` | `direction = null`; `status = WATCHING` |
| `status = ACTIVE` | `status = HOLDING` |
| `status = CLOSED` | `status = RETIRED`, `retiredReason = SOLD` |
| `status = INVALIDATED` | `status = RETIRED`, `retiredReason = INVALIDATED` |
| `status = ARCHIVED` (PASS-at-write) | `status = PASSED` |
| `status = ARCHIVED` (walk-away) | `status = RETIRED`, `retiredReason = DROPPED` |
| `status = SUPERSEDED` | `status = RETIRED`, `retiredReason = REPLACED` |
| `status = WATCHING` / `PROMOTED` | unchanged |

---

## UI principle — lists rendering lists

- **Positions**: grouped by real `Position.status` — **Held** (OPEN), **Pending approval** (PENDING_APPROVAL), **Closed** (CLOSED; win/loss from `outcome`). Pending never lumped into "Open."
- **Theses**: filtered by `status` (Watching / Holding / Passed / Retired) — a filter over real data. "Holding" is also visible as the Position lens.
- **Activity feed**: merge Order events (`intent × status` → bought / sold / added / partial + their proposed versions) and Thesis events (`ThesisUpdate.type` → updated / passed / stopped-watching). Each row shows the real status of the thing it's about.
- **Killed**: `deriveTradeStatus` (Position×Order → fictional status), thesis-status-as-holding projection, and every render that masks the real status (rejected → "Sold", PASS → "Archived"). The only surviving mapping is trivial enum → label/color.

---

## Migration — sequenced, safe on the live book

Expand → migrate → contract, **in-place** (fields keep their names). Each PR is independently reviewable + deployable.

- **PR A — Schema additive.** Add `HOLDING` / `PASSED` / `RETIRED` to the status enum; add `retiredReason`; make `direction` nullable. Purely additive — nothing reads or writes the new values yet. Zero behavior change. *(Live-DB migration — review before applying.)*
- **PR B — Backfill + writers + dual-read.** Migrate existing rows per the table above; flip every writer (`record_thesis`, `update_thesis`, `place_trade`, `close_position`, promote action, proposal layer, crons) to emit the new values; readers accept old + new during the transition.
- **PR C — UI cleanup.** Repoint the UI to the new values; kill `deriveTradeStatus` + the projections; split Held vs Pending-approval; make Passed / Retired consistent everywhere.
- **PR D — Agent vocabulary.** Tools + prompts to the new values.
- **PR E — Contract.** Remove the old enum values + the old-value reader handling.

> The XENE "Held vs Pending approval" split (PR C) needs no schema change — it reads `Position.status` directly. Can ship early as a standalone safe win.

---

## PROMOTED — the one special case
Not folded into the 4-state core. It's an account transition (paper position force-closed at promotion, awaiting first live re-entry) carrying "decide-today" semantics + frozen conviction context (`paperTenureDays` / `paperRealizedPnl` / `paperReviewCount`) the daily run depends on. Stays a distinct status; revisited on its own once the core lands.

## Separate (not taxonomy): `Order.status = FILLED` race
3 uncoordinated writers (place_trade inline / reconcile cron / close path). Track + fix independently.
