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

---

## Execution status + handoff (live — 2026-06-14)

**The model is LOCKED (above). This section is the live state + the rule-book so any session picks it up with zero prior context.**

### Done
- **PR A (#411)** — additive schema — **merged + migration applied to prod** (verified: `HOLDING`/`PASSED`/`RETIRED` enum values, nullable `retiredReason`, nullable `direction`; 815 theses intact).
- **PR #412** — `lib/thesis-status.ts` display foundation (the 3 new labels) — **open, awaiting merge.** Shared base; concept-PRs build on it, do **not** re-add to `thesis-status.ts`.

### In flight (separate sub-sessions; each opens its own PR — review before merge)
- **B1 — PASS → PASSED.** Store researched-declined theses as `status:"PASSED"` (was `ARCHIVED`); keep `direction:"PASS"` for now. Fixes the discovery `record_thesis` red error + the Pass-shows-as-"Archived" display bug. Touches `record-thesis.ts` (input enum ~362 + `effectiveStatusForTriggers` ~1057 + guard the non-PASS branch), `discovery.ts:447` prompt, every ARCHIVED-as-terminal query (add `PASSED`), + backfill `UPDATE "Thesis" SET status='PASSED' WHERE direction='PASS' AND status='ARCHIVED'`.
- **Dashboard Held/Pending** — display-only: the positions list shows **held + pending-buy + pending-sell together, grouped + labeled** (NOT hidden/removed — it's the principal's main view of open trades).

### Remaining concept-PRs — SEQUENTIAL (each edits the same files; do NOT parallelize)
Order: **B2 → B3 → B4 → agent-vocab → UI cleanup → contract.** One lands + is reviewed, then the next.
- **B2 — ACTIVE → HOLDING.** Writers: `place_trade` inline flip, `promoteThesisOnApproval`. Readers: every `status === "ACTIVE"`. Backfill `ACTIVE→HOLDING`.
- **B3 — CLOSED / INVALIDATED / ARCHIVED / SUPERSEDED → RETIRED + `retiredReason`.** Writers: close path (`closeThesisForPosition`), `update_thesis`, record_thesis parent-flip, watchlist/editor removes. Backfill with the reason per the mapping table above (ARCHIVED-walkaway→`DROPPED`, CLOSED→`SOLD`, INVALIDATED→`INVALIDATED`, SUPERSEDED→`REPLACED`).
- **B4 — PENDING → null direction.** Seeds (`addWatchlistItem`, builder/editor). Readers: `direction === "PENDING"`. Backfill `direction=NULL WHERE direction='PENDING'`.
- **Agent vocab** — teach the agents the new statuses: `get_theses` / `needs-action` / `complete-run` outputs + the prompts (`system-prompt.ts`, `system-prompts/intraday-tactical.ts`, `system-prompts/discovery.ts`). The agents must understand HOLDING/PASSED/RETIRED to reason correctly.
- **UI cleanup** — kill `deriveTradeStatus` fiction + the thesis-as-holding projection; render real statuses.
- **Contract** — remove the legacy enum values once nothing reads them.

### Per-concept recipe (apply to each)
1. Flip the writer(s) to emit the new value.
2. **Dual-read:** `rg "<OLD_VALUE>" lib components app` — every Thesis-status reader/query handling the old value must also handle the new. Allowlists (`status IN ('ACTIVE'…)`) are safe — the new value just isn't allowed in. **Denylists / terminal-IN lists are the danger** — add the new value or a pass/holding leaks into the wrong view.
3. **Backfill SQL** — apply AFTER the code deploys (readers handle the new value first), via Supabase MCP, **with the principal's approval**. Count first.
4. Verify: `npx prisma generate` → `npx tsc --noEmit` → `npx jest` (affected) → **run the app** (a migrated thesis renders right + doesn't leak into the wrong list).

### Operational
- Migrations apply **manually** (build only runs `prisma generate`). The **principal applies DB migrations + backfills**, or approves an MCP apply. Supabase project id `zomxxtqiszpkqrjrqqat`. DB-first: apply a migration **before** the schema deploys.
- `gh auth switch --user dave-sucks` before any push. Worktrees have no `.env` — run `prisma generate` before `tsc`.
- Reader surface ≈ 158 status/direction branches / ~42 files — much is **Position/Order** status (does NOT change); the **Thesis** subset is ~20-30 files. Grep per-concept.
