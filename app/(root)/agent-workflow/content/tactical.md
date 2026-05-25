---
id: tactical
title: Tactical Run
summary: Single-thesis, single-decision focused run — spawned when a trigger fires. Validates the signal, takes at most one position action, closes out with an update.
---

When the [Trigger Evaluator](agent:triggers) fires on a thesis, a Tactical Run spawns with a tight step budget focused on one question: did this trigger fire for a real reason, and if so, what's the right move?

It validates against fresh data, takes at most one position action, and always writes an `update_thesis` row as the close-out. It can't mint new theses — `record_thesis` isn't in its allowlist. New coverage only happens in the [Daily Run](agent:agent) and [Discovery Run](agent:discovery).

## Step 1: Validate

Read the trigger predicate that fired and the thesis it's attached to. Pull fresh stock data on the ticker. Decide: is the signal or price level still actionable, or did the setup already move past the entry?

```reads
get_theses — the firing thesis with its full update history
get_stock_data?provider=finnhub — fresh quote, technicals, news
get_earnings_data?provider=finnhub — if the trigger is earnings-related
get_market_context?provider=finnhub — regime check before acting
get_options_flow?provider=fmp — if the trigger references unusual options activity
get_sec_filings?provider=sec — if the trigger references an 8-K or insider filing
read_artifact — full article content behind the firing signal
web_search?provider=perplexity — only when the firing signal doesn't fully explain the setup
dispatch_thesis_research — if deep research is stale or missing before an entry decision
wait_for_thesis_refresh — waits for the research child run before trading
```

## Step 2: Act

At most one position action per run. The tactical agent picks the appropriate tool based on what the trigger says and what the fresh data confirms.

```writes
place_trade?provider=alpaca — open a position when the trigger says ADD or the agent overrides toward entry
close_position?provider=alpaca — full exit when the trigger fires EXIT (stop hit, target hit, invalidation)
manage_position?provider=alpaca — partial close, target or stop adjustment, trail, or scale-in
```

## Step 3: Close out

Every tactical run ends with an `update_thesis`. The audit type reflects the actual decision — `UPDATED` if fields changed, `REVIEWED` if the agent validated but held, `CLOSED` if the thesis is no longer valid.

```writes
update_thesis — required close-out: UPDATED / REVIEWED / CLOSED depending on the decision
```

## Step 4: Complete

```writes
complete_run — marks the run COMPLETE and fires the Briefing Agent inline
```
