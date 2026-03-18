# Analyst Workflow Rebuild Plan

> Status: PLANNING
> Date: 2026-03-18
> Context: After PR #88 (Position/Order/TradeDecision tables) and PR #93 (11-tool refactor)

---

## Executive Summary

We rebuilt the trading layer (Position, Order, TradeDecision) and consolidated tools (18 → 11). The agent can now discover stocks and place trades. But it still behaves like a **scanner**, not an **analyst**. A real analyst:

1. Manages a **portfolio** — reviews every holding daily, not just new discoveries
2. Maintains a **watchlist** — tracks stocks they passed on or are monitoring
3. Curates a **universe** — a sector/thematic stock pool they specialize in
4. Makes **portfolio-level decisions** — not just per-ticker buy/pass verdicts

This plan closes those gaps.

---

## Part 1: Gap Analysis — Current State vs. Desired

### What Works Today

| Capability | Status | Notes |
|---|---|---|
| Agent discovers new stocks via scan_candidates | Working | Movers, earnings, StockTwits, Reddit, insider |
| Agent researches tickers (get_stock_data) | Working | Quote, profile, financials, technicals, news |
| Agent creates theses (show_thesis) | Working | LONG/SHORT/PASS all persisted |
| Agent places trades (place_trade) | Working | Creates Position + Order + TradeDecision |
| Trade decisions tracked (BUY/SELL/HOLD/PASS) | Working | TradeDecision table records everything |
| Open positions shown in system prompt context | Working | Agent sees current holdings at run start |
| Recent closed trades shown in context | Working | Last 20 with P&L and evaluation |
| Recent PASS decisions shown in context | Working | Last 10 with reasoning |
| Analyst briefings as "living memory" | Working | Last 3 briefings injected into context |
| Duplicate position guard | Working | Blocks duplicate positions across analysts |
| Price monitoring cron | Working | Hourly checks, exit evaluation |

### What's Missing (Critical Gaps)

#### Gap 1: No Portfolio Review Phase in Agent Runs
**Problem:** When a run kicks off, the agent jumps straight to `get_market_context` → `scan_candidates` → research new tickers. It **never reviews its current holdings**. Open positions are listed in the system prompt as static text, but the agent doesn't:
- Call `get_stock_data` on holdings to check current price/news
- Form updated theses on existing positions (should it hold, sell, add?)
- Evaluate if stop losses or targets need adjusting
- Check if the original thesis is still valid

**Impact:** The agent is blind to its own portfolio's current state. It might buy more tech stocks while its existing tech positions are crashing.

#### Gap 2: No Watchlist Management (Analyst-Level)
**Problem:** The `watchlist` field on AgentConfig is a static `String[]` — it's just ticker symbols. There's no:
- Record of WHY a stock is on the watchlist
- History of theses/reviews for watchlist items
- Mechanism for the agent to add/remove watchlist items during a run
- Connection between PASS decisions and watchlist additions
- Price alerts or condition-based triggers for watchlist items

**Current state:** `WatchlistItem` table exists but is user-level (global), not analyst-level. AgentConfig has `watchlist: String[]` but it's just a flat list with no metadata.

**Impact:** When an agent passes on a stock today, that decision is recorded as a TradeDecision(PASS) but the stock doesn't get added to the watchlist for tomorrow's review. The agent has no structured way to say "watch this, come back to it."

#### Gap 3: No Universe Management
**Problem:** `tickerUniverse` on AgentConfig is another static `String[]`. There's no:
- Way for the agent to grow/prune its universe over time
- Sector-to-ticker mapping (e.g., "AI sector" → specific stocks)
- Distinction between "core universe" (always monitor) and "extended universe" (check periodically)
- Universe review as part of the run workflow
- UI for managing universe beyond the chat builder

**Impact:** An analyst focused on "AI stocks" has no structured way to maintain which stocks are in that category. The builder can set initial tickers, but the universe never evolves.

#### Gap 4: No Portfolio Review Tool
**Problem:** There's no tool that lets the agent do a holistic portfolio assessment mid-run. After researching individual tickers, the agent should:
- Compare all holdings + watchlist + new discoveries together
- Assess overall exposure (sector, direction, risk)
- Decide on portfolio-level actions (rebalance, reduce concentration, trim winners)
- Update the watchlist and universe based on findings

