# Hindsight Agent — Full Data Flow & Expected DB State

Use this document to debug the agent pipeline. It describes every DB write
that should happen during a successful run, what the cron jobs do afterward,
and what a "healthy" database looks like.

---

## 1. Run Creation (POST /api/research/agent-run)

**Trigger:** User clicks "Run" on an analyst, or morning-research cron fires.

**Writes:**

| Table | Action | Key Fields |
|-------|--------|------------|
| ResearchRun | CREATE | `status=RUNNING`, `source="AGENT"` (manual) or `"MANUAL"` (cron), `agentConfigId` (FK to analyst), `parameters` (JSON snapshot of analyst config) |

**Expected state after:** 1 new ResearchRun row with `status=RUNNING`.

---

## 2. Agent Execution (POST /api/research/agent)

The agent route loads the ResearchRun, builds a system prompt with historical
context (recent trades, accuracy, past briefings, PASS decisions), then calls
GPT-4.1 with 14 tools via `streamText`.

### Tools That Are READ-ONLY (no DB writes)

These tools only call external APIs and return data to the model:

- `get_market_overview` — SPY/VIX/sectors from Finnhub
- `scan_candidates` — earnings + movers + trending tickers
- `get_stock_data` — quote + profile + metrics from Finnhub
- `get_technical_analysis` — RSI, SMA, volume from Finnhub candles
- `get_earnings_data` — earnings calendar from Finnhub
- `get_options_flow` — unusual options from FMP (alias: `get_unusual_options_flow`)
- `get_reddit_sentiment` — Reddit posts
- `get_twitter_sentiment` — StockTwits/FMP social
- `get_sec_filings` — SEC EDGAR filings
- `get_analyst_targets` — FMP analyst consensus
- `get_company_peers` — Finnhub peer comparison
- `get_news_deep_dive` — multi-source news + press releases
- `search_reddit` — Reddit search
- `detect_market_themes` — LLM theme analysis
- `scan_catalysts` — aggregated catalyst data

### show_thesis — Persists a Thesis

Called once per ticker the agent analyzes. Direction is LONG, SHORT, or PASS.

| Table | Action | Key Fields |
|-------|--------|------------|
| Thesis | CREATE | `researchRunId`, `ticker`, `direction` (LONG/SHORT/PASS), `confidenceScore` (0-100), `entryPrice`, `targetPrice`, `stopLoss`, `reasoningSummary`, `thesisBullets[]`, `riskFlags[]`, `signalTypes[]`, `holdDuration`, `sourcesUsed` (JSON), `source="AGENT"` |
| RunEvent | CREATE | `runId`, `type="thesis_complete"` (or `"skip"` for PASS), `payload` = thesis data |
| TradeDecision | CREATE (PASS only) | `runId`, `analystId`, `symbol`, `decision="PASS"`, `reasoning`, `thesisId` |

**Expected:** 1 Thesis + 1 RunEvent per ticker. If PASS, also 1 TradeDecision.
If LONG/SHORT, TradeDecision is created by `place_trade` instead.

### place_trade — Opens a Position via Alpaca

Called only for LONG/SHORT theses that meet confidence threshold.

| Table | Action | Key Fields |
|-------|--------|------------|
| Position | CREATE | `analystId`, `symbol`, `direction` (LONG/SHORT), `status=OPEN`, `quantity`, `avgCost` (filled price), `targetPrice`, `stopLoss`, `exitStrategy="PRICE_TARGET"` |
| Order | CREATE | `positionId`, `symbol`, `side` (BUY/SELL), `orderType="MARKET"`, `quantity`, `status="FILLED"`, `filledPrice`, `filledQty`, `filledAt`, `alpacaOrderId` |
| PositionEvent | CREATE | `positionId`, `eventType="OPENED"`, `description`, `priceAt` |
| TradeDecision | CREATE | `runId`, `analystId`, `symbol`, `decision="BUY"`, `reasoning`, `thesisId`, `positionId`, `orderId` |
| RunEvent | CREATE | `runId`, `type="trade_placed"`, `payload` = {position_id, order_id, ticker, shares, price} |

