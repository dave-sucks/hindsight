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
**Status:** open, partial credit from [#360](https://github.com/dave-sucks/hindsight/pull/360). **Mentioned by principal 2026-05-26.**

The system has accumulated gates over time, some of which now refuse legitimate trades or block reasonable updates. Specific suspects to audit:

- `place_trade`'s `goalpost-moving` gate (refuses raising target on WATCHING when entry condition met).
- `place_trade`'s confidence-floor (rejects below `minConfidence` — fine, but is the threshold right?).
- `update_thesis`'s `structural_unchanged_reason` requirement (forces a reason field on patches that don't touch belief).
- `update_thesis`'s zero-trigger guard (rejects REVIEWED-only on theses with no triggers — fine for inert rows, but the PENDING exemption is the only sane path today).
- `update_thesis`'s INVALIDATED-on-PROMOTED rejection (prevents legitimate "this is dead" calls during the first-live-run; should this be allowed if `close_position` already fired in the same run? Probably yes).
- Anywhere the tool returns a Layer-1 refusal for a JUDGMENT CALL (not a STRUCTURAL violation).

Goal: keep gates that prevent STRUCTURALLY IMPOSSIBLE states (e.g., ACTIVE thesis with no position). Remove gates that second-guess the agent's judgment. Default to "let the agent decide" wherever the state would still be valid.

**Output:** a list of gates with a verdict (keep / remove / soften) and a follow-up PR per removal.