**Impact:** `summarize_run` captures a summary but doesn't execute portfolio-level decisions. The agent can only act ticker-by-ticker, never holistically.

#### Gap 5: No Agent Tools for Watchlist/Universe Management
**Problem:** The agent has no tools to modify the watchlist or universe during a run. It can:
- Place trades (place_trade)
- Record theses (show_thesis)
- Summarize (summarize_run)

But it cannot:
- Add a stock to the watchlist with notes
- Remove a stock from the watchlist
- Add/remove stocks from the universe
- Set watchlist alerts or review conditions

#### Gap 6: System Prompt Doesn't Instruct Portfolio Review
**Problem:** The system prompt (`buildSystemPrompt`) tells the agent:
1. Get market context
2. Scan candidates
3. Research each ticker
4. Show thesis + trade
5. Summarize

There's no phase for "review your current positions" or "check your watchlist." The agent is told about open positions in the context block but isn't instructed to research them.

#### Gap 7: Analyst Builder Doesn't Support Universe/Sector Configuration Well
**Problem:** The analyst builder chat can suggest sectors and a watchlist, but:
- No sector presets (e.g., "AI/Tech", "Healthcare", "Energy")
- No way to auto-populate universe from a sector
- `strategyType` field (DISCOVERY/WATCHLIST/DIRECTED) exists but is never set in the builder
- No UI for managing universe outside the chat
- Markets and exchanges fields are hardcoded, never exposed

---

## Part 2: Implementation Plan

### Phase 1: Watchlist Table + Agent Tools (Week 1)

#### 1A: New `AnalystWatchlistItem` Table

Replace the flat `watchlist: String[]` on AgentConfig with a proper relational table.

```prisma
model AnalystWatchlistItem {
  id          String   @id @default(cuid())
  analystId   String
  userId      String
  symbol      String
  reason      String   // Why it was added (e.g., "Strong AI thesis but valuation too high")
  addedBy     String   // "AGENT" | "USER" | "SYSTEM"
  status      String   @default("ACTIVE") // ACTIVE | REMOVED | GRADUATED (became a position)
  priority    String   @default("NORMAL") // HIGH | NORMAL | LOW
  conditions  String?  // JSON: conditions to trigger review (e.g., price < $X, earnings date)
  lastReviewedAt DateTime?
  removedAt   DateTime?
  removeReason String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // Relations
  analyst     AgentConfig @relation(fields: [analystId], references: [id])
  theses      Thesis[]    // All theses ever written for this symbol by this analyst

  @@unique([analystId, symbol])
  @@index([analystId, status])
  @@index([userId])
}
```

**Key design decisions:**
- One row per analyst per symbol (unique constraint)
- `status` tracks lifecycle: ACTIVE → GRADUATED (when a position opens) or REMOVED
- `theses` relation links all historical theses for the symbol — this is the "series of reviews" you described
- `conditions` stores JSON trigger conditions for when to re-examine
- `addedBy` distinguishes agent-added vs user-added vs system-added items

**Migration from existing data:**
- Read `AgentConfig.watchlist` String[] for each analyst
- Create AnalystWatchlistItem rows with `addedBy: "USER"`, `reason: "Migrated from config"`
- Keep `watchlist` field on AgentConfig for backward compatibility but stop writing to it

#### 1B: New `AnalystUniverse` Table

```prisma
model AnalystUniverse {
  id          String   @id @default(cuid())
  analystId   String
  userId      String
  symbol      String
  tier        String   @default("CORE") // CORE | EXTENDED | DISCOVERY
  sector      String?  // Sector classification
  addedBy     String   // "AGENT" | "USER" | "BUILDER"
  reason      String?  // Why this stock is in the universe
  status      String   @default("ACTIVE") // ACTIVE | REMOVED
  removedAt   DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  analyst     AgentConfig @relation(fields: [analystId], references: [id])

  @@unique([analystId, symbol])
  @@index([analystId, status])
  @@index([analystId, tier])
}
```

**Tier definitions:**
- **CORE**: Always analyze every run (e.g., the 10-20 stocks the analyst specializes in)
- **EXTENDED**: Check weekly or when relevant catalysts appear
- **DISCOVERY**: Recently discovered, being evaluated for promotion to CORE/EXTENDED

