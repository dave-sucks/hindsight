# Trigger followups (post trailing-stop PR)

> Self-contained handoff for a fresh session. Three open items, ordered cheapest → biggest.

## What just shipped (context)

- **This PR — `claude/trailing-stop-trigger`:** `TRAILING_STOP` is now a **first-class trigger predicate**, not a side-channel. The trigger-evaluator evaluates it against the paired Position's `peakPrice` (the price-monitor maintains that high-water mark for every open position) + direction, then fires `app/thesis.trigger.fired` → tactical run → close proposal → approve/reject — **identical pipeline to "exit at $X".** Manual creation via a "Trailing stop" toggle on the stop trigger's popover (`components/agent/sheets/ThesisTriggersSection.tsx`); editing the % is the normal trigger-value edit. Enforcement key files: `lib/agent/triggers/evaluate.ts` (the `TRAILING_STOP` case), `lib/inngest/functions/trigger-evaluator.ts` (feeds `peakPrice`/`direction` into the eval context), `lib/actions/thesis-edit.ts` (`applyTriggerTypeChange` + `applyTriggerValueEdit`).
- **NOTE:** an earlier build of this routed trailing through `Position.exitStrategy="TRAILING"` (the price-monitor's direct-close path). That was removed because it bypassed the trigger pipeline. **Keep that history in mind for Followup 3 — that "direct execute" path is exactly what we want back, but as a deliberate per-trigger choice.**
- **PR #457 (merged):** `get_theses` surfaces `principalDirective` (the principal's most recent reject comment / approve-edit, verbatim); a reject-with-comment sets `nextReviewAt=now` so the thesis comes up `REVIEW_DUE` and the agent reads + acts on the note (`lib/agent/tools/get-theses.ts`, `lib/proposals/execute.ts`, `lib/agent/system-prompt.ts`).

---

## Followup 1 — Teach the agent to set trailing stops (~3 lines, do first)

**Why:** `TRAILING_STOP` is in the `update_thesis`/`record_thesis` tool schema, so the agent *can* emit `{kind:"TRAILING_STOP", trailPct}` and it validates + fires. But the **prompt never tells it when to**. So the principal's "I think we can squeeze more, but sell if it drops 5% from here" — which PR #457 already surfaces and flags for review — won't reliably become a trailing stop, because the agent doesn't know to map "% retracement from here" → trailing stop.

**Fix:** add a line to the directives/REVIEW section of `lib/agent/system-prompt.ts`: *"A 'sell if it drops X% from here / lock in gains on a pullback' instruction = a `TRAILING_STOP` trigger at X% (EXIT action). Set it via `update_thesis` triggers."* Consider mirroring in the trigger-template guidance in `lib/agent/tools/record-thesis.ts` (~line 238).

**Done when:** rejecting a held name with "squeeze more but sell on a 5% drop" → next daily run → agent sets a 5% `TRAILING_STOP` → which fires a close proposal on breach.

---

## Followup 2 — Edit-on-reject

**Why:** the most *direct* version of the squeeze scenario — set the trailing stop (or tweak the stop/target) **in the reject dialog itself**, in one step, no agent round-trip.

**What:** `components/proposals/ProposalActions.tsx`'s reject dialog currently takes only a free-text message. Add structured controls — e.g. "reject + set N% trailing stop" / "reject + raise stop to $X". Wire to the existing `applyTriggerTypeChange` / `applyTriggerValueEdit` (`lib/actions/thesis-edit.ts`) and the trigger PATCH route (`app/api/theses/[id]/triggers/[triggerId]/route.ts`), alongside the existing `rejectProposal`.

**Note:** reuse the popover's trailing toggle UX. Keep the free-text message too (PR #457 reads it).

---

## Followup 3 — Per-trigger fire mode: tactical run vs direct execute (the big one)

**Why (the principal's actual driver):** tactical runs are **expensive** — every trigger fire spawns a GPT-5.5 agent. Spend blew up partly from this (see memory `project_openai_spend_audit_2026_06_11`: ~$15/day incl. tactical refire storms). For a **deterministic exit** like a trailing stop or a hard stop, there's **nothing for the agent to decide** — it should just exit (or propose the exit) without paying for a tactical run.

**The ask:** a per-trigger choice — **"wake a tactical run (agent evaluates + decides)"** vs **"execute directly (no agent — instant exit / instant close-proposal)."** Plus the broader flexibility to add triggers to any action section (Buy / Sell / Review) with the chosen behavior.

**Key insight — the direct path already exists.** The price-monitor's `checkExitConditions → closeOpenPosition` (the `exitStrategy="TRAILING"` machinery in `lib/trade-exit.ts` + `lib/inngest/functions/price-monitor.ts`) closes a position **directly, no agent**. That's the exact side-channel removed from trailing in this PR — but as a *deliberate per-trigger mode* it's the right cost-saving tool.

**Design sketch:**
- Add `fireMode: "TACTICAL" | "DIRECT"` to the `Trigger` type + zod schema (`lib/agent/triggers/types.ts`, `schema.ts`), default `TACTICAL` (current behavior).
- In `lib/inngest/functions/trigger-evaluator.ts`, on a fire: `DIRECT` → call `closeOpenPosition(...)` directly (it already routes through `maybeAwaitApproval`, so approvals still apply); `TACTICAL` → fire `app/thesis.trigger.fired` (current).
- Default trailing stops (and arguably all EXIT stops/targets) to `DIRECT` — they're mechanical; tactical adds cost, not value. Let the principal flip it per trigger.
- UI: trigger popover exposes "On fire: Review (tactical) / Exit immediately (no agent)."

**Important caveat:** `DIRECT` still respects the approval gate. On a LIVE account with require-approval-sells ON, a direct trailing exit still **proposes** a close (no auto-sell) — `DIRECT` saves the *tactical-run cost*, not the approval step. (To get true auto-sell, require-approval-sells must be off — separate setting.)

**Cost cadence note:** triggers (incl. trailing) are evaluated **hourly during market hours** by the trigger-evaluator's price path (independent of the paused signal pipeline). Not tick-by-tick. `DIRECT` mode doesn't change cadence — it changes what happens *on* a fire (close directly vs spawn an agent).

**Files:** `lib/agent/triggers/types.ts` + `schema.ts`, `lib/inngest/functions/trigger-evaluator.ts`, `lib/actions/closeTrade.actions.ts` (already gate-aware), the popover UI. Add a `fireMode` switch-case nowhere needed (it's a trigger field, not a predicate kind).
