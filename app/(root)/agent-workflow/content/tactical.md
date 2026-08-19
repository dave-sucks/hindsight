---
id: tactical
title: Tactical Run
summary: Single-thesis, single-decision focused run — spawned when a trigger fires. Reads the deep-research excerpt, validates the signal, takes at most one position action, closes out with an update.
---

When the [Trigger Evaluator](agent:triggers) fires on a thesis, a Tactical Run spawns with a tight step budget focused on one question: did this trigger fire for a real reason, and if so, what's the right move?

The thesis context includes a DEEP-RESEARCH EXCERPT — snapshot, top bull-case bullets, top bear-case bullets, and a `researchAge` annotation. Every decision anchors to that excerpt. The bear-case bullets in particular matter: if any of them have come true since the research was written, the trigger may be firing into an invalidated thesis.

It validates against fresh data, takes at most one position action, and always writes an `update_thesis` row as the close-out. `record_thesis` isn't in its allowlist — new coverage only happens in the [Daily Run](agent:agent) and [Discovery Run](agent:discovery).

## Step 1: Validate

Read the trigger predicate and the firing thesis. Pull fresh stock data. Decide: is the signal or price level still actionable, or has the setup moved past the entry?

If the research is `stale` or `missing` AND the intended action is a trade, the `place_trade` tool gate will reject it. Refresh first.

```reads
get_stock_data?provider=finnhub — fresh quote, technicals, news — required
get_theses — the firing thesis with its full update history
get_earnings_data?provider=finnhub — if the trigger is earnings-related
get_market_context?provider=finnhub — regime check before acting
get_sec_filings?provider=sec — if the trigger references an 8-K or insider filing
read_artifact — full article content behind the firing signal
web_search?provider=perplexity — only when the firing signal doesn't fully explain the setup
dispatch_thesis_research — refresh stale or missing research before a trade action
wait_for_thesis_refresh — blocks until the refresh child run completes
```

## Step 2: Act

At most one position action per run. The confirmation gate runs before `place_trade`: (a) the live quote still confirms the level, (b) no contradicting headline in the last hour. For `TRADE`-horizon theses, a volume check also applies — 1.5x average is the bar, but only if the session is past mid-day. For `CATALYST`, `TARGET`, and `COMPOUNDER` horizons, volume is informational and never a reason to reject.

```writes
place_trade?provider=alpaca — open a position when the action is ADD; it atomically flips the thesis WATCHING/PROMOTED → HOLDING on the fill (no separate status call) and records the recomputed target and stop
close_position?provider=alpaca — full exit when the trigger fires EXIT
manage_position?provider=alpaca — partial close, target or stop adjustment, trail, or scale-in
```

## Step 3: Close out

Every tactical run ends with exactly one `update_thesis`, passing the `triggerId` so the thesis timeline carries the link. The audit type reflects the actual decision: `UPDATED` if fields changed, `REVIEWED` if the agent validated but held or found a false fire, `INVALIDATED` if the thesis itself is no longer applicable.

```writes
update_thesis — required close-out; must include triggerId; UPDATED / REVIEWED / INVALIDATED
```

## Step 4: Complete

```writes
complete_run — marks the run COMPLETE and fires the Briefing Agent inline
```