**Migration:** Read `AgentConfig.tickerUniverse` String[] → create AnalystUniverse rows with `tier: "CORE"`, `addedBy: "USER"`

#### 1C: New Agent Tools (3 tools)

**Tool 12: `manage_watchlist`**
```typescript
{
  action: "ADD" | "REMOVE" | "UPDATE",
  symbol: string,
  reason: string,
  priority?: "HIGH" | "NORMAL" | "LOW",
  conditions?: string, // e.g., "Review if price drops below $150"
}
```
- ADD: Creates AnalystWatchlistItem with status ACTIVE
- REMOVE: Sets status to REMOVED with removeReason
- UPDATE: Modifies priority, reason, or conditions
- Returns confirmation with current watchlist count

**Tool 13: `manage_universe`**
```typescript
{
  action: "ADD" | "REMOVE" | "PROMOTE" | "DEMOTE",
  symbol: string,
  tier?: "CORE" | "EXTENDED" | "DISCOVERY",
  sector?: string,
  reason?: string,
}
```
- ADD: Creates AnalystUniverse entry at specified tier
- REMOVE: Sets status REMOVED
- PROMOTE: Moves DISCOVERY → EXTENDED → CORE
- DEMOTE: Moves CORE → EXTENDED → DISCOVERY
- Returns confirmation with universe summary

**Tool 14: `portfolio_review`**
```typescript
{
  holdings_assessment: [
    {
      symbol: string,
      current_action: "HOLD" | "SELL" | "ADD" | "TRIM" | "CLOSE",
      reasoning: string,
      updated_target?: number,
      updated_stop?: number,
    }
  ],
  watchlist_actions: [
    { symbol: string, action: "ADD" | "REMOVE" | "GRADUATE", reason: string }
  ],
  universe_actions: [
    { symbol: string, action: "ADD" | "REMOVE" | "PROMOTE" | "DEMOTE", reason: string }
  ],
  exposure_notes: string,
  risk_assessment: string,
  overall_strategy_note: string, // Feeds into the briefing
}
```
- Executes all holding actions (update targets/stops, close positions via `closeOpenPosition`)
- Executes all watchlist/universe mutations
- Persists a PortfolioReviewEvent on each affected position
- Returns summary of all actions taken

### Phase 2: Agent Workflow Rewrite (Week 1-2)

#### 2A: New Run Phases in System Prompt

Rewrite `buildSystemPrompt` to add portfolio review and watchlist phases:

```
## How to Work

### Phase 1: Context & Discovery (2 steps)
1. get_market_context — market regime, themes, sector leadership
2. scan_candidates — find new opportunities

### Phase 2: Portfolio Review (2-4 steps)
For EACH open position:
  1. get_stock_data(symbol) — check current price, news, technicals
  2. show_thesis(symbol) — update thesis (HOLD/SELL direction)
     - If thesis changes, note in reasoning why
     - If stop or target needs updating, flag for portfolio_review

This is your MOST IMPORTANT phase. You are a portfolio manager first.
Never skip reviewing your holdings.

### Phase 3: Watchlist Review (1-3 steps)
For HIGH priority watchlist items (and any with triggered conditions):
  1. get_stock_data(symbol) — quick check
  2. show_thesis(symbol) — has the thesis improved? Ready to buy?
     - If ready: place_trade → manage_watchlist(REMOVE) or it auto-graduates
     - If deteriorated: manage_watchlist(REMOVE, reason)
     - If unchanged: move on (the thesis history builds automatically)

### Phase 4: New Discovery Research (4-8 steps)
For scan_candidates results (filtered against universe + watchlist):
  1. get_stock_data + optional deep research
  2. show_thesis — LONG/SHORT/PASS
  3. If PASS but interesting: manage_watchlist(ADD) with conditions
  4. If tradeable: place_trade

### Phase 5: Portfolio Review & Synthesis (2 steps)
1. portfolio_review — holistic assessment of all holdings, watchlist
   actions, universe updates, risk/exposure
2. summarize_run — mark run complete, ranked picks
```

#### 2B: Enhanced Context Loading

Update the agent route to load watchlist and universe data:

