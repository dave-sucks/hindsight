# MORNING_PLAN_V2 — Design Doc (FINAL)

**Status:** Draft, awaiting review. **Not implemented.**
**Last revised:** 2026-05-08 — earlier drafts proposed inventing new tools and bootstrapping data in the prompt. Both were wrong. This version keeps every existing tool, keeps the agent fetching its data via tool calls (visible in the UI), and rewrites only what's actually broken — the prompt's bloat, one tool's bad fallback, the user prompt's chat-style framing, and the missing mode allowlist on the Daily Run.

---

## TL;DR

**Tools are not the problem.** `read_signals`, `get_portfolio_context`, `get_theses`, `get_stock_data`, `read_artifact`, `update_thesis`, `place_trade`, `manage_position`, `close_position`, `manage_watchlist`, `record_thesis`, `record_run_summary`, `complete_run` — all stay exactly as they are. Tool descriptions, schemas, gates, UI rendering — unchanged.

**Six things ARE broken:**

1. The system prompt is 600 lines of procedural stages, hard-reject gates, priority blocks, and prohibition lists. The model gets lost in it.
2. The 5 priority blocks the prompt renders (Priority Reviews, Fired Triggers, Matching Triggers, Live Theses, Watchlist) are different views of the same question — "what theses need my attention?" — and the agent has to cross-reference them. They should be one field on each thesis row, computed by the tool.
3. `read_signals`'s fallback path turns "router routed nothing today" into "here are 50 signals matching your sector" — a firehose.
4. The user prompt the morning cron sends is `"Begin your research session. Follow all phases in order."` — generic, conversational. The model treats the run like a chat.
5. The Daily Run sees discovery bucket signals, blurring the line between "manage your book" and "find new coverage."
6. **`MODES["research-run"].toolAllowlist` is `undefined` — Daily Run sees every tool, including `record_thesis` and `manage_watchlist`. Mode separation isn't enforced.** Daily Run is supposed to manage the existing book, not mint new coverage. Discovery's job is to mint. The boundary lives in the tool allowlist, not in prose rules in the prompt.

The fix is small and surgical. Rewrite the prompt. Improve one tool's response shape. Fix one tool's fallback. Change the user prompt. Tighten one tool's mode behavior. Lock the Daily Run's tool allowlist. Done.

---

## What stays the same (so this is unambiguous)

- **Every tool listed above.** Same names, same schemas, same descriptions, same gates, same UI cards.
- **Tool execution order.** Agent can call tools in whatever order makes sense for its work.
- **Tool result rendering.** Same `ToolCallRow` dispatch on `result.ui` discriminator. Same renderers (ToolUIRenderer, ThesisCardRenderer, RunSummaryRenderer, etc.).
- **Run lifecycle.** ResearchRun row, RunEvent stream, RunMessage persistence — unchanged.
- **Briefing agent.** Inline after every run. Unchanged.
- **Trigger evaluator + tactical run.** Untouched.
- **Discovery cron + prompt + tools.** Untouched.
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
| Per-`needsAction`-kind action map (ENTRY_MET → place_trade or rejection, etc.) | 3 | Kept. ~5 bullets. |
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

## The six fixes

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
   ENTRY_MET, NEAR_STOP, NEAR_TARGET, REVIEW_DUE, TRIGGER_FIRED, or
   null.

2. Act on every thesis where needsAction is non-null:
   - ENTRY_MET → place_trade if conviction holds, OR update_thesis
     with a concrete rejection reason (volume too thin, regime shift,
     fresh negative news, R/R no longer 2:1). "Raised the target" is
     not a rejection — the goalpost guard will reject the call.
   - NEAR_TARGET → close_position to take profit, or update_thesis
     with a revised target backed by today's data.
   - NEAR_STOP → manage_position (tighten/trim) or close_position.
   - REVIEW_DUE → update_thesis with what you found. Empty patch +
     rationale is fine if nothing material changed.
   - TRIGGER_FIRED → act per the trigger's intent (typically
     place_trade, manage_position, or close_position).

