# Hindsight — Thesis Research V2 (RAG architecture)

> **Status (as of 2026-05-14):** Proposed. Not yet implemented.
>
> **Supersedes:** [`THESIS_RESEARCH_V2_OUTDATED.md`](./THESIS_RESEARCH_V2_OUTDATED.md)
> — that doc had a 10-week build path that this doc collapses to ~1 week
> by using a RAG (retrieval-augmented generation) pattern instead of building
> 5 specialist tools + a multi-section schema + per-claim citation gates.
> Keep the OUTDATED doc as the V2.5 fallback if RAG quality is insufficient.
>
> **What this is:** the plan to lift thesis-research depth from one-paragraph
> vibes to multi-paragraph, source-cited, structured equity-research notes
> on the depth of Google AI's stock summaries. Built around a two-layer
> architecture: data-layer tools that pull structured facts from your
> existing APIs, and a synthesis-layer meta-tool that hands all of that
> data to a deep-research model (Sonar / Claude / Gemini) which writes the
> thesis with bull/bear cases and citations.
>
> **The build path:** Phase 1 is a 2-day MVP — the meta-tool + the
> `thesis-writer` agent mode + invocation from Principal Chat. Phases 2-5
> wire it into Discovery, Daily promote-to-active, Tactical, and the
> research journal. Total: ~1 week to fully wired.
>
> **Owner:** principal. **Audience:** future sessions picking this up cold.
>
> **Related docs:**
> - [`docs/VISION.md`](../VISION.md) — Pillar 2 (Thesis quality) is the success bar
> - [`docs/THESIS_ARCHITECTURE.md`](../THESIS_ARCHITECTURE.md) — the live thesis system reference; this plan is additive
> - [`docs/PRINCIPLES.md`](../PRINCIPLES.md) — three-layer principle; every rule maps to its correct layer
> - [`docs/plans/THESIS_RESEARCH_V2_OUTDATED.md`](./THESIS_RESEARCH_V2_OUTDATED.md) — the original 10-week plan, kept as V2.5 fallback if RAG quality falls short
> - [`docs/plans/MORNING_RUN_V2_DESIGN.md`](./MORNING_RUN_V2_DESIGN.md) — sibling plan that rewrote the daily-run prompt

---

## 0. Status table

| Phase | Title | Calendar | Status |
|---|---|---|---|
| **0** | Bake-off — pick the deep-research model | 0.5 day | Not started |
| **1** | Data tools + meta-tool + `thesis-writer` mode + Principal Chat invocation | 2 days | Not started |
| **2** | Discovery integration (fan-out) | 1 day | Not started |
| **3** | Daily run promote-to-active staleness gate | 1 day | Not started |
| **4** | Tactical inline invocation | 1 day | Not started |
| **5** | Research journal (cross-run memory) | 3 days | Not started |

**Total:** ~1 calendar week to fully wired. Phase 1 alone (2 days) is enough to validate via main chat.

---

## 1. The core insight

A thesis is **not** "let an LLM go figure it all out." A thesis is:

1. **Pull structured facts** from your trusted APIs — financials, earnings beats, analyst ratings, insider transactions, peer set, recent filings, recent news. Real numbers, real dates, real names.
2. **Hand all of that to a research-grounded model** (Sonar deep research / Claude with web_search / Gemini with Google Search grounding) as context: "here's the data, write a thesis."
3. **The model fills narrative gaps via web search** — recent analyst commentary, earnings-call transcript highlights, market sentiment narrative, M&A rumors — but uses the structured data as ground truth for any number, date, or name.
4. **Out comes a multi-section thesis** with citations to both the structured pulls and the web sources.

This is **retrieval-augmented generation** for theses. It's how every production financial AI system actually works. You don't ask the LLM to "find Ford's revenue" — you pull revenue from FMP, hand it over, say "use this revenue, write the section."

The previous V2 plan ([OUTDATED doc](./THESIS_RESEARCH_V2_OUTDATED.md)) tried to build 5 specialist tools and a multi-section schema with per-claim Layer-1 citation gates. That's the right shape for a fully-audited V2.5. For V2, RAG with a single meta-tool is much cheaper and ships in a week.

---