```typescript
// In route.ts, add to history loading:

// Active watchlist items with thesis history
const watchlistItems = await prisma.analystWatchlistItem.findMany({
  where: { analystId: configId, status: "ACTIVE" },
  include: {
    theses: {
      orderBy: { createdAt: "desc" },
      take: 2, // Last 2 theses per watchlist item
      select: { direction: true, confidenceScore: true, createdAt: true, reasoningSummary: true },
    },
  },
});

// Universe summary
const universeStats = await prisma.analystUniverse.groupBy({
  by: ["tier"],
  where: { analystId: configId, status: "ACTIVE" },
  _count: true,
});

const coreUniverse = await prisma.analystUniverse.findMany({
  where: { analystId: configId, status: "ACTIVE", tier: "CORE" },
  select: { symbol: true, sector: true },
});
```

Inject into system prompt:
```
## Your Watchlist (X items)
- $AAPL (HIGH) — "Strong fundamentals but overvalued at $195" (last reviewed 3/15, PASS @ 62% confidence)
- $PLTR (NORMAL) — "AI play, waiting for pullback below $70" (last reviewed 3/14, PASS @ 55%)

## Your Universe
- CORE (12 tickers): MSFT, AAPL, NVDA, GOOGL, META, AMZN, TSLA, AMD, CRM, SNOW, PLTR, NET
- EXTENDED (8 tickers): ...
- DISCOVERY (3 tickers): ...
```

#### 2C: Step Budget Rebalance

With new phases, the 30-step budget needs rebalancing:

| Phase | Steps | Notes |
|---|---|---|
| Context + Discovery | 2 | get_market_context + scan_candidates |
| Portfolio Review | 2-6 | get_stock_data + show_thesis per holding (assume 1-3 holdings) |
| Watchlist Review | 1-3 | Quick checks on HIGH priority items |
| New Discovery | 4-10 | 2-5 new tickers at 2 steps each |
| Portfolio Review + Summary | 2 | portfolio_review + summarize_run |
| Management tools | 2-4 | manage_watchlist + manage_universe calls |
| **Total** | **13-27** | Fits within 30-step budget |

Key insight: The agent dynamically allocates steps. A run with 3 open positions and 2 watchlist items leaves 15+ steps for new discovery. A fresh analyst with no positions uses all steps for discovery.

### Phase 3: Analyst Builder Enhancement (Week 2)

#### 3A: Strategy Type Activation

Currently `strategyType` (DISCOVERY/WATCHLIST/DIRECTED) is set but never used. Wire it up:

- **DISCOVERY**: Default. Agent scans market broadly, builds universe over time.
- **WATCHLIST**: Agent primarily reviews watchlist items. Minimal new scanning.
- **DIRECTED**: Agent only researches stocks in the universe. No market scanning.

The system prompt should vary the Phase 2-4 balance based on strategyType.

#### 3B: Universe Seeding in Builder

Add to the `suggest_config` tool output:
```typescript
{
  // ... existing config fields
  initialUniverse: [
    { symbol: "NVDA", tier: "CORE", sector: "Semiconductors" },
    { symbol: "AMD", tier: "CORE", sector: "Semiconductors" },
    { symbol: "MRVL", tier: "EXTENDED", sector: "Semiconductors" },
  ],
}
```

When `createAnalystFromBuilder` runs, also create AnalystUniverse rows.

#### 3C: Sector Presets

Add sector preset data that the builder can reference:
```typescript
const SECTOR_PRESETS = {
  "AI & Semiconductors": ["NVDA", "AMD", "AVGO", "MRVL", "QCOM", "ARM", "TSM", ...],
  "Cloud & SaaS": ["CRM", "SNOW", "NET", "DDOG", "MDB", "ZS", ...],
  "Healthcare & Biotech": ["LLY", "NVO", "MRNA", "VRTX", "REGN", ...],
  "Energy & Renewables": ["XOM", "CVX", "ENPH", "FSLR", "NEE", ...],
  // etc.
};
```

Builder chat can suggest: "Based on your AI focus, here's a starting universe of 15 stocks across semiconductors, cloud infrastructure, and AI applications."

### Phase 4: UI Enhancements (Week 2-3)

