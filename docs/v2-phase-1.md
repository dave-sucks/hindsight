# V2 Phase 1: Input Model + Prompt Rewrite + Tool Cleanup

> **Self-contained implementation guide.** Read this file, then implement. No additional context needed.
> Reference: `docs/v2-architecture.md` for full design rationale.

## Overview

Phase 1 is the highest-impact, lowest-risk cleanup. Zero schema changes. The app keeps working identically — we reorganize what the agent sees at run start and rewrite the system prompt to enforce portfolio-manager thinking.

### What Changes
1. **New `buildRunInput()` function** — consolidates scattered context loading
2. **New `buildV2SystemPrompt()`** — portfolio-first, 7-phase run contract
3. **Remove `get_portfolio_state` tool** — portfolio is injected input
4. **Rename `show_thesis` → `record_thesis`** and **`summarize_run` → `complete_run`**
5. **Update tool UI registrations** in AgentThread for renames

### What Does NOT Change
- No Prisma schema changes
- No new DB tables or fields
- All existing tools keep working (except `get_portfolio_state` removal)
- Run replay of old completed runs still works
- Morning cron still works

---

## Task 1A: Create `lib/agent/run-input.ts`

### Current State
Context loading is duplicated in two places:
- `app/api/research/agent/route.ts` lines 116-327 (the `historyBlock` construction)
- `lib/inngest/functions/morning-research.ts` (similar block)

Both query the same data (briefings, positions, watchlist, closed trades, accuracy, passes) and format it as markdown. They're slightly inconsistent.

### What to Build
Create `lib/agent/run-input.ts` with a single canonical function:

```typescript
export interface RunInput {
  analyst: {
    name: string
    mandate: string | null
    voice: string | null
    directionBias: string
    holdDurations: string[]
    sectors: string[]
    exclusionList: string[]
    minConfidence: number
    maxPositionSize: number
    maxOpenPositions: number
  }
  portfolio: {
    cash: number
    buyingPower: number
    portfolioValue: number
    positions: Array<{
      symbol: string
      direction: string
      quantity: number
      avgCost: number
      currentPrice: number
      unrealizedPnl: number
      unrealizedPnlPct: number
      targetPrice: number | null
      stopLoss: number | null
      exitStrategy: string
      daysHeld: number
      activeThesisId: string | null
      activeThesisSummary: string | null
    }>
    exposure: {
      long: number
      short: number
      net: number
      utilizationPct: number
    }
  }
  watchlist: Array<{
    symbol: string
    reason: string
    priority: string
    thesisDirection: string | null
    targetPrice: number | null
    stopPrice: number | null
    conviction: number | null
    catalyst: string | null
    daysOnList: number
    lastReviewedDaysAgo: number
  }>
  priorBrief: {
    date: string
    narrative: string
    strategyNotes: string | null
  } | null
  performance: {
    winRate: number | null
    totalTrades: number
    calibrationNote: string | null
  } | null
  recentClosedTrades: Array<{
    symbol: string
    direction: string
    outcome: string | null
    pnlPct: number
    closeReason: string | null
    daysHeld: number
    lesson: string | null
  }>
}

export async function buildRunInput(analystId: string, userId: string): Promise<RunInput>
```

### Implementation Details

**Analyst config:**
```typescript
const config = await prisma.agentConfig.findFirst({
  where: { id: analystId, userId },
})
```

**Portfolio positions — with live prices:**
```typescript
import { getLatestPrices } from "@/lib/alpaca"

const openPositions = await prisma.position.findMany({
  where: { analystId, userId, status: "OPEN" },
  select: { id: true, symbol: true, direction: true, quantity: true, avgCost: true,
    targetPrice: true, stopLoss: true, exitStrategy: true, openedAt: true },
})

// Batch fetch live prices from Alpaca
const symbols = openPositions.map(p => p.symbol)
let livePrices: Record<string, number> = {}
if (symbols.length > 0) {
  try {
    livePrices = await getLatestPrices(symbols)
  } catch (err) {
    console.warn("[buildRunInput] Failed to fetch live prices:", err)
  }
}

// Build position array with P&L
const positions = openPositions.map(p => {
  const currentPrice = livePrices[p.symbol] ?? Number(p.avgCost)
  const avgCost = Number(p.avgCost)
  const unrealizedPnl = (currentPrice - avgCost) * p.quantity * (p.direction === "SHORT" ? -1 : 1)
  const unrealizedPnlPct = avgCost > 0 ? (unrealizedPnl / (avgCost * p.quantity)) * 100 : 0
  const daysHeld = Math.floor((Date.now() - p.openedAt.getTime()) / (1000 * 60 * 60 * 24))
  return { symbol: p.symbol, direction: p.direction, quantity: p.quantity,
    avgCost, currentPrice, unrealizedPnl, unrealizedPnlPct,
    targetPrice: p.targetPrice ? Number(p.targetPrice) : null,
    stopLoss: p.stopLoss ? Number(p.stopLoss) : null,
    exitStrategy: p.exitStrategy, daysHeld,
    activeThesisId: null, activeThesisSummary: null }
})

// Calculate exposure
const longExposure = positions.filter(p => p.direction === "LONG").reduce((sum, p) => sum + p.currentPrice * p.quantity, 0)
const shortExposure = positions.filter(p => p.direction === "SHORT").reduce((sum, p) => sum + p.currentPrice * p.quantity, 0)
```

