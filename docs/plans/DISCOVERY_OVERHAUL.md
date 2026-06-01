# Discovery Overhaul — implementation plan

> **What this is.** The prioritized to-do list for the discovery overhaul. For the operating model + signal-source catalog this executes against, see [`DISCOVERY_V2.md`](./DISCOVERY_V2.md).
>
> **Updated:** 2026-05-31.
>
> **Status convention:** NOW = execute this week. SOON = next PR cycle. MEDIUM = workstream. LATER = backlog.

---

## Shipped 2026-05-31 (NOW + SOON lanes, single working-tree commit)

All of NOW + SOON lanes were executed in one working-tree pass on 2026-05-31. Working tree state:

**Modified (9 files):**
- `lib/agent/system-prompt.ts` — daily-run Step 1 no longer reads `read_signals` (NOW-3)
- `lib/agent/modes.ts` — three changes:
  - daily-run (`research-run`) allowlist: removed `read_signals` (NOW-3)
  - principal allowlist + discovery allowlist: added `twitter_search` (SOON-1b)
  - principal prompt: appended `## BATCHED DISCOVERY` section (SOON-1a) + `twitter_search` routing guidance in the tool catalog
- `lib/agent/tools/dispatch-thesis-research.ts` — pre-dispatch in-flight writer check (SOON-1c)
- `lib/agent/tools/index.ts` — register `twitter_search` (SOON-1b)
- `app/(root)/chat/page.tsx` — accept `?analyst=<id>&kickoff=<msg>` query params, server-validate, thread through (SOON-2)
- `app/(root)/chat/ChatPageClient.tsx` — pass kickoff to AgentChat's `initialPrompt` on fresh chats (SOON-2)
- `components/analysts/AnalystDetailClient.tsx` — render `RunDiscoveryButton` (SOON-2)
- `docs/README.md` — index entries for `DISCOVERY_V2.md` + this doc
- `docs/plans/DISCOVERY_V2.md` — added Part 1 (operating model) + §3 (dual-role producer pattern), renumbered legacy sections

**New (4 files):**
- `lib/intelligence/xai-live-search.ts` — xAI Live Search client with `sources:["x"]` (SOON-1b)
- `lib/agent/tools/twitter-search.ts` — Grok-attributed posts agent tool (SOON-1b)
- `components/RunDiscoveryButton.tsx` — entry-point button that routes to `/chat?analyst=…&kickoff=…` (SOON-2)
- `docs/plans/DISCOVERY_OVERHAUL.md` — this doc

**Operational (no code):**
- NOW-1: paused `firm-market-sweep`, `portfolio-watchlist-monitor`, `domain-monitor`, `signal-router` Inngest crons.
- NOW-2: `UPDATE "Monitor" SET enabled=false WHERE "builtIn"=false` — 65 monitors disabled (initial pass excluded PODCAST_SEGMENT scope, follow-up flipped those too). Final state: 0 non-builtIn enabled, 6 builtIn left running, 84 disabled total.

**Verified:** `npx tsc --noEmit` is clean for all 9 changed + 4 new files (pre-existing implicit-any errors in `app/(root)/analysts/[id]/page.tsx` and `…/edit/page.tsx` are unrelated and predate this work).

**Env requirements:**
- `XAI_API_KEY` — required for `twitter_search`. If unset, the tool returns a clean structured failure and the agent can fall back to `web_search`.

**Smoke test path before merging:**
1. Open `/analysts/<momentum-analyst-id>`, click "Run discovery" → should land at `/chat?analyst=…&kickoff=…` with the analyst pre-scoped and the kickoff auto-sending.
2. Watch the agent execute the batched-discovery flow per the new prompt section: triage narration → per-survivor `get_theses` + `get_stock_data` (parallel) → 4-dim composite → cap-5 dispatches + PASS rows for the rest + skip-narration for junk.
3. Sanity-check `record_run_summary` shape: dispatched / PASS-recorded / skipped buckets.
4. Re-run discovery on a second analyst with overlapping universe — confirm SOON-1c rejects the duplicate ticker if a writer is still RUNNING on it.
5. Spot-check `twitter_search` end-to-end with a sharp probe: "What is @traderstewie saying about $NVDA this week?" → expect handle-attributed posts with archetype tags.