#### 4A: Analyst Detail — Watchlist Tab
- New tab on `/analysts/[id]` showing AnalystWatchlistItem rows
- Each item shows: symbol, reason, priority, last reviewed date, thesis history
- Inline actions: remove from watchlist, change priority
- Click through to stock detail page

#### 4B: Analyst Detail — Universe Tab
- New tab showing AnalystUniverse rows grouped by tier
- Drag-and-drop or button to promote/demote tiers
- Add/remove tickers with sector tagging
- Universe coverage stats (sectors, market cap distribution)

#### 4C: Run Detail — Portfolio Review Card
- New domain component for `portfolio_review` tool results
- Shows: holdings assessment grid, watchlist changes, universe changes
- Visual: exposure pie chart, risk heat indicators

#### 4D: Dashboard — Watchlist Widget
- Show aggregated watchlist items across all analysts
- Highlight items with triggered conditions or HIGH priority

### Phase 5: Cron Integration (Week 3)

#### 5A: Morning Research Cron Update
`morning-research.ts` should pass watchlist and universe context to the agent, just like the manual run flow.

#### 5B: Watchlist Condition Monitor (New Cron)
New Inngest cron that runs alongside price-monitor:
- Checks AnalystWatchlistItem conditions (price thresholds, dates)
- When conditions are met, flags the item for the next run
- Optional: sends alert email for HIGH priority triggered conditions

#### 5C: Universe Refresh (Weekly Cron)
New weekly cron that:
- Reviews DISCOVERY tier items older than 2 weeks without promotion → auto-remove
- Checks if CORE universe tickers have been delisted or are stale
- Generates universe health report

---

## Part 3: Detailed File Changes

### New Files
| File | Description |
|---|---|
| `prisma/migrations/XXXXXX_add_watchlist_universe_tables/migration.sql` | New tables |
| `lib/agent/tools/manage-watchlist.ts` | Watchlist management tool |
| `lib/agent/tools/manage-universe.ts` | Universe management tool |
| `lib/agent/tools/portfolio-review.ts` | Portfolio review tool |
| `lib/actions/watchlist.actions.ts` | Watchlist CRUD actions |
| `lib/actions/universe.actions.ts` | Universe CRUD actions |
| `components/domain/PortfolioReviewCard.tsx` | Portfolio review tool UI |
| `components/analysts/AnalystWatchlistTab.tsx` | Watchlist tab component |
| `components/analysts/AnalystUniverseTab.tsx` | Universe tab component |
| `lib/inngest/functions/watchlist-monitor.ts` | Watchlist condition cron |
| `lib/inngest/functions/universe-refresh.ts` | Universe health cron |

### Modified Files
| File | Changes |
|---|---|
| `prisma/schema.prisma` | Add AnalystWatchlistItem, AnalystUniverse models; add relations to AgentConfig, Thesis |
| `lib/agent/tools.ts` | Register 3 new tools (14 total), wire up tool context |
| `lib/agent/system-prompt.ts` | Rewrite workflow phases, add portfolio/watchlist/universe instructions |
| `app/api/research/agent/route.ts` | Load watchlist + universe context, inject into prompt |
| `app/api/chat/analyst-builder/route.ts` | Add universe seeding to suggest_config |
| `lib/actions/analyst.actions.ts` | Update createAnalystFromBuilder to create universe rows |
| `components/research/tool-uis.tsx` | Register portfolio_review, manage_watchlist, manage_universe UIs |
| `components/analysts/AnalystDetailClient.tsx` | Add Watchlist and Universe tabs |
| `lib/inngest/functions/morning-research.ts` | Load watchlist/universe for cron runs |
| `lib/actions/closeTrade.actions.ts` | Auto-graduate watchlist item when position opens |
| `lib/agent/update-analyst-briefing.ts` | Include watchlist/universe changes in briefing |
| `types/index.ts` | Add new types for watchlist, universe, portfolio review |

---

## Part 4: Priority & Ordering

### Must-Have (Ship First)
1. **AnalystWatchlistItem table** — the foundation for everything
2. **System prompt rewrite** — add portfolio review + watchlist phases
3. **Enhanced context loading** — inject watchlist + position data for agent
4. **manage_watchlist tool** — agent can add/remove watchlist items
5. **portfolio_review tool** — holistic portfolio assessment at end of run
6. **Auto-add PASS stocks to watchlist** — when agent passes with >40% confidence