**Link active theses to positions:**
For each open position, find the most recent thesis on that ticker by this analyst:
```typescript
for (const pos of positions) {
  const thesis = await prisma.thesis.findFirst({
    where: { ticker: pos.symbol, userId, researchRun: { agentConfigId: analystId } },
    orderBy: { createdAt: "desc" },
    select: { id: true, reasoningSummary: true },
  })
  if (thesis) {
    pos.activeThesisId = thesis.id
    pos.activeThesisSummary = thesis.reasoningSummary.slice(0, 200)
  }
}
```

**Watchlist:**
```typescript
const watchlistItems = await prisma.analystWatchlistItem.findMany({
  where: { analystId, status: "ACTIVE" },
  orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
})
// Compute daysOnList and lastReviewedDaysAgo for each
```

**Prior brief (most recent 1, not 3):**
```typescript
const latestBriefing = await prisma.analystBriefing.findFirst({
  where: { analystId },
  orderBy: { createdAt: "desc" },
  select: { narrative: true, strategyNotes: true, createdAt: true },
})
```

**Performance:**
```typescript
const latestAccuracy = await prisma.accuracyReport.findFirst({
  where: { userId },
  orderBy: { createdAt: "desc" },
  select: { winRate: true, tradesAnalyzed: true, narrativeSummary: true },
})
```

**Recent closed trades (10, not 20):**
```typescript
const recentTrades = await prisma.position.findMany({
  where: { userId, status: "CLOSED", analystId },
  orderBy: { closedAt: "desc" },
  take: 10,
  select: { symbol: true, direction: true, outcome: true, avgCost: true,
    closePrice: true, closeReason: true, closedAt: true, openedAt: true,
    realizedPnl: true, agentEvaluation: true },
})
```

**Account balances:**
```typescript
import { getAccount } from "@/lib/alpaca"
const account = await getAccount()
```

### Error Handling
Wrap the entire function in try/catch. If Alpaca is down, use avgCost as currentPrice fallback. If any query fails, return empty arrays. Log warnings but don't fail the run.

---

## Task 1B: Rewrite `lib/agent/system-prompt.ts`

### Current State
`buildSystemPrompt(config)` takes an `AgentConfigInput` and returns a prompt string. The history block is appended separately in `agent/route.ts` line 329.

### What to Build
Replace with `buildV2SystemPrompt(config, runInput)` that takes the full RunInput and produces a single complete prompt.

**New signature:**
```typescript
export function buildV2SystemPrompt(config: AgentConfigInput, runInput: RunInput): string
```

### Prompt Structure

The prompt should have these sections IN ORDER (order matters — the agent sees portfolio before instructions):

