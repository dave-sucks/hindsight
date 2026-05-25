---
id: discovery
title: Discovery Run
summary: Per analyst — scans the week's discovery signals, scores survivors, and hands off to the [Thesis Writer](agent:thesis-writer) to mint new coverage. The cadence safety net for new tickers.
---

Once a week, every enabled analyst spawns this agent to find new tickers worth covering. It can't touch coverage the analyst already holds — the [Daily Run](agent:agent) and [Tactical Run](agent:tactical) handle that.

Most new candidates land as watching, and the next Daily Run decides when to enter. A hot setup with a dated catalyst inside five trading days can enter the same day.

## Step 1: Scan

Pulls candidate signals this analyst has access to. The signal router has already universe-fenced everything before it gets here, so Discovery does not re-filter.

```reads
read_signals — pulls this week's discovery-bucket signals
get_earnings_calendar?provider=finnhub — for analysts subscribed to the earnings calendar feed
get_market_movers?provider=fmp — for analysts subscribed to a market movers feed
```

## Step 2: Score

Each promising candidate gets a quick four-dimension composite score (trend strength, relative strength, entry quality, catalyst freshness). The composite is what decides Step 3.

```reads
get_stock_data?provider=finnhub — quote, technicals, and recent news on the candidate
get_theses — checks if another analyst already covers it
```

## Step 3: Mint

Three outcomes. The composite picks one.

- Composite of 7 or higher, with a dated catalyst inside five trading days and an open slot — this is the immediate-buy path. The agent dispatches the Thesis Writer, waits for it to finish, then places a starter trade. The thesis lands as active from the jump.
- Composite of 4 or higher — dispatch to the watchlist. The Thesis Writer produces the full multi-section research note and the thesis lands as watching.
- Composite below 4 — write a direct PASS thesis. Terminal at write, kept for institutional memory so future re-encounters can read the prior verdict.

```writes
dispatch_thesis_research — used by both the immediate-buy and the watchlist-mint paths
wait_for_thesis_refresh — only used on the immediate-buy path
place_trade?provider=alpaca — only used on the immediate-buy path
record_thesis — only used for direct PASS rows
```

## Step 4: Recap

```writes
record_run_summary — structured ranked-picks recap
complete_run — fires the Briefing Agent inline to write next week's standup
```