**Expected per trade:** 1 Position + 1 Order + 1 PositionEvent + 1 TradeDecision + 1 RunEvent.

### summarize_run — Marks Run Complete

Called once at the end of the run.

| Table | Action | Key Fields |
|-------|--------|------------|
| ResearchRun | UPDATE | `status=COMPLETE`, `completedAt=now()` |
| RunEvent | CREATE | `type="run_summary"`, `payload` = {summary, ranked_picks, risk_notes, portfolio_review} |
| RunEvent | CREATE | `type="run_complete"`, `payload` = {analyzed, recommended, placed} |

### After Stream Completes (onFinish callback)

| Table | Action | Key Fields |
|-------|--------|------------|
| RunMessage | DELETE all for run, then CREATE | `runId`, `role="thread"`, `content` = JSON stringified full conversation |
| AnalystBriefing | CREATE | `analystId`, `runId`, `narrative` (AI markdown), `marketContext` (JSON), `theses` (JSON array), `trades` (JSON array), `portfolioSnapshot` (JSON), `strategyNotes` |

---

## 3. Expected DB State After One Successful Run

Assuming the agent scans 5 tickers, creates theses for 3, trades 1:

| Table | Expected Rows | Notes |
|-------|--------------|-------|
| ResearchRun | 1 | `status=COMPLETE` |
| RunEvent | 6 | 3 thesis_complete/skip + 1 trade_placed + 1 run_summary + 1 run_complete |
| RunMessage | 1 | Full conversation thread |
| Thesis | 3 | 1 LONG + 2 PASS (example) |
| TradeDecision | 3 | 1 BUY + 2 PASS |
| Position | 1 | `status=OPEN` |
| Order | 1 | `status=FILLED` |
| PositionEvent | 1 | `eventType=OPENED` |
| AnalystBriefing | 1 | Linked to run + analyst |

---

## 4. Cron Job Lifecycle (What Happens After the Run)

### price-monitor (hourly 9AM–5PM ET Mon–Fri)

For every OPEN Position:

| Table | Action | Key Fields |
|-------|--------|------------|
| PositionEvent | CREATE | `eventType="PRICE_CHECK"`, `priceAt` (current), `pnlAt` (unrealized P&L) |
| Position | UPDATE (conditional) | `nearTargetAlertSent=true` when price reaches 80% of target |

Also calls `checkExitConditions()` which may trigger a close:

| Table | Action | Condition |
|-------|--------|-----------|
| PositionEvent | CREATE | `eventType="NEAR_TARGET"` when 90%+ to target (max once per 2 hours) |
| → closeOpenPosition() | See below | When target hit, stop hit, or time expired |

### closeOpenPosition() — Closing a Position

| Table | Action | Key Fields |
|-------|--------|------------|
| Order | CREATE | `side` opposite of entry (SELL for LONG, BUY for SHORT), `status="FILLED"`, `filledPrice` |
| Position | UPDATE | `status=CLOSED`, `closePrice`, `closeReason` (TARGET/STOP/TIME/MANUAL), `realizedPnl`, `outcome` (WIN/LOSS/BREAKEVEN), `closedAt` |
| PositionEvent | CREATE | `eventType="CLOSED"`, `priceAt`, `pnlAt` |
| Inngest event | FIRE | `trade/closed` with `positionId` → triggers trade-evaluator |

### eod-evaluation (5PM ET Mon–Fri)

| Table | Action | Key Fields |
|-------|--------|------------|
| PositionEvent | CREATE (per OPEN position) | `eventType="EOD_CHECK"`, `priceAt`, `pnlAt` (idempotent per day) |
| Inngest event | FIRE (for unevaluated CLOSED positions) | `trade/closed` → triggers trade-evaluator |

### trade-evaluator (event: trade/closed)

| Table | Action | Key Fields |
|-------|--------|------------|
| Position | UPDATE | `agentEvaluation` = GPT-4o narrative evaluation |
| PositionEvent | CREATE | `eventType="EVALUATED"`, `description` = evaluation text |

### accuracy-scorer (Sunday 10AM ET)

