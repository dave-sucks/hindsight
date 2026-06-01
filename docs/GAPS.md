# Hindsight — Gaps

> **What this is:** the live tracker for what's broken or being improved on the live-trading loop. Scoped to what affects real money, real analysts, real runs.
>
> The legacy 6-week-rework tracker is [`GAPS_LEGACY.md`](./GAPS_LEGACY.md). Most of it shipped. The remaining items there weren't important enough to land before live; they sit deferred unless production data shows them biting.
>
> **How this file is maintained:** add new items as they're found. Move closed items to the "Done since" section with the PR # and date. Don't strike through inline. When the file's open list grows past one screen, re-evaluate priorities and demote anything that's no longer load-bearing.
>
> **The 5 roles (the mental model behind every item):**
> 1. **Daily run** — manages the portfolio. Walks the book every morning. Trades, exits, trims, adds, edits targets. Reads research; never writes deep research.
> 2. **Tactical run** — same as daily but single-thesis, wakes on triggers.
> 3. **Discovery run** — mints net-new theses on Sundays.
> 4. **Thesis-writer** — refreshes research on existing theses. Dispatched on promotion + on agent judgment via `dispatch_thesis_research`. Writes belief / target / stop / triggers / sections. **Never touches status.**
> 5. **Promotion action** — closes paper positions, flips theses ACTIVE → PROMOTED, fans out writer refreshes. Output is "fresh research with urgency signal." The daily run then decides re-enter / wait / kill.
>
> Every item below is a failure of one or more of those roles to do its job, or a missing primitive that prevents them from working.

---

## P0 — Blocks the live trading loop

These prevent the live agent from doing its job. Fix first.

*(All four original P0 items shipped 2026-05-26. See "Done since" below. New P0 items go in this section as they're found.)*

---

## P1 — Quality is degraded but live loop functions

### P1-2 — Audit and remove unnecessary place_trade / update_thesis gates
**Status:** open. **Mentioned by principal 2026-05-26.**

The system has accumulated gates over time, some of which now refuse legitimate trades or block reasonable updates. Specific suspects to audit:

- `place_trade`'s `goalpost-moving` gate (refuses raising target on WATCHING when entry condition met).
- `place_trade`'s confidence-floor (rejects below `minConfidence` — fine, but is the threshold right?).
- `update_thesis`'s `structural_unchanged_reason` requirement (forces a reason field on patches that don't touch belief).
- `update_thesis`'s zero-trigger guard (rejects REVIEWED-only on theses with no triggers — fine for inert rows, but the PENDING exemption is the only sane path today).
- `update_thesis`'s INVALIDATED-on-PROMOTED rejection (prevents legitimate "this is dead" calls during the first-live-run; should this be allowed if `close_position` already fired in the same run? Probably yes).
- Anywhere the tool returns a Layer-1 refusal for a JUDGMENT CALL (not a STRUCTURAL violation).

Goal: keep gates that prevent STRUCTURALLY IMPOSSIBLE states (e.g., ACTIVE thesis with no position). Remove gates that second-guess the agent's judgment. Default to "let the agent decide" wherever the state would still be valid.

**Output:** a list of gates with a verdict (keep / remove / soften) and a follow-up PR per removal.

### P1-3 — `targetPrice` field is overloaded (was P1-23) — **DONE 2026-05-31**

The fix turned out to be a one-line trigger bug, not a schema split. `watchingEntryTrigger` was reading `targetPrice` (the take-profit) instead of `entryPrice` (where the writer wanted to buy in). The schema was always correct — both columns existed with separate meanings — the trigger code just wired the wrong column to the ENTER action.

**Shipped:**
- `lib/agent/triggers/defaults.ts:watchingEntryTrigger` now reads `entryPrice` instead of `targetPrice`
- Writer prompt clarifies `entry_price = where you'd buy in` (was ambiguously "current quote from the research")
- Long "CHOOSING THE ENTER TRIGGER" warning block in `run-thesis-writer.ts` simplified — most of it was workaround for the now-fixed default
- `PriceTargetsBlock` gauge consistently shows `Stop · Entry · Current · Target` across every status