## 2. The two-layer architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                        DATA LAYER                                  │
│  Individual tools, callable from anywhere (chat, daily run, etc.)  │
│                                                                    │
│   get_financials_deep    ── 5yr FMP financials + estimates         │
│   get_analyst_coverage   ── FMP grades-historical + targets        │
│   get_insider_activity   ── SEC Form 4 90d rollup                  │
│   get_earnings_history   ── 8q beats/misses                        │
│   get_peers_with_metrics ── Finnhub peers + parallel snapshot      │
│   [existing] get_stock_data, get_sec_filings, read_artifact,       │
│              web_search, get_market_context                        │
│                                                                    │
│  Each returns structured data. None persist directly.              │
└───────────────────────────────────────────────────────────────────┘
                            │
                            │ called in parallel by ↓
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│                      SYNTHESIS LAYER                               │
│                                                                    │
│   write_thesis_research(ticker, analyst_context, mode)            │
│     1. Parallel-fetches all data-layer tools (~5-10s)              │
│     2. Formats results into structured data block                  │
│     3. Sends to deep-research model with synthesis prompt          │
│        (Sonar deep research / Claude w/ web_search / Gemini)       │
│     4. Returns: { sections[], citations[], rawDataBlock }          │
└───────────────────────────────────────────────────────────────────┘
                            │
                            │ called by ↓
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│                       AGENT LAYER                                  │
│                                                                    │
│   thesis-writer mode (new MODES entry)                             │
│   Allowlist: write_thesis_research, record_thesis,                 │
│              update_thesis, complete_run                           │
│                                                                    │
│   Workflow:                                                        │
│     1. Call write_thesis_research                                  │
│     2. Decide direction / horizon / target / stop / confidence    │
│     3. record_thesis or update_thesis (with researchData persisted)│
│     4. complete_run                                                │
│                                                                    │
│   ~3-4 tool calls. ~60-120 seconds wall time per thesis.           │
└───────────────────────────────────────────────────────────────────┘
                            │
                            │ invoked from ↓
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATION LAYER                             │
│                                                                    │
│   dispatch_thesis_research(ticker, analyst_id, mode, reason)      │
│   ── Available in: Discovery, Daily, Tactical, Principal Chat     │
│   ── Inserts child ResearchRun(parentRunId=ctx.runId)             │
│   ── Fires Inngest event app/thesis.write.requested               │
│   ── Returns childRunId immediately                                │
│                                                                    │
│   Per-orchestrator pattern:                                        │
│     Discovery       → fire-and-forget, fan out N candidates       │
│     Daily promote   → dispatch + Inngest step.waitForEvent        │
│     Tactical        → inline call (no event roundtrip)            │
│     Principal Chat  → dispatch + wait + stream                     │
└───────────────────────────────────────────────────────────────────┘
```

---

## 3. The data layer — what each tool returns and persists

Each tool follows the existing [`defineTool()`](../../lib/agent/define-tool.ts) pattern. None persist data on their own — they return it; whoever called them decides what to do.

### 3.1. `get_financials_deep`

**Source:** FMP `/income-statement`, `/key-metrics`, `/analyst-estimates`

**Returns:**
```ts
{
  ticker, currency,
  annual: {
    period: string;          // "2025-12-31"
    revenue: number;
    revenueGrowth: number;   // YoY
    grossProfit: number;
    grossMargin: number;
    ebitda: number;
    ebitdaMargin: number;
    netIncome: number;
    netMargin: number;
    dilutedEps: number;
    epsGrowth: number;
    operatingCashFlow: number;
    capex: number;
    freeCashFlow: number;
  }[];                       // last 5 years
  forwardEstimates: {
    period: string;          // "2026-12-31"
    revenue: number;
    revenueGrowth: number;
    eps: number;
    epsGrowth: number;
  }[];                       // next 2 years (analyst-aggregated)
  ratios: {
    pe: number | null; pegRatio: number | null;
    debtToEquity: number; currentRatio: number;
    roa: number; roe: number; roic: number;
  };
  source: "FMP";
}
```

**Risk:** FMP-tier dependent for some fields. `/analyst-estimates` may return empty for small-caps.

### 3.2. `get_analyst_coverage`

**Source:** FMP `/v4/price-target-consensus`, `/grades-historical`, `/upgrades-downgrades`

**Returns:**
```ts
{
  ticker,
  consensus: {
    rating: "BUY" | "HOLD" | "SELL" | "MIXED";
    bullish: number;
    neutral: number;
    bearish: number;
    totalAnalysts: number;
  };
  priceTargets: {
    low: number; average: number; median: number; high: number;
    currentPrice: number;
    impliedUpside: number;     // (avg - current) / current
  };
  recentActions: {
    date: string;              // "2026-05-13"
    firm: string;              // "Morgan Stanley"
    analyst: string | null;    // "Andrew Percoco"
    action: "INITIATED" | "UPGRADED" | "DOWNGRADED" | "MAINTAINED" | "REITERATED";
    ratingFrom: string | null;
    ratingTo: string;
    priceTargetFrom: number | null;
    priceTargetTo: number;
  }[];                          // last 30 days, sorted desc
  source: "FMP";
}
```

This is the data behind the firm-by-firm analyst table in the Ford screenshots' Analysis tab.

### 3.3. `get_insider_activity`

**Source:** SEC EDGAR Form 4 (free; existing wrapper handles EDGAR auth)

**Returns:**
```ts
{
  ticker, windowDays,
  netDirection: "BUYING" | "SELLING" | "MIXED" | "FLAT";
  netValue: number;            // negative = net selling
  totalTxns: number;
  topInsiders: {
    name: string;
    role: string;              // "CEO" / "CFO" / "Director" / "10% Owner"
    netValue: number;
    netShares: number;
    pctOfHoldings: number;
    txnCount: number;
  }[];
  recentTxns: {
    date: string;
    insider: string;
    role: string;
    side: "BUY" | "SELL";
    shares: number;
    avgPrice: number;
    value: number;
    formType: "Form 4";
  }[];                          // last 90 days
  patternVs6Mo: "ACCELERATING_SELL" | "ACCELERATING_BUY" | "NORMAL_FOR_TICKER";
  source: "SEC EDGAR";
}
```

### 3.4. `get_earnings_history`

**Source:** FMP `/historical/earning_calendar`

**Returns:**
```ts
{
  ticker,
  history: {
    quarter: string;           // "Q1 2026"
    reportedAt: string;        // "2026-04-29"
    revenue: { actual, estimate, surprisePercent };
    eps: { actual, estimate, surprisePercent };
    outcome: "BEAT" | "MISS" | "INLINE";
  }[];                          // last 8 quarters
  beatRate: number;             // % of last 8 that beat consensus
  source: "FMP";
}
```

### 3.5. `get_peers_with_metrics`

**Source:** Finnhub `/stock/peers` + parallel fan-out to existing `get_stock_data`

**Returns:**
```ts
{
  ticker,
  peers: string[];              // 4-6 ticker symbols
  comparison: {
    ticker: string;
    marketCap: number;
    peRatio: number | null;
    revenueGrowthYoY: number | null;
    ytdReturn: number;
    rsi14: number | null;
    leaderScore: number;        // server-computed 0-100 composite
  }[];
  rankings: {
    byGrowth: string[];         // tickers sorted desc
    byYtd: string[];
    byComposite: string[];
  };
  targetTickerRank: {
    growth: number;             // e.g. 2 of 5
    ytd: number;
    composite: number;
  };
  source: "Finnhub";
}
```

### 3.6. Existing tools the thesis-writer also uses

- `get_stock_data` — quote + technicals + 7-day news (already in catalog)
- `get_market_context` — SPY/VIX/sector context (already in catalog)
- `get_sec_filings` — recent 10-K/10-Q/8-K (already in catalog)
- `read_artifact` — for fetching full text behind any signal/news (already in catalog)
- `web_search` — Sonar (already in catalog) — only used as a fallback when the deep-research model needs a specific niche query

---

## 4. The synthesis layer — `write_thesis_research`

The meta-tool. Single tool call from the thesis-writer agent's perspective.

### 4.1. Tool spec

```ts
// lib/agent/tools/write-thesis-research.ts
export const writeThesisResearch = defineTool({
  description:
    "Generate a complete deep-research thesis on one ticker. Pulls " +
    "structured data from Finnhub/FMP/SEC EDGAR in parallel, then " +
    "synthesizes via a deep-research model (Sonar deep research / " +
    "Claude with web_search / Gemini with Google grounding). Returns " +
    "a structured multi-section thesis with citations to both " +
    "structured data and web sources. Use ONCE per thesis-write call — " +
    "this is the meta-tool that does the entire data-pull + synthesis " +
    "pipeline.",
  schema: z.object({
    ticker: z.string(),
    analyst_context: z.string().min(50)
      .describe("The analyst's strategy in 2-3 sentences so synthesis is framed."),
    mode: z.enum(["mint", "refresh"]),
    existing_thesis_summary: z.string().optional()
      .describe("Required when mode='refresh' — what the current thesis says."),
  }),
  ui: "tool-ui" as const,
  groupId: "thesis-research",
  progressLabel: ({ ticker }) => `Researching $${ticker} deep`,

  execute: async ({ ticker, analyst_context, mode, existing_thesis_summary }, ctx) => {
    // Phase 1: parallel structured data pulls
    const [
      stockData, financials, analystCov, insider,
      earningsHist, peers, filings,
    ] = await Promise.all([
      fetchStockDataDirect(ticker),
      fetchFinancialsDeep(ticker),
      fetchAnalystCoverage(ticker),
      fetchInsiderActivity(ticker, 90),
      fetchEarningsHistory(ticker, 8),
      fetchPeersWithMetrics(ticker),
      fetchSecFilings(ticker, ['10-K', '10-Q', '8-K'], 5),
    ]);

    // Phase 2: format the data block
    const dataBlock = formatStructuredDataBlock({
      ticker, stockData, financials, analystCov, insider,
      earningsHist, peers, filings,
    });

    // Phase 3: synthesis prompt + deep-research model call
    const prompt = buildSynthesisPrompt({
      ticker, analyst_context, mode, existing_thesis_summary, dataBlock,
    });
    const research = await callDeepResearchModel(prompt);
    // ↑ returns { text, citations[] }

    // Phase 4: parse into sections
    const sections = parseIntoSections(research.text);

    return {
      summary: `Deep thesis research for $${ticker}`,
      data: {
        sections,                  // structured: fundamentals/technicals/...
        citations: research.citations,
        rawDataBlock: dataBlock,   // saved on Thesis.researchData
      },
      sources: research.citations.map((c) => ({
        provider: c.domain ?? "structured",
        title: c.title,
        url: c.url,
      })),
    };
  },
});
```

### 4.2. The data block format

`formatStructuredDataBlock()` produces a markdown string the model reads as ground truth. Approximately:

```markdown
═══════════════════════════════════════════════════════════════════
STRUCTURED DATA: $F (Ford Motor Company)
Pulled 2026-05-14 16:30 ET — use these as ground truth.
═══════════════════════════════════════════════════════════════════