### Should-Have (Ship Second)
7. **AnalystUniverse table** — structured universe management
8. **manage_universe tool** — agent can curate its universe
9. **Universe seeding in builder** — initial universe from sector selection
10. **Watchlist tab UI** — visible watchlist on analyst detail page
11. **Universe tab UI** — visible universe on analyst detail page
12. **Strategy type activation** — DISCOVERY/WATCHLIST/DIRECTED modes

### Nice-to-Have (Ship Third)
13. **Sector presets** — pre-built universe templates
14. **Watchlist condition monitor cron** — automated condition checks
15. **Universe refresh cron** — weekly health checks
16. **Portfolio review card UI** — visual portfolio assessment
17. **Dashboard watchlist widget** — cross-analyst watchlist view

---

## Part 5: How It All Works Together (End State)

### Example: "AI Momentum Trader" analyst with 3 holdings, 4 watchlist items, 15-stock universe

**Run starts:**
1. Agent loads context: 3 open positions (NVDA, AMD, MSFT), 4 watchlist items (PLTR, ARM, SMCI, SNOW), 15-stock CORE universe
2. `get_market_context` → "Risk-on, tech leadership, AI theme dominant"
3. `scan_candidates` → finds AVGO (earnings beat), MU (insider buying), new AI startup IPO

**Portfolio review phase:**
4. `get_stock_data("NVDA")` → up 3% on AI spending news → `show_thesis("NVDA", HOLD)` — raise target
5. `get_stock_data("AMD")` → flat, no news → `show_thesis("AMD", HOLD)` — maintain
6. `get_stock_data("MSFT")` → hit target price! → `show_thesis("MSFT", SELL)` — take profits

**Watchlist review phase:**
7. `get_stock_data("PLTR")` → pulled back 8% → `show_thesis("PLTR", LONG, 72%)` → `place_trade("PLTR")` — watchlist item graduates!
8. `get_stock_data("ARM")` → still overvalued → quick PASS thesis, stays on watchlist

**New discovery phase:**
9. `get_stock_data("AVGO")` → strong earnings → `show_thesis("AVGO", LONG, 75%)` → `place_trade("AVGO")`
10. `get_stock_data("MU")` → insider buying interesting but weak technicals → `show_thesis("MU", PASS)` → `manage_watchlist(ADD, "MU", "Insider buying signal, wait for technical confirmation")`

**Portfolio review & synthesis:**
11. `portfolio_review` → Sells MSFT (hit target), notes PLTR graduated from watchlist, adds MU to watchlist, overall exposure: 80% tech (flag as concentrated), risk: moderate
12. `summarize_run` → Complete. 2 new trades (PLTR, AVGO), 1 sell (MSFT), 1 watchlist add (MU), portfolio P&L: +$2,340

**After run:**
- Briefing generated with strategy notes: "Heavy tech exposure — consider diversifying next run"
- Watchlist updated: PLTR removed (graduated), MU added
- Universe unchanged (all discoveries were already in universe)
- Next run will review 4 holdings (NVDA, AMD, PLTR, AVGO), 4 watchlist items (ARM, SMCI, SNOW, MU)

---

## Appendix: Relation to PR #88 and #93

### PR #88 Delivered
- Position/Order/PositionEvent/TradeDecision tables (the trading layer)
- Cascade delete for analysts
- Duplicate position guard
- Cancel/close trade actions
- All crons migrated to new tables

### PR #93 Delivered
- 18 tools → 11 tools consolidation
- 5-minute in-memory Finnhub cache
- Soft concurrency limit (5 parallel requests)
- Fire-and-forget trades
- Flexible system prompt (agent decides depth)
- PASS theses mandatory with full reasoning
- Per-run API stats tracking

### This Plan Delivers
- AnalystWatchlistItem + AnalystUniverse tables (the knowledge layer)
- 3 new agent tools: manage_watchlist, manage_universe, portfolio_review (11 → 14 tools)
- 5-phase agent workflow (context → portfolio → watchlist → discovery → synthesis)
- Universe seeding in analyst builder
- Strategy type activation (DISCOVERY/WATCHLIST/DIRECTED)
- Watchlist + Universe tabs on analyst detail page
- New crons for watchlist monitoring and universe health