**Still pending:** Lane 3 (MEDIUM workstream — EDGAR + Benzinga + Quiver structured) and Lane 4 backlog. SOON-3 (per-thesis evidence diff) remains owned by the parallel daily-run-side session.

---

## TL;DR

Three lanes of work, ordered by sequencing.

1. **Kill the noise** (NOW) — pause the 4 inbound crons + disable non-builtIn monitors + strip `read_signals` from the daily run. Stops the input poisoning. **15 minutes plus one small PR.**
2. **Teach the agent the batched-discovery shape** (SOON) — append a discovery operating-mode overlay to the Principal Chat prompt + add entry-point buttons on `/analysts/[id]` and `/stocks/[ticker]`. **One PR, ~3 days.**
3. **Build dual-role catalyst producers** (MEDIUM) — EDGAR 8-K + Form 4 first (free, highest α). Each producer feeds discovery routing AND fires triggers on held theses from the same wire. **One PR per source, ~1 week each.**

Lane 2's "Daily-run-side" companion (per-thesis evidence diff in `get_theses`) is owned by the other session and runs parallel; it has no discovery-side dependencies.

---

## Lane 1 — Kill the noise (NOW)

### NOW-1: Pause the 4 inbound Inngest crons
- **Action:** Inngest dashboard → pause:
  - `firm-market-sweep` (6:30 AM ET)
  - `portfolio-watchlist-monitor` (7:00 AM ET)
  - `domain-monitor` (7:15 AM ET)
  - `signal-router` (7:30 AM ET)
- **Effort:** 5 minutes
- **Reversibility:** un-pause in dashboard
- **Side effects:** Sonar API spend → $0; agents that consume signals see empty `read_signals` pools (handled gracefully — the tool already returns `{signals:[]}` on empty)
- **Dependencies:** none

### NOW-2: Disable non-builtIn monitors
- **Action:** SQL — `UPDATE "Monitor" SET enabled = false WHERE "isBuiltIn" = false`
- **Effort:** 5 minutes
- **Reversibility:** flip back to `true`
- **Side effects:** Monitor rows stay (forensics); producers stop polling
- **Dependencies:** ideally after NOW-1; if NOW-1 isn't done, the still-running crons would skip these monitors but still execute

### NOW-3: Remove read_signals from the daily run
- **Files:**
  - `lib/agent/system-prompt.ts` (`buildDailyRunSystemPromptV2`) — strip the `read_signals` block from Stage 1
  - `lib/agent/modes.ts` — remove `read_signals` from the daily-run (`research-run`) tool allowlist
- **New Stage 1 shape:** `get_theses(include_history:true)` + `get_portfolio_context`, then per-thesis evidence via `get_stock_data` / `get_sec_filings` / `get_earnings_data` in the review loop.
- **Effort:** small PR, 1-2 days incl. tests
- **Reversibility:** revert the PR
- **Dependencies:** functionally independent of NOW-1/2 but ideally lands after them so the daily run isn't transitioning while the input pipeline is still producing

---

## Lane 2 — Teach the agent the batched-discovery shape (SOON)

### SOON-1: Principal Chat — batched-discovery operating-mode overlay + `twitter_search` tool + dispatch-dedup
- **Goal:** when the input to Principal Chat is a multi-candidate pool (paste of multiple tickers, "today's movers," "find similar to $X"), the agent enters triage shape — NOT single-ticker deep-research dispatch shape. Add Grok's X coverage as a tool call inside Claude (keeping Claude as the orchestrator). Close the cross-analyst in-flight dispatch dup waste seen on AVGO + CRDO 2026-05-31.

