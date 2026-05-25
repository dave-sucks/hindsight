---
id: agent
title: Daily Run
summary: Per analyst — reviews every holding and watchlist name every weekday morning, updates theses where new evidence arrived, and trades when conviction is there.
---

Every weekday at 8 AM, each enabled analyst runs a full portfolio review. It reads the signals that came in overnight, works through each name one at a time, and asks: does anything need to change today?

For most names the answer is no. Nothing material happened, so the analyst logs that it reviewed the thesis and moves on. For names where something changed — a signal fired, a trigger predicate matched, research is stale — it pulls fresh data, updates the thesis, and acts on the position if the conviction is there. The Daily Run can also enter new positions on discovery candidates that arrived overnight.

## Step 1: Portfolio check-in

Plain-text orientation — no tools. The agent acknowledges its open positions and watchlist, notes any priority reviews flagged by the price monitor, and sets the direction for the session.

## Step 2: Orient

Read everything gathered since the last run. Signals come back in three buckets: portfolio names, watchlist names, and new discovery candidates. Each signal carries an ID that gets wired into any thesis update for provenance.

```reads
read_signals — today's signals in three buckets: portfolio, watchlist, discovery
get_theses — full thesis library: ACTIVE, WATCHING, and PROMOTED theses with recent update history
get_portfolio_context — live P&L, days held, distance from peak, exit levels
read_artifact — full article content behind any signal worth a deep read
web_search?provider=perplexity — live search, sparingly, within the per-run budget
get_market_context?provider=finnhub — SPY, VIX, sector ETFs, macro events, regime
```

## Step 3: Per-thesis review

The agent goes through every `ACTIVE`, `WATCHING`, and `PROMOTED` thesis one at a time. For each name it asks: did a trigger fire or new evidence arrive? Is a scheduled review due? If neither, it writes a `REVIEWED`-only update and moves on.

`PROMOTED` theses — names in conviction-pause state from a paper-to-live promotion — require an explicit decision this run: either `place_trade` to re-enter live, or `update_thesis` to move the name back to `WATCHING`. No reasoning-only patches allowed.

Research that's more than 14 days old or missing entirely triggers a `dispatch_thesis_research` call before any trade action is taken.

```reads
get_stock_data?provider=finnhub — only on theses that warrant real research, not every ticker
get_earnings_data?provider=finnhub — when earnings are within two weeks
get_earnings_calendar?provider=finnhub — firm-wide calendar, scope:coverage for your book
get_market_movers?provider=fmp — today's movers, scope:coverage intersects your positions
get_options_flow?provider=fmp — when unusual options activity is flagged
get_sec_filings?provider=sec — when an insider filing or 8-K is flagged
dispatch_thesis_research — spawns a Thesis Writer to refresh stale or missing deep research
wait_for_thesis_refresh — waits for the research child run to complete before trading
```

## Step 4: Position management

Act on what the research showed. `update_thesis` is the default close-out for every thesis touched. `record_thesis` is reserved for net-new coverage or a direction flip — not for updates to names already in the library.

```writes
update_thesis — every thesis touched in the review gets one audit row (UPDATED, REVIEWED, STATUS_CHANGED, CLOSED)
record_thesis — net-new coverage or direction flip only; requires source_kind + source_signal_ids
place_trade?provider=alpaca — new entry, or re-entering a PROMOTED thesis live
close_position?provider=alpaca — full exit with realized P&L and reason
manage_position?provider=alpaca — partial close, target/stop update, trail, or scale-in
```

## Step 5: Recap

```writes
record_run_summary — ranked picks recap: every thesis touched + the action that actually happened, plus portfolio exposure breakdown
```

## Step 6: Complete

```writes
complete_run — marks the run COMPLETE and fires the Briefing Agent inline to write tomorrow's standup
```
