---
id: editor
title: Analyst Editor
summary: Refines an existing analyst — figures out the size of the change first, then does only as much rewriting as that change actually needs.
---

Not every change to an analyst needs a full rewrite. The Editor classifies what you're asking for before it touches anything, and matches the size of the edit to the size of the request. A numeric tweak leaves the strategy prompt alone. A fence change re-validates against real data but preserves everything else. Only a full archetype shift rewrites the prompt from scratch.

Risk and exit discipline that's already working always gets preserved across every lane.

## Step 1: Classify

The Editor silently decides which of four lanes applies: a question that just needs an answer, a numeric-only change (confidence threshold, position size, hold duration), a universe fence change, or a full archetype shift. The lane determines how much rewriting happens — and whether the strategy prompt gets touched at all.

## Step 2: Ground in real data

For fence changes and archetype shifts, the Editor pulls 30 days of this analyst's actual routing history before suggesting anything. That shows which themes are getting signals, which are dead, and which tickers keep showing up but aren't on the watchlist yet.

```reads
read_analyst_inbox_stats — 30-day routing rollup: top tickers, dead themes, hot unwatched names
```

## Step 3: Pin down ambiguity

One `ask_question` per turn with two to five options. Vague requests like "make this more aggressive" get resolved to exactly one field — `minConfidence`, position size, `maxOpenPositions`, or signal type — before anything changes.

```reads
ask_question — one call per turn; multiple questions bundled via steps[]
```

## Step 4: Validate the proposed fence

If the universe is changing, the Editor runs the proposed dimensions against real signal data. Zero routes means the fence is too narrow. New watchlist tickers come only from the frequency-ranked output — never invented.

```reads
discover_signals_for_fence — validates the new universe against 30 days of real routes
read_knowledge_library — re-reads the current archetype skeleton for consistency; full three-beat selection for archetype shifts
get_stock_data?provider=finnhub — spot-checks any candidate tickers
```

## Step 5: Emit

The output is a scoped diff. A numeric-only change touches nothing in the prompt. A fence change weaves in the new paragraph and preserves the rest. An archetype shift rewrites from the new skeleton. Sectors and industries always travel together.

```writes
suggest_config — updated analyst config as a side-panel diff
```