#### 1a. Prompt overlay (`lib/agent/modes.ts` → `buildPrincipalSystemPrompt`)
Append a new section (~100 lines) titled "BATCHED DISCOVERY — when the input is multiple candidates":
- **Detection:** input contains >1 candidate ticker; or message includes a paste-shape research artifact; or message begins with "discovery"; or kickoff was composed by a discovery entry-point button (presence of a synthetic prefix marker in the kickoff is fine).
- **Reuse the existing Sunday-cron triage shape verbatim.** Per-candidate `get_stock_data` + cross-analyst overlap check via `get_theses({tickers})` + 4-dim composite (trendStrength 0-3 + relativeStrength 0-3 + entryQuality 0-2 + catalystFreshness 0-2). The Sunday-cron prompt's triage rubric is the keeper; the batched section just adds conversation-specific behavior.
- **Dispatch gate:** composite ≥ 4 → `dispatch_thesis_research`; composite < 4 → `record_thesis(direction:'PASS', reasoning_summary, invalidation_conditions:[…])`; DISPATCH_CAP = 5 per session.
- **Empty-handed outcome is legal.** "None of these clear the bar" → `record_run_summary(primary_decision:'HOLD', …)` + `complete_run`. Don't fabricate a dispatch to fill the cap.
- **Paste handling:** when the user message includes a research paste (Grok output, Reddit thread, Stratechery excerpt, fintwit thread), extract candidates (ticker + attribution + claim) first, then triage from there.
- **NEW: Operator context as composite input.** When the operator's message includes attribution / claim / urgency on a candidate ("3 momentum handles converging on $NBIS"), `catalystFreshness` gets +1 and the dispatch `reason` arg cites the operator's framing verbatim. The conversation IS data for the score.
- **NEW: Clarification turn allowed.** One question max per session: if a candidate sits on the composite boundary (4-5) and the operator's framing implies more conviction than the technicals do, the agent ASKS before dispatching. In cron mode this never fires (no operator); in chat mode it's the value-add.
- **Keep:** the existing single-ticker `dispatch_thesis_research` defaults (`/research $X` hard trigger, natural-language "thesis on $X" → dispatch). The batched section is additive.

#### 1b. New tool: `twitter_search` (`lib/agent/tools/twitter-search.ts`)
Grok integration shape decision: **paste-in (Option 1) + Grok-as-a-tool inside Claude (Option 3) for v1.** Defer Grok-as-orchestrator (Option 2) until v1 proves out.
- Wraps xAI Live Search API with `sources:["x"]`.
- Same `ToolResult` envelope shape as `web_search`; renders the same way in `ToolCallRow`.
- Agent picks between `web_search` (Sonar, general web) and `twitter_search` (xAI, X / fintwit / handle attribution) based on intent. Prompt teaches: "use `twitter_search` for handle attribution, social attention shifts, multi-archetype convergence; use `web_search` for general news, sell-side reports, neutral coverage."
- Registered in `lib/agent/tools/index.ts`; added to the `principal` allowlist in `modes.ts`. Discovery-mode allowlist gets it too (Sunday cron can use it once a sufficient kickoff prompt is found — separate work).
- Defer adding Grok-4 as a selectable model in `modes.ts` until v1 ships. The xAI provider plumbing this PR introduces makes that follow-up trivial.

#### 1c. Bug fix: cross-analyst in-flight dispatch dedup (`lib/agent/tools/dispatch-thesis-research.ts`)
Today's 2026-05-31 discovery runs spawned 2 writers on AVGO (Catalyst Event PM + Momentum Breakout) and 2 on CRDO (Momentum Breakout + Secular Compounder). Different analysts CAN have their own theses on the same ticker (cardinality allows it), but spawning two parallel deep-research writers when one could be reused is waste.
- Pre-dispatch check: does a `ResearchRun(mode='THESIS_WRITER', status='RUNNING')` exist for `(ticker, accountId)` in the past N minutes?
- If yes, reject with structured error: "In-flight writer for $TICKER (run cmp...) by analyst Y. Wait for completion; thesis-writer output is reusable across your analysts."
- The second analyst's daily run consumes the first writer's output. No new writer fan-out.

