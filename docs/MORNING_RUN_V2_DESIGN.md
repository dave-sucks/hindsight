# MORNING_PLAN_V2 — Design Doc (FINAL)

**Status:** Draft, awaiting review. **Not implemented.**
**Last revised:** 2026-05-10 — added Fix #0 after a follow-up audit found that per-thesis triggers are NOT authoritative today; three parallel layers override them. Fix #2's `needsAction` taxonomy amended to be purely trigger-driven (`NEAR_TARGET` / `NEAR_STOP` kinds dropped — they were the same hardcoded-threshold bug at a different layer). Without Fix #0, every other change in this doc is cosmetic. 2026-05-08 — earlier drafts proposed inventing new tools and bootstrapping data in the prompt. Both were wrong. This version keeps every existing tool, keeps the agent fetching its data via tool calls (visible in the UI), and rewrites only what's actually broken.

---

## TL;DR

**The single most important finding:** per-thesis triggers — the agent-set predicates that are supposed to decide when to enter, exit, scale, or review — are **not actually authoritative today**. Three parallel layers override them:

1. **Auto-close cron.** Every position is created with `exitStrategy: "PRICE_TARGET"`. `lib/inngest/functions/price-monitor.ts` runs hourly, calls `lib/trade-exit.ts`, and auto-closes any position whose price hits its stop or target — no LLM in the loop. The trigger evaluator's 5-min cron path is the path that's *supposed* to drive exits (via tactical-run validation); the hourly auto-close races it and wins.
2. **Hardcoded alarm thresholds.** The same hourly cron writes `NEAR_TARGET` (≥0.9 progress) and `NEAR_STOP` (≥0.8 progress) `PositionManagementAction` rows on hardcoded percentages. Those rows feed the daily-run prompt's "Priority Reviews — MUST act today" block, forcing defensive action on positions the agent never set a near-trigger for.
3. **Generic numeric rules in the prompt.** `lib/agent/system-prompt.ts` Step 2.B layers in *"Within 5% of stopLoss → MUST call manage_position"* and similar — regardless of what the per-thesis triggers actually configured.

Result: the user's anchor scenario — *"6-month hold, +150% target, sell only if it drops 5%"* — does not work today. A -3% intraday tick can fire the auto-close path, the `NEAR_STOP` alarm, or the prompt's 5%-from-stop mandate before the agent's per-thesis logic gets a chance. **The trigger system as designed is correct; it just isn't being trusted by the operational layers around it.**

**Tools (otherwise) are not the problem.** `read_signals`, `get_portfolio_context`, `get_theses`, `get_stock_data`, `read_artifact`, `update_thesis`, `place_trade`, `manage_position`, `close_position`, `manage_watchlist`, `record_thesis`, `record_run_summary`, `complete_run` — all stay exactly as they are. Tool descriptions, schemas, gates, UI rendering — unchanged.