## Snapshot
Current: $14.47 (+6.63%) · Day range: $13.63-$14.94
52w range: $9.88-$14.94 · Market cap: $56.6B
Volume: 178M (2.0x 20d avg) · RSI(14): 72 · Beta: 1.46

## Financials, Annual ($M)
              2022     2023     2024     2025  2026e  2027e
Revenue     158,057  176,191  184,992  187,267 172,311 177,146
% Growth        —      11.5%    5.0%     1.2%   -8.0%   2.8%
Gross Profit 23,660   25,641   26,558   12,801  21,982  24,801
% Margin      15.0%    14.6%    14.4%     6.8%   12.8%   14.0%
EBITDA       13,918   13,148   12,786   -1,335  12,649  13,933
Net Income   -2,152    4,329    5,894   -8,162   3,536   7,119
Diluted EPS  -0.49     1.08     1.46    -1.94    0.55    1.76
FCF             -13    6,682    6,739   12,467   4,969   6,462

## Last 8 Earnings
Q1 2026 (2026-04-29): Rev $43.3B vs $42.7B est | EPS $0.63 vs $0.20 est — BEAT
Q4 2025 (2026-02-04): ... etc.
Beat rate: 6/8 (75%)

## Analyst Coverage
Consensus: HOLD · 13 analysts (1 Bearish / 9 Neutral / 3 Bullish)
Targets: Low $10 · Avg $13.29 · Median $13 · High $16
Implied upside: -8.2%