**No schema changes. No migration.** See [`docs/plans/PRICE_LEVEL_SEMANTICS.md`](./plans/PRICE_LEVEL_SEMANTICS.md) for the postmortem on why the schema-split plan (this doc's earlier proposal) was over-engineering.

### P1-5 — Thesis-writer fabricated MRVL post-earnings data (was P1-25)
**Status:** investigation needed.

MRVL refresh (`cmpm5fmgg000904jx6puwbp54`) on 2026-05-26 wrote two contradictory rationales 7 minutes apart: first said "Q1 FY2027 print due tonight (May 27)", then said "MRVL printed a clean beat-and-raise (revenue +3.2%, raised Q2 guide)" — earnings hadn't actually printed. Likely the deep-research model inside `write_thesis_research` returned analyst estimates as if they were actuals.

**Fix:** start by inspecting the actual `write_thesis_research` output for the MRVL run to determine if the meta-tool returned bad data or the writer hallucinated on top. If meta-tool: add date-awareness to the synthesis prompt. If writer: add a Layer-1 sanity check warning in `update_thesis` rationale parser when rationale claims a beat/miss but `catalystDate` is in the future.

### P1-6 — Writer "urgency signal" output on promotion refreshes
**Status:** design + ship. Mentioned by principal 2026-05-26.

When the promotion-action dispatches N writer refreshes in parallel, each refresh comes back with a full thesis. The daily run currently has no clean way to tell "this is a high-conviction urgent buy" vs "this peaked, downgrade to watching" vs "this is broken, kill."

Add a `recommendedAction: "BUY_LIVE" | "DEFER_TO_WATCHING" | "INVALIDATE"` field that the writer sets based on its research. Surface prominently in the UI (chip on the thesis row) and read by the daily-run prompt's PROMOTED branch as the writer's input (the daily run still decides; the writer's recommendation is data, not authority).

### P1-7 — UI: rename "Awaiting live entry" to action-forcing label
**Status:** small. Principal-flagged 2026-05-26.

Current label reads passive — agent treated it that way too. Rename to "Decide today (re-enter / wait / kill)" or similar. Tiny UX fix that makes the PROMOTED state legible at a glance.

### P1-8 — V2 daily-run prompt has no DAY-trader workflow
**Status:** surfaced during V1-deletion (GAPS P0-2) audit, 2026-05-26.

`buildV2SystemPrompt` (V1, now deleted) carried a separate `if (dayOnly)` branch (~80 lines) with a DAY-trader-specific 5-phase playbook: pre-market check → movers-first screen → candidate list (5–8 names) → mint WATCHING theses with intraday ABS-price triggers → record. Critical pieces: forbidden carryover (positions over from yesterday are EOD-flatten misses to clean up first), absolute PRICE_ABOVE/PRICE_BELOW triggers only (PRICE_MOVE_PCT / VS_SMA / RSI silent-fail on the intraday cron), reject-extended-chase rule (>8% premarket), no-overnight rule with `intraday-eod-flatten.ts` at 15:45 ET enforcing.

`buildDailyRunSystemPromptV2` has no DAY branch — a DAY-only analyst (`holdDurations === ["DAY"]`) running through it gets the SWING walk-the-book workflow, which assumes durable theses and per-thesis review cadences that don't apply to a single-session strategy.

**Fix:** add a DAY-flavored fork to V2 mirroring the V1 structure. The historical V1 DAY block lives at the deletion commit's parent (`git show <parent>:lib/agent/system-prompt.ts` lines 446-526) — port the workflow body, drop the priority-blocks pre-rendering (V2 uses get_theses + needsAction instead), keep the intraday-only trigger discipline and the EOD-flatten reminder.

Verify against `intraday-eod-flatten.ts` and `discovery-run.ts:59` (which skips Discovery for DAY-only analysts) — both confirm DAY is a real production lifecycle, not legacy.

---

## P2 — Backlog (defer until P0+P1 clean)

Old GAPS items that may still matter but aren't blocking. Move out of `GAPS_LEGACY.md` if/when production data shows them biting:
- Quote source inconsistency between Layer-1 and Layer-2 (legacy P1-11)
- PRINCIPAL_CHAT hangs when child THESIS_WRITER fails (legacy P1-19)
- Status-derived-from-actions refactor (legacy P1-20) — clean architecture move, not blocking
- Discovery archetype-blind prompt (legacy P1-9)
- Provenance soft-gate (legacy P1-15)

Re-evaluate after the live loop is stable for ~1 week.

---

## Done since

### 2026-05-27 — `Thesis.promotedAt` timestamptz migration + V2 prompt-preview template
- **P1-4** — `Thesis.promotedAt` migrated from bare `timestamp(3)` to `timestamptz(6)`; existing 3 rows (AVGO/TSM/MRVL, all promoted 2026-05-26) backfilled `-12h` to undo the `@prisma/adapter-pg` AM/PM-flip. Post-migration verification confirmed `promotedAt` matches the `STATUS_CHANGED → PROMOTED` audit row to the millisecond. Schema regression test in [prisma/schema.test.ts](prisma/schema.test.ts) pins the `@db.Timestamptz(6)` annotation. Audit-row peer `ThesisUpdate.timestamp` left bare for now — written by Postgres `now()` via `@default(now())`, not affected by the adapter bug.
- **P1-9** — `SYSTEM_PROMPT_TEMPLATE` regenerated to mirror `buildDailyRunSystemPromptV2`'s 9-section structure (Identity → Edge → Universe & rules → Yesterday's standup → Horizon glossary → Per-horizon data discipline → How you work → Your job → How tools work). The "How It Works" sheet's Daily Run prompt-preview tab now shows what the agent actually receives, not the deleted V1 procedural-stages body. Consumer (`components/domain/team-card.tsx` → `PromptBanner`) renders the markdown as-is; no section-header parsing happens downstream, so no consumer changes were needed.

### 2026-05-26 — P1-1: review-driven refresh cadence (staleness gate removed)
- **P1-1** — Deleted the hard `place_trade` staleness gate (formerly `place-trade.ts:160-243`). Research-age decisions are now soft input to the agent's REVIEW flow, not a Layer-1 refusal at trade time. `classifyResearchAge` is horizon-aware (`STALE_DAYS_BY_HORIZON`: CATALYST/TRADE 7d, TARGET 30d, COMPOUNDER 90d), and `researchAge` returns `horizonThreshold` so prompts can render "stale: 32d > 30d threshold." V2 daily-run prompt teaches the REVIEW-time decision tree (dispatch refresh, soft-patch, or proceed) and explicitly notes there is no staleness gate on `place_trade`. Tactical prompt now skips the refresh and acts on the trigger (the daily run is the right place for thorough review). Design doc: [`REVIEW_REFRESH_CADENCE.md`](./plans/REVIEW_REFRESH_CADENCE.md).

### 2026-05-26 — first live promotion incident fully closed
The 2026-05-26 first-live-day failures (Earnings Drift Trader, 3 PROMOTED theses skipped) are structurally fixed.

- **P0-1** — `complete_run` preflight + new `PROMOTED_AWAITING_RESOLUTION` needsAction kind. Gate now refuses run completion when PROMOTED rows are unaddressed; agent reads the kind via `get_theses` and knows it must act. Shipped via [#346](https://github.com/dave-sucks/hindsight/pull/346).
- **P0-2** — Deleted the deprecated V1 daily-run prompt builder (`buildV2SystemPrompt` — 625 lines, misleadingly named). The next session that updates the prompt physically can't update the wrong file. Shipped via [#349](https://github.com/dave-sucks/hindsight/pull/349).
- **P0-3** — Ported PROMOTED handling into the V2 daily-run prompt. Step 2 now lists `PROMOTED_AWAITING_RESOLUTION` first; new top-priority sub-section "PROMOTED — must decide today" with the three legal outcomes. Shipped via [#349](https://github.com/dave-sucks/hindsight/pull/349).
- **P0-4** — Thesis-writer can't flip status on PROMOTED refresh. Added the PROMOTED prompt branch + Layer-1 backstop in `update_thesis` that refuses `change_status` from `runMode: "THESIS_WRITER"` on PROMOTED rows. 10 new tests pin the behavior. Shipped via [#350](https://github.com/dave-sucks/hindsight/pull/350).
- **P1-7** — UI label renamed from "Awaiting live entry" to "Promoted" (literal enum name; principal choice). The agent reads the structural needsAction kind, not the UI string, so the label is purely for human clarity. Shipped via [#349](https://github.com/dave-sucks/hindsight/pull/349).

**The PROMOTED loop is now end-to-end coherent:** writer keeps status as PROMOTED → gate forces resolution → prompt teaches the three legal outcomes → agent makes the call.

Two new findings surfaced during the V1→V2 audit, filed as P1-8 + P1-9 below.

---

## See also

- [`GAPS_LEGACY.md`](./GAPS_LEGACY.md) — the prior 6-week-rework tracker (mostly closed).
- [`THESIS_ARCHITECTURE.md`](./THESIS_ARCHITECTURE.md) — the live reference for how the system works (the 5 roles + the lifecycle).
- [`VISION.md`](./VISION.md) — the product north star.
- [`run-reviews/2026-05-26-live-analyst-architecture-review.md`](./run-reviews/2026-05-26-live-analyst-architecture-review.md) — the evidence trail for P0-1 through P0-4.
- [`plans/REVIEW_REFRESH_CADENCE.md`](./plans/REVIEW_REFRESH_CADENCE.md) — design doc that drove P1-1 (closed 2026-05-26).
