---
id: builder
title: Analyst Builder
summary: Guided interview that turns a trading edge into a working analyst — grounded in the actual signal pipeline before anything gets written.
---

You describe the strategy you want to run. The Builder asks a handful of focused questions, picks the closest archetype from the playbook library, checks that the universe actually produces signals today, and outputs a complete analyst config as a side-panel diff you can review and accept.

Nothing gets written until the fence is validated against real routing data. Watchlist tickers come exclusively from that validation — the Builder never invents them.

## Step 1: Ask

The very first tool call is always `ask_question`. Two to five quick replies on the edge you're hunting — earnings, momentum, value, catalyst, thematic — to give the session a direction before anything else runs.

```reads
ask_question — 2-5 options on the edge type; first call in every session
```

## Step 2: Narrow

One to three follow-up `ask_question` calls (one per turn) pin down direction, hold duration, themes, and risk appetite. Multiple related questions go inside a single call's `steps[]` array rather than firing sequentially.

## Step 3: Pick a playbook

The Builder browses the archetype index, presents the top two to four matches as another `ask_question`, then deep-reads the chosen one. It also reads the vetted signal taxonomy and source catalog so the analyst prompt it writes is grounded in what Hindsight's pipeline actually produces.

```reads
read_knowledge_library — strategy archetypes, signal taxonomy, source catalog
get_market_context?provider=finnhub — regime check before sizing the universe
```

## Step 4: Validate the fence

Before writing anything, the Builder runs the proposed universe against 30 days of real routed signals. Zero signals means the fence is too narrow — it widens and re-validates. Watchlist tickers come only from the frequency-ranked output of this step.

```reads
discover_signals_for_fence — validates sectors/industries/themes/tickers against real routes
get_stock_data?provider=finnhub — spot-checks on any candidate tickers
```

## Step 5: Emit

The output is a complete analyst config rendered as a side-panel diff: the analyst prompt adapted from the chosen skeleton, universe dimensions, trading rules, intelligence policy, watchlist, a set of domain monitors, and a few discovery queries. You review and accept.

```writes
suggest_config — full analyst config as a side-panel diff
```