```
## Section 1: Identity
You are {name}, an autonomous AI portfolio manager...
{analystPrompt if set}

## Section 2: Your Rules
Direction bias, hold duration, sectors, min confidence, exclusions, max position size, max open positions

## Section 3: Current Portfolio
{render runInput.portfolio as markdown table}
Positions: SYMBOL | DIR | QTY | AVG COST | CURRENT | P&L | P&L% | TARGET | STOP | DAYS HELD | THESIS SUMMARY
Exposure: Long $X | Short $X | Net $X | Utilization X%
Cash: $X | Buying Power: $X | Slots: X/Y used

## Section 4: Watchlist ({N} items)
{render runInput.watchlist sorted by priority}
SYMBOL [PRIORITY] DIR — "reason" (X days on list, reviewed X days ago) | target $X, stop $X | catalyst: ... | conviction: X%

## Section 5: Prior Brief
{if runInput.priorBrief exists}
Market Posture: {posture}
Strategy Notes: {notes}
Watch Tomorrow:
- SYMBOL: {trigger} → {action}
Unresolved: ...

## Section 6: Performance Context
Win Rate: X% | Trades: N | Calibration: {note}

## Section 7: Recent Closed Trades
{render runInput.recentClosedTrades}
OUTCOME | DIR SYMBOL | entry → exit | +$X | X days | Lesson: ...

## Section 8: Run Contract (7 Phases)

### Phase 1: ORIENT (1 step)
Call get_market_context. Interpret regime, sector leadership, themes.

### Phase 2: REVIEW HOLDINGS (1-6 steps)
You can see your portfolio above. Do NOT research every holding every day. TRIAGE:
- MUST review: positions near target/stop (>80% proximity), earnings this week, items from "Watch Tomorrow"
- SHOULD review: held > expected duration, > 5% unrealized loss
- CAN SKIP: healthy positions within thesis parameters, reviewed yesterday

For positions needing review: get_stock_data → narrate → record_thesis (to update or confirm thesis)

### Phase 3: REVIEW WATCHLIST (1-4 steps)
Triage your watchlist above:
- MUST review: HIGH priority, catalyst date this week, "Watch Tomorrow" triggers
- SHOULD review: not reviewed in 5+ days
- CAN SKIP: LOW priority, recently reviewed

For items needing review: get_stock_data → decide: INITIATE / WATCH (update) / REMOVE

### Phase 4: DISCOVER (2-8 steps, CONDITIONAL)
Skip or minimize discovery when:
- Portfolio at max positions and no exits planned
- RISK_OFF regime and portfolio is defensive
- Prior brief says "no new positions"

When discovery runs: scan_candidates → pick 2-4 → get_stock_data + record_thesis each

### Phase 5: SYNTHESIZE (no tools — YOUR CORE JOB)
Produce a DECISION TABLE considering the ENTIRE portfolio:

| # | Ticker | Action | Confidence | Size | Reasoning |
|---|--------|--------|-----------|------|-----------|

Actions: INITIATE / ADD / HOLD / REDUCE / EXIT / WATCH / REMOVE_WATCH / PASS

Then write portfolio-level reasoning:
- Current posture vs target posture
- Risk budget usage
- Key tradeoffs made
- The one risk that could blow this up

### Phase 6: EXECUTE (1-5 steps)
Execute decisions IN ORDER. Exits BEFORE entries (frees capital + slots).
- record_thesis for every researched ticker (including PASS)
- close_position for EXIT decisions
- place_trade for INITIATE/ADD decisions (requires thesis_id from record_thesis)
- manage_watchlist for WATCH/REMOVE_WATCH decisions

### Phase 7: BRIEF (1 step)
ALWAYS call complete_run as your LAST action with:
- ranked_picks, market_summary, overall_assessment, exposure_breakdown, risk_notes (existing)

## Section 9: Tool Reference
{list all 13 tools with one-line descriptions}

## Section 10: Rules
- THESIS RULES: Must call record_thesis for EVERY ticker you called get_stock_data on. PASS theses need full reasoning. All theses need entry_price.
- WATCHLIST RULES: ADD interesting PASS stocks. REMOVE stale items. UPDATE targets/conviction.
- CITATION: Use [N] notation from _sources arrays.
- STYLE: Use $TICKER format. Be conversational but substantive. 2-4 sentences between tool calls.
- NEVER fabricate data. If a tool fails, say so and move on.
- ALWAYS end with complete_run.
```

### Key Differences from Current Prompt
1. **Portfolio is Section 3** (before instructions) — agent sees holdings FIRST
2. **Watchlist is Section 4** — agent sees what it's tracking BEFORE being told to research
3. **Phase 2 says "triage, not exhaustive"** — current says "review EVERY open position"
4. **Phase 4 says "conditional"** — current always runs full scan
5. **Phase 5 explicitly requires a decision table** — current just says "narrate your reasoning"
6. **No `get_portfolio_state` reference** — removed from tool list
7. **`show_thesis` → `record_thesis`** and **`summarize_run` → `complete_run`** throughout
8. **Single brief** replaces "3 recent briefings" section

---

## Task 1C: Remove `get_portfolio_state` Tool

### Current Location
`lib/agent/tools.ts` — the `get_portfolio_state` tool definition. Search for `get_portfolio_state` to find it.

### What to Do
1. **Delete** the `get_portfolio_state` tool from `createResearchTools()`
2. **Update `place_trade` return value** to include portfolio context after trade:
   ```typescript
   return {
     ...existingReturn,
     portfolioUpdate: {
       remainingSlots: maxOpenPositions - currentOpenCount,
       remainingBuyingPower: account.buying_power,
       openPositionCount: currentOpenCount,
     }
   }
   ```
3. **Update `close_position` return value** similarly
4. Remove any reference to `get_portfolio_state` from the system prompt (already handled by 1B)