Recent 30d actions:
  2026-05-13 — Morgan Stanley (Andrew Percoco) — MAINTAINED Equal-Weight, PT $14
  2026-05-04 — Citigroup (Michael Ward) — MAINTAINED Neutral, PT $13 (from $13.50)
  2026-05-01 — TD Cowen (Itay Michaeli) — MAINTAINED Hold, PT $13 (from $14)
  2026-04-30 — UBS (Joseph Spak) — UPGRADED to Buy, PT $14 (from $15)
  ... etc.

## Insider Activity, 90d
Net direction: NET BUYING (+$2.3M, uncommon for $F)
Notable: 2026-04-22 — James Farley (CEO) — BUY 50,000 @ $11.85
[etc]

## Peers
GM, STLA, RACE, TSLA, RIVN
| Ticker | MktCap  | P/E   | RevGrowth | YTD   | RSI |
| GM     | $48.2B  | 5.4   | -2.1%     | -8.4% | 51  |
| STLA   | $42.7B  | 4.1   | -3.5%     | -12%  | 47  |
| F      | $56.6B  | -     | 1.2%      | +18%  | 72  |  ← target
| RACE   | $98.4B  | 47.1  | 8.4%      | +12%  | 64  |
| TSLA   | $824B   | 75.2  | 18.4%     | +24%  | 68  |
$F ranks 3 of 5 by growth, 2 of 5 by YTD return.

## Recent SEC Filings
2026-05-02 — 10-Q (Q1 2026)
2026-04-29 — 8-K (Q1 earnings release)
[etc]

## Recent News, 7d
2026-05-14 — "Ford soars on energy storage pivot" — CNBC
2026-05-13 — "Ford Energy could be worth $10B per Morgan Stanley" — Bloomberg
[top 10]

## Stock Description
Ford Motor Company (NYSE: F) is an American multinational automaker
founded in 1903 by Henry Ford and headquartered in Dearborn, Michigan.
Sector: Consumer Cyclical · Industry: Auto - Manufacturers
```

This is ~3-5k tokens. Goes in the model's prompt.

### 4.3. The synthesis prompt

```
You are writing an equity research thesis for $TICKER on behalf of:
{analyst_context}

═══════════════════════════════════════════════════════════════════
GROUND-TRUTH DATA — use these numbers; do not invent or contradict.
═══════════════════════════════════════════════════════════════════

{dataBlock}

═══════════════════════════════════════════════════════════════════
YOUR JOB
═══════════════════════════════════════════════════════════════════

1. Use the structured data above as ground truth for any financial
   figures, dates, ratings, transcript metadata, insider transactions,
   peer comparisons, and consensus.

2. Use web research to fill narrative gaps the structured data doesn't
   cover:
   - Earnings call transcript highlights (top 5 with specific quotes
     when available)
   - Recent (last 14 days) analyst commentary and rationale beyond
     the rating actions table
   - Specific dated catalysts in the next 1-3 months
   - Sentiment narrative and recent news context

3. Synthesize into this exact structure, citing every claim:

   ## Snapshot (1 paragraph)
   ## Recent Catalysts (1 paragraph)
   ## Fundamentals (1 paragraph + segment breakdown if relevant)
   ## Latest Earnings (5 specific bullets)
   ## Catalysts & Events (3-5 dated bullets)
   ## Bull Case (3-5 cited claims)
   ## Bear Case (3-5 cited claims — MANDATORY even on a LONG thesis)
   ## Analyst Consensus Synthesis (1 paragraph)
   ## Insider & Technical Setup (1 paragraph)

