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

### P0-1 — `complete_run` preflight scope excludes PROMOTED
**Status:** in-progress (this session). **Production-confirmed 2026-05-26 on Earnings Drift Trader.**

`lib/agent/tools/complete-run.ts:437` scopes the unaddressed-needsAction preflight to `["ACTIVE","WATCHING"]`. PROMOTED theses are silently excluded; the agent can complete the run without addressing them. Today's first live morning run hit this: 3 PROMOTED rows (AVGO, MRVL, TSM) sat untouched, primaryDecision: WATCH, tradesPlaced: 0.

**Fix:** add `"PROMOTED"` to the scope filter. Add a `PROMOTED_AWAITING_RESOLUTION` needsAction kind so the refusal message tells the agent what's expected (place_trade / update_thesis change_status: WATCHING / update_thesis change_status: INVALIDATED — though INVALIDATED on PROMOTED is currently rejected by tool gates; revisit per P1-2).

**Verify:** tomorrow morning's run on the live analyst should refuse to complete until each of the 3 PROMOTED rows is addressed.

### P0-2 — DELETE the deprecated V1 daily-run prompt (`buildV2SystemPrompt`)
**Status:** open. **Root cause of the V1/V2 confusion that buried PROMOTED handling.**

`lib/agent/system-prompt.ts:106` defines `buildV2SystemPrompt` — a misleadingly-named ~600-line legacy daily-run prompt marked `@deprecated` but still in the file. The current production prompt is `buildDailyRunSystemPromptV2` at line 831, ~165 lines. The legacy file still being present is a footgun: sessions porting features (like PROMOTED handling) have been updating the wrong file. Today's failed run is the direct consequence — PROMOTED guidance exists in the V1 prompt (lines 627-645) and is missing from the V2 prompt that actually ships.

**Fix:** before deleting, scan for ANY remaining content in V1 that's missing from V2 — PROMOTED handling is the known one, audit for others. Port whatever's missing into V2 (see P0-3). Then `git rm` the V1 builder + its caller-less helper functions. Update the `// V1 deprecated` comment block at line 95-104 to point to the deletion commit.

**Why it's P0:** as long as V1 lives in the repo, the next session that needs to update the prompt will likely land it in the wrong file. P0-3 (porting PROMOTED back to V2) is half the value; the other half is making it impossible to repeat the mistake.

### P0-3 — Port PROMOTED handling into the V2 daily-run prompt
**Status:** open. **Half the cause of today's failure (paired with P0-1).**

The V2 daily-run prompt (`buildDailyRunSystemPromptV2`) has zero PROMOTED guidance. Step 2's needsAction values are listed as `TRIGGER_FIRED / TRIGGER_MATCHING_NOW / REVIEW_DUE / null` — no PROMOTED-specific kind. The walk-through has branches for TRIGGER_FIRED and REVIEW_DUE on PENDING / LONG / SHORT, no PROMOTED branch.

**Fix:** port the PROMOTED block from `lib/agent/system-prompt.ts:627-645` (the V1 prompt) into V2's step 2. Concretely add ~25 lines:
- A new bullet under needsAction values: `PROMOTED_AWAITING_RESOLUTION` (paired with P0-1).
- A new sub-section under Step 2 named "**PROMOTED — must decide today**" that explains the three legal outcomes (re-enter via place_trade / defer via update_thesis change_status: WATCHING / kill via INVALIDATED) and the conviction-context fields the agent should consider.
- Mention in the closeout-contract / per-thesis-action paragraph that PROMOTED rows require a status-changing call.

Keep V2's tight 165-line shape — the addition is incremental, not a rewrite.

### P0-4 — Thesis-writer prompt: add PROMOTED branch (don't flip status on refresh)
**Status:** open. **Caused all 3 promotion-time status flips today.**

`lib/agent/run-thesis-writer.ts:268-310` branches on `existingThesis?.status === "ACTIVE"` (HELD template) vs everything else (WATCHING template). PROMOTED falls into the WATCHING branch — the prompt literally says "YOU ARE WRITING A WATCHING THESIS" when refreshing a PROMOTED row, and the writer obediently calls `update_thesis(change_status: "WATCHING")` to match.

