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

## Live status — ✅ P1-24 COMPLETE (2026-06-16)

**The entire migration is done — data, schema, writers, agent vocab, UI, contract code, and the destructive enum shrink are all live and verified in prod.** Final state: `ThesisStatus` enum = {WATCHING, HOLDING, PASSED, RETIRED, PROMOTED} (legacy values dropped 2026-06-16 via the contract migration); `direction` = LONG | SHORT | null. 815 theses intact, 0 data loss, 0 zombies/desync.

**Data migration COMPLETE + verified in prod.** Live counts: status {RETIRED 659, PASSED 119, WATCHING 22, HOLDING 15}; direction {LONG 437, null 358, SHORT 20, PASS 0, PENDING 0}; retiredReason {REPLACED 360, SOLD 136, INVALIDATED 134, DROPPED 29 = 659}. Zero legacy enum values in the book; 0 zombies / 0 desync.

**Merged:** #411 schema · #412 labels · #414 B1 PASS→PASSED · #415 B2 ACTIVE→HOLDING · #416 B3 terminals→RETIRED+reason · #417 B4 PENDING→null · #418 PASS-off-direction · #413 dashboard Held/Pending split · #419 agent-vocab (prompts + tool text + /agent-workflow + docs/prompts) · #420 UI-cleanup (killed `deriveTradeStatus`, inlined real `Position.status`+`outcome` at its 2 call sites; also fixed a latent `PENDING_APPROVAL`→"Holding" mislabel in the analyst-detail trade row) · #421 brief-detail (dropped the fake bucket-projected status tags + prose-guessed direction — audit finding #1) · #423 PriceTargetsBlock (extracted the entry/stop/target/current gauge to a shared component; reused on the trade detail page; fixed its missing current marker) · #424 contract-code (dual-read removal + legacy-literal scrub + `record_thesis` narrowed to persist only WATCHING/PASSED + Option-3 input-enum trim + audit findings #2–4 + `THESIS_ARCHITECTURE.md` rewrite).

**Done (hygiene, not a PR):** stale-RUNNING-run reconcile — 37 stuck `RUNNING` ResearchRuns (oldest 2026-06-05) flipped to FAILED on 2026-06-15 (`updatedAt < now()-interval '1 hour'`); verified 0 RUNNING remain. Zero token bleed (all past the 800s serverless cap).

**Contract (final phase) — DONE:**
- **#424 contract-code** — merged + deployed. Removed dual-read (`isPassedThesis` + legacy reader branches), scrubbed legacy literals, narrowed `record_thesis` to persist only `WATCHING`/`PASSED` (caught + fixed a real latent ACTIVE-on-direction-flip write bug), trimmed dead input verbs (`change_status` ACTIVE/CLOSED + direction PENDING) while keeping `INVALIDATED`/`ARCHIVED`/`PASS` as translated input aliases (**Option 3** — agent vocab unchanged), rewrote `THESIS_ARCHITECTURE.md`, resolved audit findings #2–4. tsc 0.
- **Contract schema → #426** (NOTE: the original #425 was merged into the `p1-24-contract-code` branch by mistake and never reached main; **#426** re-targeted the schema enum shrink + migration onto main — code-only-free, no #421/#423 revert). Merged + deployed green.
- **Migration APPLIED 2026-06-16** via Supabase MCP (`apply_migration p1_24_taxonomy_contract`), after the step-0 guard confirmed 0 legacy rows. Post-verify: enum = the 5 final values; 815 theses intact; reads OK.

**✅ P1-24 COMPLETE. Nothing else in scope remains.**

**Optional cosmetic follow-up (not blocking, not done):** `docs/prompts/REVIEW_DAILY_RUN.md` + `REVIEW_DISCOVERY_RUN.md` still carry dead `'ACTIVE'` entries in their `status IN (…)` SQL allowlists. Harmless post-contract (text comparison matches nothing), just stale noise — trim when convenient.

**Out of scope / deferred by design (never blocked completion):** PROMOTED revisit; agent input-vocab full flip (Option 3 kept aliases); `Order.status=FILLED` race.

**Adjacent (NOT taxonomy, surfaced this session):** `PriceTargetsBlock` extraction shipped in #423 (above). Thesis-card redesign (annotated price chart: watchlist-add / entry vertical markers + target/stop horizontal lines; Tier-1 gauge → Tier-2 chart) + repurposing the deleted Post-Run brief into a portfolio summary — a design/research session is producing a proposal (`docs/plans/THESIS_VISUALIZATION.md`). Separate from the migration; discuss when the proposal lands.

### UI status audit — genuine findings (2026-06-15)
Full read-only sweep of every status/direction render across homepage, thesis rows, run/agent renderers, trades, analyst detail. **All live/primary surfaces trace to a real DB field** (`Position.status`/`outcome`/`direction`, `Order.status`/`intent`, `Thesis.status`/`direction`, server-reconciled action verbs). The exceptions:

1. **✅ RESOLVED (#421).** `components/intelligence/brief-detail.tsx:97,100` — was the one genuine user-visible fake: "Holding"/"Watching" tag projected from *which MorningBrief bucket* the item came from, + an up/down arrow regex-guessed from the alert prose. #421 dropped the fake tag + arrow and re-grouped items under honest bucket-labeled sections (Portfolio / Watchlist / New Opportunities). No live `Thesis.status` join (deprecated brief data).
2. **✅ RESOLVED (#424).** `lib/thesis-status.ts` unknown-status fallback returned the `ACTIVE`/"Active" display; #424 changed it to a neutral "Unknown" pill so a genuinely-unknown status reads as obviously-wrong, not as confident "Active."
3. **✅ RESOLVED (#424).** `components/ui/thesis-row.tsx` `null` direction was coerced to `"PASS"`; #424 removed the coercion (now yields `null` cleanly) as part of making direction null-safe end-to-end.
4. **✅ DISMISSED (#424 audit).** `trade-card.tsx` / `run-summary-card.tsx` — re-checked: their status maps are **Position-status** (legit enum→label), not the stale Thesis map the audit assumed. Nothing to fix; left as-is.

Robustness (not a correctness bug): the activity-feed ADD/REDUCE/STOP/NEAR_* verbs re-parse a label *string* that was itself built from the real `PositionManagementAction.actionType` — a lossy round-trip that silently falls through to HOLD if the label is renamed. Worth hardening to key on `actionType` directly.