**Seven things ARE broken (added Fix #0 to the original six):**

0. **Per-thesis triggers are not authoritative.** Three parallel layers override them. Until this is fixed, every other prompt or tool change is cosmetic. *(NEW — must land first.)*
1. The system prompt is 600 lines of procedural stages, hard-reject gates, priority blocks, and prohibition lists. The model gets lost in it.
2. The 5 priority blocks the prompt renders (Priority Reviews, Fired Triggers, Matching Triggers, Live Theses, Watchlist) are different views of the same question — "what theses need my attention?" — and the agent has to cross-reference them. They should be one field on each thesis row, computed by the tool. *(AMENDED — kinds must be trigger-driven, not hardcoded thresholds.)*
3. `read_signals`'s fallback path turns "router routed nothing today" into "here are 50 signals matching your sector" — a firehose.
4. The user prompt the morning cron sends is `"Begin your research session. Follow all phases in order."` — generic, conversational. The model treats the run like a chat.
5. The Daily Run sees discovery bucket signals, blurring the line between "manage your book" and "find new coverage."
6. **`MODES["research-run"].toolAllowlist` is `undefined` — Daily Run sees every tool, including `record_thesis` and `manage_watchlist`. Mode separation isn't enforced.** Daily Run is supposed to manage the existing book, not mint new coverage. Discovery's job is to mint. The boundary lives in the tool allowlist, not in prose rules in the prompt.

The fix is small and surgical. Land Fix #0 first; everything downstream follows naturally. *(Note: "Discovery weekly-only" — sometimes called out as a separate concern — is achieved for free by Fix #1's prompt rewrite (no Step 4 — Discovery anymore) plus Fix #5's allowlist (which excludes `record_thesis` + `manage_watchlist` from the Daily Run). No separate fix needed.)*

---

## What stays the same (so this is unambiguous)

- **Every tool listed above.** Same names, same schemas, same descriptions, same gates, same UI cards.
- **Tool execution order.** Agent can call tools in whatever order makes sense for its work.
- **Tool result rendering.** Same `ToolCallRow` dispatch on `result.ui` discriminator. Same renderers (ToolUIRenderer, ThesisCardRenderer, RunSummaryRenderer, etc.).
- **Run lifecycle.** ResearchRun row, RunEvent stream, RunMessage persistence — unchanged.
- **Briefing agent.** Inline after every run. Unchanged.
- **Trigger evaluator + tactical run.** Untouched. (Fix #0 stops the OTHER layers from racing them — but the trigger evaluator and tactical-run code paths themselves don't change.)
- **Discovery cron + prompt + tools.** Untouched.
- **`price-monitor.ts` peak/trough tracking and the near-target email.** Stay. They're useful telemetry — peak for trailing-stop math, email for user-facing alerts. **Only the auto-close path goes (Fix #0).**
- **buildRunInput** stays as a function. Its output shape slims down (priorityReviews / triggersFiredSinceLastRun / triggersMatchingNow / activeTheses are removed because the agent gets that data through `get_theses` now), but it still computes positions and the briefing standup for the prompt.

---

## Where logic lives — the three-layer principle

This is the architectural backbone underneath every fix below. Every well-built agent system (Cursor, Claude Code, Perplexity, Devin) splits logic across three layers and is religious about putting each rule in the RIGHT layer. Today Hindsight blurs all three; V2 separates them cleanly.

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1 — Tool gates (server-side validation)               │
│ "What must NEVER happen, regardless of what the agent       │
│ thinks." Refuses bad calls. Returns the rejection reason    │
│ as a tool result. The agent reads the rejection and         │
│ corrects its call. NOT enforced by prose in the prompt.     │
└─────────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────────────┐
│ Layer 2 — Tool result shape (computed context)              │
│ "What the agent shouldn't have to compute itself."          │
│ Pre-digested state in tool responses. The agent CONSUMES    │
│ this info; the math/cross-referencing happens server-side.  │
│ Examples: needsAction per thesis, daysToEarnings, signals   │
│ already filtered to today's portfolio + watchlist.          │
└─────────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────────────┐
│ Layer 3 — Prompt (judgment + identity + intent)             │
│ "What requires interpretation." The mandate, the goals, the │
│ analyst's role and edge. SHORT. Describes WHAT and WHY,     │
│ not HOW. The mechanical HOW lives in tools.                 │
└─────────────────────────────────────────────────────────────┘
```

**Mapping every rule in today's prompt to its V2 destination:**

| Rule today | Layer | V2 destination |
|---|---|---|
| 6 procedural stages (Step 1 / Step 2 / …) | — | **Deleted.** Procedures don't belong anywhere. The agent needs goals ("act on needsAction items"), not pseudocode. |
| 4 horizons with full default-cadence explanations | 2 + 3 | Cadence math → tool-internal (Layer 2: `get_theses` uses horizon to compute `REVIEW_DUE`). 5-line glossary → prompt (Layer 3: explains what each horizon MEANS for exit policy). The agent SEES horizons, doesn't COMPUTE cadence. |
| 5 priority blocks (Priority Reviews, Fired Triggers, Matching Now, Live Theses, Watchlist) | 2 | **`get_theses.needsAction`** — one annotation per thesis row. The 5-way cross-reference happens server-side. |
| Tool-call discipline + forbidden-phrase list | 3 | One sentence in the user prompt: "You are running unattended. No human will respond. Every turn must call a tool. End with complete_run." |
| Closeout contract ("every Live Theses row produces one tool call") | — | **Deleted.** It existed because the agent didn't know which rows mattered. With `needsAction`, it does — null rows don't need touching. |
| Promotion check (prompt narration) | 1 | **Deleted from prompt.** Already a tool gate in `record_run_summary` (PR #235). Don't duplicate. |
| Goalpost-moving prohibition (prompt narration) | 1 | **Deleted from prompt.** Already a tool gate in `update_thesis` (PR #232 + #220). Don't duplicate. |
| 9 hard-reject gates listed as prose rules | 1 | **Already in tools, kept there. Prose duplicates deleted.** The agent learns from rejection messages, not from prompt warnings. |
| `record_thesis` 30-line tool description | — | Tool description, not prompt. Stays — it's the right place for the schema-level guidance. |
| Tool catalog re-listed in prompt | — | Already injected by AI SDK as schemas; the prompt doesn't repeat it. |
| Identity + mandate (analystPrompt) | 3 | **Kept.** This IS the judgment that makes Tech Momentum different from Catalyst Event Raider. |
| Universe & rules (sectors, watchlist, sizing) | 3 | Kept. |
| Yesterday's briefing standup | 3 | Kept (continuity between runs). |
| Workflow goals (5 bullets, not 6 stages) | 3 | Kept. ~5 lines. |
| Per-`needsAction`-kind action map (TRIGGER_FIRED → execute action; TRIGGER_MATCHING_NOW → same; REVIEW_DUE → update_thesis) | 3 | Kept. ~5 bullets. |
| Horizon glossary (CATALYST/TRADE/TARGET/COMPOUNDER meaning) | 3 | Kept. ~5 lines. |

**Why this works:** the agent's attention budget goes to JUDGMENT (analyst-specific edge, what makes a good trade), not to tracking 9 rules across 5 priority blocks across 6 procedural stages. The model gets the context it needs through tool results (Layer 2) and gets stopped from doing the wrong thing by tool gates (Layer 1). The prompt is short because it doesn't have to teach mechanics.

**This is how Cursor handles "you must read a file before editing it":**
- Layer 1 (tool gate): `edit_file` refuses if the file hasn't been read this session. Returns "Read the file first."
- Layer 2 (tool result): `read_file` returns the file with line numbers. Agent sees structure, doesn't compute it.
- Layer 3 (prompt): "Be careful with destructive operations." One sentence. Judgment, not procedure.

**Mapped to Hindsight:**
- Layer 1 (tool gate): `place_trade` refuses if confidence < threshold or target ≤ entry. Returns the specific reason.
- Layer 2 (tool result): `get_theses` returns each thesis with `needsAction`. Agent sees what needs work.
- Layer 3 (prompt): "Manage your book. Act where needsAction says to act. End with complete_run." Goals, not procedures.

---

## The seven fixes

### Fix #0 — Make per-thesis triggers authoritative *(NEW — must land first)*

**Current state:** every position created by `place_trade` is set to `exitStrategy: "PRICE_TARGET"` ([place-trade.ts:330](../lib/agent/tools/place-trade.ts)). Every hour, `lib/inngest/functions/price-monitor.ts` calls `checkExitConditions(position, currentPrice, peakPrice)`, which runs the `PRICE_TARGET` branch of `lib/trade-exit.ts` and calls `closeOpenPosition` directly when price hits the stop or target. **No LLM in the loop, no per-thesis trigger consulted.** The same cron also writes `NEAR_TARGET` (≥0.9 progress) and `NEAR_STOP` (≥0.8 progress) `PositionManagementAction` rows on hardcoded thresholds — these become the daily-run prompt's "Priority Reviews — MUST act today" block.

The trigger evaluator (`lib/inngest/functions/trigger-evaluator.ts`, 5-min cron) evaluates the agent's per-thesis triggers correctly — but `checkExitConditions` runs every hour and short-circuits straight to `closeOpenPosition` before the trigger system can spawn a tactical run. **The agent's careful per-thesis decisions are racing a generic auto-close layer and losing.**

**Problem:** the user's anchor scenario doesn't work. A 6-month TARGET hold with stop at -5% can be auto-closed by the parallel layer on a transient price tick. A 14-day TRADE 80% of the way to its stop fires `NEAR_STOP` and gets forced into defensive action even when the thesis is intact. The agent has no way to express "trust my triggers, don't auto-close." The doc's premise — that the trigger system + tactical-run + per-thesis predicates is the source of truth — is contradicted by these layers running underneath.

**Fix:**

1. **Change `place_trade` default `exitStrategy`** from `"PRICE_TARGET"` to `"MANUAL"` (`lib/agent/tools/place-trade.ts:330`). New positions are trigger-controlled by default. The agent can still opt into trailing behavior explicitly via `manage_position.set_trailing_stop`, which sets `exitStrategy: "TRAILING"`.

2. **Gut `lib/trade-exit.ts` to TRAILING-only:**
   - Delete the `PRICE_TARGET` branch (~lines 34-53). Per-thesis triggers in the trigger evaluator now own this.
   - Delete the `TIME_BASED` branch (~lines 55-60). Dead code — no production caller ever sets `exitDate`.
   - Keep the `TRAILING` branch (~lines 62-81). This is an explicit per-position behavior the agent OPTS IN to via `manage_position`. Different semantic from triggers — it's "trailing peak math, not predicate evaluation."
   - Keep `MANUAL` (no-op).
   - Delete the `NEAR_TARGET` / `NEAR_STOP` `PositionManagementAction` writes (~lines 148-220). Those are the hardcoded-threshold parallel logic. Without them, the daily-run prompt's Priority Reviews block goes empty (correct — that block is killed by Fix #1 anyway).
   - Keep the `targetProximity` / `stopProximity` helper functions; they're still useful for the near-target email.

3. **Strip the auto-close call from `lib/inngest/functions/price-monitor.ts`:**
   - Keep: fetching quotes, peak/trough updates on `Position`, `PRICE_CHECK` `PositionEvent` writes, the user-facing near-target email (lines 132-175). All useful telemetry.
   - Remove: the `checkExitConditions(position, currentPrice, position.peakPrice)` call at line 130. Trigger evaluator's 5-min cron path is now the sole consumer of price-vs-trigger evaluation. (Trigger-evaluator already loads ACTIVE+WATCHING theses with non-empty triggers, so positions covered by per-thesis triggers are already handled.)
   - Net: `price-monitor.ts` becomes a thin orchestrator — peak/trough tracking + email + timeline events, nothing that closes positions.

4. **Position.exitStrategy enum decision:** keep, narrowed. Effective values become `MANUAL` (default) | `TRAILING` (explicit opt-in). `PRICE_TARGET` and `TIME_BASED` are unreachable but the column stays for legacy rows. No backfill SQL needed — existing OPEN positions with `exitStrategy: "PRICE_TARGET"` keep that string, but the only code path that read it (`checkExitConditions`) is gone, so they effectively become `MANUAL`. Document; revisit removing the column once production has zero `PRICE_TARGET` open positions.

**What's the fallback if a thesis disappears or has no triggers?** None — and that's correct. If a position has an active thesis with triggers, the trigger evaluator handles it. If a thesis is INVALIDATED/CLOSED but the position is still OPEN, that's a state-machine bug in `close_position` (it should fire the thesis update). Adding a generic safety net here would re-introduce the parallel-logic problem; the right answer is to fix the state-machine bug if it surfaces.

**Why this lands first:** every other fix in this doc assumes the agent's per-thesis triggers are the source of truth. Until Fix #0 lands, the prompt rewrite (Fix #1) and `needsAction` field (Fix #2) describe a system that doesn't actually work that way. With Fix #0 landed, the rest of the fixes are honest. Without it, they're cosmetic.

**Effort:** ~3-4 hours including unit-test reshape (`lib/trade-exit.test.ts` rescoped to TRAILING + MANUAL).

### Fix #1 — Rewrite the system prompt

**Current state:** ~600 lines in `lib/agent/system-prompt.ts`. Six procedural stages (Step 1 through Step 6), nine hard-reject gates duplicated as prose rules, five priority blocks, a "Tool-call discipline" section listing forbidden phrases, a closeout contract, a promotion check, a goalpost-moving prohibition, anti-narration rules for trades and watchlist updates, a per-thesis review loop with multiple branches.

**Problem:** Each rule was added to fix a specific failure. Stacked, they form a maze. The model navigates by lowest-resistance path, which is often "summarize the priority blocks back as prose, then ask the user a question." Today's runs prove this — 3 of 7 morning runs failed today, two by reading data and stopping mid-flow without acting.

**Fix:** Rewrite the prompt to ~80 lines. Goals, not procedures. Identity, not rules. **The priority blocks (Priority Reviews / Fired Triggers / Matching Triggers / Live Theses / Watchlist) are removed from the prompt entirely — the work moves into `get_theses`'s response shape (see Fix #2 below).** Rendered shape:

```
═══════════════════════════════════════════════════════════════════
You are [Tech Momentum Trader / Catalyst Event Raider / etc].
═══════════════════════════════════════════════════════════════════

## Edge
[Analyst's existing analystPrompt — unchanged, ~30-50 lines]

## Universe & rules
- Sectors: Information Technology
- Industries: Semiconductors, Software, Tech Hardware
- Themes: [if any]
- Direction: LONG only
- Hold style: SWING
- Min confidence: 70%
- Max position size: $2,500
- Max open positions: 5
- Watchlist seeds: AMD, NVDA, MSFT, FIVN

## Yesterday's standup
[Briefing agent's writeup from prior run — unchanged]

## Horizon glossary
- **CATALYST** — trade is built around an event. Exit on the event firing
  or 30 days past catalystDate.
- **TRADE** — short-term momentum or pattern. Max 14 days. Exit on stop,
  target, or maxHoldDays.
- **TARGET** — open-ended swing with a defined target. Weeks to months.
  Exit on stop, target, or invalidation.
- **COMPOUNDER** — long-term hold. Months to years. Exit only on
  invalidation triggers.

═══════════════════════════════════════════════════════════════════
## Your job
═══════════════════════════════════════════════════════════════════

You are running UNATTENDED. No human will answer questions. Every
assistant turn must include at least one tool call. Text-only turns
end the run as FAILED. End with complete_run.

Each morning:

1. Read your inbox. read_signals returns today's portfolio + watchlist
   signals. get_portfolio_context returns your live positions with
   PnL. get_theses returns your active and watching theses, each with
   a `needsAction` field telling you which ones need work today —
   TRIGGER_FIRED, TRIGGER_MATCHING_NOW, REVIEW_DUE, or null.

2. Act on every thesis where needsAction is non-null:
   - TRIGGER_FIRED → execute the trigger's declared action.
       ENTER  → place_trade if conviction holds, OR update_thesis
                with a concrete rejection reason (volume too thin,
                regime shift, fresh negative news, R/R no longer 2:1).
                "Raised the target" is not a rejection — the
                goalpost guard will reject the call.
       EXIT   → close_position.
       REVIEW → research + update_thesis.
       TRIM / MOVE_STOP / ADD → manage_position.
   - TRIGGER_MATCHING_NOW → same map; the predicate is true right now
     even if the cron hasn't delivered the fire event yet. Treat the
     same as TRIGGER_FIRED.
   - REVIEW_DUE → update_thesis with what you found. Empty patch +
     rationale is fine if nothing material changed.

3. Theses with needsAction == null don't need to be touched. The
   trigger system already evaluated them; nothing fired, nothing's
   matching, no review is due. Yesterday's thesis stands.

4. Use get_stock_data when you need fresh price/research for a ticker
   you're acting on. Skip it for routine REVIEWED-only updates.

5. record_run_summary with your decision and ranked picks. Then
   complete_run.

═══════════════════════════════════════════════════════════════════
## How tools work
═══════════════════════════════════════════════════════════════════

Tools enforce all the constraints — confidence thresholds, target/stop
shape, position size limits, goalpost-moving, duplicate positions,
target/stop relative ordering vs live price. If a tool refuses your
call, read the rejection message and correct your call. Don't work
around it.

You do not need to think about: signal IDs, trigger cooldowns,
nextReviewAt, watchlist sync, thesis provenance, source kinds. The
tools handle those.

You cannot mint new coverage on a ticker with no existing thesis —
that's the Discovery Run's job (Sundays). Manage what you have.
```

That's the prompt. ~80 lines. Loaded with goals + analyst-specific identity + last night's standup. No procedural stages. No forbidden-phrase lists. No closeout contracts. No promotion-check pseudocode. Tool gates and `record_run_summary`'s narration→execution gate already enforce the invariants — the prompt doesn't have to repeat them.

### Fix #2 — Add `needsAction` to `get_theses`'s response

**Current state:** `get_theses` returns each thesis with its raw fields (status, direction, target, stop, confidence, recentUpdates). The 5 priority blocks the prompt renders today (Priority Reviews, Fired Triggers, Matching Triggers, Live Theses, Watchlist) all compute, server-side in `buildRunInput`, the same kind of "this thesis needs attention" signal — just split across 5 different shapes the agent has to cross-reference.

**Problem:** The agent has to read all 5 prompt sections, mentally merge them, and figure out which theses need action. That's mental overhead the tool should remove.

**Fix:** Add a `needsAction` field per thesis row in `get_theses`'s response. **Important: every kind is purely trigger-driven.** No hardcoded proximity thresholds, no generic "within X% of level" math. If the agent wants warning at 5% from stop, it should add a trigger when minting the thesis (`PRICE_BELOW level: stop * 1.05`, action: REVIEW). That's exactly what the trigger system is for, and that's what makes the agent's stated "if it drops 8%, sell" actually mean 8% — not 4%.

```typescript
type NeedsAction =
  | { kind: "TRIGGER_FIRED",        triggerId: string, action: "ENTER"|"EXIT"|"REVIEW"|"ADD"|"TRIM"|"MOVE_STOP", summary: string, firedAt: Date }
  | { kind: "TRIGGER_MATCHING_NOW", triggerId: string, action: "ENTER"|"EXIT"|"REVIEW"|"ADD"|"TRIM"|"MOVE_STOP", predicateSummary: string, livePrice: number }
  | { kind: "REVIEW_DUE",           daysOverdue: number }
  | null;
```

Computation lives in the tool (or in a shared helper that buildRunInput calls too — same logic, one source of truth):

- **TRIGGER_FIRED**: a `ThesisUpdate(type=TRIGGER_FIRED)` row exists for this thesis since the prior run, with no UPDATED follow-up yet. Reuses existing trigger-firing rows. Action comes from the firing trigger.
- **TRIGGER_MATCHING_NOW**: server-side evaluation against fresh quote — a trigger predicate is currently true. Same evaluator used by the trigger-evaluator's 5-min cron (`shouldFire` from `lib/agent/triggers/evaluate.ts`). Catches matches the cron may not have delivered yet. ENTER triggers matching now signal "entry condition met for a WATCHING thesis"; EXIT triggers matching now signal "exit condition met for an ACTIVE position"; REVIEW triggers matching now signal "research warranted right now."
- **REVIEW_DUE**: `nextReviewAt < now` (horizon-keyed: CATALYST 1d, TRADE 1d, TARGET 7d, COMPOUNDER 30d). Reuses existing horizon math from `lib/agent/horizon-policy.ts`. The agent SET this cadence on the thesis — surfacing it back is showing the agent its own clock, not a generic rule.

Precedence (when multiple match): TRIGGER_FIRED > TRIGGER_MATCHING_NOW > REVIEW_DUE.

**Dropped from earlier drafts:** `NEAR_TARGET`, `NEAR_STOP`, `ENTRY_MET`. They were hardcoded-threshold heuristics — the same parallel-logic bug Fix #0 is removing, just relocated into a tool. Specifically:

- `NEAR_TARGET` (livePrice within 5% of target) and `NEAR_STOP` (livePrice within 5% of stop) impose a fixed 5% rule the agent never wrote. A 6-month TARGET hold with a -8% stop would still get flagged at -3%, forcing defensive action — same anti-pattern as today's prompt rules, just hidden inside `computeNeedsAction()`. **If the agent wants warning at 5% from stop, it should add a `PRICE_BELOW level: stop * 1.05, action: REVIEW` trigger when minting the thesis.** The trigger system already does this; using it is the point.
- `ENTRY_MET` collapses cleanly into `TRIGGER_MATCHING_NOW` filtered to `action: "ENTER"` — no need for a separate kind. The prompt's per-kind action map maps it to `place_trade` or rejection-with-reason in the same line.

**Why the trigger-only shape is right:** every priority signal that matters is either an event (a trigger fired) or a state evaluation against an agent-set predicate (matching now, review due). Hardcoded thresholds masquerading as "smart annotations" are the bug we're fixing in Fix #0; we shouldn't recreate them in Layer 2. Crucially, every kind here is **agent-driven** — the agent set the trigger, the agent set the review cadence — not a generic rule the system imposed.

**Why this is the right shape:** every priority signal Hindsight currently surfaces is per-thesis. Collapsing them into one annotation lets the agent walk the book once. The UI keeps the same `ThesisCardRenderer`; we add a small alert chip when `needsAction != null`.

**What this lets us delete from buildRunInput:** the `priorityReviews`, `triggersFiredSinceLastRun`, `triggersMatchingNow`, and `activeTheses` fields used to render the prompt's 5 priority blocks. The Live Theses table in the prompt goes away. Run-input still computes positions for the prompt's identity/rules section.

### Fix #3 — Stop `read_signals` from dumping the sector firehose

**Current state:** `lib/agent/tools/read-signals.ts:444-545`. When the routing query returns zero rows, the tool falls back to a wide query: `(watchlist tickers OR sectors OR industries OR themes)`. For Secular Theme Architect (sector = `Information Technology`), that's ~50 signals across the entire IT sector — what you saw in the screenshots.

**Problem:** Empty routing is real signal — "today's intelligence pipeline didn't find anything tagged for this analyst." The fallback turns that into noise. The agent treats the firehose as today's inbox and gets distracted onto names that aren't its job.

**Fix:** Remove the sector / industry / theme branches from the fallback. Keep only the watchlist branch — if the analyst's watchlist tickers had any signals today, return those. If not, return empty.

Specifically:

```typescript
// Today (line 461-466 of read-signals.ts):
OR: [
  ...(cfgWatchlist.length > 0 ? [{ tickers: { hasSome: cfgWatchlist } }] : []),
  ...(cfgSectors.length > 0 ? [{ sectors: { hasSome: cfgSectors } }] : []),       // delete
  ...(cfgIndustries.length > 0 ? [{ industries: { hasSome: cfgIndustries } }] : []), // delete
  ...(cfgThemes.length > 0 ? [{ themes: { hasSome: cfgThemes } }] : []),           // delete
],

// V2:
OR: [
  ...(cfgWatchlist.length > 0 ? [{ tickers: { hasSome: cfgWatchlist } }] : []),
],
// If watchlist is empty too → return empty result with discoveryNote.
```

Empty result is fine. The new prompt handles it: "0 signals today, walk the book on internal triggers."

### Fix #4 — Make autonomy explicit in the user prompt

**Current state:** `lib/inngest/functions/morning-research.ts:137`. The user prompt sent into `generateText` is:

```typescript
prompt: "Begin your research session. Follow all phases in order.",
```

That's the same text used in interactive `/runs/[id]` chat sessions where a human IS answering. The model has no way to know it's running unattended in a cron.

**Problem:** The model defaults to assistant-style behavior — listing options, asking which to pursue, ending turns with "would you like me to proceed?" That's exactly what the failed runs did today.

**Fix:** Change the user prompt for cron-triggered runs:

```typescript
prompt: `It's the start of the trading day. Run your morning playbook
unattended — there is no human to respond to questions. Every turn
must call a tool; text-only turns terminate the run as FAILED. End
with complete_run.`,
```

Tactical-run gets the same treatment in `lib/inngest/functions/tactical-run.ts`.

### Fix #5 — Lock the Daily Run's tool allowlist (mode separation)

**Current state:** `MODES["research-run"].toolAllowlist = undefined` in `lib/agent/modes.ts`. Means: Daily Run sees every tool — including `record_thesis` and `manage_watchlist`. Discovery's allowlist (correctly) includes those tools. Tactical's allowlist (correctly) excludes them. Daily is the only mode without explicit boundaries.

**Problem:** "Daily manages the existing book; Discovery mints new coverage" is a hard architectural rule we agreed on, but today nothing enforces it. The agent on Daily can mint a fresh thesis on a discovery-bucket signal, do exactly the discovery work the Discovery cron is supposed to handle on Sundays. That's why today's failed runs reached for AVGO/GOOGL/MRVL — names not in the analyst's book.

**Fix:** Set `MODES["research-run"].toolAllowlist` explicitly. Include the tools that manage the existing book; exclude the tools that mint new coverage.

```typescript
"research-run": {
  // ...
  toolAllowlist: [
    // Read
    "read_signals",
    "get_portfolio_context",
    "get_theses",
    "get_stock_data",
    "read_artifact",
    "web_search",
    "get_market_context",
    "get_earnings_data",
    "get_earnings_calendar",
    "get_market_movers",
    "get_options_flow",
    "get_sec_filings",
    // Write — manage existing book ONLY
    "update_thesis",
    "place_trade",
    "manage_position",
    "close_position",
    // Terminal
    "record_run_summary",
    "complete_run",
    // EXCLUDED:
    //   record_thesis    → minting new coverage is Discovery's job
    //   manage_watchlist → adding watchlist names is Discovery's job
  ] as const,
}
```

**What about new names that should enter coverage during the week?** Three paths, all of them mode-correct:

1. **Tactical promotion** — when an ENTER trigger fires on a WATCHING thesis (already minted by Discovery), `tactical-run` picks it up. It can `update_thesis` to flip status to ACTIVE and `place_trade` to enter. New POSITION, no new thesis.
2. **Sunday Discovery cron** — weekly mint window. Already wired.
3. **Manual Discovery fire** — `app/discovery.run.manual` event with the analyst id. Already supported. User can fire on demand if a hot name appears mid-week.

**Discovery's allowlist** (`MODES["discovery"]`) is already correct: includes `record_thesis` + `manage_watchlist` + `place_trade` (for high-conviction starter trades), excludes `update_thesis` + `manage_position` + `close_position`. Don't touch it.

**Tactical's allowlist** (`MODES["tactical"]`) is already correct: includes `update_thesis` + position management, excludes `record_thesis` + `manage_watchlist`. Don't touch it.

The mode boundary lives in three lines per mode in `modes.ts`. The prompt doesn't have to police it.

### Fix #6 — Tighten the Daily Run's bucket scope on `read_signals`

**Current state:** `read_signals` returns three buckets in one response: `portfolioSignals`, `watchlistSignals`, `discoverySignals`. The Daily Run sees all three. The Discovery Run sees all three (with `ctx.discoveryOnly` it hides the first two — already mode-aware on the discovery side).

**Problem:** The Daily Run agent is told "manage your book" but its inbox includes 15+ discovery signals on tickers it doesn't cover. That's why today's failed runs reached for AVGO/GOOGL/MRVL (none of which were in Tech Momentum's book — they were discovery candidates).

**Fix:** Add a similar mode flag for the Daily Run. When `ctx.dailyRunOnly === true`, hide `discoverySignals` from the response (same pattern as `ctx.discoveryOnly`). Set the flag from `lib/inngest/functions/morning-research.ts` when creating the tool context.

This is a 5-line change in `read-signals.ts` (mirror the existing `ctx.discoveryOnly` branch) and a one-line change in `morning-research.ts` (set `dailyRunOnly: true` in the createResearchTools context).

The Daily Run still gets portfolio + watchlist signals (the work surface). Discovery candidates only show up in Sunday's Discovery Run. Cleanly mode-separated.

---

## What does NOT change

To be totally explicit:

- **No new tools.** No `start_run`, no `start_daily_run`, no `get_thesis_detail`. The existing 13 tools are enough. `get_theses` gains one field; that's not a new tool.
- **No tool merging.** `read_signals` + `get_portfolio_context` + `get_theses` stay separate. Three tool calls, three UI cards. That's the chat experience.
- **No tool removal — the tools all stay defined and exported.** What changes is which tools each MODE allowlists. Daily Run loses access to `record_thesis` and `manage_watchlist` (they're Discovery's job). Discovery and Tactical allowlists are unchanged. Same tools exist; mode says who can call which.
- **No new mode.** The existing `research-run` mode in `lib/agent/modes.ts` stays. Its `toolAllowlist` becomes explicit (was `undefined`). See Fix #5.
- **No bootstrap-in-prompt.** Data flows through tool calls, like today. The thing I'm taking OUT of the prompt (5 priority blocks) goes INTO a tool result, not into more prompt.
- **No record_run_complete merger.** `record_run_summary` then `complete_run` — same as today.
- **All tool gates stay tool-side.** Goalpost-moving guard (update_thesis), narration→execution gate (record_run_summary), promotion gate (record_run_summary), inverted-shape gate (record_thesis + update_thesis), confidence/size/slot/live-price gates (place_trade) — all kept. They were always the right shape; they just shouldn't be duplicated as prose rules in the prompt.
- **Horizons stay.** Tool-internal: `computeNeedsAction` uses horizon for the REVIEW_DUE cadence. `record_thesis` uses horizon for default trigger templates. The agent reads horizon as a thesis field but doesn't reason about cadence math.
- **Trigger evaluator + tactical-run code paths stay.** Fix #0 changes the layers AROUND them — `price-monitor.ts` stops auto-closing, `trade-exit.ts` stops carrying its own exit logic — but the trigger evaluator's 5-min cron + signal-driven evaluation, the `evaluateTrigger` predicate engine, and the tactical-run prompt + flow are all unchanged. Per-thesis triggers WERE the right primitive all along; Fix #0 just removes the parallel layers that were silently overriding them.
- **Default trigger templates** in `lib/agent/triggers/defaults.ts` stay. They already produce the right per-horizon trigger shapes (`PRICE_BELOW level: stop` action: EXIT, etc.) — once Fix #0 lands, those templates ARE the system's exit logic.

---

## Files that change

| File | Change | Approx LOC |
|---|---|---|
| `lib/agent/tools/place-trade.ts` | **Fix #0** — default `exitStrategy: "PRICE_TARGET"` → `"MANUAL"` at line 330. New positions are trigger-controlled by default. | 1 |
| `lib/trade-exit.ts` | **Fix #0** — delete `PRICE_TARGET` and `TIME_BASED` branches. Delete the `NEAR_TARGET` / `NEAR_STOP` `PositionManagementAction` writes. Keep `TRAILING` + `MANUAL` + the `targetProximity` / `stopProximity` helpers (still useful for the email). | ~120 deleted |
| `lib/trade-exit.test.ts` | **Fix #0** — rescope to TRAILING + MANUAL only. Drop `PRICE_TARGET` + `TIME_BASED` + near-alert tests. | ~150 deleted |
| `lib/inngest/functions/price-monitor.ts` | **Fix #0** — remove the `checkExitConditions(...)` call at line 130. Keep peak/trough updates, `PRICE_CHECK` events, near-target email. | ~3 deleted |
| `lib/agent/system-prompt.ts` | **Fix #1** — rewrite `buildV2SystemPrompt` — 600 → 80 lines. Keep the function signature and inputs. Render goals + identity + universe + standup. The 5 priority block sections (priorityReviews, triggersFiredSinceLastRun, triggersMatchingNow, activeTheses, watchlist) — deleted; that data now flows through `get_theses`. | ~550 deleted, ~80 added |
| `lib/agent/tools/get-theses.ts` | **Fix #2** — add `needsAction` field per thesis row in the response. Trigger-driven kinds only (TRIGGER_FIRED / TRIGGER_MATCHING_NOW / REVIEW_DUE). Computed via shared helper `computeNeedsAction(thesis, position?, latestQuote?, recentTriggerFires)`. | ~30 added |
| `lib/agent/needs-action.ts` *(new)* | **Fix #2** — shared helper. Trigger-driven kinds only — no NEAR_* heuristics. Reuses `shouldFire` from `lib/agent/triggers/evaluate.ts` for the matching-now check. | ~80 added |
| `lib/agent/run-input.ts` | **Fix #1 + #2** — strip priorityReviews, triggersFiredSinceLastRun, triggersMatchingNow, activeTheses fields. Keep positions, watchlist, performance, intelligencePolicy, recentClosedTrades. | ~80 deleted |
| `lib/agent/tools/read-signals.ts` | **Fix #3 + #6** — delete sector/industry/theme fallback branches (~10 lines). Add `ctx.dailyRunOnly` branch that hides `discoverySignals` (~5 lines). | ~10 deleted, ~5 added |
| `lib/agent/modes.ts` | **Fix #5** — set `MODES["research-run"].toolAllowlist` explicitly. Excludes `record_thesis` + `manage_watchlist`. | ~20 |
| `lib/inngest/functions/morning-research.ts` | **Fix #4 + #6** — change user prompt string. Add `dailyRunOnly: true` to tool context. Branch on `config.useV2Prompt` to dispatch to V1 or V2 builder. | ~10 |
| `lib/inngest/functions/tactical-run.ts` | **Fix #4** — change user prompt to mention unattended autonomy. | ~2 |
| `components/agent/renderers/ThesisCardRenderer.tsx` *(or related)* | **Fix #2** — render an alert chip on thesis rows where `needsAction != null` ("Trigger fired: ENTER", "Trigger matching: PRICE_ABOVE $185", "Review 4d overdue"). One-line UI affordance. | ~15 added |
| `prisma/schema.prisma` | **Fixes #1-#6 rollout flag** — add `useV2Prompt: Boolean @default(false)` to AgentConfig. *(Fix #0 ships unflagged — see Rollout below.)* | 1 |

Total: ~13 files, ~880 net LOC delta (heavily deletion). Fix #0 alone: ~270 LOC deleted, 1 line changed.

---

## Rollout

**Two regimes — Fix #0 ships unflagged; Fixes #1–#6 ship behind a per-analyst flag.**

### Fix #0 — ships unflagged (correctness, not behavior)

Fix #0 is removing parallel logic that was never supposed to be authoritative in the first place. The trigger evaluator's 5-min cron path already handles everything Fix #0 deletes — it just wasn't winning the race. Flagging "should the agent's per-thesis triggers actually be the source of truth, yes or no?" per analyst makes no sense; either they are, or they aren't.

Behavior change to watch on the day Fix #0 lands:

- Existing OPEN positions stop being auto-closed by the hourly cron. If the trigger evaluator catches them at the same level (which it should — same `PRICE_BELOW level: stop` predicate fires from `targetDefaults` / `tradeDefaults`), behavior is unchanged from the user's perspective. If a position with empty `triggers[]` exists on an ACTIVE thesis, that's a separate bug to fix (likely a `record_thesis` gate that should have rejected the mint, or a thesis that predates the trigger work).
- New positions default to `MANUAL`. The agent's per-thesis triggers are the only path to exit (other than explicit `close_position` calls, manual UI close, or the agent later opting into `TRAILING` via `manage_position`).
- The daily-run prompt's "Priority Reviews — MUST act today" block goes empty (the `NEAR_TARGET` / `NEAR_STOP` source is gone). That's correct — but the V1 prompt still references it. Fix #1 cleans this up.

### Fixes #1–#6 — feature-flagged

```typescript
// In AgentConfig, add a column:
useV2Prompt: boolean  // default false

// In morning-research.ts, branch on the flag:
const systemPrompt = config.useV2Prompt
  ? buildV2SystemPromptV2(agentConfig, runInput)   // new 80-line builder
  : buildV2SystemPrompt(agentConfig, runInput);    // existing 600-line builder

// Keep both builders. Flip one analyst at a time. Compare runs.
```

Same pattern for the read_signals fix and the user prompt — gate behind the flag. Tactical runs follow the same flag (because they share the same context tool surface). The mode-allowlist change (Fix #5) is unflagged once Fix #1 lands — it's an architectural correctness fix and there's no good reason to leave Daily Run with `record_thesis` access in V1 either, but flagging it lets the next session decide based on V1 behavior at the time.

Ship the flag with default `false`. Flip Tech Momentum first. Watch for 5-7 trading days. If failure rate drops and decision quality holds: flip the next analyst. If anything regresses: flip back.

Once all 7 analysts are on V2 for 7 days, delete the V1 builder and the flag.

### Suggested PR shape

Either of these works — implementation session's call:

- **Single PR** titled `fix(thesis): delegate operational layers to per-thesis triggers`. ~880 net LOC, three logical commits inside (Fix #0, Fixes #1–#4 + #6, Fix #5). Cleaner reviewer narrative.
- **Two PRs** — one for Fix #0 (ships unflagged, ~270 LOC), one for Fixes #1–#6 (ships flagged, ~610 LOC). Cleaner rollback granularity if Fix #0 surfaces a hidden state-machine bug in production.

---

## Risks / things to watch

1. **Fix #0 — what happens if a position has no triggers and the price tanks?** Today, `checkExitConditions` would auto-close at the stop. After Fix #0, no auto-close. The position stays open until the next daily run touches it (or until the trigger evaluator's 5-min cron path catches a per-thesis trigger, if one exists). **This is the correct behavior** — if the agent didn't set a trigger, the agent didn't think the level was important enough to react to automatically. But: spot-check production data for ACTIVE theses with empty `triggers[]` arrays before landing Fix #0. If any exist, that's a separate bug — likely a stale row from before the trigger work, or a `record_thesis` gate that should have rejected the mint. SQL: `SELECT id, ticker, status, jsonb_array_length(triggers) FROM "Thesis" WHERE status='ACTIVE' AND jsonb_array_length(triggers) = 0;`

2. **Fix #0 — Position.exitStrategy enum has unreachable values.** Existing rows with `PRICE_TARGET` keep that string, but no code reads it. UI showing the enum value should be neutral or hidden. Cosmetic; revisit removing the column later once production has zero `PRICE_TARGET` open positions.

3. **Fix #0 — what if the trigger evaluator misses a fire that the auto-close would have caught?** The trigger evaluator's 5-min cron path uses `evaluateTrigger` from `lib/agent/triggers/evaluate.ts`, which handles `PRICE_ABOVE` / `PRICE_BELOW` deterministically against the latest Finnhub quote. Same data source as `checkExitConditions`. Predicate semantic is the same (price < stop fires the trigger; price <= stop fires the legacy exit). The only divergence is the action path: trigger fires `app/thesis.trigger.fired` → spawns tactical-run → tactical agent validates and decides. That validation IS the win — the agent gets to evaluate "is this a fake-out or a real flush?" before closing. The risk shape is "tactical-run is broken or slow"; existing tactical-run code is unchanged by this PR, so any regression here predates Fix #0.

4. **The new prompt is shorter — but is it ENOUGH for analysts with complex `analystPrompt` mandates?** The 30-line analystPrompt the user wrote stays. The system-frame around it shrinks. If the analyst's mandate references concepts the system prompt used to define (e.g. "use the closeout contract"), those references break. Audit each analyst's `analystPrompt` for system-prompt citations before flipping.

5. **The empty-fallback case.** Today the agent expects N signals; sometimes it'll see 0. The new prompt addresses this ("internal triggers" = the `needsAction` items on each thesis). But the model might still spend a turn explaining "no signals today" instead of acting. Watch the first day of any flipped analyst.

6. **`record_thesis` and `manage_watchlist` are now excluded from Daily Run's allowlist (Fix #5).** This is correct architecturally — Daily manages, Discovery mints. But it changes behavior: any analyst that previously minted occasional new theses from watchlist signals during the daily run will now produce zero new theses except via Tactical promotion (ENTER trigger fires) or Sunday Discovery. Watch the first week to confirm nothing useful is being lost — and if it is, fire `app/discovery.run.manual` as the on-demand path.

7. **The narration→execution gate (PR #228) and the promotion gate (PR #235) BOTH still fire on `record_run_summary`.** They're tool-side, so they're orthogonal to the prompt rewrite. Should keep working unchanged.

8. **The prematureExitViolation retry in `morning-research.ts` (PR #226) still wraps the run.** Should keep working — it's a defense-in-depth, not core path. With the better prompt, it should fire less often.

---

## Test plan

**Fix #0:**
- [ ] Pre-flight SQL: `SELECT id, ticker, status, jsonb_array_length(triggers) FROM "Thesis" WHERE status='ACTIVE' AND jsonb_array_length(triggers) = 0;` — confirm zero rows before landing. If non-zero, fix the underlying mints first.
- [ ] Unit test `evaluateExitStrategy` no longer returns TARGET/STOP exits for `PRICE_TARGET` strategy (only `TRAILING` returns stop signals).
- [ ] Unit test that `checkExitConditions` no longer writes `NEAR_TARGET` / `NEAR_STOP` rows.
- [ ] Integration test — a position with `exitStrategy: "MANUAL"` whose price crosses a per-thesis `PRICE_BELOW level: stop` EXIT trigger fires `app/thesis.trigger.fired` via the 5-min cron, NOT via `checkExitConditions`. Tactical-run spawns and closes via `close_position`.
- [ ] Smoke test on prod data — point the new `price-monitor.ts` at production for one market hour. Confirm no positions are auto-closed by the cron over normal price movement. Confirm peak/trough tracking + email behavior intact.

**Fix #2 (`needsAction`):**
- [ ] Unit test `computeNeedsAction` — every kind (TRIGGER_FIRED / TRIGGER_MATCHING_NOW / REVIEW_DUE / null), every precedence case, edge cases (no position, no triggers, no nextReviewAt). Confirm `NEAR_TARGET` / `NEAR_STOP` / `ENTRY_MET` are NOT in the kinds union.
- [ ] Spot-check 3-5 prod theses — confirm `get_theses` returns the right `needsAction` value vs the priority blocks the V1 prompt would render.

**Fixes #1 / #3 / #4 / #5 / #6:**
- [ ] Render the V2 prompt for each of the 7 analysts. Read each one. Confirm it makes sense without the procedural scaffolding.
- [ ] Pick the analyst with the most theses (Catalyst Event Raider, ~14). Confirm the rendered prompt is < 6K tokens.
- [ ] Dev run: generate one V2 run against Tech Momentum's prod data. Compare tool call count, decision quality, narration quality vs a recent V1 run.
- [ ] Confirm `read_signals` with empty routing + empty watchlist signals returns clean empty data (no fallback firehose).
- [ ] Confirm `read_signals` with `dailyRunOnly: true` hides `discoverySignals`.
- [ ] Confirm `MODES["research-run"].toolAllowlist` rejects calls to `record_thesis` and `manage_watchlist` from the Daily Run agent (tool-not-found error).
- [ ] Confirm the user prompt change doesn't break the interactive `/runs/[id]` chat (interactive runs use a different prompt path, but verify).

---

## What to do next

1. **Read this doc.** Push back on anything that's wrong.
2. **Sign off on the seven fixes** (Fix #0 + Fixes #1–#6).
3. **Write the code.** Land Fix #0 first, unflagged — it's the load-bearing correctness change. Then Fixes #1–#6 behind the per-analyst flag. Single PR or two PRs, implementer's call (see Rollout above).
4. **Flip Tech Momentum.** Watch for a week.
5. **Iterate per analyst.** Flip the next analyst when Tech Momentum holds for 5-7 trading days.
6. **Update `docs/GAPS.md`** when this lands — close P0-5b/c (the operational layer was the open piece) and note the V2 prompt as a follow-on.
7. **Bump `LAST_VERIFIED_AT` in `lib/agent/workflow-registry.ts`.**