3. Theses with needsAction == null don't need to be touched. The
   trigger system and review-cadence calculator already evaluated them.

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

**Fix:** Add a `needsAction` field per thesis row in `get_theses`'s response:

```typescript
type NeedsAction =
  | { kind: "ENTRY_MET",     livePrice: number, target: number }
  | { kind: "NEAR_TARGET",   livePrice: number, distancePct: number }
  | { kind: "NEAR_STOP",     livePrice: number, distancePct: number }
  | { kind: "REVIEW_DUE",    daysOverdue: number }
  | { kind: "TRIGGER_FIRED", triggerId: string, action: "ENTER"|"EXIT"|..., summary: string, firedAt: Date }
  | null;
```

Computation lives in the tool (or in a shared helper that buildRunInput calls too — same logic, one source of truth):

- **ENTRY_MET**: thesis is WATCHING + LONG/SHORT + livePrice has crossed target (LONG) / stop (SHORT) — the existing entry-trigger predicate.
- **NEAR_TARGET**: thesis is ACTIVE with a position + livePrice within 5% of target.
- **NEAR_STOP**: thesis is ACTIVE with a position + livePrice within 5% of stop.
- **REVIEW_DUE**: nextReviewAt < now (horizon-keyed: CATALYST 1d, TRADE 1d, TARGET 7d, COMPOUNDER 30d). Reuses existing horizon math.
- **TRIGGER_FIRED**: a `ThesisUpdate(type=TRIGGER_FIRED)` row exists for this thesis since the prior run, with no UPDATED follow-up yet.

Precedence (when multiple match): TRIGGER_FIRED > ENTRY_MET > NEAR_STOP > NEAR_TARGET > REVIEW_DUE.

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

---

## Files that change

