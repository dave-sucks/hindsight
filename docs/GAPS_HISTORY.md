# Hindsight — Gaps History

> **What this is:** the closed-items trajectory for the **thesis architecture rework**. Each "Done since" block is the punch list of what shipped on that date, what the failure mode was, and how it was resolved. Useful when:
> - You want to understand why a current piece of the system exists.
> - A regression appears and you want to see what shipped near that date.
> - A fresh session needs to learn the rework's history without inflating every active GAPS.md context window.
>
> **What this is NOT:** a general changelog. GitHub PRs are the history record for the whole codebase. This file is scoped to the thesis architecture rework only.
>
> **How it gets updated:** when a P-item closes in `GAPS.md`, the closure block moves here (most recent on top). Don't keep dual copies. Append-only — never edit historical entries except to fix factual errors.

---

## Done since 2026-05-25 (PROMOTED-integration wave + doc cleanup)

Five items, three code PRs (#330 + #331 + #333) plus a same-day cleanup audit that retired four stale doc entries. Headline: the PROMOTED-status work that started with PR #324 is now end-to-end across producers (promotion fan-out), consumers (decision agents read fresh research + researchAge), and the trigger layer (PROMOTED rows no longer carry orphan HELD-template EXIT triggers). One piece of the original P0-13 spec — the `place_trade` Layer-1 staleness gate — is deferred to Phase 2 of `THESIS_LIFECYCLE_FIX.md` and re-filed as the new P1-22.

### ✅ P0-13 — PROMOTED status integration gaps (post-PR #324 architecture review)

**Filed:** 2026-05-24 after PR #324 (PROMOTED status) landed without closing the loop on three downstream consumers + the trigger templates. Four holes total; three shipped same-week, one re-filed.

**The four holes + outcomes:**

| # | Hole | Outcome |
|---|---|---|
| 1 | `write_thesis_research` doesn't know about PROMOTED conviction context | ✅ **Closed via PR #330** — `buildSynthesisPrompt` now accepts optional `promotionContext`; auto-populated when `dispatch_thesis_research(mode:'refresh')` targets a PROMOTED thesis. Output frames Decision Fields against `paperTenureDays / paperRealizedPnl / paperReviewCount`. |
| 2 | `promote-analyst.actions.ts` doesn't auto-dispatch thesis-writer rewrites | ✅ **Closed via PR #330** — new `fanOutPromotionRewrites` fires parallel `app/thesis.write.requested` events for every PROMOTED thesis at promotion time. Dialog surfaces deep-links to each child run so the user can watch them stream. |
| 3 | NO staleness gate on `place_trade` | ⏸ **Deferred to Phase 2** — PR #330's body: *"prototyped it in this session and pulled it back out — the gate's recovery instruction (`call dispatch_thesis_research(mode:'refresh')`) requires that tool to be in the daily/tactical allowlists, which it isn't today. The gate ships in Phase 2 alongside the allowlist additions so the recovery path is real on the same commit."* Re-filed as **P1-22** in `GAPS.md`. |
| 4 | Trigger templates only know `HELD` vs `WATCHING`, not `PROMOTED` | ✅ **Closed via PR #333** — `ThesisState` enum extended to include `"PROMOTED"`; template dispatcher delegates PROMOTED to the WATCHING template family (no EXIT, ENTER off target + REVIEW); `transitionThesisToPromoted` regenerates triggers in the same `$transaction` as the status flip; `close_position` refuses cleanly on PROMOTED status. (P1-21 entry — closed simultaneously.) |

**Adjacent shipping (not part of P0-13 spec but lands the same week):**
- **PR #331** — read-side surfacing. `get_theses` returns `researchAge` (`missing` / `stale` / `fresh`) + a summary-tier excerpt (`snapshot + bullCase + bearCase`) by default. Daily-run + tactical prompts updated to read research before deciding. Sets up the consumer side for P1-22's gate.
- **`THESIS_LIFECYCLE_FIX.md`** plan doc (added in PR #330) lays out the three-phase spine that closes the broader read / refresh / immediate-buy loop. Phase 0 = PR #330 + PR #331 (shipped). Phase 1 = read-side enforcement. Phase 2 = refresh-side allowlists + staleness gate (P1-22).

**Why this matters:** PR #324 added PROMOTED in isolation — the row could be written but no consumer knew about it. Without Holes 1+2 the first live run would have read pre-promotion research and traded blind; without Hole #4 every PROMOTED thesis would have spawned orphan tactical EXIT runs on its first stop-cross. P0-13 was the load-bearing follow-up; closing it makes first-promotion safe.

### ✅ P0-10 — Thesis structured status disagrees with `reasoningSummary` text — folded into P1-20

**Filed:** 2026-05-13 after the GOOGL/Secular Theme failure. Production state at diagnosis: 4 theses (AMD, AVGO, GOOGL, TSM) had open positions but `status = WATCHING`; the agent read `reasoningSummary` ("Entry executed within max position size limits") and classified the names as portfolio-held, ignoring the WATCHING-needs-action work. The free text overrode the structured field in the agent's reasoning.

**Closure:** the immediate failure mode is structurally impossible. PR #265's atomic `place_trade` flip (WATCHING → ACTIVE inside the same DB transaction as the Alpaca order) prevents new occurrences of the desync. The 4 production rows were patched 2026-05-13.

The deeper architectural concern P0-10 raised — that `status` is exposed as a settable arg on `record_thesis` / `update_thesis` and the agent's free-text fields can disagree with the enum — is now better captured by **P1-20** ("Thesis status should be derived from actions, not a manual arg with clamps"). P1-20 proposes removing `status` as a settable arg entirely; that's the structural fix P0-10's path (a) was reaching for. The narrower path (b) — adding a `record_thesis` validator that rejects action verbs in `reasoningSummary` when structured fields don't agree — is subsumed: with P1-20 there's no way to write inconsistent state because the agent never touches status.

**Cross-references:** PR #265 (atomic WATCHING → ACTIVE, the structural fix), PR #316 (`forceWatchingMint` clamp — the third Band-Aid that motivated P1-20), P1-20 (the architectural refactor that absorbs P0-10's spirit).

### ✅ P1-14 — No Layer-1 closeout enforcement for `needs_action: null` theses — V1 path is dead

**Filed:** design follow-up from `MORNING_RUN_V2_DESIGN.md`. The premise: the V2 prompt says "Theses with `needsAction == null` don't need to be touched" while the legacy V1 prompt's "every Live Theses row produces one tool call" contract still exists in parallel code paths.

**Closure:** the V1 prompt path is gone. Concrete evidence (verified by code audit 2026-05-25):
- `buildV2SystemPrompt` (the legacy V1 builder with the misleading name) is still defined in `lib/agent/system-prompt.ts` lines 91–107 but marked `@deprecated` with a comment saying "NO production caller. Will be deleted in a follow-up PR once we've run on V2-only for ~14 trading days."
- grep returns zero callers outside comments.
- `app/api/agent/[mode]/route.ts:238-239` unconditionally calls `buildDailyRunSystemPromptV2` (manual UI runs). The block explicitly notes "V2 is the only path as of 2026-05-16."
- `lib/inngest/functions/morning-research.ts:123` unconditionally calls `buildDailyRunSystemPromptV2` (cron).
- The `useV2Prompt` column was dropped from `AgentConfig` (P2-17 / PR #317) — no schema knob left to toggle.

The "every Live Theses row produces one tool call" contract is now enforced by `complete_run`'s preflight (PR #266 / PR #320) — `runCompleteRunPreflight` uses the same `computeNeedsAction` logic as `get_theses` to identify triggered theses and refuses if any lack an `update_thesis` call. Single source of truth.

**Why this is closed not just stale:** the contradiction the entry described — "two prompts coexisting contradictorily" — has no surface anymore. V2's "null = skip" is the only rule.

### ✅ P2-19 — ThesisSheet skeletons because parent doesn't forward data it already has — PR #313

**Filed:** 2026-05-19 sheet-redesign session. Sheet open from `thesis-row.tsx` (watchlist sidebar, stock-page row, trade-row) passed only ~10 props; the sheet then fired `/api/theses/[id]/triggers` to fetch the remaining fields, producing 300–500ms of skeleton time on every open for data the parent already had in memory.

**Fix (PR #313, merged 2026-05-23):** expanded `ThesisRowData` to include the missing fields (`status`, `coreBelief`, `keyAssumptions`, `invalidationConds`, `scoring`, `scoringComposite`, `sourceKind`, `sourceRationale`, `sourceSignalIds`, `parentThesisId`, `researchSections`, …), updated the Prisma `select` blocks in `/stocks/[symbol]/page.tsx` and `/trades/[id]/page.tsx` to fetch them, and spread the full row into `<ThesisSheet>` instead of cherry-picking. The `/triggers` fetch in `ThesisSheet` became a background refresh.

Net effect: status pill, Core Belief headline, Key Assumptions, Cause for Concern, and Composite Score now render synchronously on every sheet open from the watchlist/stock/trade paths.

**Note:** P2-19's `parentThesisId` reference is unrelated to the audit-chain semantic — it just lists the field as one of the props that wasn't being forwarded. The deeper question of whether `parentThesisId` itself is still pulling weight (separate from P2-19's data-forwarding fix) is now filed as **P2-23** in `GAPS.md` (deprecation track).

---

## Done since 2026-05-24 (PROMOTED trigger hardening — the P1-21 deep dive)

P1-21 closed — the last of the four post-PR-#324 PROMOTED integration holes (P0-13 covered #1–#3; this is #4). Filed 2026-05-24, fixed same day before first promotion. Summarized in the wave block above; full implementation detail below.

### ✅ P1-21 — Trigger templates don't know PROMOTED (Hole #4 from P0-13)

**Filed:** 2026-05-24 architecture review on PR #324. Deferred follow-up — filed as P1 because orphan EXIT runs don't lose money, but they spawn scary "no position found" logs during the first day of live trading (the worst possible observability window).

**Symptom (pre-fix):** PROMOTED theses carried the SAME triggers their predecessor-ACTIVE row carried, including HELD-state EXIT predicates like `PRICE_BELOW(stop) → EXIT`. But a PROMOTED thesis has no open position — the paper position was force-closed at promotion. If price crossed the stop on a PROMOTED-no-position thesis, the trigger evaluator fired `app/thesis.trigger.fired`, tactical-run consumed the event, then fell through to the "no position found" path on close_position (or skipped at load-context per the current ACTIVE+WATCHING status filter). No money lost, but orphan tactical compute + log noise.

**Why this would have escalated:** at filing time (2026-05-24) there were zero PROMOTED rows in DB. After the first analyst gets promoted (PR #330 — promotion fan-out — landed 2026-05-25), every paper-era ACTIVE thesis becomes PROMOTED and inherits its HELD-side triggers. This bug becomes immediate the moment first-promotion lands.

**Fix:** five-part:
1. **`lib/agent/triggers/defaults.ts`** — extended `ThesisState` enum to `"HELD" | "WATCHING" | "PROMOTED"`. The dispatcher in `defaultTriggersForHorizon` delegates PROMOTED to the WATCHING template family (`watchingCatalystDefaults` / `watchingTradeDefaults` / `watchingTargetDefaults` / `watchingCompounderDefaults`) — same shape: no EXIT, ENTER off the target level (the re-entry path), plus the news/earnings/hygiene REVIEW set.
2. **`lib/actions/promote-analyst.actions.ts`** — `transitionThesisToPromoted` now regenerates the trigger array against the PROMOTED template in the same `$transaction` as the status flip. Falls back to keeping existing triggers if horizon is missing (rare). Cooldown defaults backfilled via `applyTriggerCooldownDefaults`.
3. **`lib/agent/tools/close-position.ts`** — explicit refuse-with-clean-error guard if the thesis row has `status='PROMOTED'`. Returns a clear instruction pointing the agent at `place_trade` (re-enter) or `update_thesis(WATCHING)` (defer). Belt-and-suspenders for any orphan EXIT trigger that slipped through the template regen.
4. **`scripts/strip-promoted-orphan-exit-triggers.ts`** — one-shot retro-script. Finds `Thesis WHERE status='PROMOTED' AND triggers contains any (EXIT | TRIM | ADD | MOVE_STOP)`, strips them, regenerates correct PROMOTED-template triggers, writes a `ThesisUpdate(type='UPDATED')` audit row. At ship time touches 0 rows; defensive after first promotion. DRY_RUN gated.
5. **Cross-file: trigger evaluator is state-blind** (`lib/agent/triggers/evaluate.ts`) — just matches predicates. So stripping EXIT triggers from PROMOTED rows is sufficient; no evaluator changes needed.

**Three-layer principle (`docs/PRINCIPLES.md`):** Layer-1 tool gate (close_position refuses) + Layer-1 invariant at write (promote-analyst regenerates triggers). The prompt layer is untouched — the agent never needs to know PROMOTED has different triggers than ACTIVE, because the template generation guarantees the right shape.

**Tests:** TypeScript clean, lint clean. The DRY-RUN of the retro-script on the production DB reported 0 rows (no PROMOTED rows existed yet — verifies the no-op path is correct).

**Cross-reference:** PR #324 (PROMOTED status added — the row this builds on), PR #330 (promotion fan-out — landed 2026-05-25, the trigger that exposes this bug in production), PR #333 (this fix), P0-13 Hole #4 (the architecture-review entry that filed this gap).

---

## Done since 2026-05-23 (close-out wave)

Three items, one PR. Headline: P0-12 (the escalating narration→execution gap on `close_position` — hit 1 of 7 runs on Wed 5/20, 3 of 7 on Fri 5/22) is structurally fixed. Bundled P1-18 (which shipped earlier as PR #316) plus two tiny P2 hygiene items.

### ✅ P0-12 — Narration→execution gap on `close_position` — gate moved from mid-run to end-of-run

**Filed:** 2026-05-22. Escalation pattern: 1 of 7 runs Wed 5/20 (EV Catalyst ON), then 3 of 7 runs Fri 5/22 (Catalyst Event Raider MRVL ×2 + OKTA on retry; Secular Theme Architect SMTC + TRIM).

**Symptom:** agent writes "exit X" / "close X" / "trim X" / "EXIT" in `decision_rationale` or `pick.reasoning` text, the narration→execution gate at `record_run_summary` fires inline, marks run FAILED. The agent then keeps running — sometimes calls the real tool after the gate fired — but the run is already FAILED. Production case 2026-05-22 Secular Theme SMTC: gate fired at 08:15:53; agent called `close_position` at 08:17:30; position later reconciled at $153.44 for **+$108.10** (the first realized winning close since the action-layer broke 5/12) — but the run row stayed FAILED. See run-review 2026-05-22 F1 for the event-stream trace.

**Root cause:** the gate fired mid-run on the FIRST `record_run_summary` call, before the agent had a chance to make the (sometimes-pending) tool call. Treated narration→execution **order** mismatch as a permanent narration→execution gap.

**Fix:** moved the gate from `lib/agent/tools/record-run-summary.ts` (inline mid-run) to `lib/agent/tools/complete-run.ts` preflight (end-of-run). Key changes:
- Removed the entire narration-gate block from `record-run-summary.ts` (~135 lines). The tool no longer reads `RunEvent` rows or writes `run_failed` / status=FAILED.
- Added `checkNarrationExecutionGap(runId)` to `complete-run.ts`. Reads the MOST RECENT `run_summary` event's payload (decision_rationale + ranked_picks reasoning), detects narration verbs, then reads all `position_closed` + `position_modified` events from the entire run. Self-corrected runs (agent narrated then called the tool, in either order) pass with no gap.
- New `PreflightFailure` kind: `narration_execution_gap`. Returns a soft refusal the agent can recover from: "call the missing tool, then complete_run again" — same recovery pattern as the existing `no_run_summary` / `unaddressed_theses` refusals. Never sets status=FAILED.
- Tactical exempt (matches the existing `skipSummaryGate` guard for `runMode === "INTRADAY_TACTICAL"`).

**Three-layer principle (`docs/PRINCIPLES.md`):** kept as a Layer-1 tool gate. The previous instinct ("add prompt text saying 'narrating exit without calling close_position is a failure'") would have been the wrong layer — the agent already understands the rule, the gate just needed to enforce it correctly.

**Tests:** `lib/agent/narration-gate.test.ts` pure-function tests on `detectNarrationHits` + `findGaps` still pass (unchanged module). The end-to-end Prisma read flow is exercised by the moved code in `complete-run.ts` — no separate integration test added, same shape as the existing preflight checks.

**Audit-log cleanup:** the old gate wrote `run_failed` events with `gateSource: "record_run_summary"` payload. New gate writes nothing — refusals come back via the `complete_run` tool result, the run stays RUNNING until the agent successfully completes it.

### ✅ P1-18 — New thesis-writer agent mints status=ACTIVE instead of WATCHING — **shipped via PR #316 (2026-05-23)**

**Filed:** 2026-05-21 after the MU zombie thesis surfaced (user-builder pathway minted `Thesis { ticker: "MU", status: ACTIVE, ... }` with no matching Position).

**Root cause:** the thesis-writer agent (`lib/agent/run-thesis-writer.ts`) didn't run through `record_thesis`'s `discoveryOnly` clamp.

**Fix (PR #316):** added `forceWatchingMint` flag plumbed `dispatch_thesis_research` → Inngest event payload → `runThesisWriterAgent` ctx → `record_thesis` `isChatDispatchDirectional` gate. LONG/SHORT mints from user-builder are now forced to WATCHING.

**Existing zombie cleanup:** MU thesis row `cmpetjrw5000304jv9ybkn0c0` repaired via SQL on 2026-05-23 — flipped to WATCHING, 10 HELD-template triggers stripped, STATUS_CHANGED ThesisUpdate audit row written.

**Cross-reference:** P1-20 (still open) is the architectural followup — removes the need for clamps entirely by deriving status from actions rather than exposing it as a settable arg.

### ✅ P2-17 — `useV2Prompt` column dropped

**Filed:** post-PR #270 deprecation. The flag stayed on `AgentConfig` after PR #270 made `buildDailyRunSystemPromptV2` unconditional; zero code paths read it since 2026-05-16.

**Fix:** removed `useV2Prompt` from `prisma/schema.prisma`. Generated migration `20260524005434_drop_use_v2_prompt` with `ALTER TABLE "AgentConfig" DROP COLUMN "useV2Prompt"`. Cleaned dead comment in `lib/inngest/functions/morning-research.ts`.

### ✅ P2-21 — `predev` Prisma regen hook added

**Filed:** 2026-05-23 after repair-script run errored on stale generated client (33 rows failed before `npx prisma generate` then succeeded clean).

**Fix:** added `"predev": "prisma generate"` to `package.json`. `npm run dev` now regens the client before booting. Note: `npx tsx scripts/foo.ts` still bypasses (npm pre-hooks don't fire on direct tsx invocations); convention for repair scripts is run `npm run dev` once after a schema change, or run `npx prisma generate` first.

---

## Done since 2026-05-20 (post-no-trade-streak wave — the keystone fixes)

Largest single wave since the V2 rollout. Resolves the "no trades in 12 days" production incident (2026-05-12 → 2026-05-21 was 7 trading days with 0 new positions). Combined effect: tactical ENTER conversion went from 0% (8 days) to 60% (Wed 5/21, 3 of 5 fires) and 40% (Fri 5/22, 4 of 10 fires). First post-incident wins: SMTC closed +$108 on Fri.

### Code changes (5 PRs, all merged 2026-05-21)

- ✅ **PR #307 — `fix(tactical): make 1.5x volume gate horizon-conditional + market-hours-aware`** (the keystone). `lib/agent/system-prompts/intraday-tactical.ts:201-260`. The 1.5x-volume-vs-20d-avg gate (added 2026-05-07 in PR #231 for the Intraday Momentum Scalper analyst) was being applied universally across all 6 analysts and all 4 horizons. Production effect after PR #289 made volume data actually flow: 30 ENTER tactical fires across 5/13–5/20 produced 0 real positions. New gate branches:
  - **TRADE** (or DAY-style intraday): 1.5x gate applies, but only after 14:00 ET. Pre-mid-session, the raw ratio is informational only.
  - **CATALYST / TARGET / COMPOUNDER**: volume is informational, not a gate.
  - **Outside market hours (before 09:30 ET or after 16:00 ET)**: skip the volume gate entirely.
  Closes the "no trades" production incident.

- ✅ **PR #308 — `chore(husky): auto-regen Prisma client when schema is newer than generated`**. `.husky/pre-commit`. Pre-commit hook now `stat`-compares schema mtime vs generated client mtime and runs `prisma generate` if the schema is newer. Kills the "phantom TS errors" trap that made two run-review sessions use `--no-verify` to bypass. (Caveat — only fires on `git commit`, not on `npx tsx`. See P2-21.)

- ✅ **PR #309 — `fix(record-thesis): use WATCHING_FIRST_REVIEW_DAYS cadence for new WATCHING theses`**. `lib/agent/tools/record-thesis.ts:687-720`. Before: every newly-minted WATCHING thesis got `nextReviewAt = now + HORIZON_REVIEW_DAYS[horizon]` (the HELD-side cadence: 1d / 1d / 7d / 30d). A brand-new COMPOUNDER WATCHING was scheduled for re-review in 30 days when the right cadence is 90. After: per-status branch. COMPOUNDER WATCHING = 90d, TARGET = 30d, TRADE = 14d, CATALYST = 14d. Held positions keep the original tighter cadence. SYSTEM_AUDIT_2026_05_19 item A4.

- ✅ **PR #310 — `fix(reviews): close the scheduled-review duplication gap (needs-action lookahead + REVIEW_DATE_HIT strip)`**. Two halves of the same bug, bundled.
  - `lib/agent/needs-action.ts:218-242` — 24h look-ahead on REVIEW_DUE. Morning daily-run now catches reviews scheduled for later TODAY (e.g. 09:30 ET when the run is at 08:00 ET) instead of treating them as "future" and skipping. Without this, the trigger evaluator's REVIEW_DATE_HIT cron fired at 09:31 ET and spawned a redundant tactical run for each.
  - `lib/agent/triggers/defaults.ts` — REVIEW_DATE_HIT trigger removed from all 4 watching template functions (Catalyst / TRADE / TARGET / COMPOUNDER). The predicate kind stays in types/evaluator for back-compat. New WATCHING theses no longer auto-get this trigger; existing rows are stripped by the cleanup script.
  - `scripts/dedupe-review-date-hit-triggers.ts` — new one-shot cleanup. Idempotent. DRY_RUN=1 supported.
  - **Production proof (Catalyst Event Raider, 2026-05-21):** 0% focus → 42.9% focus, 0 ACTIVE positions → 2 (MRVL + OKTA — first trades ever for this analyst). Closes P2-18.

- ✅ **PR #311 — `fix(record-thesis): Layer-1 cap of 5 LONG/SHORT WATCHING mints per discovery run`**. `lib/agent/tools/record-thesis.ts` discovery-clamp block. 2026-05-17 discovery cron minted 38 new WATCHING theses across 5 analysts (7-8 per analyst) against a documented 8/run soft-cap that GPT-4o wasn't honoring. Now enforced at the tool layer. SYSTEM_AUDIT_2026_05_19 item A3.

### Production cleanup (repair scripts run 2026-05-23)

The 5 code PRs above stopped CREATING bad rows; the repair scripts fixed existing bad rows.

- ✅ **`scripts/fix-watching-next-review.ts` applied.** 33 WATCHING theses had their `nextReviewAt` extended from the old held-side cadence to the WATCHING_FIRST_REVIEW_DAYS cadence. 4 already-in-range, 0 errors. Distribution shifted from ~20+ overdue to: 3 in next-7d, 11 in 7-14d, 6 in 14-30d, 17 in 60d+. SYSTEM_AUDIT_2026_05_19 item B3.

- ✅ **`scripts/dedupe-review-date-hit-triggers.ts` applied.** 27 REVIEW_DATE_HIT triggers stripped across 27 WATCHING theses (23 were already trigger-free — newer mints post-#310). Live theses with REVIEW_DATE_HIT triggers remaining: 0.

### Documentation

- ✅ **`docs/run-reviews/2026-05-20.md`** (PR #302) — Multi-day trajectory write-up of the no-trade incident. Trace through Catalyst NVDA's history showed the timing gap; led directly to PR #310.

### Resolved by this wave but tracked separately

- **P2-18 (Catalyst near-no-op morning runs)** — closed by PR #310's look-ahead. See P2-18 inline-CLOSED block in GAPS.md (will migrate here next round).

### Surfaced + filed this wave

New gaps discovered during the work, filed in GAPS.md:
- **P0-12** — Narration→execution gap on `close_position` (1 run Wed 5/20, 3 runs Fri 5/22 — escalating)
- **P1-18** — New thesis-writer agent mints status=ACTIVE instead of WATCHING (MU zombie 5/21)
- **P1-19** — PRINCIPAL_CHAT hangs when child THESIS_WRITER fails (Inngest event-wiring)
- **P2-20** — Volume ratio math broken for intraday timestamps (durable fix for #307's workaround)
- **P2-21** — Prisma client stale on `npx tsx` (#308 hook is git-only)
- **P2-22** — Cross-analyst discovery duplication (audit doc A8; deferred)

### SYSTEM_AUDIT_2026_05_19.md correlation

The audit doc was a one-shot snapshot from 2026-05-19. Items A1-A8 and B1-B7 were "PR open" at the time; tracking what actually shipped:
- A1 (technicals null) → PR #289 (merged 2026-05-20)
- A2 (stale ENTER triggers post-promotion) → PR #292 (merged 2026-05-20)
- A3 (discovery cap) → PR #311 (merged 2026-05-21)
- A4 + A5 (WATCHING cadence + REVIEW_DATE_HIT cooldown) → PRs #309 + #310 (merged 2026-05-21)
- A6 + A7 (complete_run preflight scope + REVIEWED classification) → PR #290 (merged 2026-05-20)
- A8 (cross-analyst dup) → re-filed as GAPS P2-22; deferred.
- B1-B3 (data-layer cleanup + repair script) → PR #294 (merged 2026-05-20) + scripts run 2026-05-23
- B4-B6 (reconcile-orders + tests + zombie guard) → PR #295 (merged 2026-05-20)
- B7 (legacy keyword scan removed) → PR #296 (merged 2026-05-20)

Audit doc closed-out 2026-05-23 (see header note).

### Migrated from GAPS.md as part of this consolidation

Old closure entries that were sitting inline-CLOSED in GAPS.md for >7 days, now moved here per the doc's "Don't keep dual copies" rule:

- **P0-11 — Manual UI runs always get the 600-line V1 prompt.** CLOSED 2026-05-16 in PR #270. V1 prompt builder marked `@deprecated`; the only V1 caller (`app/api/agent/[mode]/route.ts:232`) was swapped to call `buildDailyRunSystemPromptV2` unconditionally. The `useV2Prompt` flag is no longer read by any code path. Flag column stays on `AgentConfig` until a follow-up migration drops it.

- **P0-5 — Horizon awareness: operational layers are still horizon-blind.** All 5 sub-items (P0-5a/b/c/d/e) closed across the Thesis Architecture work + Morning Run V2 + admin sweep PRs. Horizon awareness now lives in three places — the daily prompt (visibility + per-horizon review cadence + per-horizon data discipline), per-thesis triggers (authoritative for exits), and the trigger evaluator (5-min cron evaluating those triggers).

- **P1-13 — Old promotion-keyword gate in `record_run_summary` is now redundant + actively wrong.** CLOSED 2026-05-19 in `lib/agent/tools/record-run-summary.ts`. The ~220-line REJECTION_KEYWORDS_RE keyword scan was deleted along with its tickerMentionRegex helper. `complete_run`'s preflight (PR #266, `computeNeedsAction`) is the structural superset; `update_thesis`'s goalpost-moving guard catches the MRVL anti-pattern on the write side. The Secular Theme failure pattern (`"outside our universe focus"` not matching the keyword regex) cannot recur.

- **P1-16 — Tactical run silent failures (verify post-PR #261).** CLOSED 2026-05-19 via the tactical run review at `docs/tactical-reviews/2026-05-18.md`. Re-audit confirms: silent failures clustered on 2026-05-11 (13 of 16 total in 14d, all the same day). Nothing since. PR #261's catch-path recovery + error aggregator is effectively closed.

- **P2-12 — Discovery prompt doesn't mention `manage_watchlist` (blocked).** CLOSED 2026-05-13 by the watchlist collapse. `manage_watchlist` was deleted; Discovery's prompt now uses `record_thesis(status: WATCHING)` for adds. See `THESIS_ARCHITECTURE.md`.

---

## Done since 2026-05-13 (easy-wins batch — P0-5e + P1-10 + P2-10 + P2-11)

Four small-but-real closures on the thesis architecture rework. Single PR.

- ✅ **P0-5e — Per-horizon data-fetching prompt guidance.** Daily-run V2 prompt gets a new "Per-horizon data discipline" section in `lib/agent/system-prompt.ts`. Maps each horizon to the right data pulls:
  - TRADE → `get_options_flow` + technicals
  - CATALYST → `get_earnings_data` / `get_sec_filings` keyed to the dated event
  - TARGET → balanced (technicals + fundamentals + next earnings)
  - COMPOUNDER → `get_sec_filings` + `get_earnings_data` + `get_market_context`; explicitly NOT options flow ("flow tells you nothing about a multi-year thesis").
  Closes P0-5 entirely. Horizon awareness now lives in three layers: the prompt (visibility + review cadence + data discipline), per-thesis triggers (authoritative exits), and the trigger evaluator (5-min cron).

- ✅ **P1-10 — Producers emit `intelligence/route-signals` event.** `firm-market-sweep`, `portfolio-watchlist-monitor`, and `domain-monitor` now `step.sendEvent("intelligence/route-signals", ...)` at the end of their step.run when `totalSignals > 0`. Router already accepted the event as a trigger (declared but no producer). Removes 15-60min routing latency that previously waited for the next 7:30am cron tick. Producer-side guard on `totalSignals > 0` avoids no-op router invocations on empty sweeps.

- ✅ **P2-10 — Discovery idempotency on Inngest retries.** `discovery-run.ts` now looks for an existing RUNNING discovery run for `(analystId, mode=DISCOVERY, startedAt within last hour)` before creating a new one. On Inngest step retry, the original ResearchRun is reused — no duplicate row, no duplicate theses, no double LLM bill. Manual fires outside the 1-hour window still create fresh rows (intended for testing).

- ✅ **P2-11 — Discovery FAILED status no longer hides successful theses.** Status logic now branches on `newTheses > 0 || ranSummary` — a run that mints 5 WATCHING theses but token-limits before `record_run_summary` lands as COMPLETE (with a `parameters.note` flag explaining the missed summary), not FAILED. The previous logic treated `ranSummary` as the sole COMPLETE gate, so legitimate runs that produced real work showed up in the run feed as failures.

**Files touched:**
- `lib/agent/system-prompt.ts` — Per-horizon data discipline section
- `lib/inngest/functions/firm-market-sweep.ts` — emit route-signals event
- `lib/inngest/functions/portfolio-watchlist-monitor.ts` — emit route-signals event
- `lib/inngest/functions/domain-monitor.ts` — emit route-signals event
- `lib/inngest/functions/discovery-run.ts` — idempotency check + status branch fix
- `docs/GAPS.md` — closures + open list trimmed
- `docs/GAPS_HISTORY.md` — closures recorded here (this section)

**Remaining in GAPS.md after this PR:** P1-9 (archetype-blind discovery — biggest item, ~1 session), P2-4 (no DAY horizon — decision needed), P2-7 (cron chaining — largely mitigated by P1-10), P2-12 (manage_watchlist — blocked on WATCHLIST_COLLAPSE).

---

## Done since 2026-05-11 (Discovery Run — full rework)

End-to-end Discovery cron + prompt + tool rework, driven by the 2026-05-10 weekly auto-cron that minted zero theses across all seven enabled analysts. Root cause was a stack of compounding issues, not a single bug — see `DISCOVERY_REVIEW.md` for the full review.

**The dominant root cause:** `read_signals` defaulted to `lookbackDays: 0` (today-only), AND the four intelligence-pipeline crons (firm-market-sweep, portfolio-watchlist-monitor, domain-monitor, signal-router) all ran Mon-Fri only. On Sunday 9am ET, `AnalystSignalRoute` had **zero** rows for "today" because the router never fired on Sunday. The discovery agent saw an empty inbox by construction, regardless of what was in the prompt.

**Adjacent root causes, also fixed:**

- The discovery prompt **truncated the analyst's `analystPrompt` to 400 characters** — the agent was operating without its own strategy, signal preferences, or risk philosophy. The first paragraph of an analyst's identity, applied as if it were the whole thing.
- The prompt was passed only 6 of ~14 strategy-relevant fields from `AgentConfig`. Direction bias, hold durations, signal types, position sizing, market cap bounds, and the analyst's watchlist were all withheld.
- The prompt told the agent to apply the universe fence manually — but the router already enforced it at routing time. Agent-side filtering was both wasted work and an error surface.
- `scope:"universe"` on movers + earnings tools intersected with `watchlist + positions` (i.e. coverage), which is the OPPOSITE of what discovery wants. Already fixed by PR #247 — confirmed.
- The composite ≥ 7 threshold was the daily-run "tradeable today" bar. Discovery's job is to seed WATCHING for the daily run to evaluate later; the bar should be lower.
- Step 2 said "Pick the 2-3 most promising candidates BEFORE scoring." Lossy pre-prune with no methodology — discarded 5+ candidates unscored.
- DAY-only analysts were running the weekly cron. A weekly WATCHING thesis with an intraday-level ENTER trigger is architecturally broken — Monday's premarket gap moves the breakout level. They shouldn't be in the cron at all.
- The prompt gave **zero guidance on horizon selection** — VISION's load-bearing concept — and zero guidance on deriving target_price + stop_loss, even though `record_thesis` rejects WATCHING/LONG or WATCHING/SHORT without a target_price (because the default ENTER trigger keys off it).
- No cross-analyst overlap check at the workflow level. The 2026-05-10 EV Catalyst case (3 attempts to mint $MU, all rejected by the same-direction guard) is what that gap looks like.

**Shipped fixes:**

- ✅ **`read_signals` defaults `lookbackDays: 7` in discovery mode.** Single source of truth — the cron and the prompt don't have to pass it. Daily-run mode still defaults to 0 (today-only).
- ✅ **All four intelligence-pipeline crons now run daily (`* * *`)** — firm-market-sweep (6:30am), portfolio-watchlist-monitor (7:00am), domain-monitor (7:15am), signal-router (7:30am). Weekend news (M&A, pre-announces, policy moves) now gets routed before Sunday's Discovery cron at 9am.
- ✅ **`discovery-run.ts` passes the FULL `analystPrompt`** (no truncation) plus 8 additional fields: `holdDurations`, `directionBias`, `minConfidence`, `maxPositionSize`, `maxOpenPositions`, `signalTypes`, `watchlist`, `marketCapMin`, `marketCapMax`.
- ✅ **Discovery prompt rewritten as a TRADER's prompt, not a filter.** New sections: "YOUR CONFIG — what bounds your work" (direction bias / hold style / signal types / watchlist), "WHAT'S ALREADY DONE FOR YOU — DO NOT RE-FILTER" (router fenced; tools coverage-excluded), "PICKING THE RIGHT HORIZON" (CATALYST/TRADE/TARGET/COMPOUNDER decision tree mapping VISION Part 2's hold-style spectrum), "TARGET, ENTRY, STOP — REQUIRED on every directional thesis" (derivation guidance from real chart structure + R/R ≥ 2:1 + direction shape enforcement), "DON'T DUPLICATE OTHER ANALYSTS" (cross-analyst overlap check).
- ✅ **Step 2 cross-analyst pre-check.** Agent calls `get_theses(tickers: [<candidate>])` before `get_stock_data` to avoid wasting research on a name another analyst already covers in the same direction.
- ✅ **Pre-prune removed.** Step 2 now says "research every promising candidate (typically 6-10 names)" instead of capping at 2-3. Score all, mint the ones that clear the bar.
- ✅ **Composite threshold lowered to 5 for WATCHING**, 8 for high-conviction ACTIVE. The WATCHING bar is "worth tracking," not "tradeable today."
- ✅ **Cap raised 5 → 8 new theses** per run (typical range 2-5).
- ✅ **DAY-only analysts skipped in the cron.** `holdDurations === ["DAY"]` analysts are filtered out (manual `targetConfigId` fire still passes through for testing).
- ✅ **Kickoff user prompt rewritten** to match the new prompt: parallel pull of all three surfaces, no manual re-filter, mint everything ≥ 5, up to 8.
- ✅ **Stale "Mon-Fri only" justifications removed** from the prompt and `read-signals.ts` comments now that the routing crons run daily.

**Files touched:**
- `lib/agent/tools/read-signals.ts` — default `lookbackDays = 7` when `ctx.discoveryOnly`
- `lib/agent/system-prompts/discovery.ts` — full rewrite (~245 lines → ~405 lines)
- `lib/inngest/functions/discovery-run.ts` — DAY-only skip, full config passthrough, new kickoff prompt
- `lib/inngest/functions/firm-market-sweep.ts` — `1-5` → `*`
- `lib/inngest/functions/portfolio-watchlist-monitor.ts` — `1-5` → `*`
- `lib/inngest/functions/domain-monitor.ts` — `1-5` → `*`
- `lib/inngest/functions/signal-router.ts` — `1-5` → `*`

**Known issues NOT addressed in this pass** (filed as P1/P2 above): P1-9 archetype-blind scoring rubric, P1-10 producers don't emit `intelligence/route-signals`, P2-10 idempotency on step.run retries, P2-11 FAILED status hides successful theses, P2-12 `manage_watchlist` not in prompt.

---

## Done since 2026-05-10 (Morning Run V2 — operational layers delegate to triggers)

End-to-end Daily Run rework. ONE PR, seven fix commits + three docs commits. Closes P0-5b + P0-5c by deletion: the parallel layers that overrode per-thesis triggers are gone, so per-thesis triggers ARE the system's exit + reactivity logic now (not just a label that lived alongside competing crons). Verified by: `SELECT id, ticker, status, jsonb_array_length(triggers) AS trigger_count FROM "Thesis" WHERE status='ACTIVE' AND jsonb_array_length(triggers) = 0;` returned `[]` before landing — every ACTIVE thesis already carries triggers, so removing the auto-close path doesn't strand any positions.

- ✅ **Fix #0 — Per-thesis triggers are now authoritative.** `place_trade` defaults `exitStrategy: "MANUAL"` (was `"PRICE_TARGET"`). `lib/trade-exit.ts` gutted to TRAILING + MANUAL only — PRICE_TARGET / TIME_BASED branches deleted, NEAR_TARGET / NEAR_STOP `PositionManagementAction` writes deleted. `lib/inngest/functions/price-monitor.ts` keeps peak/trough tracking + the near-target email + `PRICE_CHECK` events but no longer auto-closes; `checkExitConditions` is TRAILING-only via early-return so `manage_position.set_trailing_stop` continues to honor its trail-from-peak math. The trigger evaluator's 5-min cron path is now the sole consumer of price-vs-trigger evaluation. Test suite rescoped to TRAILING + MANUAL.
- ✅ **Fix #1 — Daily Run system prompt rewritten.** ~600 lines → ~80. `buildDailyRunSystemPromptV2` in `lib/agent/system-prompt.ts`. Goals + identity + standup, not procedural stages. The 5 priority blocks (Priority Reviews, Fired Triggers, Matching Now, Live Theses, Watchlist) are gone — that work moved into `get_theses.needsAction` (Fix #2). New `AgentConfig.useV2Prompt Boolean @default(false)` (migration `20260510000000_agent_config_use_v2_prompt`); morning-research branches on it to dispatch V1 vs V2 builder. `latestBriefing` field added to `RunInput` for the V2 "Yesterday's standup" section.
- ✅ **Fix #2 — `get_theses` returns trigger-driven `needsAction`.** New `lib/agent/needs-action.ts` helper, 14 unit tests in `needs-action.test.ts`. Three kinds — TRIGGER_FIRED / TRIGGER_MATCHING_NOW / REVIEW_DUE — all driven by predicates the agent set, not hardcoded thresholds. Anti-regression assertions: a 6-month TARGET hold with a $90 stop returns null at $97 (-3%), $119 (95% to target). Reuses `shouldFire` from `lib/agent/triggers/evaluate.ts`. `read-theses-table.tsx` renders an alert chip on rows where `needs_action != null`.
- ✅ **Fix #3 — `read_signals` sector firehose fallback removed.** Empty routing is real signal; the old fallback turned that into 50 sector-wide signals. Watchlist branch kept (analyst's curated explicit interests); sector / industry / theme branches deleted.
- ✅ **Fix #4 — Explicit unattended-cron user prompts.** V2 morning prompt: "It's the start of the trading day. Run your morning playbook unattended — there is no human to respond to questions. Every turn must call a tool; text-only turns terminate the run as FAILED. End with complete_run." Tactical-run prompt gets the same explicit-unattended language unflagged. V1 keeps the old wording during rollout.
- ✅ **Fix #5 — Daily Run tool allowlist locked.** `MODES["research-run"].toolAllowlist` was undefined; now explicit. Excludes `record_thesis` + `manage_watchlist`. Daily Run manages the existing book; new coverage minting is the Sunday Discovery cron's job (or `app/discovery.run.manual` on demand, or tactical promotion via `update_thesis(change_status: "ACTIVE")`). `morning-research.ts` now actually filters by the allowlist (mirror of `tactical-run.ts` and `discovery-run.ts` patterns); previously the cron passed every tool regardless of mode.
- ✅ **Fix #6 — `dailyRunOnly` flag on `read_signals`.** Mirror of the existing `discoveryOnly` pattern. When set (from morning-research, gated on `useV2Prompt`), hides the discoverySignals bucket from the V2 Daily Run's response — discovery candidates only show up in Sunday's Discovery Run.

**Rollout:** Fix #0 ships unflagged (correctness, not behavior — the parallel layer was never supposed to be authoritative). Fixes #1–#6 ship behind `AgentConfig.useV2Prompt` (default false). Flip Tech Momentum first; watch 5–7 trading days; flip the next analyst when it holds. Once every enabled analyst has been on V2 for ~7 days without regression, delete the V1 builder + the flag.

**Verification 2026-05-10:** tsc clean (only the two pre-existing unrelated errors in `GenerateAudioButton.tsx` + `transcript-row.tsx` remain — same baseline PR #239 acknowledged); 177/177 jest pass (14 new in `needs-action.test.ts`, 16 rescoped in `trade-exit.test.ts`, 147 prior). Pre-flight SQL on prod returned `[]` — no ACTIVE theses without triggers; all 10 currently-OPEN positions are `exitStrategy='PRICE_TARGET'` and become effectively MANUAL after Fix #0 lands (their per-thesis EXIT triggers still fire via the trigger evaluator's 5-min cron).

---

## Done since 2026-05-08 (GAPS cleanup — verified against merged code)

Doc-only pass. The product owner asked for an honest re-grade of the open items after spot-checking the actually-merged code (not just session summaries). Two items moved to closed; the P0-5 umbrella was rewritten in plain English; P0-5e was downgraded from P0 to P1.

- ✅ **P1-4 — Discovery softer than required at minting.** Closed as already-done. Verified Step 4 of [`lib/agent/system-prompt.ts`](../lib/agent/system-prompt.ts) on main (after PR #235 + PR #239): explicitly says use `record_thesis`, not `manage_watchlist`, with three conviction bands (high → ACTIVE+place_trade, lower → WATCHING with ENTER triggers, fails → PASS thesis). Explicit framing: *"Open slots are the reason discovery should run, not a reason to skip it."* The original GAPS framing ("the prompt says 'add to watchlist'") predates these PRs. No code change in this cleanup — just GAPS.md acknowledging the prompt is already where the audit wanted it.
- ✅ **P0-5 umbrella reframed.** "Mostly cosmetic" was true on 2026-05-07 audit but stale after PR #239 closed P0-5a + most of P0-5c. Rewrote the section in plain English: the umbrella problem is "operational layers between morning runs are still horizon-blind." P0-5b (cron-side wiring of `horizon-policy.ts`) is the real remaining P0; P0-5c is a 30-min prompt-edit follow-on; P0-5e was downgraded from P0 to P1 because it's a prompt fix (per-horizon tool-selection guidance), not a code change.

**No code changes** in this PR — pure GAPS.md honesty. The "open items" list now accurately reflects what's actually missing in `origin/main`.

---

## Done since 2026-05-08 (Thesis Architecture)

End-to-end thesis-system pass. PR [#239](https://github.com/dave-sucks/hindsight/pull/239). Live reference: [`docs/THESIS_ARCHITECTURE.md`](./THESIS_ARCHITECTURE.md).

- ✅ **P0-1 — Structural-belief fields required.** New [`lib/agent/thesis-belief.ts`](../lib/agent/thesis-belief.ts) validator (mirrors `thesis-shape.ts`). `record_thesis` rejects directional theses missing `core_belief` (non-empty after trim), ≥2 `key_assumptions`, ≥2 `invalidation_conditions`. `update_thesis` adds `structural_unchanged_reason` + discipline gate: patches that change `confidence_score` / `target_price` / `stop_loss` without touching belief AND without an explicit reason are rejected (gate bypasses on terminal transitions and ACTIVE promotions). Reason persists into the timeline rationale. 14 unit tests; closes the 32%/32%/38% population gap audited 2026-05-07.
- ✅ **P0-5a — Horizon + structural belief surfaced in daily-run prompt.** [`run-input.ts`](../lib/agent/run-input.ts) `activeTheses` select now carries `horizon`, `coreBelief`, `nextReviewAt`, `catalystDate`, `maxHoldDays`. [`system-prompt.ts`](../lib/agent/system-prompt.ts) Live Theses table renders Horizon + Schedule columns (review-due / catalyst-in-Nd / max-hold-Xd-left), plus per-thesis line: belief preview + horizon exit-policy hint sourced from [`lib/agent/horizon-policy.ts`](../lib/agent/horizon-policy.ts). Agent no longer needs a `get_theses` round-trip to remember what kind of trade it's managing.
- ✅ **Promotion gap — `change_status: "ACTIVE"` enum extension.** Pre-this-PR the tactical prompt instructed `update_thesis(change_status: "ACTIVE")` but the enum only allowed INVALIDATED/CLOSED. Calls rejected silently; theses stayed WATCHING with open positions, breaking the morning-run Live Theses table. Now legal: requires `existing.status === "WATCHING"` and recomputed `target_price` + `stop_loss` (the WATCHING target was the ENTER trigger level — behind us at promotion). Bypasses the goalpost-moving guard (legitimate target raise on promotion) and the structural-unchanged-reason gate (promotion is its own justification — capital behind existing belief). Tactical + daily prompts updated to use the new path.
- ✅ **Conditional requireds — `catalystDate` when CATALYST, explicit `maxHoldDays` when TRADE.** `record_thesis` rejects `horizon=CATALYST` without `catalyst_date` (the dated event drives both the trigger template and the 30d-past-event exit policy) and `horizon=TRADE` without explicit `max_hold_days` (no more silent default-14 auto-extending past the intended window). PASS theses bypass.
- ✅ **Trade evaluator reads the belief.** [`trade-evaluator.ts`](../lib/inngest/functions/trade-evaluator.ts) post-mortem prompt now feeds `coreBelief` + `keyAssumptions` + `invalidationConds` + `horizon` into GPT-4o. System prompt instructs grading against the BELIEF, not just the rationale: "right outcome, wrong reasons" becomes a documentable learning. Closes the eval side of P0-1.
- ✅ **`horizon-policy.ts` — single source for horizon constants.** New module exports `HORIZON_REVIEW_DAYS`, `HORIZON_REVIEW_CADENCE`, `HORIZON_EXIT_POLICY`. `record_thesis` imports the day constants for `nextReviewAt` math (replacing inline 1/1/7/30 ternary). Daily-run prompt imports the cadence + policy strings for per-thesis hint rendering. Writer and reader stay aligned.
- ✅ **Drive-by — `update-thesis.ts` `select` was missing `direction` + `entryPrice`.** Latent bug in the shape gate (it referenced fields the Prisma client returned as undefined at runtime). Added to the select.

**Verification 2026-05-08:**
- `npx tsc --noEmit` clean for all modified files. Two pre-existing unrelated errors (`GenerateAudioButton.tsx`, `transcript-row.tsx`) remain.
- 168/168 jest tests pass (14 new in `thesis-belief.test.ts`; 154 existing across 7 suites).
- **Pending:** next morning cron — watch for rejection-loop behavior on the new gates. If thesis mint count drops to ~0 the prompt didn't fully adapt; revert + tighten before re-shipping. Spot-check via Supabase: `SELECT direction, coreBelief IS NOT NULL, array_length(keyAssumptions,1), array_length(invalidationConds,1) FROM "Thesis" WHERE createdAt::date = current_date AND direction IN ('LONG','SHORT')`.

---

## Done since 2026-05-08 (small sweep — P1-3, P2-2, P2-5)

PR: [#238 — chore: small sweep — P1-3 cadence doc, P2-2 watchlist default, P2-5 dead code](https://github.com/dave-sucks/hindsight/pull/238)

- ✅ **P1-3 — Trigger evaluator cadence doc corrected.** CLAUDE.md had "every 15 min" in two places (Architecture/Reactivity section and Inngest Crons section). Updated both to "hourly". Registry was already correct (`workflow-registry.ts` schedule field and the Done-since note from 2026-05-07). No code change — the cron itself (`0 9,10,11,12,13,14,15,16 * * 1-5`) was always hourly; only the docs were wrong.
- ✅ **P2-2 — `manage_watchlist` default horizon changed TRADE → TARGET.** `ensureWatchingThesisForWatchlistAdd()` in [`lib/agent/tools/manage-watchlist.ts`](../lib/agent/tools/manage-watchlist.ts): default when no catalyst is supplied is now TARGET (open-ended hold, exits at target/stop/invalidation). `reviewDays` updated from the 1d TRADE default to 30d for TARGET. `maxHoldDays` already defaults to null for non-TRADE horizons — no change needed there. Tool description updated to document all three horizon options. No external callers relied on the TRADE default — the horizon is derived internally from the `catalyst` field presence.
- ✅ **P2-5 — `sync-heartbeat.ts` deleted.** Note: the audit's claim that it wasn't in `functions[]` was wrong — `syncHeartbeat` was imported and registered at `route.ts:36`. However the product owner's decision to delete stands. Removed the import (`route.ts` line 5) and the `functions[]` entry (`route.ts` line 36), then deleted the file. No other references in the codebase except `portfolio.actions.ts:537` which is a comment describing the prior cron cadence — that line does not import or call the function, so no change needed there.

---

## Done since 2026-05-08 (Monitor Health workstream)

This session: closed P0-4, P1-2. PR pending — number to fill in once the branch lands.

- ✅ **P0-4 — Monitor ROI tracer wired (Pillar 5).** Diagnosis: the chain `Thesis.sourceSignalIds → Signal.monitorId → Monitor` was actually intact end-to-end — `trade-evaluator.ts` fires within 12–48s of every close, `Signal.monitorId` is populated on 39 of 39 cited signals, and `Monitor.{tradesSourced,winsSourced,lossesSourced,successScore}` does increment correctly via the transactional update at `trade-evaluator.ts:139-162`. The break was upstream at thesis minting: the agent overwhelmingly picks `source_kind: WEB_SEARCH` (8/10 on 5/07, 3/5 on 5/08) instead of `ROUTED_SIGNAL` even when read_signals informed the thesis. WEB_SEARCH provenance is allowed to leave `source_signal_ids` empty, which silently skips the credit chain. **Fixes (this PR):** (1) new `ToolContext.signalsByTicker` map; `read_signals` populates it on every return so record_thesis can detect the mismatch. (2) Soft-nudge in `record_thesis`: when `source_kind ≠ ROUTED_SIGNAL` for a ticker that appeared in this run's read_signals output, log a WARN + append a hint to the success message so the agent sees it in-context. No hard reject — would risk a regression and the thesis itself is fine. (3) Strengthened the `read_signals` tool description (citation is now imperative, not advisory) and added a "Provenance is not optional — pick the right kind" block to the daily-run system prompt explaining the 4 source_kind options and *why* (the credit chain). (4) **Backfill ran on production:** recomputed Monitor counters from the canonical chain via authoritative SQL — total trades-sourced lifted from 2 → 5; portfolio_searches went 2/2/0 → 3/2/0 (score 1.0 → 0.667), watchlist_searches 1/0/0 → 2/0/0. Idempotent — safe to re-run.
- ✅ **P1-2 — Dead SEARCH monitor cleanup.** `pipeline-cleanup.ts` gains Step 3: `enabled: false` on SEARCH monitors where `lastRunAt > 30 days ago AND tradesSourced = 0`. Soft-disable (not delete) — `Signal.monitorId` keeps its FK target, so historical signals still resolve and the trade-evaluator's chain walk for any open thesis citing them keeps working. Both `firm-market-sweep` and `domain-monitor` already filter by `enabled: true`, so disabled monitors auto-silence on the next cron tick. Existing dead population was already cleaned by a prior intervention (32 SEARCH monitors are currently `enabled: false`); the new rule keeps them disabled and catches future strays. No one-time SQL needed today (no monitors currently meet the 30d+0-trades cutoff that aren't already disabled).

---

## Done since 2026-05-08 (admin sweep)

Doc + prompt + tool-allowlist housekeeping. PR title "chore: admin sweep — P0-3 / P0-5d / P1-5 / P1-6 / P2-9".

- ✅ **P0-3 — Generalized narrate-vs-execute gate.** Verified PR #228 fully implements the design. `lib/agent/narration-gate.ts` is a pure verb→tool ruleset covering `manage_position` (tighten/trim/scale/move stop/trail/adjust), `close_position` (closing/exiting/sold/sell), and `manage_watchlist` (add/remove ... watchlist). Wired into `record_run_summary`'s persistence path: scans `decision_rationale` + each pick's `reasoning`, cross-references against `RunEvent` rows of type `position_closed | position_modified | watchlist_add | watchlist_remove`, emits a `run_failed` RunEvent and atomically transitions `ResearchRun: RUNNING → FAILED` on any mismatch. `complete_run`'s atomic transition was tightened from `status: { not: COMPLETE }` to `status: RUNNING`, so the FAILED status set by the gate sticks — that's the optional v2 "refuse complete_run on mismatch" half of the original fix path. `place_trade` is intentionally excluded from the verb list (gated upstream by morning-research's trade-execution gap check). 21 unit tests in `lib/agent/narration-gate.test.ts`.
- ✅ **P0-5d — Horizon promotion path on update_thesis.** Rewrote the `horizon` field schema description in [`update-thesis.ts`](../lib/agent/tools/update-thesis.ts) from "Rarely changed" (which actively discouraged the workflow) to a description that invites promotion with concrete examples: TRADE compounding past its 14d window → upgrade to TARGET; COMPOUNDER with eroded moat → downgrade to TARGET with tighter exit; CATALYST that printed and is now riding residual momentum → TARGET. Includes the must-do guardrail: any horizon change MUST also update `maxHoldDays` and `nextReviewAt` to the new horizon's defaults (TRADE 14d / TARGET 90d / COMPOUNDER 365d) — otherwise the thesis ends up with an exit policy that contradicts its label. No runtime guard yet (deferred to P0-5b territory).
- ✅ **P1-5 — Editor lane taxonomy in workflow-page prompt template.** The runtime editor prompt (`lib/agent/modes.ts → buildEditorSystemPrompt`) already documents all 4 lanes in detail (Step 0 — CLASSIFY THE REQUEST). The gap was on the documentation surface: `lib/agent/builder-prompt-template.ts` exported only a builder template, and the workflow-registry's editor card imported the same builder template — so users browsing `/agent-workflow` saw builder content under the editor card. New `EDITOR_PROMPT_TEMPLATE` export documents all four lanes (Q&A, numeric, fence, archetype) at the top with one-sentence descriptions of when each applies and how deeply it rewrites the analystPrompt. `workflow-registry.ts:239` updated to import it.
- ✅ **P1-6 — `get_sec_filings` builder allowlist.** Already done. `lib/agent/modes.ts:103` has `"get_sec_filings"` in the BUILDER `toolAllowlist`; registry's `agents: ["builder", "agent", "tactical", "discovery"]` matches. GAPS entry was stale relative to the code.
- ✅ **P2-9 — CLAUDE.md tool count refresh.** Updated heading from "19 tools" to "25 trading tools" with a line acknowledging the 3 podcast-only tools that live alongside but are out of scope. Itemized list adds: `get_portfolio_context`, `update_thesis`, `get_earnings_calendar`, `get_market_movers`, `manage_position` (was nested under close_position as 14b), `ask_question`, `discover_signals_for_fence`, `read_analyst_inbox_stats`, `suggest_config`. Cross-checked against `TOOL_REGISTRY` and `lib/agent/tools/` directory.
- ✅ **P2-1 — 6 PASS-on-watchlist theses with no triggers.** Closed as stale. The watching-thesis integrity workstream's reframe of P1-1 covers this directly: PASS-direction theses are institutional-memory rows that by design don't carry ENTER triggers — there's no entry to trigger on. The "6 zero-trigger PASS theses" the audit flagged are the same population as the 14 PASS-direction watching theses already accounted for. No SQL fix needed.
- ✅ **P2-8 — Briefing isn't a separate cron.** Closed. The 2026-05-07 registry edit changed briefing's `schedule` field to "Inline after every run (no separate cron)" — that's the documentation fix the gap was asking for. No code change, no further work.
- ✅ **P2-10 — Podcast tools missing from TOOL_REGISTRY.** Closed as intentional. The registry's header comment now explicitly scopes the podcast feature out of `/agent-workflow` — `read_past_transcripts`, `suggest_podcast_config`, `write_segment_transcript` live in `lib/agent/tools/` alongside the trading tools but are part of the podcast surface (`lib/podcast/`, `docs/PODCAST_PLAN.md`). Revisit only if podcast becomes a first-class feature on the workflow page.

---

## Done since 2026-05-08 (watching-thesis integrity workstream)

This session: closed P0-2, P1-1, P1-7, P1-8, P2-3. PR pending — number to fill in once the branch lands.

- ✅ **P0-2 — Promotion check enforced at runtime.** New state-based gate in `record_run_summary`: for every WATCHING/LONG-or-SHORT thesis owned by the analyst, fetches the latest quote, evaluates the entry condition, and marks the run FAILED unless either (a) a `place_trade` INITIATE TradeDecision landed for that ticker, (b) an `update_thesis(change_status: INVALIDATED)` ThesisUpdate landed, or (c) the rationale corpus names the ticker AND contains a concrete rejection keyword (volume / regime / news / R/R / liquidity / etc.). Same FAILED severity as the existing narration→execution gate. The MRVL pattern (raise target, walk away) has been blocked at the `update_thesis` layer since PR #232; this gate catches the broader "did absolutely nothing" case.
- ✅ **P1-1 — Reframed and resolved.** The audit's "11 of 43 watching theses missing ENTER triggers" was a measurement issue. Rerunning the trigger-health query 2026-05-08: of the 14 watching theses without ENTER triggers, **all 14 have `direction: PASS`** — institutional-memory theses that by design don't get ENTER triggers. Zero directional (LONG/SHORT) watching theses in production lack an ENTER trigger. To prevent regressions: `record_thesis` now rejects WATCHING + LONG-or-SHORT mints whose merged trigger array contains zero ENTER actions (parity with the existing `manage_watchlist` guard).
- ✅ **P1-7 — Overdue reviews fire daily.** New `housekeeping-overdue-theses` Inngest cron, hourly during US market hours. Queries every ACTIVE/WATCHING thesis with `nextReviewAt < NOW() AND closedAt IS NULL`; writes one synthetic `ThesisUpdate(type=TRIGGER_FIRED, triggerId=__OVERDUE_REVIEW__)` per overdue thesis with a 24h per-thesis cooldown. The next Daily Run for the analyst surfaces the row in its prompt's "Triggers Fired Since Your Last Run" priority block (run-input.ts adapted to label the synthetic id as "scheduled review overdue"). Test population on 2026-05-08: 14 watching PASS theses with `nextReviewAt = 2026-05-02` (6 days overdue) — the cron's first market-hours tick will fire 14 synthetic rows.
- ✅ **P1-8 — Already addressed.** Triggers DO fire during agent runs via `triggersMatchingNow` in [`run-input.ts`](../lib/agent/run-input.ts) (server-side `evaluateLiveTriggerMatches` at run start, surfaced as Section 7 of the system prompt). The audit's "0×" finding was pre-PR. Marking P1-8 closed; no action needed.
- ✅ **P2-3 — Per-horizon WATCHING templates.** [`defaults.ts`](../lib/agent/triggers/defaults.ts) `defaultTriggersForHorizon(_, _, "WATCHING")` now branches on horizon: WATCHING/CATALYST gets filing+earnings REVIEW + 14d hygiene; WATCHING/TRADE gets a tight ENTER + 14d hygiene (matches max-hold); WATCHING/TARGET keeps the current shape (entry + support REVIEW + 30d hygiene); WATCHING/COMPOUNDER gets a patient ENTER (7d cooldown — ignore wiggles), guidance-cut REVIEW, and 90d hygiene. All four templates carry `REVIEW_DATE_HIT` so the trigger-evaluator's 5-min cron auto-fires when `nextReviewAt` lands.
- ✅ **Self-healing prompt language.** Step 2.A NO branch in [`system-prompt.ts`](../lib/agent/system-prompt.ts) now requires the agent to inspect a WATCHING thesis's triggers[] before logging REVIEWED — if the array has zero ENTER triggers (or only legacy EXIT triggers), it's malformed and must be repaired via `update_thesis(triggers: [...])` or explicitly closed via `change_status: INVALIDATED`. The existing `update_thesis` zero-trigger guard backstops this — REVIEWED-only updates on zero-trigger theses are already rejected.

**Verification 2026-05-08 (production):**
- Goalpost-moves since 2026-05-07: **0** (5 in the prior 7-day window, all on AMZN by Catalyst Event Raider 5/05–5/06 — pre-existing baseline).
- New WATCHING theses 2026-05-07: **5** (MRVL, MU, AMKR, SMCI, FIVN). All directional, all have ENTER + target + horizon + ≥2 keyAssumptions + ≥2 invalidationConds. coreBelief 3 of 5 (60%) — the rest is the P0-1 structural-fields work, separate session.
- Manual cron sanity check via Inngest dashboard pending — outside this session's automated reach.

---

## Done since 2026-05-06 audit (prior session)

For posterity — what got fixed in the 2026-05-06 → 2026-05-07 window:

- ✅ `defaultTriggersForHorizon()` now takes a `state: 'HELD' | 'WATCHING'` param. WATCHING templates emit `ENTER` triggers (no EXIT). 39 watching theses re-backfilled. (PR #217)
- ✅ Watching trigger health: 0 EXIT triggers on watching theses (down from majority); 0 zero-trigger watching theses (down from 11).
- ✅ Action layer recovered: 10 INITIATEs on 5/07 vs ~1 in the prior week.
- ✅ Goalpost-moving anti-pattern: 0 occurrences on 5/07 (vs the documented MRVL incident).
- ✅ `record_run_summary` no longer drops WATCH actions (PR from 2026-05-06 session).
- ✅ Workflow registry schedule clarifications: trigger evaluator (hourly + on event), discovery (Sunday weekly), briefing (inline). (2026-05-07)
- ✅ Workflow registry has `LAST_VERIFIED_AT` and the page surfaces it. (2026-05-07)
- ✅ Doc cleanup: 24 stale planning + handoff docs moved to `docs/legacy/`. (2026-05-07)
- ✅ Recent commit-level fixes since the audit (still need verification on next morning run):
  - PR #226 — close prose-termination gap that failed 3/7 morning runs on 5/07
  - PR #228 — generalize narration→execution gate to manage_position, close_position, manage_watchlist
  - PR #229 — teach prompt to recompute target/stop on WATCHING→ACTIVE promotion
  - PR #230 — close prose-termination gap in tactical-run (mirrors #226)
  - PR #232 — block inverted-target theses at write time (record + update)

**Important caveat:** PR #228 in particular *claims* to generalize the narrate-vs-execute gate. This GAPS doc still lists P0-3 (generalized narrate-vs-execute) as open because the audit didn't verify whether #228 actually implements the full design or just adds a per-tool check. Verify before closing.

---
