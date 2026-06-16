---
id: agent
title: Daily Run
summary: Per analyst — reviews every holding and watchlist name every weekday morning, updates theses where new evidence arrived, and trades when conviction is there.
---

Every weekday at 8 AM, each enabled analyst runs a full portfolio review. It reads the signals that came in overnight, works through each thesis one at a time, and asks: does anything need to change today?

For most names the answer is no. Nothing material happened, so the analyst logs that it reviewed the thesis and moves on. For names where something changed — a trigger fired, new evidence arrived, a thesis is stale — it pulls fresh data, updates the thesis with what it learned, and acts on the position if the conviction is there.

## Step 1: Portfolio check-in

Plain-text orientation — no tools. The agent acknowledges its open positions and watchlist, notes any priority reviews flagged by the price monitor, and sets the direction for the session.

## Step 2: Orient

Read everything gathered since the last run. Signals come back in three buckets: portfolio names, watchlist names, and new discovery candidates. Each signal carries an ID that gets wired into any thesis update for provenance.

```reads
read_signals — today's signals in three buckets: portfolio, watchlist, discovery
get_theses — full thesis library: HOLDING, WATCHING, and PROMOTED theses with recent update history and research excerpts
get_portfolio_context — live P&L, days held, distance from peak, exit levels
read_artifact — full article content behind any signal worth a deep read
web_search?provider=perplexity — live search, sparingly, within the per-run budget
get_market_context?provider=finnhub — SPY, VIX, sector ETFs, macro events, regime
```

## Step 3: Per-thesis review

The agent goes through every thesis on the live coverage book one at a time. Each returned thesis now includes a DEEP-RESEARCH EXCERPT — `snapshot`, top bull-case bullets, top bear-case bullets, and a `researchAge` annotation (`fresh`, `stale`, or `missing`). Every trade decision anchors to that excerpt, not just the price level.

**Research staleness gate:** if a thesis has `researchAge.freshness` of `stale` or `missing` AND the intended action is a trade (entry, close, scale), the agent must refresh the research first. The `place_trade` tool gate enforces this — trading off stale research without an in-run refresh is rejected.

```reads
get_stock_data?provider=finnhub — only on theses that warrant real research, not every ticker
get_earnings_data?provider=finnhub — when earnings are within two weeks
get_earnings_calendar?provider=finnhub — firm-wide calendar, scope:coverage for your book
get_market_movers?provider=fmp — today's movers, scope:coverage intersects your positions
get_options_flow?provider=fmp — when unusual options activity is flagged
get_sec_filings?provider=sec — when an insider filing or 8-K is flagged
dispatch_thesis_research — spawns a Thesis Writer to refresh stale or missing research before trading
wait_for_thesis_refresh — blocks until the refresh child run completes, then returns the updated excerpt
```

**`PROMOTED` theses — conviction-pause state.** A `PROMOTED` thesis was `HOLDING` in paper with intact conviction; then the user promoted the analyst from paper to live trading, the paper position was force-closed, and the thesis sits in this state awaiting first-live-run resolution. The row carries conviction context from the paper era: tenure, realized P&L, and how many times the analyst affirmed the thesis before promotion.

The default action on a `PROMOTED` thesis is `place_trade` — re-enter live. That's the doubled-conviction signal: both the analyst's paper track record and the user's explicit promotion decision say this name is worth real money. Research must be fresh before entry (dispatch-then-wait if stale). Recompute target and stop relative to today's price before calling `place_trade` — the paper-era levels are stale.

The only opt-out is `update_thesis(change_status: "WATCHING")` to defer re-entry. `INVALIDATED` and `ARCHIVED` transitions are rejected at the tool layer on `PROMOTED` theses (re-entry is `place_trade`, which flips the thesis to `HOLDING`). Reasoning-only patches (no `change_status`) are also rejected — `PROMOTED` requires an explicit resolution this run.

**Regular `WATCHING` and `HOLDING` theses:** for each name, the questions are: did a trigger fire? Did new evidence arrive? Is a scheduled review due? If none of the above — write a `REVIEWED`-only update and move on. If an entry trigger is currently met, the action is to enter: `place_trade` (the trade tool owns the WATCHING → HOLDING flip on fill). Raising the target instead of trading when the entry condition is met is a run failure.

```writes
update_thesis — every thesis touched gets one audit row (UPDATED, REVIEWED, STATUS_CHANGED, or CLOSED)
record_thesis — net-new coverage or direction flip only; requires source_kind + source_signal_ids
place_trade?provider=alpaca — new entry, or re-entering a PROMOTED thesis live
close_position?provider=alpaca — full exit with realized P&L and reason
manage_position?provider=alpaca — partial close, target/stop update, trail, or scale-in
```

## Step 4: Promotion check

Before recording the run summary, the agent checks: is any entry trigger currently met on a `WATCHING` thesis, and was a `place_trade` actually called for it? Is any open position near its stop, and was it addressed? If something was missed, act now — or document a concrete rejection reason in the run summary. The `record_run_summary` tool rejects `primary_decision: HOLD` when an entry condition is currently met and no trade landed.

## Step 5: Recap

```writes
record_run_summary — ranked picks: every thesis touched + the action that actually happened, plus portfolio exposure breakdown
```

## Step 6: Complete

```writes
complete_run — marks the run COMPLETE and fires the Briefing Agent inline to write tomorrow's standup
```