**Fix:** add a third branch for `existingThesis?.status === "PROMOTED"`. Use PR #333's PROMOTED trigger template (already exists in `lib/agent/triggers/defaults.ts`). Explicit FORBIDDEN clause: "Do NOT call `update_thesis` with `change_status`. Refresh research only — status is the daily run's call." Optional Layer-1 backstop: refuse `change_status: WATCHING` from PROMOTED when `runMode === "THESIS_WRITER"`. The principal had to manually revert 3 thesis rows today; this is the durable fix.

---

## P1 — Quality is degraded but live loop functions

### P1-1 — Replace the abandoned place_trade staleness gate (old P1-22) with review-driven judgment
**Status:** design needed. **Replaces and supersedes the old P1-22.**

The original P1-22 plan was a hard `place_trade` gate that would refuse trades on research older than N days. That's the wrong shape — it gates EXECUTION on research age instead of keeping research current.

Correct design: theses get reviewed on cadence (`nextReviewAt`) and on triggers (REVIEW). The review's job is for the agent to decide:
- Thesis intact, no changes → log REVIEWED.
- Thesis intact, small tweak warranted (e.g., lower the entry price because the agent's more bullish) → `update_thesis` with the patch.
- Thesis materially stale, needs a full rewrite → `dispatch_thesis_research(refresh)`, wait for the rewrite, act on the refreshed thesis.

The agent uses judgment. No hard gate on `place_trade`. The system makes refreshes EASY (dispatch_thesis_research in the allowlist, fast turnaround) and the prompt teaches the decision tree.

**What needs to happen:**
1. Add `dispatch_thesis_research` to the daily-run + tactical mode allowlists.
2. Add `wait_for_thesis_refresh` to the daily-run allowlist so the agent can block on the refresh before acting.
3. Update V2 prompt step 2 with the decision tree for REVIEW_DUE: "Decide whether to log REVIEWED only, patch via update_thesis, or full-rewrite via dispatch_thesis_research."
4. Soft signal in `get_theses` output: `researchAge: "fresh" | "stale" | "missing"` + `daysOld` so the agent has the data to decide.
5. **No** hard gate in `place_trade`. The agent trades on its judgment.

**Design doc needed:** `docs/plans/REVIEW_REFRESH_CADENCE.md` — written next session.

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

### P1-3 — `targetPrice` field is overloaded (was P1-23)
**Status:** open. Currently mitigated by the V2 thesis-writer overriding all defaults (0/8 theses on the live analyst hit the broken default today).

Same `targetPrice` column is "take-profit" when ACTIVE and "buy-in breakout" when WATCHING/PROMOTED (per the default ENTER trigger in `lib/agent/triggers/defaults.ts:295-310`). Writer-as-shield works, but the schema split is the durable fix:
1. Split into `entryTriggerPrice` (WATCHING/PROMOTED breakout) and `takeProfitPrice` (ACTIVE take-profit).
2. Migrate existing rows.
3. Update default triggers + sheet renderers + prompts to read the right field per status.
4. Drop `targetPrice` after a soak period.

~1 day. Reconsider priority if a non-writer code path becomes a meaningful share of thesis production.

### P1-4 — `Thesis.promotedAt` column timestamp 12h adrift from audit row (was P1-24)
**Status:** open. Surfaced 2026-05-26.

Column is `timestamp without time zone`; audit-row `ThesisUpdate.timestamp` is `timestamptz`. Same `new Date()` write yields different stored values — exactly 12h apart. Probable Prisma/`@prisma/adapter-pg` AM/PM-flip on the bare-timestamp column type. Doesn't break trading but breaks any time-since-promotion math.

**Fix:** migrate column to `timestamptz`, validate Prisma schema declaration, backfill query: `UPDATE "Thesis" SET "promotedAt" = "promotedAt" - INTERVAL '12 hours' WHERE "promotedAt" > NOW()` (verify against `ThesisUpdate` first per-row).

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

(Nothing yet. Items move here with PR # and date when they ship.)

---

## See also

- [`GAPS_LEGACY.md`](./GAPS_LEGACY.md) — the prior 6-week-rework tracker (mostly closed).
- [`THESIS_ARCHITECTURE.md`](./THESIS_ARCHITECTURE.md) — the live reference for how the system works (the 5 roles + the lifecycle).
- [`VISION.md`](./VISION.md) — the product north star.
- [`run-reviews/2026-05-26-live-analyst-architecture-review.md`](./run-reviews/2026-05-26-live-analyst-architecture-review.md) — the evidence trail for P0-1 through P0-4.
- `docs/plans/REVIEW_REFRESH_CADENCE.md` (TBD) — design doc for P1-1.