### Why This Is Safe
- The tool was called exactly once per run (per the current prompt: "call ONCE after all research")
- All data it returned is now injected at run start via `buildRunInput()`
- If the agent hallucinates a call to the deleted tool, AI SDK returns a clean error and the agent moves on

---

## Task 1D: Rename Tools

### `show_thesis` → `record_thesis`

In `lib/agent/tools.ts`:
1. Find the `show_thesis` tool definition
2. Rename to `record_thesis`
3. Keep all parameters and execute logic identical
4. Add a backward-compat alias:
   ```typescript
   // Alias for backward compat with old persisted messages
   record_thesis: { ...recordThesisTool },
   show_thesis: { ...recordThesisTool },
   ```

### `summarize_run` → `complete_run`

Same pattern:
1. Rename to `complete_run`
2. Keep parameters and logic identical
3. Add alias

### UI Registration Updates

In `components/research/AgentThread.tsx`, find `useRegisterResearchToolUIs()` or wherever `useAssistantToolUI` hooks are registered:
1. Register tool UIs for both old and new names
2. `record_thesis` and `show_thesis` → same ThesisCard/ThesisArtifactSheet UI
3. `complete_run` and `summarize_run` → same RunSummaryCard UI

**Search for these patterns:**
- `useAssistantToolUI("show_thesis"` → duplicate for `"record_thesis"`
- `useAssistantToolUI("summarize_run"` → duplicate for `"complete_run"`

---

## Task 1E: Update Consumers

### `app/api/research/agent/route.ts`

Replace lines 60-114 (config loading) and lines 116-327 (history block) with:

```typescript
// Load analyst config
const config = await loadAnalystConfig(analystId, runId, user.id)

// Build structured run input
const runInput = await buildRunInput(resolvedAnalystId, user.id)

// Build system prompt with injected state
const systemPrompt = buildV2SystemPrompt(config, runInput)
```

Keep everything else (auth, streamText, onStepFinish, onError, onFinish, message persistence) unchanged.

**Important:** The `loadAnalystConfig` function should be extracted from the existing config-loading logic (lines 60-114). It returns the `AgentConfigInput` type that the prompt builder needs.

### `lib/inngest/functions/morning-research.ts`

Same replacement pattern. Find where it builds context and system prompt, replace with `buildRunInput()` + `buildV2SystemPrompt()`.

---

## Files Changed Summary

```
NEW:   lib/agent/run-input.ts              (RunInput type + buildRunInput function)
EDIT:  lib/agent/system-prompt.ts           (buildV2SystemPrompt replaces buildSystemPrompt)
EDIT:  lib/agent/tools.ts                   (remove get_portfolio_state, rename show_thesis/summarize_run, add aliases)
EDIT:  app/api/research/agent/route.ts      (use buildRunInput + buildV2SystemPrompt, remove inline context loading)
EDIT:  lib/inngest/functions/morning-research.ts  (same replacement)
EDIT:  components/research/AgentThread.tsx   (register tool UIs for new names + aliases)
```

---

## Testing Checklist

Before merging, verify:

- [ ] **Manual agent run** with an analyst that has open positions → agent sees portfolio in prompt, triages, doesn't call get_portfolio_state
- [ ] **Manual agent run** with empty portfolio → agent skips Phase 2, focuses on discovery
- [ ] **Manual agent run** with full portfolio (max positions) → agent skips/minimizes Phase 4 (discovery)
- [ ] **Decision table** appears in agent text output during Phase 5
- [ ] **Tool rename**: agent calls `record_thesis` (not `show_thesis`) — verify ThesisCard renders
- [ ] **Tool rename**: agent calls `complete_run` (not `summarize_run`) — verify RunSummaryCard renders
- [ ] **Replay old run**: navigate to a previously completed run → RunUnifiedChat still renders
- [ ] **Morning cron test**: trigger via Inngest dashboard → run completes, briefing generated
- [ ] **No get_portfolio_state calls**: grep agent logs for "get_portfolio_state" — should be zero
- [ ] **Alpaca down fallback**: if getLatestPrices fails, positions still show with avgCost as currentPrice

---

## Important Constraints

- **DO NOT** change any Prisma schema — Phase 1 is zero-migration
- **DO NOT** change tool execute logic (only rename + remove)
- **DO NOT** modify the UI components themselves (ThesisCard, RunSummaryCard, etc.) — only the registration hooks
- **DO NOT** change the briefing generation logic (`update-analyst-briefing.ts`) — that's Phase 2
- **Keep backward compat aliases** for renamed tools — old persisted RunMessages reference `show_thesis` and `summarize_run`
- Follow all rules in CLAUDE.md (ShadCN components as-is, CSS variables only, etc.)