═══════════════════════════════════════════════════════════════════
CITATION FORMAT
═══════════════════════════════════════════════════════════════════
- Structured-data claims: [STRUCTURED:financials_2025] or
  [STRUCTURED:rating_2026-05-13_morgan_stanley]
- Web claims: [WEB:<url>]

═══════════════════════════════════════════════════════════════════
QUALITY BAR
═══════════════════════════════════════════════════════════════════
- Every paragraph contains specific numbers, dates, or names.
- "Recently" without a date is forbidden.
- "Strong fundamentals" without a metric is forbidden.
- Bear case is MANDATORY even on LONG. Adversarial.
- Match the depth of a Goldman Sachs initiation note, not a Reddit post.
```

### 4.4. Section parser

`parseIntoSections()` extracts each `## SectionName` block into a structured object:
```ts
{
  snapshot: { text, citations },
  recentCatalysts: { text, citations },
  fundamentals: { text, citations },
  latestEarnings: { bullets: [{ text, citation }, ...] },
  catalystsAndEvents: { bullets: [...] },
  bullCase: { bullets: [...] },
  bearCase: { bullets: [...] },
  analystConsensusSynthesis: { text, citations },
  insiderTechnicalSetup: { text, citations },
}
```

This lands on `Thesis.researchSections` JSONB. The thesis-card UI renders each section as a tab or expandable accordion.

---

## 5. The agent layer — `thesis-writer` mode

### 5.1. Mode entry in [`lib/agent/modes.ts`](../../lib/agent/modes.ts)

```ts
"thesis-writer": {
  model: "claude-sonnet-4-6",       // bake-off determines final choice
  provider: "anthropic",
  thinkingBudget: 4000,              // optional extended thinking
  maxSteps: 8,                       // very bounded — 3-4 calls expected
  toolAllowlist: [
    "write_thesis_research",
    "record_thesis",
    "update_thesis",
    "complete_run",
    // For edge cases — agent rarely needs these:
    "get_stock_data",
    "web_search",
  ],
  hasSuggestConfig: false,
  maxDuration: 300,                  // 5 min — meta-tool can take 60-90s
},
```

The allowlist is intentionally narrow. The meta-tool does ~95% of the work; the agent is just there to add direction/horizon/target/stop/confidence on top of the synthesis.

### 5.2. Prompt shape

```
You are {analystName}, writing one thesis on $TICKER.
{analystPrompt}

Mode: {mint | refresh existing thesis {id}}
Why dispatched: {reason}

Your job:
  1. Call write_thesis_research(ticker, analyst_context, mode).
     This does the deep work — data pulls, web research, synthesis.
     ONE call. Wait for it.
  2. Read the returned research carefully. Specifically:
     - Bull case substantive?
     - Bear case substantive?
     - Catalysts dated?
     - Numbers cited?
  3. Decide:
     - direction: LONG / SHORT / PASS
     - horizon: CATALYST / TRADE / TARGET / COMPOUNDER
     - entry_price (current quote from the research data)
     - target_price (real chart level — breakout / consolidation high)
     - stop_loss (real chart level — support / R:R ≥ 2:1)
     - confidence_score (0-100, ≥ minConfidence for ACTIVE)
     - core_belief, key_assumptions, invalidation_conditions
       (one sentence each, falsifiable, derived from the research)
  4. Call record_thesis (mint) or update_thesis (refresh). Pass:
     - All the decision fields above
     - researchData: the rawDataBlock from write_thesis_research
     - researchSections: the parsed sections
     - source_kind / source_signal_ids / source_rationale
  5. complete_run.

Quality bar:
  - The thesis-card user opens it; it should read like a real
    equity-research note, not a Reddit post.
  - Bear case must be substantive even on LONG.
  - Every belief field must trace back to something in the research.
```

Layer-3 discipline: short prompt, the tool gates do the heavy lifting.

### 5.3. Execution function

`lib/agent/run-thesis-writer.ts` — same shape as `runDailyResearchAgent()` in [`lib/inngest/functions/morning-research.ts`](../../lib/inngest/functions/morning-research.ts). Loads context, builds prompt, calls AI SDK `generateText` with the configured model + tool allowlist, persists tool calls + final thesis. Streams events on the existing SSE channel keyed by runId.

---

## 6. The orchestration layer — `dispatch_thesis_research`

The tool that orchestrators call to invoke the worker. Same as the OUTDATED doc's design — that part was right. Recap:

```ts
// lib/agent/tools/dispatch-thesis-research.ts
export const dispatchThesisResearch = defineTool({
  description:
    "Dispatch a thesis-writer sub-agent to write or refresh a thesis " +
    "for one ticker. Returns immediately with a child run ID; the " +
    "research happens asynchronously in its own agent loop.",
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
      data: { childRunId: childRun.id, estimatedDurationMs: 90_000 },
      sources: [],
    };
  },
});
```

### 6.1. Per-orchestrator invocation pattern

