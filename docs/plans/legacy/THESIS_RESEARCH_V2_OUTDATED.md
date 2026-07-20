> **OUTDATED/SUPERSEDED — see [`../../THESIS_ARCHITECTURE.md`](../../THESIS_ARCHITECTURE.md) + [`../THESIS_RESEARCH_V2.md`](../THESIS_RESEARCH_V2.md); kept as build history.**

# Hindsight — Thesis Research V2

> **Status (as of 2026-05-14):** Proposed. Not yet implemented. Two
> decisions required before Phase 1 starts — see [Decisions](#decisions-needed-before-phase-1).
>
> **What this is:** the multi-PR plan to lift thesis-research depth from
> one-paragraph vibes to multi-section, source-cited, bull-vs-bear research
> on the depth of a real equity analyst note.
>
> **The architecture:** a dedicated `thesis-writer` agent mode (worker)
> invoked from Discovery / Daily / Tactical / Principal Chat (orchestrators)
> via the orchestrator-worker pattern. Same shape Claude Code uses to spawn
> sub-agents, Cursor uses for sub-routines, LangGraph supervisors use,
> Inngest fan-out is designed for. Single responsibility, fully reusable,
> testable in isolation.
>
> **The build path:** Phase 1 ships the worker + a dispatch tool wired
> into Principal Chat — proof-of-concept is "user types into the main chat
> and gets a Google-AI-depth thesis." Phase 2 wires it into Discovery's
> Sunday cron. Phases 3-5 cover Daily, Tactical, and the research journal.
>
> **Owner:** principal. **Audience:** future sessions picking this up cold.
>
> **Related docs:**
> - [`docs/VISION.md`](../../VISION.md) — Pillar 2 (Thesis quality) is the success bar
> - [`docs/THESIS_ARCHITECTURE.md`](../../THESIS_ARCHITECTURE.md) — the live thesis system reference; this plan is additive
> - [`docs/PRINCIPLES.md`](../../PRINCIPLES.md) — three-layer principle; every rule in this plan maps to its correct layer
> - [`docs/plans/MORNING_RUN_V2_DESIGN.md`](./MORNING_RUN_V2_DESIGN.md) — sibling plan that rewrote the daily-run prompt; same layering applied to a different surface

---

## 0. Status table

| Phase | Title | Calendar | Status | Validation surface |
|---|---|---|---|---|
| **0** | Opus spike + thesis-writer skeleton | 0.5 wk | Not started | Single hand-invoked run on $QCOM streams to /runs/[id] |
| **1** | Worker + 5 tools + multi-section schema + Principal Chat dispatch | 3-4 wk | Not started | "Write me a fresh thesis on $QCOM" in main chat → side-by-side better than Google AI |
| **2** | Discovery integration | 1 wk | Not started | One Sunday cron writes deep theses for all 6 analysts |
| **3** | Daily promote-to-active | 1 wk | Not started | place_trade refuses on stale research; daily auto-refreshes |
| **4** | Tactical integration | 1 wk | Not started | Trigger fires → inline refresh → act |
| **5** | Research journal (cross-run memory) | 2 wk | Not started | Thesis-writer prompts contain analyst's 90d track record |

**Total:** 8-10 calendar weeks to fully wired. Phase 1 alone (3-4 weeks) is enough to start using the system in chat-driven workflow.

---

## 1. The problem

### 1.1. The gap, in two side-by-side paragraphs

**Hindsight's thesis on Qualcomm (2026-05-14):**

> Qualcomm has made a significant move to a new 52-week high which aligns with our strategy of capturing momentum. The semiconductor sector remains robust, and such movements typically precede further gains.

**Google AI's thesis on Qualcomm (same day):**

> Qualcomm surged approximately 70% recently, driven by a strategic pivot toward AI and data center infrastructure. Analysts project a mixed near-term outlook due to conservative Q3 guidance and potential overbought conditions, but remain optimistic about long-term growth in automotive and AI segments.
>
> **Bullish:** Strategic Pivot to AI Infrastructure — data center processors scheduled to ship to a major hyperscaler by late 2024. Strong Automotive and IoT Growth — record Q2 2026 automotive revenues, +38% YoY. Massive Capital Return Program — ~$3.7B returned, new $20B share buyback authorization.
>
> **Bearish:** Weak Q3 Revenue Guidance — $9.2-10B vs market expectations. Significant Insider Selling — ~$5M over past three months. Technical Overbought — RSI above 70, support near $185.

The Hindsight thesis is **one assistant turn** synthesizing **one tool call** (`get_stock_data` — Finnhub quote + Finnhub `/stock/metric` + 3 news headlines from a 7-day window + recommendations + RSI/SMA). There's no earnings-call transcript, no Form 4 insider parse, no segment-revenue breakdown, no peer comparison, no analyst-report synthesis, no explicit adversarial bear case.

### 1.2. Why the existing structural-belief gate doesn't fix it

`record_thesis` already requires `coreBelief`, ≥2 `keyAssumptions`, ≥2 `invalidationConds`. Those gates catch **shape**, not **substance**. `"momentum in semis"` is a legal `keyAssumption`. `"market volatility"` is a legal `invalidationCondition`. The gates were the right answer to "the agent skipped the structural belief fields entirely" — they are not the answer to "the agent fills the fields with vapor."

The substance problem has three causes upstream of the schema:

1. **Data:** the agent doesn't have the tools to surface the kind of specifics Google's summary contains (segment growth, insider transactions, transcript guidance language, analyst-note synthesis).
2. **Workflow:** the daily-run agent writes the thesis inline alongside the rest of its book-management work — the wrong cadence and the wrong attention budget for deep research.
3. **Architecture:** thesis writing is a sub-task that should have its own bounded agent loop, not a sub-section of an orchestrator's loop.

This plan fixes all three.

---

## 2. The convergent pattern from external research

Independent survey of FinRobot (Apache-2.0, ai4finance-foundation), TradingAgents (Apache-2.0, TauricResearch — 75.1k stars), Anthropic's [`/solutions/financial-services`](https://claude.com/solutions/financial-services), and Alpaca's AI-agents writeup. Full detail in [Appendix A](#appendix-a--external-research-synthesis).

The five mechanics that all four sources converge on:

1. **Decompose research into named lanes before synthesizing.** Fundamentals / Technicals / Catalyst / Sentiment / Bear Case. FinRobot uses 8 specialist agents per equity-research report. TradingAgents runs a 4-lane Analyst Team in parallel. Citadel (quoted on Anthropic's page): *"build and update coverage models, separate signal from noise, and pressure-test their work."*

2. **Force an adversarial bear case alongside the bull case.** TradingAgents implements as a Bullish Researcher vs Bearish Researcher debate. Citadel calls it "pressure-test." Hindsight has `risk_flags` but nothing requires the entries be substantive.

3. **Every claim cites a source.** Anthropic's financial-services framing: *"Every number can be traced back to its source."* Hindsight has `sourcesUsed` plumbed but the prompt does not *enforce* per-bullet citation.

4. **Two-tier model split — deep-think for synthesis, quick-think for retrieval.** TradingAgents codifies as `deep_think_llm` + `quick_think_llm`. Anthropic implies it (Opus 4.6 for complex modeling). Hindsight runs GPT-4o everywhere — overpaying for retrieval, arguably underpaying for synthesis.

5. **Persistent cross-run memory.** TradingAgents writes a `trading_memory.md` and injects "most recent same-ticker decisions plus recent cross-ticker lessons" into the next decision. Hindsight has `AnalystBriefing` (within-day continuity) but no longitudinal rollup.

What to **skip**: FinRobot's 5+ specialist agents wholesale (cost bomb under Hindsight's step budgets), TradingAgents' Fund Manager layer (Hindsight's user is the FM), DCF / 3-year projection generators (heavy and not Hindsight's edge), and the StockHero black-box framing entirely — it's the anti-pattern.

---

## 3. The architecture — orchestrator-worker

### 3.1. Why this pattern, with industry receipts

Every serious agent system uses the same shape: an **orchestrator agent** owns the goal, and **worker agents** own bounded sub-tasks. The orchestrator's tool catalog includes "regular tools" (database queries, file edits) AND "spawn a worker" tools. Workers run in their own context with their own prompts and their own tool catalogs.

| System | Orchestrator | Worker |
|---|---|---|
| **Claude Code** (this product) | The conversation you're in | Sub-agents spawned via the `Agent` tool — general-purpose, Explore, Plan |
| **Cursor agent mode** | The user's "compose" prompt | Codebase-search sub-routine, file-edit application sub-routine |
| **Devin** | Plan-and-execute planner | Browser-use sub-agent, terminal sub-agent |
| **Anthropic deep-research** | The user's chat with Claude | The deep-research worker (long-running, web access, structured report) |
| **LangGraph supervisor pattern** | Supervisor node | Specialist worker nodes |
| **CrewAI / AutoGen** | Crew manager / group-chat manager | Crew agents / group members |

Single monolithic agents doing everything in one loop hit a complexity wall fast. Decomposition into orchestrator + workers is how every agent system scales past trivial tasks.

### 3.2. How Hindsight maps to it

```
                    Orchestrators (existing run modes)
                    ──────────────────────────────────
              ┌─── Discovery (Sunday weekly cron) ────┐
              │                                        │
              ├─── Daily run (8am weekdays) ──────────┤
              │                                        │
              ├─── Tactical (event-driven) ───────────┤    invoke
              │                                        │   ────────►
              ├─── Principal Chat (/chat) ────────────┤
              │                                        │
              └─── Dev tool (/dev/thesis-writer) ─────┘

                                                          Worker (new mode)
                                                          ─────────────────
                                                          thesis-writer
                                                            • One ticker
                                                            • Claude Opus 4.7
                                                              + extended thinking
                                                            • 5 deep-research tools
                                                            • Multi-section thesis
                                                            • Per-claim citations
                                                            • Bull + bear cases
                                                            • Writes Thesis row
                                                              + ThesisUpdate audit
                                                              row when done
```

Communication shape:

```
Orchestrator
  │
  │   tool call:   dispatch_thesis_research({ticker, analyst_id, mode, reason})
  │
  ▼
dispatch_thesis_research.execute()
  │
  ├── Inserts ResearchRun(mode="THESIS_WRITER", parentRunId=ctx.runId, status=PENDING)
  ├── Fires Inngest event app/thesis.write.requested
  └── Returns { childRunId, estimatedDurationMs }    ◄── orchestrator continues
                                                         immediately

[separate execution context]
  │
  ▼
Inngest function thesis-writer
  │
  ├── Marks ResearchRun status=RUNNING
  ├── Calls runThesisWriterAgent({ runId, ticker, analystId, mode, existingThesisId })
  │     │
  │     │  ── Builds thesis-writer prompt with analyst identity + ticker context
  │     │  ── Calls AI SDK generateText with claude-opus-4-7 + thinkingBudget
  │     │  ── Streams tool calls: get_stock_data, get_earnings_transcript,
  │     │     get_insider_activity, get_segment_revenue, get_peer_comparison,
  │     │     get_analyst_notes, [optionally get_sec_filings, web_search]
  │     │  ── Synthesizes the multi-section research block
  │     │  ── Calls record_thesis (mint) or update_thesis (refresh)
  │     │  ── Calls complete_run
  │     │
  ├── Marks ResearchRun status=COMPLETE
  └── Sends Inngest event app/thesis.written { childRunId, thesisId, success }
```

Orchestrators that need the result wait for the `app/thesis.written` event. Orchestrators that fire-and-forget (Discovery's case) just keep going.

### 3.3. Sync vs async per orchestrator

| Orchestrator | Mode | Why |
|---|---|---|
| **Discovery** | Fan-out, fire-and-forget | 5-8 candidates per analyst per Sunday. Wall-time = single longest worker, not sum. Each child becomes a first-class run row in /runs. Discovery's record_run_summary lists "dispatched N; check /runs for outcomes." |
| **Daily promote-to-active** | Dispatch + Inngest `step.waitForEvent` (timeout 3m) | Daily agent fires refresh, blocks the daily run until refresh completes, then retries place_trade. Doesn't burn function timeout — Inngest steps are cheap. |
| **Tactical** | Inline call to `runThesisWriterAgent()` | One trigger fired, one thesis. Lower latency by skipping the event roundtrip. Same Inngest function context. |
| **Principal Chat** | Dispatch + wait + stream | User invocation. Stream the worker's tool-call progress to the chat surface using existing SSE infrastructure. |
| **Dev tool** | Direct sync POST to /api/agent/thesis-writer | Tuning surface. Bypasses orchestrator entirely. |

---

## 4. Build vs adopt

**Decision: build native to Hindsight's stack.**

### 4.1. Why not adopt FinRobot or TradingAgents

Both are Python codebases. Running either inside Hindsight requires:

- A Python service alongside Vercel (Modal / Fly / Cloud Run)
- RPC bridge between Inngest and the Python service
- Re-wiring their data layer from yfinance / Alpha Vantage to Finnhub / FMP / Alpaca / Sonar / Firecrawl / SEC EDGAR (most of the build)
- Translating their output back into Hindsight's `Thesis` schema + `ThesisUpdate` audit log + streaming AssistantUI rendering surface
- Inheriting their architectural choice of **procedure-in-prompt** rather than **gates-in-tools** — exactly the maze-prompt pattern your [`PRINCIPLES.md`](../../PRINCIPLES.md) was written to delete

Concrete inheritance cost:

| | FinRobot | TradingAgents |
|---|---|---|
| Stack | Python, local Flask UI on `127.0.0.1:8001`, Jupyter tutorials | Python, CLI + library |
| LLM provider | OpenAI by default | OpenAI, Anthropic, Google, xAI, DeepSeek, Qwen, Ollama, Azure |
| Data | FMP, Finnhub, SEC EDGAR, yfinance, FinNLP | Alpha Vantage required by default config |
| Output | HTML/PDF report with 15+ chart types | stdout/files + persistent `trading_memory.md` |
| Architecture | 8 specialist agents → Director routes | Analyst Team (4) → Researcher Team debate → Trader → Risk Mgmt → Fund Manager |
| License | Apache-2.0 | Apache-2.0 |

### 4.2. What's valuable, in TypeScript

The five mechanics from §2 collapse to ~600 lines of TypeScript inside existing Hindsight patterns:

| Mechanic | Hindsight implementation | LOC |
|---|---|---|
| Named research lanes | Zod schema block on `record_thesis` | ~80 |
| Bull/bear debate | `bull_case[]` + `bear_case[]` array fields with min-N + citation gates | ~70 |
| Per-claim citations | `CitationRef` type + Layer-1 validator against this run's tool history | ~120 |
| Two-tier model split | One `MODES["thesis-writer"]` entry — Opus on the worker, GPT-4o stays on orchestrators | ~10 |
| Cross-run memory | `ResearchJournal` model + weekly rollup cron + prompt block | ~150 |
| Orchestrator-worker plumbing | `dispatch_thesis_research` tool + `thesis-writer.ts` Inngest function + `parentRunId` column + child-run UI | ~250 |

Plus 5 new tools (~1000 LOC total) following existing [`defineTool()`](../../../lib/agent/define-tool.ts) patterns.

The valuable bits are **patterns**, not **code**. Importing the Python codebases imports the tax without the lift.

---

## 5. The thesis-writer agent mode (concrete spec)

### 5.1. Mode entry in [`lib/agent/modes.ts`](../../../lib/agent/modes.ts)

```ts
"thesis-writer": {
  model: "claude-opus-4-7",
  provider: "anthropic",
  thinkingBudget: 8000,            // extended thinking for synthesis
  maxSteps: 18,                    // one ticker — bounded
  toolAllowlist: [
    // Snapshot
    "get_stock_data",
    "get_market_context",
    // Deep research (NEW in PRs 1.2-1.6)
    "get_earnings_transcript",
    "get_insider_activity",
    "get_segment_revenue",
    "get_peer_comparison",
    "get_analyst_notes",
    // Existing depth tools
    "get_sec_filings",
    "get_earnings_data",
    "read_artifact",
    "web_search",
    // Write — exactly one fires
    "record_thesis",               // mint mode
    "update_thesis",               // refresh mode
    // Terminal
    "complete_run",
  ],
  hasSuggestConfig: false,
  maxDuration: 480,                // 8 min — Opus extended thinking is slower
},
```

### 5.2. Invocation contract

```ts
type ThesisWriterInput = {
  runId: string;                   // the worker's own ResearchRun id
  ticker: string;
  analystId: string;
  mode: "mint" | "refresh";
  existingThesisId?: string;       // required when mode === "refresh"
  reason: string;                  // why this work was dispatched
};

type ThesisWriterOutput = {
  success: boolean;
  thesisId?: string;
  errorReason?: string;
};
```

### 5.3. Prompt shape (Layer 3, short)

The prompt is short — this is the architecture's payoff. The mode is single-purpose, so the prompt doesn't need procedure padding. Approximate structure:

```
You are {analystName}, writing one thesis on {ticker}.
{analystPrompt}                                    // the analyst's identity

Mode: {mint | refresh existing thesis {id}}
Why dispatched: {reason}

Your job: produce one Thesis row that survives a side-by-side comparison
with a professional equity analyst note. Multi-lane research, every claim
cited to a tool result, mandatory adversarial bear case even when going
LONG.

Tools you have:
  • Snapshot: get_stock_data, get_market_context
  • Deep research: get_earnings_transcript, get_insider_activity,
    get_segment_revenue, get_peer_comparison, get_analyst_notes
  • Existing depth: get_sec_filings, get_earnings_data, read_artifact,
    web_search
  • Write: record_thesis (mint) | update_thesis (refresh)

Workflow:
  1. Snapshot — get_stock_data + get_market_context.
  2. Deep research — call the 5 deep tools as appropriate. Skip a tool
     if the snapshot makes it irrelevant (e.g. no segment data on a
     pure-play single-product company). Use web_search to fill specific
     gaps the structured tools missed.
  3. Synthesize — write the multi-section research block:
       fundamentals.summary  + citations
       technicals.summary    + citations
       catalyst.summary      + citations + when (if dated)
       bull_case[]           ≥3 cited claims
       bear_case[]           ≥2 cited claims (MANDATORY even on LONG)
  4. Pick direction, horizon, target/stop, confidence.
  5. Call record_thesis (mint) or update_thesis (refresh).
  6. Call complete_run.

Quality bar:
  • Every claim cites a specific tool result (signalId, artifactId, or
    tool-call uuid). The tool gate enforces this.
  • Section summaries ≥80 chars. The tool gate enforces this.
  • Bear case is mandatory even on LONG. The tool gate enforces this.
```

Layer-3 discipline: describe what good looks like; do not enumerate procedure. The Layer-1 gates do the enforcement; the Layer-2 tool descriptions explain mechanics.

### 5.4. Execution function

`lib/agent/run-thesis-writer.ts` — same shape as `runDailyResearchAgent()` in [`lib/inngest/functions/morning-research.ts`](../../../lib/inngest/functions/morning-research.ts). Loads context, builds prompt, calls AI SDK `generateText` with the Opus model + extended thinking + tool allowlist, persists tool calls + final thesis. Streams events on the existing SSE channel keyed by runId.

---

## 6. The dispatch tool (orchestrator side)

### 6.1. `dispatch_thesis_research`

```ts
// lib/agent/tools/dispatch-thesis-research.ts
export const dispatchThesisResearch = defineTool({
  description:
    "Dispatch a deep-research sub-agent to write or refresh a thesis " +
    "for one ticker. Returns immediately with a child run ID; the " +
    "research happens asynchronously in its own agent loop. Use for " +
    "every candidate worth a thesis in discovery, or for any held " +
    "thesis with stale research before a promote-to-active.",
  schema: z.object({
    ticker: z.string(),
    analyst_id: z.string(),
    mode: z.enum(["mint", "refresh"]),
    existing_thesis_id: z.string().optional(),
    reason: z.string().min(20),
  }),
  ui: "tool-ui" as const,
  groupId: "thesis-dispatch",

  execute: async (args, ctx) => {
    // Insert child ResearchRun, fire Inngest event, return immediately.
    const childRun = await prisma.researchRun.create({
      data: {
        agentConfigId: args.analyst_id,
        mode: "THESIS_WRITER",
        status: "PENDING",
        parentRunId: ctx.runId,
        parameters: { ...args },
      },
    });
    await inngest.send({
      name: "app/thesis.write.requested",
      data: { childRunId: childRun.id, ...args },
    });
    return {
      summary: `Dispatched thesis-writer for $${args.ticker} (${args.mode})`,
      data: { childRunId: childRun.id, estimatedDurationMs: 90_000, items: [...] },
      sources: [],
    };
  },
});
```

### 6.2. Per-orchestrator allowlist

| Mode | `dispatch_thesis_research` allowed? | Notes |
|---|---|---|
| `discovery` | yes | Replaces the per-candidate `record_thesis` call from the current Discovery prompt |
| `research-run` (daily) | yes | Used when `place_trade` Layer-1 gate refuses on stale research (Phase 3) |
| `tactical` | yes | Used when trigger fires on a thesis with stale research (Phase 4) |
| `principal` | yes | User-initiated thesis writing from main chat (Phase 1 PoC) |
| `builder` / `editor` | no | Out of scope; analyst config edit, not thesis work |
| `podcast-*` | no | Different feature |

---

## 7. The schema model — what's automatic vs agent-driven

The Thesis row is a **smart form**: agent provides judgment, system computes operational state, audit log captures history.

### 7.1. Bucket 1 — Agent provides (judgment, can't be computed)

| Field | Why |
|---|---|
| `direction` (LONG/SHORT/PASS) | Interpretation of evidence |
| `horizon` (CATALYST/TRADE/TARGET/COMPOUNDER) | Picking the exit policy |
| `coreBelief` | The load-bearing claim |
| `keyAssumptions` | What must remain true |
| `invalidationConds` | What kills the thesis |
| `entryPrice` / `targetPrice` / `stopLoss` | Pulled from real chart levels but the choice is judgment |
| `confidenceScore` | Calibration |
| `catalystDate` (CATALYST only) | Sourced from filing/calendar but agent picks which event |
| `maxHoldDays` (TRADE only) | Setup-specific judgment |
| `targetSizePct` / `scalingPlan` | Sizing intent |
| **NEW: `research` block** (fundamentals / technicals / catalyst / bull_case / bear_case) | Multi-section deep work |
| Custom `triggers[]` beyond defaults | Rare; specific predicates |

### 7.2. Bucket 2 — System computes (derived, automatic)

| Field | How |
|---|---|
| **Default `triggers[]`** | [`defaultTriggersForHorizon()`](../../../lib/agent/triggers/defaults.ts) attaches the standard set per horizon × direction × status. LONG WATCHING auto-gets `PRICE_ABOVE(target) → ENTER`. ACTIVE auto-gets `PRICE_BELOW(stop) → EXIT`. CATALYST auto-gets filing-OR triggers + earnings REVIEW. Agent only writes *custom* triggers on top. |
| `nextReviewAt` | Derived from `horizon` via [`HORIZON_REVIEW_DAYS`](../../../lib/agent/horizon-policy.ts). CATALYST=1d, TRADE=1d, TARGET=7d, COMPOUNDER=30d. Agent never sets manually. |
| `status` | Derived from `direction` + run context. Discovery's LONG/SHORT → WATCHING, PASS → ARCHIVED. `place_trade` flips WATCHING → ACTIVE atomically. `close_position` flips ACTIVE → CLOSED. |
| `hold_duration` | Derived from `horizon`. TRADE/TARGET/CATALYST → SWING, COMPOUNDER → POSITION. |
| `signal_types` | Inferred from `sourceSignalIds`' normalized types. (Today agent provides; this is a candidate for auto-derivation in PR 1.1.) |
| **NEW: `reasoning_summary`** | Derived from `research.fundamentals.summary` + `research.technicals.summary` collapsed. Server-side rollup, 2-3 sentences. Agent stops writing this directly. |
| **NEW: `thesis_bullets`** | Derived from `research.bull_case[].claim` — top 3-5. Server-side. |
| **NEW: `risk_flags`** | Derived from `research.bear_case[].claim` — top 2-4. Server-side. |
| `fundamentals` block (PE, market cap, beta) | Auto-populated from this run's `get_stock_data` tool result — not retyped by the agent. |
| **NEW: `researchUpdatedAt`** | Set whenever the `research` block is written. Used by Phase 3 staleness gate. |

### 7.3. Bucket 3 — Audit log (history)

`ThesisUpdate` rows. Already in place. Every state change writes one. New `type='RESEARCH_REFRESHED'` value added in PR 1.1 for refresh-only patches.

### 7.4. Triggers — who sets what

**Automatic** (from [`triggers/defaults.ts`](../../../lib/agent/triggers/defaults.ts)):

| Horizon × Direction × Status | Auto-attached triggers |
|---|---|
| LONG WATCHING | `PRICE_ABOVE(target) → ENTER` cd=1d |
| LONG ACTIVE | `PRICE_BELOW(stop) → EXIT` cd=0, `PRICE_ABOVE(target) → REVIEW` cd=0 |
| CATALYST any | + `OR(8-K, 10-Q, 10-K) → REVIEW` cd=1d, `EARNINGS_BEAT/MISS → REVIEW` cd=7d |
| TRADE any | + `TIME_ELAPSED(maxHoldDays) → REVIEW` |
| TARGET any | + `EARNINGS_BEAT/MISS → REVIEW` cd=7d, 30d hygiene |
| COMPOUNDER any | + 90d hygiene; structural-break review only |

**Agent-driven** (rare, custom on top):
- Specific numeric predicates derived from `keyAssumptions` (e.g. assumption "GM stays above 70%" → trigger `EARNINGS_REPORT → REVIEW if grossMargin < 70`)
- Event predicates derived from `invalidationConds` (e.g. "CFO departure")

Most theses don't need any custom triggers — the horizon defaults cover the standard cases.

### 7.5. Schema migration

```prisma
model ResearchRun {
  // ... existing fields
  parentRunId      String?
  parentRun        ResearchRun?  @relation("RunHierarchy", fields: [parentRunId], references: [id])
  childRuns        ResearchRun[] @relation("RunHierarchy")
  @@index([parentRunId])
}

model Thesis {
  // ... existing fields
  research            Json?          // multi-section block; see PR 1.1 schema
  researchUpdatedAt   DateTime?
}

enum ResearchRunMode {
  // ... existing
  THESIS_WRITER
}

enum ThesisUpdateType {
  // ... existing
  RESEARCH_REFRESHED
}
```

---

## 8. The phases

### Phase 0 — Opus spike + thesis-writer skeleton (0.5 wk)

**Goal:** derisk the model decision and stand up the minimum viable worker before tooling work begins.

**Work:**

1. Stand up the `thesis-writer` mode entry in [`lib/agent/modes.ts`](../../../lib/agent/modes.ts) with current tool set (no new tools yet)
2. Build the bare `runThesisWriterAgent()` execution function with a one-paragraph prompt
3. Stand up `thesis-writer.ts` Inngest function listening for `app/thesis.write.requested`
4. Add `parentRunId` schema migration
5. Hand-fire one event for `$QCOM` and watch it stream to `/runs/[id]`

**Validation:**
- Tool calling works (Opus correctly invokes existing tool schemas via AI SDK Anthropic provider)
- Extended thinking doesn't blow `maxSteps`
- Streaming SSE works through the existing route
- Output quality on $QCOM is visibly better than GPT-4o on the same prompt
- Context window math holds: prompt + ~6 tool results stays well inside Opus 200k window

**Decision rule:** if green → continue Phase 1 with Opus. If red → Phase 1 ships unchanged but stays on GPT-4o and leans harder on the multi-section schema + citation gate to compensate.

**Effort:** 0.5 day.

---

### Phase 1 — Worker + 5 tools + multi-section schema + Principal Chat dispatch (3-4 wk)

**Goal:** the user can type "write me a fresh thesis on $QCOM for Tech Momentum" into the main chat at `/chat` and get back a Google-AI-depth thesis.

| PR | Title | Layer | Effort |
|---|---|---|---|
| 1.1 | Multi-section thesis schema + citation gate | L1 | 2d |
| 1.2 | Tool: `get_earnings_transcript` | L2 | 2d |
| 1.3 | Tool: `get_insider_activity` | L2 | 2d |
| 1.4 | Tool: `get_segment_revenue` | L2 | 1-3d (FMP plan dependent) |
| 1.5 | Tool: `get_peer_comparison` | L2 | 2d |
| 1.6 | Tool: `get_analyst_notes` | L2 | 2d |
| 1.7 | Full thesis-writer prompt (replaces Phase 0 stub) | L3 | 1d |
| 1.8 | `dispatch_thesis_research` tool + Principal Chat allowlist | L1+L2 | 1d |
| 1.9 | Parent/child run rendering in `/runs/[id]` | UI | 2d |
| 1.10 | (Optional) `/dev/thesis-writer` debug page | UI | 1d |

**PRs 1.2-1.6 can be parallelized** — no inter-dependencies. Schedule as parallel tracks if there's bandwidth; sequential is ~10 days; parallel is ~3 days wall-time.

#### PR 1.1 — Multi-section thesis schema

Add the `research` block to [`record-thesis.ts`](../../../lib/agent/tools/record-thesis.ts):

```ts
const citationRef = z.object({
  kind: z.enum(["signal", "artifact", "tool_result"]),
  id: z.string(),
  snippet: z.string().min(20).optional(),
});

research: z.object({
  fundamentals: z.object({
    summary: z.string().min(80),
    citations: z.array(citationRef).min(1),
  }),
  technicals: z.object({
    summary: z.string().min(80),
    citations: z.array(citationRef).min(1),
  }),
  catalyst: z.object({
    summary: z.string().min(80),
    citations: z.array(citationRef).min(1),
    when: z.string().datetime().optional(),
  }),
  bull_case: z.array(z.object({
    claim: z.string().min(40),
    citation: citationRef,
  })).min(3),
  bear_case: z.array(z.object({
    claim: z.string().min(40),
    citation: citationRef,
  })).min(2),
  valuation: z.object({
    summary: z.string().min(80),
    citations: z.array(citationRef).min(1),
  }).optional(),
}).optional(),
```

**Layer-1 citation validator:** for each citation, validate the id appears in this run's tool-call history. Reject with the specific failing IDs called out so the agent retries.

**Tool context extension:** [`lib/agent/tool-context.ts`](../../../lib/agent/tool-context.ts) gains `ctx.toolResults: Map<callId, {tool, args, result}>` so the validator has something to validate against.

**Server-side derivation:** when `research` is present, server derives `reasoning_summary`, `thesis_bullets`, `risk_flags` from it. Old direct-write paths still work (additive rollout).

**Rollout flag:** `AgentConfig.useResearchSchemaV2` boolean. Phase 1 gates research-block REQUIREMENT behind this flag for the thesis-writer mode only.

**Schema additions:** `Thesis.research` JSONB column, `Thesis.researchUpdatedAt` timestamp, `ThesisUpdate.type` adds `RESEARCH_REFRESHED`.

#### PRs 1.2-1.6 — The 5 deep-research tools

| Tool | Purpose | Data path | Returns | Risk |
|---|---|---|---|---|
| `get_earnings_transcript` | Management voice + guidance | Finnhub `/stock/earnings-call-transcripts` (verify tier) → fallback Sonar+Firecrawl | callDate, managementCommentary[], guidance[], qaSnippets[] | Medium — transcript availability |
| `get_insider_activity` | Form 4 rollup | SEC EDGAR (existing wrapper) | netDirection, totalNetValue, topInsiders[], recentTxns[], patternVs6Mo | Low |
| `get_segment_revenue` | Revenue by segment with YoY | FMP `/income-statement-segments` → fallback 10-Q Firecrawl | segments[] with quarterlyRevenue, ttmRevenue, pctOfTotal, notableShift | Medium — FMP plan |
| `get_peer_comparison` | Relative positioning | Finnhub `/stock/peers` + fan-out `get_stock_data` | peers[], comparison[], ranking[] | Low |
| `get_analyst_notes` | Recent street notes | Sonar with publisher domain filter + Firecrawl on top hits | notes[] with rating + PT deltas + summary, consensusShift | Medium — Sonar quality |

Each follows the existing [`defineTool()`](../../../lib/agent/define-tool.ts) pattern. UI: `tool-ui` with one ticker row + N generic rows. Allowlist: thesis-writer + tactical (some).

#### PR 1.7 — Full thesis-writer prompt

Replaces the Phase 0 stub. See §5.3 for the shape.

#### PR 1.8 — `dispatch_thesis_research` tool

The tool spec from §6.1. Added to Principal Chat's `toolAllowlist`. Principal Chat can now dispatch a thesis write from the main chat.

**Principal Chat prompt addendum** (~5 lines): "When the user asks for a fresh thesis on a ticker, call dispatch_thesis_research with mode='mint' (or 'refresh' if the ticker has an existing WATCHING/ACTIVE thesis). Stream the worker's progress; the user will see it inline."

#### PR 1.9 — Parent/child run UI

`/runs/[id]` page reads `parentRunId` and `childRuns`. If parent: show child runs as a list under the main timeline, each clickable to its own run page. If child: show "← Parent: {parent name}" breadcrumb.

#### PR 1.10 — `/dev/thesis-writer` debug page (optional)

Hidden under `/dev/*` (dev-only auth). Form with ticker + analyst dropdown + mode radio. POST → fires the same Inngest event the dispatch tool fires. Used for tuning the prompt without going through chat. **Not user-facing.**

**Phase 1 success criteria:**
1. User opens `/chat`, types "Write me a fresh thesis on $QCOM for Tech Momentum"
2. Principal Chat dispatches the worker; user sees streaming progress
3. Worker runs ~10-15 tool calls (5 deep + 5 supporting) over ~60-90 seconds
4. Final `record_thesis` call lands with the structured `research` block
5. Side-by-side compared with Google AI's $QCOM summary, the Hindsight thesis matches or exceeds depth on at least 4 of 5 dimensions (fundamentals specificity, technicals specificity, catalyst specificity, bull-case substance, bear-case substance)
6. Every claim in the thesis is clickable to its source via the citation chip

---

### Phase 2 — Discovery integration (1 wk)

**Goal:** Sunday cron writes deep theses for every analyst.

| PR | Title | Effort |
|---|---|---|
| 2.1 | Discovery prompt rewrite — fan out to thesis-writer per candidate | 2d |
| 2.2 | `dispatch_thesis_research` allowlisted in discovery mode | 0.5d |
| 2.3 | Discovery prompt: cap at 6 dispatches per run; one-Sunday end-to-end test | 1d |
| 2.4 | Roll out to all 6 analysts after spot-check | 0.5d |

**Discovery prompt collapses to ~80 lines:**
```
Step 1 — Read discovery surfaces (read_signals, get_market_movers, get_earnings_calendar)
Step 2 — Per candidate cross-analyst overlap check (get_theses)
Step 3 — Dispatch thesis-writer per candidate that clears the bar
Step 4 — record_run_summary listing dispatched theses
Step 5 — complete_run
```

The body Discovery used to write inline is now the worker's job. Discovery's responsibility shrinks to "find candidates and dispatch."

**Validation:** one Sunday morning. After all 6 analysts complete, count parent + child runs. Spot-check 5 child theses for the same depth bar as Phase 1 success criteria.

---

### Phase 3 — Daily promote-to-active (1 wk)

**Goal:** the daily run can't promote a stale-research WATCHING thesis to ACTIVE without first refreshing.

| PR | Title | Effort |
|---|---|---|
| 3.1 | `place_trade` Layer-1 staleness gate | 1d |
| 3.2 | `dispatch_thesis_research` allowlisted in research-run mode | 0.5d |
| 3.3 | Daily prompt: 2-line addition explaining the refresh flow | 0.5d |
| 3.4 | Inngest `step.waitForEvent` integration for daily-run wait pattern | 2d |

**Layer-1 gate spec** (in `place_trade.execute()`):

```
if (existing.status === 'WATCHING' && this is a WATCHING → ACTIVE promote) {
  const ageDays = daysSince(thesis.researchUpdatedAt)
  const refreshCalledThisRun = ctx.toolResults.find(
    t => t.tool === 'dispatch_thesis_research'
      && t.args.existing_thesis_id === thesis.id
      && t.args.mode === 'refresh'
  )
  if (ageDays > 7 && !refreshCalledThisRun) {
    return reject(
      `Research is ${ageDays} days stale. Refresh first: ` +
      `call dispatch_thesis_research(thesis_id: ${thesis.id}, mode: 'refresh'), ` +
      `wait for completion, then retry place_trade.`
    )
  }
}
```

The agent learns from the rejection. The daily prompt only needs ~2 sentences explaining the pattern; the gate's rejection message does the rest.

---

### Phase 4 — Tactical integration (1 wk)

**Goal:** when a trigger fires on a thesis with stale research, refresh inline before the tactical decision.

| PR | Title | Effort |
|---|---|---|
| 4.1 | Tactical run inline-invokes `runThesisWriterAgent()` (no Inngest event roundtrip) | 2d |
| 4.2 | Trigger-evaluator: skip refresh if research <24h old | 0.5d |
| 4.3 | Tactical prompt addition: "if thesis stale, refresh has run; the result is in your context" | 0.5d |

**Why inline (not event):** tactical's UX is "trigger fired → act in 60 seconds." An event roundtrip costs 5-15s of Inngest queueing + a separate function spin-up. Inline call to `runThesisWriterAgent()` skips that. Same function context, just a nested agent loop.

---

### Phase 5 — Research journal (cross-run memory) (2 wk)

**Goal:** TradingAgents' `trading_memory.md` pattern, native to Hindsight. Lessons from past trades feed back into future theses.

| PR | Title | Effort |
|---|---|---|
| 5.1 | `ResearchJournal` Prisma model + migration | 0.5d |
| 5.2 | `lib/inngest/functions/research-journal-rollup.ts` weekly cron | 3d |
| 5.3 | Inject journal into thesis-writer prompt (Layer 3) | 0.5d |
| 5.4 | Validate one analyst week-over-week to confirm patterns surface | 1d |

**Schema:**
```prisma
model ResearchJournal {
  id              String   @id @default(cuid())
  agentConfigId   String
  generatedAt     DateTime @default(now())
  windowDays      Int
  rightPatterns   String[]
  wrongPatterns   String[]
  commonGaps      String[]
  narrativeSummary String

  agentConfig     AgentConfig @relation(fields: [agentConfigId], references: [id])
  @@index([agentConfigId, generatedAt(sort: Desc)])
}
```

**Cron:** Sunday 8 AM ET (1h before Discovery). Per analyst: pull last 10 closed `Position.agentEvaluation` post-mortems → GPT-4o-mini synthesis → persist `ResearchJournal`.

**Prompt injection:** thesis-writer prompt prepends:
```
Your track record (last 90 days):
  Worked: {rightPatterns}
  Didn't work: {wrongPatterns}
  Recurring research gaps: {commonGaps}
  {narrativeSummary}

Don't repeat the gaps. Lean into what worked.
```

---

## 9. Decisions needed before Phase 1

### Decision 1 — Run Phase 0 spike now, or commit to Opus blind?

- **Run spike (recommended):** half-day cost. Resolves the model question cheaply before 2 weeks of work depends on it.
- **Skip:** start Phase 1 immediately with Opus assumed working. Slightly higher rework risk if Opus has tool-calling or context issues.

### Decision 2 — Does the FMP plan support `/income-statement-segments`?

- If yes → PR 1.4 stays ~1 day, single endpoint.
- If no → PR 1.4 becomes ~3 days, falls back to Firecrawl on the latest 10-Q's segment-revenue table.

Quick check: hit the endpoint with the existing FMP key on a known multi-segment ticker like $QCOM. If returns data → green. If 403 → fallback path takes over.

### Decision 3 — Earnings transcript data source

Three options for `get_earnings_transcript`:
- **Finnhub** transcript endpoint — verify your tier supports it. If yes, this is the cleanest path.
- **API Ninjas** earnings transcripts — paid, structured, ~$10/mo.
- **Sonar + Firecrawl** on `motleyfool.com` / `seekingalpha.com` — cheapest, less reliable extraction quality.

Pick one before PR 1.2 starts.

---

## 10. Risks and known unknowns

### Stack / context
- **Claude 30k context warning in CLAUDE.md.** That note is about the DAILY-RUN prompt. Thesis-writer's prompt is much smaller (~150 lines) + ~10 tool results, well inside Opus 200k. Phase 0 verifies; if Opus also crashes on thesis-writer scale, the model branch dies and the plan reverts to GPT-4o.
- **Tool-call budget on Opus.** Extended thinking inflates per-step latency. `maxDuration: 480` is conservative; verify on real runs.
- **Inngest fan-out concurrency.** 6 analysts × ~6 candidates each = 36 concurrent thesis-writer runs on Sunday. Set `concurrency: 8` initially; raise if Sunday throughput is too slow.

### Data
- **Earnings transcript availability.** Finnhub may require upgraded tier. Fallback paths add ~1d each.
- **FMP segments endpoint.** Unknown if your plan supports it. See Decision 2.
- **SEC EDGAR rate limits.** 10 req/sec. The `get_peer_comparison` fan-out could push past on bursty runs — add retry/backoff in the helper.
- **Sonar burn.** New tools (transcripts fallback + analyst notes) × 6 candidates × 6 analysts × Sunday = 60-80 Sonar calls/Sunday. Verify against your monthly Sonar budget. Existing `intelligencePolicy.liveSearchBudget` is per-run; new tools should respect it OR have their own budgets.

### Behavior
- **Bear-case quality.** Mandating `bear_case[].min(2)` creates a new failure mode: model writes fluff bear cases to satisfy the count. Mitigation: per-bullet `min(40)` chars + citation requirement. Watch first-week outputs for vapor.
- **Citation gate false-rejects.** If validator misses an artifact ID format edge case, legitimate theses get blocked. Mitigation: rollout under `useResearchSchemaV2` flag, validate one analyst end-to-end before flipping all 6.
- **Step-budget inflation.** 18 steps per thesis-writer run is a guess. May need a bump to 25 once measured. The daily-run V2 design lifted maxSteps multiple times during rollout; same pattern likely here.

### Orchestration
- **Discovery fire-and-forget UX.** Discovery completes "successfully" with 0 thesis rows because the workers haven't finished yet. Need to make the parent run's UI clearly show "5 child runs spawned, 3 complete, 2 running." Without that the user thinks Discovery failed.
- **Daily wait-for timeout.** If thesis-writer takes >3min on a big ticker, daily run's `step.waitForEvent` times out. Daily then has to decide: retry, skip, or proceed on stale research with a warning. Pick a default before PR 3.4.
- **Tactical inline timeout.** Tactical's `maxDuration: 240` already; with an inline thesis-writer run that's another ~90s. May need to bump tactical to 360.

### Cost
- **Opus + extended thinking.** Per thesis-writer run: ~6 tool results (each ~1-2k tokens) + synthesis with 8k thinking budget. Estimate ~$0.30-0.80 per run on Opus 4.7. Sunday cron: ~36 runs × $0.50 = ~$18/Sunday + ad-hoc. Verify against monthly budget before committing to Opus.
- **GPT-4o fallback.** Same shape ~$0.05-0.15 per run. ~$3-6/Sunday. Significantly cheaper but lower quality on synthesis (Phase 0 spike confirms the trade-off).

### Scope creep
- **Valuation lane.** Listed optional in PR 1.1 schema. Full DCF valuation is out of scope; not Hindsight's edge.
- **TradingAgents-style multi-agent decomposition.** Tempting to split thesis-writer into N specialist sub-sub-agents (fundamentals analyst, technicals analyst, etc.). Explicitly out of scope — the multi-section schema + Opus synthesis achieves the same depth in one model call.

---

## 11. Success criteria

The plan is done when:

1. A thesis-writer run on $QCOM (or any name) contains:
   - 80+ word fundamentals summary with specific revenue/margin/segment figures, each cited
   - 80+ word technicals summary with specific levels, RSI, trend, cited
   - 80+ word catalyst summary naming a specific date or event, cited
   - 3+ bull-case bullets, each citing a specific data point
   - 2+ bear-case bullets, each citing a specific data point
2. Side-by-side comparison vs Google AI's stock summary on the same ticker shows comparable depth and specificity.
3. Every claim has a clickable citation chip in the UI traceable to a tool result.
4. **Phase 1 done:** "Write me a fresh thesis on $QCOM for Tech Momentum" in main chat produces a deep thesis end-to-end without manual intervention.
5. **Phase 2 done:** Sunday Discovery cron runs reliably for all 6 analysts, fanning out to thesis-writer per candidate, no premature termination.
6. **Phase 3 done:** Daily-run promote-to-active path refuses stale research, dispatches refresh, retries place_trade after refresh completes — verified end-to-end on one promotion.
7. **Phase 4 done:** Trigger fires on a stale-research thesis, tactical runs the inline refresh, acts on the result.
8. **Phase 5 done:** Thesis-writer prompts contain the research-journal block; one analyst's week-over-week pattern surfaces in the journal.
9. The daily run does NOT re-write thesis bodies — it patches fields when something material changes (verified by spot-check).

---

## Appendix A — External research synthesis

Full content of the research review conducted 2026-05-14. URLs and key claims preserved so future sessions don't need to re-research.

### A.1. FinRobot (ai4finance-foundation)

- **URL:** https://github.com/ai4finance-foundation/finrobot
- **What:** open-source multi-agent platform for financial applications. Apache-2.0, ~7k stars, v1.0.0 March 2026.
- **Architecture:** Perception → Brain → Action. Director Agent routes to 8 specialist agents per equity-research report (sections: investment thesis, risk assessment, valuation, etc.). Separate Market Analyst / Market Forecaster for prediction. Financial Chain-of-Thought agents for stepwise reasoning.
- **Data:** FMP, Finnhub, SEC EDGAR, yfinance, FinNLP, news APIs, optional Adanos retail sentiment.
- **Models:** GPT-4 (`gpt-4-0125-preview` in default config). Plug-and-play LLM but OpenAI-default.
- **License:** Apache-2.0. Python pip + local Flask UI on `127.0.0.1:8001`.
- **Worth stealing:** the section taxonomy (8 named subsections per thesis); the "Director routes to specialists" pattern as a single-LLM-with-sub-prompts approach.
- **Worth skipping:** the codebase wholesale (Python service, local web UI), the DCF/projection generator, the RL loop.

### A.2. FinRobot.ai (hosted)

- **URL:** https://finrobot.ai/login
- **What:** login wall with marketing copy claiming "AI-Powered Equity Research." No public detail.
- **Usable info:** none.

### A.3. TradingAgents (TauricResearch)

- **URLs:** https://tradingagents-ai.github.io/ + https://github.com/TauricResearch/TradingAgents
- **What:** multi-agent LLM trading framework. Apache-2.0, ~75.1k stars, v0.2.5 May 2026, arXiv 2412.20138.
- **Architecture (5-layer):** Analyst Team (4 parallel) → Researcher Team (Bull/Bear debate) → Trader → Risk Mgmt → Fund Manager.
- **Data:** historical prices, news, social sentiment (StockTwits, Reddit), insider transactions, financial reports, technical indicators. Alpha Vantage required by default.
- **Models:** explicit two-tier split — `deep_think_llm` + `quick_think_llm`. Supports OpenAI, Anthropic, Google, xAI, DeepSeek, Qwen, GLM, MiniMax, OpenRouter, Ollama, Azure.
- **Memory:** persists `~/.tradingagents/memory/trading_memory.md`. Injects recent same-ticker decisions + cross-ticker lessons into next decision.
- **License:** Apache-2.0, Python library + CLI.
- **Worth stealing:** bull/bear debate as the depth mechanism (highest-leverage idea); quick-think/deep-think model split; persistent decision journal; specialist analyst roles before synthesizer; risk-management gate before commit.
- **Worth skipping:** 5-team org-chart wholesale (cost bomb under Inngest billing + step budgets); Fund Manager layer (Hindsight's user is the FM); the project's performance claims as a methodology.

### A.4. StockHero

- **URL:** https://www.stockhero.ai/
- **What:** commercial AI trading bot. Marketplace of preset bots, integrates with Alpaca + others. Claims ~90% win rate on preset bots (cherry-picked).
- **Architecture / data / models:** not disclosed.
- **Worth stealing:** nothing on research-depth. Their value prop is the opposite of Hindsight's.
- **Useful signal:** confirms the obvious competitor offering is worse than what Hindsight already has reasoning-wise. Lean into auditable theses with citations.

### A.5. Claude for Financial Services

- **URL:** https://claude.com/solutions/financial-services
- **Anthropic positioning highlights:**
  - **Source attribution:** *"every number can be traced back to its source"*
  - Native Excel + PowerPoint integration
  - Agentic reasoning — advanced planning and agentic coding
  - "Claude leads on financial reasoning benchmarks"
- **Named customers + quotes:**
  - **Citadel:** *"Analysts are using it to build and update coverage models, separate signal from noise, and pressure-test their work."*
  - FIS: AML investigations from days to minutes
  - Others: BNY Mellon, Carlyle, Mizuho, Travelers, Walleye Capital, Citi, RBC, Brex
- **Models named:** Claude Opus 4.6 powers Claude for Excel for complex financial modeling.
- **Data partnerships:** LSEG, FactSet, S&P Global, Morningstar, Dun & Bradstreet, PitchBook, Moody's via MCP servers.
- **Worth stealing:** source attribution as a hard requirement (every bullet cites a source); "pressure-test their work" as the canonical industry voice for the bear case; templates as the deployment unit.

### A.6. Alpaca on AI agents

- **URL:** https://alpaca.markets/learn/how-traders-are-using-ai-agents-to-create-trading-bots-with-alpaca
- **What:** Alpaca's blog post on community AI-agent patterns.
- **Architecture described:** conversational vs autonomous. Generic "analysis → decision → trade." No diagrams.
- **Frameworks mentioned:** ChatGPT, Claude, AutoGPT, BabyAGI, Zapier Agents, MCP, TAAPI.
- **Risk controls recommended:** explicit trade confirmations, limit orders, position size caps, paper trading first, monitor behavior, test every command.
- **Real examples:** Zapier (ChatGPT + RSS), Corbin Brown (no-code), Creator Magic (TAAPI + ChatGPT), `tedlikeskix/alpaca-mcp-server` (Claude → Alpaca MCP bridge).
- **Worth stealing:** MCP server as the bridge pattern (future state); risk-control checklist.
- **Worth skipping:** the article's framework set (AutoGPT/BabyAGI is outdated, RSS-feed-as-data is much thinner than Hindsight's pipeline).

### A.7. Synthesis — convergent best-practice pattern

1. **Decompose research into named lanes before synthesizing** (FinRobot 8 agents · TradingAgents 4 analysts · Citadel "coverage models")
2. **Pressure-test the bull case with a bear case** (TradingAgents debate · Citadel "pressure-test")
3. **Every claim must cite a source** (Anthropic positioning · FinRobot SEC wiring)
4. **Two-tier model split** (TradingAgents `deep_think_llm` + `quick_think_llm` · Anthropic Opus for complex modeling)
5. **Persistent cross-ticker memory feeds next decision** (TradingAgents `trading_memory.md`)
6. **A risk-management step that runs after research but before execution** (TradingAgents Risk Mgmt team · Alpaca's #1 recommendation)

### A.8. Where they disagree

- **Number of agents:** FinRobot 8 · TradingAgents 5 teams · Alpaca 1. Right answer for Hindsight: 1 worker agent with strict multi-section schema, not literally N worker calls.
- **RL / fine-tuning:** FinRobot bundles RL · TradingAgents is pure prompt-engineering. Skip RL.
- **Debate as separate roles vs structured prompt:** TradingAgents runs two LLM personas · Anthropic's framing doesn't require two personas. Cheaper and equally effective: one model prompted to write bull then bear as separate sections.
- **Data breadth:** FinRobot pulls fundamentals deep (DCF, 3-yr projections) · TradingAgents broader (social, insider, sentiment). Hindsight closer to TradingAgents shape; the depth gap is a prompt + tool problem, not a data-breadth problem.

### A.9. The single highest-leverage change

Rewrite `record_thesis` to require a multi-section response (fundamentals, technicals, catalyst, bull case, bear case), with mandatory per-bullet source citations, run after per-lane research. That alone closes most of the gap with Google AI's depth.

PR 1.1 + PR 1.7 in this plan implement that change. Everything else is amplification.

---

## Appendix B — Industry pattern: orchestrator-worker

The architecture pattern this plan uses is well-documented across the agent-systems ecosystem. Names vary but the shape is identical.

| System | Pattern name | Orchestrator | Worker |
|---|---|---|---|
| Claude Code | Sub-agents (`Agent` tool) | Main conversation | general-purpose, Explore, Plan agents |
| Cursor compose | Sub-routines | The user's compose prompt | Codebase semantic search, file-edit application |
| Devin | Plan/execute | Planner agent | Browser-use sub-agent, terminal sub-agent |
| Anthropic deep-research | Tool-as-agent | User chat with Claude | Long-running research worker |
| LangGraph | Supervisor with specialists | Supervisor node | Worker nodes |
| CrewAI | Crew with agents | Crew manager | Crew member agents |
| AutoGen | Group chat with manager | Group manager | Member agents |
| OpenAI Assistants | Assistant + tools | Outer assistant | Function-call sub-routines |

**Why every system converges here:** monolithic agents doing everything in one loop hit a complexity wall fast. Decomposition into orchestrator + workers gives:
- Bounded context per agent (no context pollution between sub-tasks)
- Reusability (one worker, many orchestrators)
- Independent improvement (tune the worker's prompt without touching orchestrators)
- Parallelizability (fan-out workers)
- Testability in isolation (validate the worker before wiring it in)

Hindsight's `MODES` registry is already built for this. Adding `thesis-writer` is one entry. The novelty in this plan isn't the pattern — it's applying the pattern to thesis writing specifically, which is the highest-leverage sub-task in the system.

---

## See also

- [`docs/VISION.md`](../../VISION.md) — Pillar 2 (Thesis quality), the success bar
- [`docs/THESIS_ARCHITECTURE.md`](../../THESIS_ARCHITECTURE.md) — live thesis-system reference; this plan is additive
- [`docs/PRINCIPLES.md`](../../PRINCIPLES.md) — three-layer principle; every PR is mapped to its correct layer
- [`docs/plans/MORNING_RUN_V2_DESIGN.md`](./MORNING_RUN_V2_DESIGN.md) — sibling plan that rewrote the daily-run prompt; same layering, applied to a different surface
- [`docs/GAPS.md`](../../GAPS.md) — open punch list; this plan addresses the "thesis quality" gap directly