| Table | Action | Key Fields |
|-------|--------|------------|
| AccuracyReport | UPSERT | `weekStartDate`, `weekEndDate`, `tradesAnalyzed`, `winRate` (0–1), `calibrationData` (JSON), `signalAccuracy` (JSON), `directionStats` (JSON), `narrativeSummary` (GPT-4o text) |

### morning-research (8AM ET Mon–Fri)

Same as manual run flow (sections 1–2) but triggered by cron.
Additional writes after agent completes:
- Updates `researchRun.parameters` with `agentSteps`, `agentToolCalls`, `elapsedMs`
- Deletes + recreates RunMessage with full thread

---

## 5. Full Position Lifecycle

```
OPENED → PRICE_CHECK (hourly) → NEAR_TARGET (optional) → CLOSED → EVALUATED
```

| Stage | PositionEvent.eventType | Position.status | Who Creates It |
|-------|------------------------|-----------------|----------------|
| Trade placed | OPENED | OPEN | place_trade tool |
| Hourly check | PRICE_CHECK | OPEN | price-monitor cron |
| Near target | NEAR_TARGET | OPEN | price-monitor / checkExitConditions |
| End of day | EOD_CHECK | OPEN | eod-evaluation cron |
| Position closed | CLOSED | CLOSED | closeOpenPosition() |
| Post-trade eval | EVALUATED | CLOSED | trade-evaluator |

Position fields at close:
- `closePrice`, `closedAt`, `closeReason` (TARGET/STOP/TIME/MANUAL)
- `realizedPnl` = (closePrice - avgCost) × quantity (LONG) or reversed (SHORT)
- `outcome` = WIN (pnl > 1%), LOSS (pnl < -1%), BREAKEVEN (in between)
- `agentEvaluation` = GPT-4o narrative (set by trade-evaluator)

---

## 6. Relationship Map

```
AgentConfig (analyst)
  ├── ResearchRun[]
  │     ├── RunEvent[]
  │     ├── RunMessage[] (1 row = full thread)
  │     ├── Thesis[]
  │     ├── TradeDecision[]
  │     └── AnalystBriefing (1:1)
  ├── Position[]
  │     ├── Order[] (1 opening + 1 closing)
  │     ├── PositionEvent[] (OPENED → PRICE_CHECK* → CLOSED → EVALUATED)
  │     └── TradeDecision (1:1 via decision)
  ├── AnalystBriefing[]
  └── TradeDecision[]

TradeDecision links:
  - runId → ResearchRun
  - analystId → AgentConfig
  - thesisId → Thesis (optional)
  - positionId → Position (optional, only for BUY/SELL)
  - orderId → Order (optional, only for BUY/SELL)
```

---

## 7. Debugging Checklist

**After a run completes, verify:**

- [ ] ResearchRun exists with `status=COMPLETE` and `completedAt` set
- [ ] RunEvents exist: at least 1 `thesis_complete` + 1 `run_summary` + 1 `run_complete`
- [ ] Thesis rows exist for each ticker analyzed
- [ ] For each LONG/SHORT thesis: Position + Order + PositionEvent(OPENED) + TradeDecision(BUY) exist
- [ ] For each PASS thesis: TradeDecision(PASS) exists
- [ ] RunMessage has 1 row with the full conversation
- [ ] AnalystBriefing has 1 row linked to this run (created async after stream)

**After market hours (crons running):**

- [ ] PositionEvent(PRICE_CHECK) rows accumulate hourly for OPEN positions
- [ ] PositionEvent(EOD_CHECK) appears once per day at 5PM
- [ ] When position closes: Position.status=CLOSED, closePrice/realizedPnl/outcome set
- [ ] After close: PositionEvent(EVALUATED) + Position.agentEvaluation set
- [ ] Sunday: AccuracyReport row for the week (only if ≥3 closed trades)

---

## 8. Old vs New Model (Trade → Position Migration)

The old model used `Trade` + `TradeEvent` tables. The new model uses:
- `Position` (replaces Trade) — the holding
- `Order` (new) — individual buy/sell orders on a position
- `PositionEvent` (replaces TradeEvent) — lifecycle events
- `TradeDecision` (new) — decision journal linking thesis → position → order

The old `Trade` and `TradeEvent` tables are deprecated and can be dropped.