| Orchestrator | Pattern | Why |
|---|---|---|
| **Discovery** | Fan-out fire-and-forget | 5-8 candidates per analyst; each child becomes a first-class run row. Parallel via Inngest `concurrency: 5`. |
| **Daily promote-to-active** | Dispatch + Inngest `step.waitForEvent` (timeout 3m) | Single thesis refresh; daily run blocks until done, then retries `place_trade`. |
| **Tactical** | Inline `runThesisWriterAgent()` call | One trigger, one thesis. Skip event roundtrip for latency. |
| **Principal Chat** | Dispatch + wait + stream | User invocation. SSE-stream the worker's progress to chat. |

### 6.2. Inngest function

`lib/inngest/functions/thesis-writer.ts` listens for `app/thesis.write.requested`, calls `runThesisWriterAgent()`, marks ResearchRun status, emits `app/thesis.written` for waiters. Same shape as existing Inngest functions. ~50 lines.

---

## 7. Schema additions

```prisma
model Thesis {
  // ... existing fields
  researchData      Json?    // the structured data block (~3-5KB)
  researchSections  Json?    // the parsed multi-section synthesis
  researchUpdatedAt DateTime?
}

model ResearchRun {
  // ... existing fields
  parentRunId   String?
  parentRun     ResearchRun?  @relation("RunHierarchy", fields: [parentRunId], references: [id])
  childRuns     ResearchRun[] @relation("RunHierarchy")
  @@index([parentRunId])
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

Three nullable additions to `Thesis`. One nullable column + one self-relation on `ResearchRun`. One enum value each to `ResearchRunMode` and `ThesisUpdateType`. All additive — no existing rows or queries break.

---

## 8. The phases

### Phase 0 — Bake-off (0.5 day)

**Goal:** pick the deep-research model.

Test 5 candidates on $F (Ford), $QCOM, $MU using the synthesis prompt from §4.3 with a hand-built data block:

| Candidate | Cost/thesis | Latency | Notes |
|---|---|---|---|
| Perplexity `sonar-deep-research` | ~$0.50-1.50 | 60-90s | Native deep research mode. Citation-heavy. Already wired via `lib/intelligence/sonar.ts`. |
| Claude Sonnet 4.6 + native `web_search` tool | ~$1-3 | 90-180s | Anthropic SDK. Good synthesis. |
| Claude Opus 4.7 + `web_search` + extended thinking | ~$3-8 | 120-240s | Top-of-line synthesis. |
| OpenAI GPT-5 / o3 + web search | ~$2-5 | 90-180s | OpenAI's deep research path. |
| Gemini 2.5 Pro + Google Search grounding | ~$0.50-1.50 | 60-120s | Google's index — probably what Google AI's stock pages use. |

Score each output (1-5) on: fundamentals specificity, earnings detail, bull substance, bear substance, analyst consensus depth, citation quality, hallucination rate, latency, cost, depth match to Ford screenshots. Total /50. Pick winner.

Validation: >35/50 = ship it. <35 = either tune the prompt or fall back to OUTDATED V2.5 plan with structured tools + per-claim citation gates.

### Phase 1 — Data tools + meta-tool + thesis-writer mode + chat invocation (2 days)

| PR | Title | Effort |
|---|---|---|
| 1.1 | 5 data tools (financials_deep, analyst_coverage, insider_activity, earnings_history, peers_with_metrics) | 1d (parallelizable) |
| 1.2 | `write_thesis_research` meta-tool + data-block formatter + synthesis prompt + section parser | 0.5d |
| 1.3 | `thesis-writer` mode entry + `runThesisWriterAgent()` exec function + Inngest `thesis-writer.ts` listener | 0.5d |
| 1.4 | `parentRunId` migration + `Thesis.researchData/researchSections/researchUpdatedAt` columns | 0.25d |
| 1.5 | `dispatch_thesis_research` tool + add to Principal Chat allowlist + 5-line prompt addition | 0.25d |
| 1.6 | Parent/child run rendering in `/runs/[id]` (basic — child run rows show under parent) | 0.5d |

**Phase 1 success criteria:**
1. Type "Write me a fresh thesis on $F for Tech Momentum" in `/chat`
2. Principal Chat dispatches thesis-writer; user sees the child run streaming
3. Worker calls `write_thesis_research` (one tool call, ~60-90s); user sees the data pulls + synthesis happen
4. Worker calls `record_thesis` with the structured research; thesis card appears
5. Side-by-side vs Google AI / Perplexity Ford output: depth comparable on at least 4 of 5 dimensions
6. Every claim is clickable to its source via citation chip in the card

### Phase 2 — Discovery integration (1 day)

| PR | Title | Effort |
|---|---|---|
| 2.1 | Discovery prompt rewrite — replace per-candidate `record_thesis` with `dispatch_thesis_research` fan-out | 0.5d |
| 2.2 | `dispatch_thesis_research` allowlisted in discovery mode | 0.25d |
| 2.3 | One Sunday cron end-to-end test on one analyst, then roll out | 0.25d |

Discovery prompt collapses to ~80 lines:
```
Step 1 — Read discovery surfaces (read_signals, get_market_movers, get_earnings_calendar)
Step 2 — Cross-analyst overlap check per candidate (get_theses)
Step 3 — Dispatch thesis-writer per candidate (parallel fan-out)
Step 4 — record_run_summary listing dispatched theses
Step 5 — complete_run
```

Inngest `concurrency: 5` on the thesis-writer function caps parallel API hits. 6 analysts × 5 candidates each = 30 dispatches; runs over ~10-20 minutes wall time on Sundays.

### Phase 3 — Daily run promote-to-active staleness gate (1 day)

| PR | Title | Effort |
|---|---|---|
| 3.1 | `place_trade` Layer-1 gate refuses if `researchUpdatedAt` >7 days AND no refresh dispatched this run | 0.5d |
| 3.2 | `dispatch_thesis_research` allowlisted in research-run mode | 0.25d |
| 3.3 | Inngest `step.waitForEvent` integration in daily-run for refresh waiting | 0.25d |

The agent learns from rejection. Daily prompt only needs ~2 sentences explaining the pattern; the gate's rejection message does the rest.

### Phase 4 — Tactical inline invocation (1 day)

| PR | Title | Effort |
|---|---|---|
| 4.1 | Tactical run inline-calls `runThesisWriterAgent()` (no event roundtrip) when thesis stale | 0.5d |
| 4.2 | Trigger evaluator: skip refresh if `researchUpdatedAt` <24h ago | 0.25d |
| 4.3 | Tactical prompt addition (~3 sentences) | 0.25d |

### Phase 5 — Research journal (3 days, optional)

Cross-run memory pattern. Same as the OUTDATED doc's Phase 5 — `ResearchJournal` Prisma model, weekly Sunday rollup cron synthesizing past `Position.agentEvaluation` post-mortems, prompt-block injection into thesis-writer.

Optional because the V1 thesis quality may already be good enough without it.

---

## 9. Decisions needed before Phase 1

### Decision 1 — Run the bake-off or commit blind?

- **Run bake-off (recommended):** half-day cost. Resolves the model choice cheaply.
- **Commit blind:** start Phase 1 with Sonar deep research assumed. Slightly higher rework risk if Sonar quality is insufficient.

### Decision 2 — FMP plan capabilities

Quick verification needed for:
- `/income-statement` 5-year history → required for `get_financials_deep`
- `/key-metrics` history → required for ratios
- `/analyst-estimates` → required for forward estimates
- `/grades-historical` → required for `get_analyst_coverage` rating actions table
- `/historical/earning_calendar` → required for `get_earnings_history` beats/misses

Some may be tier-restricted. If any return 403, the corresponding data section is skipped (returned as empty/null) and the synthesis prompt notes it. Tool gracefully degrades.

### Decision 3 — Earnings transcript: include or skip?

The Ford screenshots show specific transcript-derived bullets (Q1 revenue $43.3B, $1.3B tariff benefit, etc.). The V1 path relies on Sonar/Claude's web search to find these — they probably can. If the bake-off shows transcript bullets are weak, add a `get_earnings_transcript` tool in V1.5 (1-2 day add).

---

## 10. Risks

### Stack
- **Claude 30k context warning in CLAUDE.md.** That's about the daily-run prompt. Thesis-writer's prompt is ~150 lines + ~5KB data block + ~10 tool results = well inside 200k. Phase 0 verifies for whichever model wins.
- **Inngest fan-out concurrency.** Discovery: 30+ thesis-writer dispatches per Sunday. `concurrency: 5` keeps API rate limits sane. Tune up if Sunday throughput is too slow.

### Data
- **FMP plan tier:** see Decision 2. Some endpoints may 403 on legacy plans. Tools degrade gracefully.
- **SEC EDGAR rate limits:** 10 req/sec. `get_peers_with_metrics` fan-out + `get_insider_activity` could push past on bursty Sunday runs. Add retry/backoff.
- **Sonar deep research cost:** ~$1-2 per thesis × 36 dispatches/Sunday = ~$50/Sunday + ad-hoc usage. Verify against monthly Sonar budget.

### Behavior
- **Bear case fluff:** mandating "MANDATORY even on LONG" creates a fluff failure mode. Mitigation: spot-check first-week outputs; if bear cases are vapor, add a min-substance rubric to the synthesis prompt.
- **Hallucinated structured-data citations:** if the model invents `[STRUCTURED:financials_2025]` references when there's no such datum, the citation chips break. Mitigation: validate citations against `dataBlock` content during section parsing; flag mismatches.
- **Discovery fire-and-forget UX:** Discovery completes "successfully" with 0 thesis rows (workers haven't finished). Mitigation: parent-run UI must show "5 child runs spawned, 3 complete, 2 running" clearly.

### Cost
- ~$1-2 per thesis-writer run on Sonar deep research (most likely winner). Sunday: ~$50. Monthly: ~$200-300 + ad-hoc usage. Acceptable.

---

## 11. Success criteria

The plan is done when:

1. A thesis-writer run on $F (or any name) produces a thesis with:
   - Multi-paragraph fundamentals section with specific dollar figures and YoY growth
   - 5+ specific earnings-call-derived bullets with exact numbers and direct quotes when relevant
   - 3+ bull case bullets, each citing a structured datum or specific web source
   - 2+ bear case bullets, each citing a structured datum or specific web source
   - Analyst consensus paragraph naming specific firms and analysts
   - Insider activity paragraph with named executives and specific transactions
2. Side-by-side comparison vs Google AI / Perplexity Ford summary on the same ticker shows comparable depth.
3. **Phase 1 done:** "Write a fresh thesis on $X for Y" in `/chat` produces a deep thesis end-to-end.
4. **Phase 2 done:** Sunday Discovery cron runs reliably for all 6 analysts, fan-out via Inngest, no premature termination.
5. **Phase 3 done:** Daily run refuses promote-to-active on stale research, dispatches refresh, retries `place_trade` after refresh — verified end-to-end.
6. **Phase 4 done:** Trigger fires on stale-research thesis; tactical runs inline refresh.
7. **Phase 5 done (if shipped):** Thesis-writer prompts contain research-journal block; one analyst's pattern surfaces.
8. The daily run does NOT re-write thesis bodies — it patches fields when something material changes.

---

## Appendix A — Why RAG over the V2.5 multi-tool approach

The OUTDATED doc proposed 5 specialist tools (`get_earnings_transcript`, etc.) + a multi-section schema with per-claim Layer-1 citation gates. That's the right shape if you need:
- Auditable claim-by-claim provenance (every bullet cites a specific tool result, validated server-side)
- Repeatable structured data (same query → same result, no model variance)
- Strict cost control per call (structured pulls are cheaper per call than deep-research models)
- The lowest possible hallucination rate

For V2 (this doc), RAG is the right choice because:
- Sonar deep research / Claude with web_search / Gemini with Google grounding ARE built for this exact synthesis-from-context task
- The structured data block IS the audit trail — every claim with `[STRUCTURED:...]` is verifiable; web claims have URLs
- Hallucination risk is low because the model has the real numbers in context
- 1 week to ship vs 10 weeks
- Per-thesis cost is ~$1-2 — totally fine

If V2 ships and the quality falls short of Google-AI depth, re-open the [OUTDATED doc](./THESIS_RESEARCH_V2_OUTDATED.md) for the V2.5 build path. The structured data tools from this V2 are also usable in V2.5 — they're a strict subset.

---

## Appendix B — How industry does this (orchestrator-worker)

The pattern this plan uses is well-documented across the agent-systems ecosystem.

| System | Pattern name | Orchestrator | Worker |
|---|---|---|---|
| Claude Code | Sub-agents (`Agent` tool) | Main conversation | general-purpose, Explore, Plan agents |
| Cursor compose | Sub-routines | The user's compose prompt | Codebase semantic search, file-edit application |
| Devin | Plan/execute | Planner agent | Browser-use sub-agent, terminal sub-agent |
| Anthropic deep research | Tool-as-agent | User chat with Claude | Long-running research worker |
| LangGraph | Supervisor with specialists | Supervisor node | Worker nodes |
| CrewAI | Crew with agents | Crew manager | Crew member agents |
| AutoGen | Group chat with manager | Group manager | Member agents |

The novelty in this plan isn't the pattern — it's applying it to thesis writing specifically.

**Parallel fan-out specifics for Discovery:**
- Discovery dispatches N thesis-writer workers via N Inngest events
- Inngest `concurrency: 5` runs them 5 at a time (API rate-limit safe)
- Each worker is self-contained — produces one Thesis row independently
- Discovery doesn't wait or synthesize across — each worker has full context to make its own decision
- Total wall time: ~longest-single-worker, not sum
- This matches Claude Code's "spawn N parallel sub-agents, each owns a complete deliverable" pattern

The wait-and-synthesize variant (orchestrator pauses, reviews all worker outputs, then makes a portfolio-level decision) only matters when the orchestrator needs to make a decision that depends on cross-worker context — e.g., "I have 8 LONG candidates but 3 open slots." That's not Discovery's job (it just mints WATCHING; daily run handles ACTIVE promotion). It would be a Phase 3+ feature on the daily run if you ever want "rank N WATCHING refreshes by conviction and promote top 3."

---

## See also

- [`docs/VISION.md`](../VISION.md) — Pillar 2 (Thesis quality), the success bar
- [`docs/THESIS_ARCHITECTURE.md`](../THESIS_ARCHITECTURE.md) — live thesis-system reference; this plan is additive
- [`docs/PRINCIPLES.md`](../PRINCIPLES.md) — three-layer principle
- [`docs/plans/THESIS_RESEARCH_V2_OUTDATED.md`](./THESIS_RESEARCH_V2_OUTDATED.md) — the original 10-week plan, kept as V2.5 fallback
- [`docs/plans/MORNING_RUN_V2_DESIGN.md`](./MORNING_RUN_V2_DESIGN.md) — sibling daily-run prompt rewrite plan
- [`docs/GAPS.md`](../GAPS.md) — open punch list