**Already removed in [#360](https://github.com/dave-sucks/hindsight/pull/360):** Gates A + B (composite-coupling on `record_thesis` + `update_thesis`) — they forced `conviction` to derive from `composite`, defeating the whole point of having a separate writer-judgment field. The remaining suspects above are unchanged. Probably folds into the trade-as-proposal refactor since the proposal layer changes which gates matter.

---

## P2 — Backlog (defer until P0+P1 clean)

Old GAPS items that may still matter but aren't blocking. Move out of `GAPS_LEGACY.md` if/when production data shows them biting:
- Quote source inconsistency between Layer-1 and Layer-2 (legacy P1-11)
- PRINCIPAL_CHAT hangs when child THESIS_WRITER fails (legacy P1-19)
- Status-derived-from-actions refactor (legacy P1-20) — clean architecture move, not blocking
- ~~Discovery archetype-blind prompt (legacy P1-9)~~ → promoted to active P1-13 by [#361](https://github.com/dave-sucks/hindsight/pull/361).
- Provenance soft-gate (legacy P1-15)

### New P2 — Disposition of paused intelligence infrastructure
After [#361](https://github.com/dave-sucks/hindsight/pull/361) the following are paused but still in the codebase / DB:
- **4 Inngest crons paused:** `firm-market-sweep`, `portfolio-watchlist-monitor`, `domain-monitor`, `signal-router`. Code lives in `lib/inngest/functions/`.
- **65 monitors disabled** (incl. 11 podcast monitors). Rows still in the `Monitor` table with `isEnabled = false`.
- **`read_signals` tool** stripped from daily-run allowlist + prompt. File still exists in `lib/agent/tools/`. Builder/editor allowlists may still reference it (verify before delete).
- **`AgentConfig.feeds`** column still populated but the routing path that consumed it (signal-router) is paused.
- **`Signal` / `SignalBatch` / `AnalystSignalRoute` tables** still exist but nothing writes to them.

**Decision needed (not urgent):** after ~2 weeks of clean operator-driven discovery, decide per-piece: fully delete (commit to the pivot) vs keep-paused-as-fallback (option to revive without re-implementing). Default to delete if no production need surfaces — paused-but-extant code rots silently and pollutes audits.

### New P2 — Sunday discovery cron disposition
`discovery-run.ts` (the Sunday 9 AM cron) still runs autonomously per-archetype. Operator-driven discovery via chat is now the primary mode; the cron is unclear value-add.

**Options:**
1. Kill — commit to operator-driven only.
2. Keep as fallback — runs when operator skips a week.
3. Repurpose — same code path, but reads from a saved-prompt source (e.g., a stored "what's worth watching this week" prompt the operator pre-writes).

P1-12 needs to land first (confirm 5/5 FAILUREs were token exhaustion not a bug) before any of these are real options.

Re-evaluate the rest after the live loop is stable for ~1 week.

---

## Done since

### 2026-06-02 — P1-10: PROMOTED is a first-class `resolved.actionability` state
PR [#375](https://github.com/dave-sucks/hindsight/pull/375). Added `PROMOTED_DECIDE_TODAY` to the actionability enum in [`lib/agent/resolved-thesis.ts`](lib/agent/resolved-thesis.ts) and branched the decision tree so a `status === "PROMOTED"` row returns the new kind regardless of price proximity, catalyst date, or trigger state (terminal status + supersession still win first). The Trade Structure Status cell in [`ThesisSheet`](components/agent/sheets/ThesisSheet.tsx) now renders "Decide today — re-enter / wait / kill" in the affirmative emerald tone — same urgency cue ProposalActions uses — instead of falling through to "Ready to buy" or "Waiting on trigger." Daily-run prompt's Step 2 PROMOTED section notes that the resolver labels these `PROMOTED_DECIDE_TODAY` independent of price/catalyst — the conviction gate was cleared at promotion. Resolver is now consistent with [`needs-action.ts`](lib/agent/needs-action.ts), which already gave PROMOTED top precedence as `PROMOTED_AWAITING_RESOLUTION` (the agent-action label; resolver is the at-a-glance label of the same state). **Open P1 list after this entry: P1-2 only.**

### 2026-06-02 — GAPS hygiene + P1-12 / P1-8 / P1-11 / P1-13 closed + conviction-backfill decision
PR [#374](https://github.com/dave-sucks/hindsight/pull/374).
- **P1-5** — MRVL Sonar earnings hallucination class fixed by [#357](https://github.com/dave-sucks/hindsight/pull/357) (writer date-awareness gate) on 2026-05-28. Was orphaned in the open P1 list — retroactively moved here. **2026-06-02 review evidence:** Sonar date-sanity sniff returned 0 rows. Gate is working in production.
- **P1-7** — UI label rename ("Awaiting live entry" → "Promoted") was already shipped via [#349](https://github.com/dave-sucks/hindsight/pull/349) on 2026-05-26 (see the "first live promotion incident fully closed" entry below). Duplicate orphan entry removed from the open P1 list.
- **P1-8** — V2 prompt has no DAY-trader workflow. **Closed: no DAY-horizon analyst exists in the current lineup and none is planned.** If a DAY analyst is ever reintroduced, refile.
- **P1-11** — Writer rationale-quality enforcement (sniff-driven). **Closed: 2026-06-02 review confirmed the prompt is holding** — the one fresh `convictionRationale` (LITE) was judgment-shape, not math restatement. Sample size is small but no failure signal. If math-rationale starts dominating later reviews, refile.
- **P1-12** — Secular Compounder 5/5 writer FAILUREs on 2026-05-31 were Anthropic credit-balance-exhaustion errors, NOT a code bug. All 5 dispatches (CRDO, TSM, LRCX, ADBE, MU) started within 36ms of each other from parent run `cmptt39lf008t04l7dv6hibei` (parallel fan-out) and failed with the same provider error: `"Your credit balance is too low to access the Anthropic API."` No other days in the past 14 days had this failure shape. **Sunday-discovery cron disposition decision (P2) is unblocked.**
- **P1-13** — BATCHED DISCOVERY archetype-blind overlay. **Closed: discovery model has been rebuilt by the principal; the 4-dim composite overlay this gap describes is no longer the active discovery design.** If a future automated-discovery v2 reintroduces a universal rubric across archetypes, refile.
- **Conviction backfill — decision NOT to backfill** (replaces what was tentatively filed as P1-14). Reviewer surfaced that 25 of 28 directional open theses had `conviction = NULL`. A backfill was applied via the historical `prisma/migrations/manual/backfill_conviction_v4.sql` script (which derives HIGH/MEDIUM/LOW from `composite` buckets) and immediately **reverted on principal pushback.** The principal call is correct: conviction is the writer's qualitative judgment, independent of composite — that decoupling is exactly what Gates A+B were killed for in PR #360. Deriving conviction from composite (even with a marker rationale) reintroduces the coupling. The right behavior: let conviction populate organically as the thesis-writer touches each thesis on refresh / re-mint. The daily-run treats NULL conviction as "no signal" and falls back to R/R math, which is intended graceful degradation. **The backfill SQL file has been marked DO NOT RUN at the top** with the decision rationale.

**Operational follow-up (not filed as a GAPS item — operational, not architectural):** a parallel writer fan-out of N dispatches will all fail simultaneously if Anthropic credit balance is below threshold at fan-out time. Solvable by Anthropic billing alerts + an optional pre-flight balance check before the dispatch fan-out. Worth doing if it bites again; otherwise just monitor billing.

### 2026-06-01 — P1-3: `targetPrice` overload was a one-line trigger bug, not a schema split
PR [#362](https://github.com/dave-sucks/hindsight/pull/362). `watchingEntryTrigger` was reading `targetPrice` (the take-profit) instead of `entryPrice` (where the writer wanted to buy in). The schema was always correct — both columns existed with separate meanings — the trigger code just wired the wrong column to the ENTER action.

**Shipped:**
- `lib/agent/triggers/defaults.ts:watchingEntryTrigger` now reads `entryPrice` instead of `targetPrice`
- Writer prompt clarifies `entry_price = where you'd buy in` (was ambiguously "current quote from the research")
- Long "CHOOSING THE ENTER TRIGGER" warning block in `run-thesis-writer.ts` simplified — most of it was workaround for the now-fixed default
- `PriceTargetsBlock` gauge consistently shows `Stop · Entry · Current · Target` across every status

**No schema changes. No migration.** See [`docs/plans/PRICE_LEVEL_SEMANTICS.md`](./plans/PRICE_LEVEL_SEMANTICS.md) for the postmortem on why the schema-split plan was over-engineering.

### 2026-06-01 — Discovery overhaul: kill noise pipeline, ship operator-driven discovery
PR [#361](https://github.com/dave-sucks/hindsight/pull/361). Audit of last 40 signal-pool entries showed ~5% signal-to-noise (Sherwood sports headlines, Seeking Alpha aggregator pieces, content-marketing-tier clickbait). The agent's triage was actually solid; the input layer was poisoned. Architectural insight: discovery isn't a separate agent, it's a conversation pattern — Principal Chat already has analyst scoping + the full toolbox; what was missing was a prompt section teaching multi-candidate triage.

**Operational changes (executed in-session):**
- Paused 4 Inngest crons: `firm-market-sweep`, `portfolio-watchlist-monitor`, `domain-monitor`, `signal-router`.
- Disabled 65 non-builtIn monitors (incl. 11 podcast monitors).
- Stripped `read_signals` from daily-run prompt + allowlist. Daily run now starts with `get_theses` + `get_portfolio_context`, walks per-thesis evidence directly.

**Code changes:**
- **BATCHED DISCOVERY prompt overlay** (~110 lines on `buildPrincipalSystemPrompt`) — activates on multi-candidate input / research pastes / discovery-shaped questions. Teaches Sunday-cron triage shape + paste-extraction + operator-context-as-composite-input + clarification turn.
- **`twitter_search` tool** — xAI Live Search over X with `sources:["x"]`. Returns handle + ticker + archetype + claim + sentiment + recency. Sibling to `web_search`. Requires `XAI_API_KEY`.
- **Cross-analyst dispatch dedup** in `dispatch_thesis_research` — closes the AVGO + CRDO double-dispatch waste from the 2026-06-01 cron runs.
- **`RunDiscoveryButton`** on `/analysts/[id]` → routes to `/chat?analyst=…&kickoff=…` (server-validated). Chat now accepts kickoff URL params, threads to AgentChat's `initialPrompt`.

**Dual-role catalyst-source insight (durable architecture):** one wire feeds both discovery (new names route as signals) and triggers (held names fire REVIEW/EXIT). Don't build two pipelines for 8-K filings — build the producer once, route twice. Documented in `DISCOVERY_V2.md` §3.

**Decisions worth flagging:**
- Slash command vs mode picker for explicit "discovery mode" trigger — shipped content-detection only; add `/discovery` slash command or mode picker as follow-up if real usage reveals detection failures. Current implementation activates batched-discovery mode automatically from message content; the button is convenience, not gate.
- Grok-as-orchestrator deferred. Shipped Grok-as-tool (`twitter_search` inside Claude) first. Grok-4 as a selectable orchestrator model is Lane 4 backlog, contingent on the Claude+`twitter_search` baseline shaking out cleanly.

**Three follow-ups surfaced:** P1-12 (Secular Compounder writer FAILUREs investigation), P1-13 (BATCHED DISCOVERY overlay archetype-blind — promoted from legacy P1-9), plus two P2 disposition decisions (paused intelligence infra + Sunday discovery cron).

**Watch tomorrow's 8 AM ET cron** — first daily run without `read_signals`. If the agent loses bearings, it'll surface fast in `/runs/`.

Design docs: [`DISCOVERY_V2.md`](./plans/DISCOVERY_V2.md) (operating model + 16-source catalog), [`DISCOVERY_OVERHAUL.md`](./plans/DISCOVERY_OVERHAUL.md) (phased to-do list with status).

### 2026-05-31 — Conviction Expression (writer judgment + read-time resolver)
- **P1-6** — Writer "urgency signal" delivered, shape differs from original spec. Instead of a `recommendedAction` enum, the writer now stamps three fields on every thesis: `conviction` (STRONG / HIGH / MEDIUM / LOW — the writer's real view, independent of composite), `convictionRationale` (≤400-char plain-talk judgment), and `variantView` (required for STRONG/HIGH — "consensus thinks X, I think Y"). `targetSizePct` promoted to required for directional theses. The daily-run prompt teaches actionability-first filtering (via the resolver, see below) then conviction-modulated sizing — STRONG → trade fast at full size; LOW → skip-by-default. Conviction is also patchable (upgrade when a catalyst prints clean, downgrade when consensus moves to your view). Shipped via [#360](https://github.com/dave-sucks/hindsight/pull/360).
- **Read-time resolver** (new primitive, not a previously-tracked GAP). `get_theses` now returns a computed `resolved` envelope per row: live `currentPrice`, evaluated `triggerState`, `actionability` verdict (`READY_TO_BUY` / `WAITING_FOR_TRIGGER` / `CATALYST_PENDING` / `HOLDING` / `SUPERSEDED` / …), and `supersededBy` (newer thesis on the same ticker that killed this one). Computed at read time, never stored. The agent reads a resolved verdict instead of re-deriving live price + trigger state + supersession every cycle. Cross-analyst supersession bug also fixed (Catalyst PM's LONG no longer killed by Compounder's PASS).
- **Gate-removal partial credit toward P1-2.** Gates A + B (composite-coupling on `record_thesis` + `update_thesis`) deleted — they forced `conviction` to derive from `composite`, defeating the field's purpose. Other suspect gates listed under P1-2 unchanged.
- **UI:** `ConvictionBadge` on the sheet header next to status; `VARIANT VIEW` as a peer section alongside Key Assumptions and Invalidation Conditions; actionability shown in the Trade Structure row's Status cell (rejected the standalone third-badge approach as noisy); stock identity made clickable to `/stocks/[ticker]`.
- **Tests:** 16 new (12 record_thesis gates, 8 update_thesis gates, 13 resolver), 303 total passing.
- **Backfill:** `prisma/migrations/manual/backfill_conviction_v4.sql` derives HIGH/MEDIUM/LOW from composite buckets for ~38 live LONG/SHORT WATCHING+ACTIVE rows missing conviction; stamps `convictionRationale = 'backfilled from composite on 2026-05-31'` so the UI can tell derived from writer-attested.
- **Two follow-ups surfaced:** P1-10 (PROMOTED not first-class in resolver actionability) and P1-11 (writer rationale-quality enforcement — sniff-watch first).

Design doc: [`CONVICTION_EXPRESSION.md`](./plans/CONVICTION_EXPRESSION.md) (updated to v4).

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