- **Effort:** 2-3 days incl. eval on 4-5 representative kickoff messages (paste-of-Grok, paste-of-Reddit-thread, "movers today," "find similar to $DELL," empty-handed run)
- **Dependencies:** none functional; NOW-3 desirable so the input layer is clean

### SOON-2: Discovery entry-point buttons
- **`/analysts/[id]` "Run Discovery" button** → POST to `/api/chat` with body: `{analystId, kickoffMessage}` → redirects to the resulting `/chat/[runId]`. Kickoff is archetype-aware:
  - Momentum: *"Run a discovery pass for this momentum analyst. Start with `get_market_movers` scope=universe + `get_earnings_calendar` scope=universe. Triage anything net-new, score on composite, dispatch up to 5 survivors + PASS-record the rest."*
  - Catalyst Event: *"Start with `get_earnings_calendar` scope=universe + recent `get_sec_filings` on universe names. Triage…"*
  - Secular Compounder: *"Pull `read_signals` (any catalyst-class signals routed in the past 7d) + thematic web_search for new entrants in [analyst themes]. Triage…"*
  - PEAD Specialist: *"Pull `get_earnings_calendar` scope=universe filtered to the last 5 trading days. Triage post-print drift candidates…"*
- **`/stocks/[ticker]` "Find similar" button** → kickoff: *"Find names similar to $X by peers / theme / catalyst class. Use `get_stock_data` for peers, `web_search` for narrative neighbors. Cross-check against [analyst]'s universe — triage, dispatch the survivors, PASS the rest."*
- **(Later)** a research paste-box on the chat surface itself (`/chat` with prefilled paste) → kickoff: *"I'm pasting research from [Grok / Reddit / fintwit / Stratechery]. Extract candidates, triage, dispatch the survivors."*
- **Effort:** 1 day
- **Dependencies:** SOON-1 (otherwise buttons hit a prompt that doesn't know discovery shape)

### SOON-3: Per-thesis evidence diff in `get_theses` (parallel — other session's lane)
- **Goal:** Daily run reads pre-digested "since last review" structured diff per thesis (filings, earnings, PT changes, news), not raw signal pool.
- **File:** `lib/agent/tools/get-theses.ts` — add `evidenceSinceLastReview` per thesis
- **Compute:** server-side SQL/Prisma diff between `Thesis.lastReviewedAt` (or `lastUpdatedAt`) and `now`, joining against (Signal rows tagged with ticker) + (filing events from EDGAR producer once MEDIUM-1 ships) + (PT changes from FMP) + (earnings prints).
- **Effort:** 1-2 weeks, deserves its own plan doc
- **Owner:** other session (already in their phase plan)
- **Dependencies:** independent of SOON-1/2 (different consumer); BENEFITS from MEDIUM-1 (more structured event sources to diff against)

---

## Lane 3 — Dual-role catalyst producers (MEDIUM)

> **The architectural rule** (see `DISCOVERY_V2.md` §3): every producer is dual-role. Same data wire feeds discovery (Signal rows routed to in-universe analysts) AND fires triggers (REVIEW/EXIT on held theses).

### MEDIUM-1: EDGAR 8-K + Form 4 producer
- **Goal:** EDGAR atom feed → one Inngest function → dual output.
- **Producer file:** `lib/inngest/functions/sources/edgar-monitor.ts`
- **Polls:** EDGAR atom feed `getcurrent?type=8-K&output=atom` and `type=4&output=atom` every N minutes (15-min start, tunable)
- **Event taxonomy:**
  - 8-K Item 2.02 (earnings) → `EARNINGS_REPORTED`
  - 8-K Item 4.02 (restatement) → `INVALIDATION_RISK`
  - 8-K Item 5.02 (officer departure) → `INVALIDATION_RISK`
  - Form 4 → cluster detector (3+ insiders / 30d, ≥ $500k aggregate) → `INSIDER_BUY_CLUSTER`
- **Dual-role routing logic:**
  ```
  for each event:
    if ticker ∈ Thesis WHERE status IN ('ACTIVE','WATCHING'):
      → fire app/thesis.trigger.fired with the relevant trigger type
    elif ticker ∈ any analyst's universe (sector/industry/theme/feeds match):
      → write Signal row routed via signal-router pattern
    else: drop
  ```
- **Trigger evaluator additions:** new trigger types in `lib/agent/triggers/types.ts` + predicate evaluators in `lib/agent/triggers/evaluate.ts`
- **Effort:** 1 PR, ~1 week
- **Cost:** $0 (EDGAR atom is free)

### MEDIUM-2: Benzinga real-time wire
- **Goal:** WebSocket subscription to Benzinga's free real-time news feed → dual output.
- **Producer file:** `lib/inngest/functions/sources/benzinga-wire.ts`
- **Pre-grader:** fast cheap model (Haiku or Groq-hosted equivalent) scores each headline for (relevance to held coverage, catalyst type, urgency) — gates the routing decision so we don't fire a `MATERIAL_NEWS` REVIEW on every passing headline.
- **New trigger type:** `MATERIAL_NEWS` (scored — only fires when pre-grader score crosses threshold)
- **Effort:** 1 PR, ~1 week
- **Cost:** $0 (Benzinga Basic News API free tier covers real-time WebSocket)

### MEDIUM-3: Quiver structured congressional (replace today's news-rewrap)
- **Goal:** Replace today's news-rewrap of Trump/Pelosi trades with the structured Quiver API.
- **Producer file:** `lib/inngest/functions/sources/quiver-congress.ts`
- **Allowlist:** top-10 ranked members (Pelosi family, Tuberville, Crenshaw, etc.); purchases ≥ $500k notional only.
- **New trigger type:** `POLITICAL_DISCLOSURE` REVIEW
- **Effort:** small PR, ~3 days
- **Cost:** $30/mo Quiver Hobbyist tier

---

## Lane 4 — Later (backlog, in rough priority order)

- **Schedule 13D activist allowlist** — credible-activist filter on EDGAR feed; rare but highest single-event α per the catalog. Same producer as MEDIUM-1 with an activist-allowlist filter.
- **Unusual options activity** (Unusual Whales API) — gated by paid API; defer until other free sources prove the producer pattern.
- **Vision-model screenshot ingestion as a tool** — user pastes a Reddit/X/Substack screenshot in chat; a `parse_research_screenshot` tool calls Claude Opus vision to extract `(ticker, claim, attribution)`; output flows into the same batched-discovery triage. The chat UI may need image-paste support first.
- **Saved-prompt cadence layer** — `SavedDiscoveryPrompt` table + cron firing saved discovery prompts as kickoff messages on the existing Principal Chat agent. **Defer until at least one operator-driven kickoff prompt has proven itself in chat.** Don't pre-author the library.
- **Grok-4 as a selectable model in the principal-chat model picker** — Grok-as-orchestrator (Option 2 from the SOON-1 decision; v1 ships Claude-with-`twitter_search` instead). Adds `model: "grok-4"` to the principal mode in `modes.ts`. Quality risk: Grok's tool-call discipline against our strict Zod gates on `record_thesis` / `update_thesis` / `dispatch_thesis_research` is unproven; defer until the v1 (Claude + `twitter_search`) baseline is shaking out, then we'll know whether Grok handles the structured dispatch flow well enough to be worth the model swap.
- **Reflexive vector memory** — embed every closed trade; new candidates matched against historical setup space (catalog §6.13). Cross-cutting; affects sizing + stop-tightness on every new thesis, not discovery routing per se.

---

## Dependency graph

```
NOW-1  ─→  NOW-2          (NOW-2 only meaningful after NOW-1)
   │
   └────→  enables Lane 3  (cron lane cleared)

NOW-3  ─→  daily run quality  (independent)

SOON-1 ─→  SOON-2  (entry points need working prompt)
SOON-3 ─→  daily run quality  (independent of discovery lane)

MEDIUM-1, MEDIUM-2, MEDIUM-3 — independent of each other; each adds one trigger source + one discovery source

LATER items each independent
```

---

## Sequencing recommendation

| When | What | Effort |
|---|---|---|
| **This week** | NOW-1, NOW-2, NOW-3 | 15 min + 1-2 days |
| **Next PR cycle** | SOON-1 + SOON-2 together | ~3 days |
| **Parallel (other session)** | SOON-3 (per-thesis evidence diff) | 1-2 weeks |
| **After SOON ships** | MEDIUM-1 (EDGAR producer + first dual-role wiring) | ~1 week |
| **After MEDIUM-1 proves the pattern** | MEDIUM-2 + MEDIUM-3 (parallel) | ~1-2 weeks combined |
| **Then** | LATER backlog, prioritized by whatever the operator-driven flow has revealed as actually missing |

This sequence assumes the operator-driven discovery flow proves itself. If after a few weeks the chat shape isn't producing enough good dispatches, revisit — maybe the answer is a different agent shape, not new sources.

---

## Open questions

1. **Discovery overlay = inline append or fork a new mode?** Today's principal mode is one prompt. Easier to append a "Batched discovery" section to the existing `buildPrincipalSystemPrompt` activated by input shape. Cleaner long-term to fork a dedicated `discovery-chat` mode if the overlay grows past ~200 lines. **Vote:** start inline; refactor if it crosses the threshold.

2. **What does "Run Discovery" send as the kickoff?** Archetype-aware (look up `AgentConfig.strategyArchetype` and compose accordingly). **Vote:** archetype-aware — the `strategyArchetype` field already exists.

3. **Keep `read_signals` available to Principal Chat after the soft-kill?** Yes — it's harmless when there's nothing in the pool, and leaves the door open for the MEDIUM-* sources to populate it again. The daily run is the path being stripped; the chat path stays.

4. **Where do PASS theses from chat-driven discovery live?** Same `Thesis(direction='PASS', status='ARCHIVED')` rows as today's Sunday cron — institutional memory, queryable via `get_theses(include_history:true)` on next encounter. No new shape.

5. **Audit trail for chat-driven dispatches.** Each dispatch already creates a child `ResearchRun(mode='THESIS_WRITER', parentRunId=<chat ResearchRun>)`; the chat shows the dispatch as a tool call inline. Sufficient — no extra logging needed.

6. **Does the Sunday DISCOVERY cron stay on while SOON-1/2 ship?** Yes — keep it running on its current shape so the analysts don't go silent during the transition. Sunset it after SOON-2 lands and the operator has run the chat-shape discovery a few times to confirm it's working. The cron's still useful as a fallback "scheduled scan" surface; whether it stays in the long run is a call to make after a month of chat-shape data.

---

## See also

- [`DISCOVERY_V2.md`](./DISCOVERY_V2.md) — operating model + 16-archetype signal-source catalog
- [`THESIS_ARCHITECTURE.md`](../THESIS_ARCHITECTURE.md) — the role split (writer produces research, orchestrator decides status); the cardinal rule downstream tools rely on
- [`PRINCIPLES.md`](../PRINCIPLES.md) — three-layer principle (each producer is Layer 2 pre-digest; the chat agent's discovery judgment is Layer 3)
- [`MORNING_RUN_V2_DESIGN.md`](./MORNING_RUN_V2_DESIGN.md) — the daily run prompt this stops feeding garbage to
- [`CONVICTION_EXPRESSION.md`](./CONVICTION_EXPRESSION.md) — adjacent design (Thesis structure) that improves conviction expression on every dispatched thesis
