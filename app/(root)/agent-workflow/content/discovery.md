---
id: discovery
title: Discovery Run
summary: Per analyst — scans the week's discovery signals, scores survivors, dispatches the [Thesis Writer](agent:thesis-writer) to mint new coverage. The cadence safety net for new tickers.
---

Once a week, every enabled analyst spawns this agent to find new tickers worth covering. Existing coverage is off-limits — the [Daily Run](agent:agent) and [Tactical Run](agent:tactical) handle that.

Most new candidates land as `WATCHING` and the [Daily Run](agent:agent) decides when to enter. A hot setup with a dated catalyst inside 5 trading days can enter same-day.

## Step 1 · Scan

Pulls candidate signals this analyst has access to. The signal router has already universe-fenced everything — Discovery does not re-filter.

```reads
read_signals — always runs · discovery-bucket only
get_earnings_calendar?provider=finnhub — gated by EARNINGS_CALENDAR feed
get_market_movers?provider=fmp — gated by MARKET_MOVERS_* feeds
```

## Step 2 · Score

Each promising candidate gets a 4-dimension composite score. The composite drives the branch in Step 3.

```reads
get_stock_data?provider=finnhub — quote + technicals + 7d news
get_theses — cross-analyst overlap check
```

## Step 3 · Mint

Three outcomes. The composite picks one.

- `composite ≥ 7` + catalyst within 5 trading days + open slot → **immediate-buy**. Dispatches the rewrite, waits for it to land, places a starter trade. [Thesis](entity:thesis) lands as `ACTIVE`.
- `composite ≥ 4` → **dispatch to watchlist**. [Thesis Writer](agent:thesis-writer) writes the full multi-section research note. [Thesis](entity:thesis) lands as `WATCHING`.
- `composite < 4` → **institutional memory**. Direct `PASS` thesis so future re-encounters can read the prior verdict.

```writes
dispatch_thesis_research — mint path (WATCHING) or immediate-buy path
wait_for_thesis_refresh — immediate-buy path only
place_trade?provider=alpaca — immediate-buy path only
record_thesis — direct PASS rows only
```

## Step 4 · Recap

```writes
record_run_summary — structured ranked-picks recap
complete_run — fires the Briefing Agent inline to write next week's standup
```