| File | Change | Approx LOC |
|---|---|---|
| `lib/agent/system-prompt.ts` | Rewrite the `buildV2SystemPrompt` function — 600 → 80 lines. Keep the function signature, keep all the inputs. Render goals + identity + universe + standup. The 5 priority block sections (priorityReviews, triggersFiredSinceLastRun, triggersMatchingNow, activeTheses, watchlist) — deleted; that data now flows through `get_theses`. | ~550 deleted, ~80 added |
| `lib/agent/tools/get-theses.ts` | Add `needsAction` field per thesis row in the response. Computed via shared helper `computeNeedsAction(thesis, position?, livePrice, recentTriggerFires)`. New file `lib/agent/needs-action.ts` for the helper (used by get_theses today; by buildRunInput later if needed elsewhere). | ~30 added in get-theses, ~80 added in needs-action.ts |
| `lib/agent/run-input.ts` | Strip the priority-block-related fields from RunInput (priorityReviews, triggersFiredSinceLastRun, triggersMatchingNow, activeTheses). Keep positions, watchlist, performance, intelligencePolicy, recentClosedTrades. | ~80 deleted |
| `lib/agent/tools/read-signals.ts` | Delete sector/industry/theme branches from the fallback path (~10 lines). Add `ctx.dailyRunOnly` branch that hides `discoverySignals` (~5 lines). | ~10 deleted, ~5 added |
| `lib/agent/modes.ts` | Set `MODES["research-run"].toolAllowlist` explicitly (Fix #5). Excludes `record_thesis` + `manage_watchlist`. | ~20 lines |
| `lib/inngest/functions/morning-research.ts` | Change the user prompt string. Add `dailyRunOnly: true` to tool context. Branch on `config.useV2Prompt` to dispatch to V1 or V2 builder. | ~10 lines |
| `lib/inngest/functions/tactical-run.ts` | Change the user prompt to mention unattended autonomy. | ~2 lines |
| `components/agent/renderers/ThesisCardRenderer.tsx` (and/or related) | Render an alert chip on thesis rows where `needsAction != null` ("Entry met @ $415", "Near stop -3%", "Review 4d overdue", etc.). One-line UI affordance. | ~15 added |
| `prisma/schema.prisma` | Add `useV2Prompt: Boolean @default(false)` to AgentConfig. | 1 line |

Total: ~6-7 files, ~750 net LOC delta (heavily deletion).

---

## Rollout — feature-flagged so you can A/B

```typescript
// In AgentConfig, add a column:
useV2Prompt: boolean  // default false

// In morning-research.ts, branch on the flag:
const systemPrompt = config.useV2Prompt
  ? buildV2SystemPromptV2(agentConfig, runInput)   // new 80-line builder
  : buildV2SystemPrompt(agentConfig, runInput);    // existing 600-line builder

// Keep both builders. Flip one analyst at a time. Compare runs.
```

Same pattern for the read_signals fix and the user prompt — gate behind the flag. Tactical runs follow the same flag (because they share the same context tool surface).

Ship the flag with default `false`. Flip Tech Momentum first. Watch for 5-7 trading days. If failure rate drops and decision quality holds: flip the next analyst. If anything regresses: flip back.

Once all 7 analysts are on V2 for 7 days, delete the V1 builder and the flag.

---

## Risks / things to watch

1. **The new prompt is shorter — but is it ENOUGH for analysts with complex `analystPrompt` mandates?** The 30-line analystPrompt the user wrote stays. The system-frame around it shrinks. If the analyst's mandate references concepts the system prompt used to define (e.g. "use the closeout contract"), those references break. Audit each analyst's `analystPrompt` for system-prompt citations before flipping.

2. **The empty-fallback case.** Today the agent expects N signals; sometimes it'll see 0. The new prompt addresses this ("internal triggers" = the priority items computed by buildRunInput). But the model might still spend a turn explaining "no signals today" instead of acting. Watch the first day of any flipped analyst.

3. **`record_thesis` and `manage_watchlist` are now excluded from Daily Run's allowlist (Fix #5).** This is correct architecturally — Daily manages, Discovery mints. But it changes behavior: any analyst that previously minted occasional new theses from watchlist signals during the daily run will now produce zero new theses except via Tactical promotion (ENTER trigger fires) or Sunday Discovery. Watch the first week to confirm nothing useful is being lost — and if it is, fire `app/discovery.run.manual` as the on-demand path.

4. **The narration→execution gate (PR #228) and the promotion gate (PR #235) BOTH still fire on `record_run_summary`.** They're tool-side, so they're orthogonal to the prompt rewrite. Should keep working unchanged.

5. **The prematureExitViolation retry in `morning-research.ts` (PR #226) still wraps the run.** Should keep working — it's a defense-in-depth, not core path. With the better prompt, it should fire less often.

---

## Test plan

- [ ] Unit test `computeNeedsAction` — every kind, every precedence case, edge cases (no position, no target, no nextReviewAt).
- [ ] Render the V2 prompt for each of the 7 analysts. Read each one. Confirm it makes sense without the procedural scaffolding.
- [ ] Pick the analyst with the most theses (Catalyst Event Raider, ~14). Confirm the rendered prompt is < 6K tokens.
- [ ] Confirm `get_theses` returns `needsAction` correctly for prod data — spot-check 3-5 theses where today's prompt has them in priority blocks.
- [ ] Dev run: generate one V2 run against Tech Momentum's prod data. Compare tool call count, decision quality, narration quality vs a recent V1 run.
- [ ] Confirm `read_signals` with empty routing + empty watchlist signals returns clean empty data (no fallback firehose).
- [ ] Confirm `read_signals` with `dailyRunOnly: true` hides `discoverySignals`.
- [ ] Confirm the user prompt change doesn't break the interactive `/runs/[id]` chat (interactive runs use a different prompt path, but verify).

---

## What to do next

1. **Read this doc.** Push back on anything that's wrong.
2. **Sign off on the six fixes.** All six, or a subset.
3. **I write the code.** Probably one PR per fix (six small PRs) so each can be reviewed and reverted independently. Or one batched PR — your call.
4. **Flip Tech Momentum.** Watch for a week.
5. **Iterate per analyst.** Flip the next analyst when Tech Momentum holds for 5-7 trading days.
