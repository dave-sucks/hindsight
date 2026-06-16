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

> ⚠️ **STALE — superseded by the "Live status — updated 2026-06-15" section at the bottom of this file.** B1–B4, agent-vocab, UI-cleanup, and the dashboard split are all MERGED + deployed + backfilled. Only the contract PR (+ a brief-detail fix) remains. The original sequencing/recipe below is kept for historical reference only.

### Done (original plan-time snapshot — now all merged; see Live status section)
- **PR A (#411)** — additive schema — merged + migration applied to prod.
- **PR #412** — `lib/thesis-status.ts` display foundation (the 3 new labels) — merged. Shared base; do **not** re-add to `thesis-status.ts`.

### Concept-PRs — ALL MERGED (B1 → B2 → B3 → B4 → PASS-off-direction → agent-vocab → UI-cleanup → dashboard split)
The sequenced value-flips landed in order, each backfilled with the principal's go. See the field-mapping table above for the value moves and the Live status section for the merged PR list. Per-concept recipe (writer flip → dual-read → backfill → verify) retained below for the contract PR.

### Per-concept recipe (apply to each)
1. Flip the writer(s) to emit the new value.
2. **Dual-read:** `rg "<OLD_VALUE>" lib components app` — every Thesis-status reader/query handling the old value must also handle the new. Allowlists (`status IN ('ACTIVE'…)`) are safe — the new value just isn't allowed in. **Denylists / terminal-IN lists are the danger** — add the new value or a pass/holding leaks into the wrong view.
3. **Backfill SQL** — apply AFTER the code deploys (readers handle the new value first), via Supabase MCP, **with the principal's approval**. Count first.
4. Verify: `npx prisma generate` → `npx tsc --noEmit` → `npx jest` (affected) → **run the app** (a migrated thesis renders right + doesn't leak into the wrong list).

### Operational
- Migrations apply **manually** (build only runs `prisma generate`). The **principal applies DB migrations + backfills**, or approves an MCP apply. Supabase project id `zomxxtqiszpkqrjrqqat`. DB-first: apply a migration **before** the schema deploys.
- `gh auth switch --user dave-sucks` before any push. Worktrees have no `.env` — run `prisma generate` before `tsc`.
- Reader surface ≈ 158 status/direction branches / ~42 files — much is **Position/Order** status (does NOT change); the **Thesis** subset is ~20-30 files. Grep per-concept.

---

## Live status — updated 2026-06-15 (supersedes the in-flight/remaining lists above)

**Data migration COMPLETE + verified in prod.** Live counts: status {RETIRED 659, PASSED 119, WATCHING 22, HOLDING 15}; direction {LONG 437, null 358, SHORT 20, PASS 0, PENDING 0}; retiredReason {REPLACED 360, SOLD 136, INVALIDATED 134, DROPPED 29 = 659}. Zero legacy enum values in the book; 0 zombies / 0 desync.

**Merged:** #411 schema · #412 labels · #414 B1 PASS→PASSED · #415 B2 ACTIVE→HOLDING · #416 B3 terminals→RETIRED+reason · #417 B4 PENDING→null · #418 PASS-off-direction · #413 dashboard Held/Pending split · #419 agent-vocab (prompts + tool text + /agent-workflow + docs/prompts) · #420 UI-cleanup (killed `deriveTradeStatus`, inlined real `Position.status`+`outcome` at its 2 call sites; also fixed a latent `PENDING_APPROVAL`→"Holding" mislabel in the analyst-detail trade row) · #421 brief-detail (dropped the fake bucket-projected status tags + prose-guessed direction — audit finding #1).

**Done (hygiene, not a PR):** stale-RUNNING-run reconcile — 37 stuck `RUNNING` ResearchRuns (oldest 2026-06-05) flipped to FAILED on 2026-06-15 (`updatedAt < now()-interval '1 hour'`); verified 0 RUNNING remain. Zero token bleed (all past the 800s serverless cap).

**Remaining — ONE item:**
1. **Contract PR (LAST).** In progress. Scope (decided 2026-06-15):
   - **Storage enums contract FULLY** — drop legacy values from the Prisma `Thesis.status` enum (ACTIVE/CLOSED/INVALIDATED/ARCHIVED/SUPERSEDED) and `Thesis.direction` enum (PASS/PENDING). Safe because handlers never write the legacy values (verify first). Postgres can't drop an enum value in place → needs the create-new-type / swap-column / drop-old-type dance. **Apply the enum-shrink migration AFTER the code that references the values is deployed green.** Recommend splitting: (A) code refs + dual-read removal + docs (deployable, no schema change) → green in prod → (B) enum-shrink migration.
   - **Tool INPUT vocabulary = Option 3 (conservative alias-keep), NOT a full flip.** The DB storage enum and the agent's Zod input enums are SEPARATE types — the input layer can keep accepting legacy verbs that the handlers translate. Remove only the genuinely-dead input verbs nothing emits (`change_status` ACTIVE/CLOSED; direction PENDING) + refresh `describe()` text. **KEEP `change_status` INVALIDATED/ARCHIVED + `direction:"PASS"` as accepted input aliases** — they're the agent's battle-tested intent language, the #419 prompts still emit them, and the handlers map them to new-vocab storage. Flipping the agent's input vocabulary is a SEPARATE deliberate agent-behavior change (prompt + enum in lockstep + eval, off-cron) for later — it must NOT ride with the storage contraction (rejected tool call = failed run on a live book).
   - Remove dual-read (`isPassedThesis` + legacy reader branches); rewrite `docs/THESIS_ARCHITECTURE.md`; deferred `/agent-workflow` verb-doc cleanup; fold in audit findings #2–4 below.
   - **Hold the MERGE until a deploy cycle confirms the merged stack is stable in prod** (data is already 100% new-values, so no rush; drafting now is fine).

**Adjacent (NOT taxonomy, surfaced this session):** extract the thesis-sheet `PriceTargetsBlock` (entry/stop/target/current gauge) into a shared component + reuse it on the trade detail page where it was hand-duplicated without the current marker (separate PR). Thesis-card redesign (entry/current/target gauge as Tier-1, mini price-chart story as Tier-2) — parked as a GAPS item, discuss separately.

### UI status audit — genuine findings (2026-06-15)
Full read-only sweep of every status/direction render across homepage, thesis rows, run/agent renderers, trades, analyst detail. **All live/primary surfaces trace to a real DB field** (`Position.status`/`outcome`/`direction`, `Order.status`/`intent`, `Thesis.status`/`direction`, server-reconciled action verbs). The exceptions:

1. **✅ RESOLVED (#421).** `components/intelligence/brief-detail.tsx:97,100` — was the one genuine user-visible fake: "Holding"/"Watching" tag projected from *which MorningBrief bucket* the item came from, + an up/down arrow regex-guessed from the alert prose. #421 dropped the fake tag + arrow and re-grouped items under honest bucket-labeled sections (Portfolio / Watchlist / New Opportunities). No live `Thesis.status` join (deprecated brief data).
2. **`lib/thesis-status.ts:48` — unknown-status fallback returns the `ACTIVE`/"Active" display** (blue pulse). Post-migration "Active" should never appear; a genuinely-unknown status silently renders as confident "Active" instead of obviously-wrong. Latent (all callers currently pass real enum values). **Fix:** neutral "Unknown"/gray fallback. → fold into contract.
3. **`components/ui/thesis-row.tsx:372` — `null` direction coerced to `"PASS"`.** Safe *only* because the consumer (`IntentSuffix`) is dead code and the sheet's `isPass` is status-guarded. Landmine if that prop is read later without the status guard. **Fix:** explicit pass-status handling; delete dead `IntentSuffix`. → fold into contract.
4. **`components/domain/trade-card.tsx` + `run-summary-card.tsx` — stale duplicate hardcoded status maps**, not wired into any live run surface (email/dead). `trade-card` STATUS_CONFIG also lacks `PENDING_APPROVAL`. Dead tech-debt. **Fix:** delete or repoint to `lib/trade-status.ts`/`lib/thesis-status.ts`. → fold into contract.

Robustness (not a correctness bug): the activity-feed ADD/REDUCE/STOP/NEAR_* verbs re-parse a label *string* that was itself built from the real `PositionManagementAction.actionType` — a lossy round-trip that silently falls through to HOLD if the label is renamed. Worth hardening to key on `actionType` directly.
