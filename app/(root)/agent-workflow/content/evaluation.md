---
id: evaluation
title: Evaluation & Tracking
summary: Background jobs watch open positions hourly, evaluate each closed trade, snapshot EOD prices, and score weekly accuracy. The feedback loop that tells you whether an analyst's beliefs were right.
---

While analysts research and trade, a set of background jobs is watching. The price monitor checks every open position every hour. When a position closes, the trade evaluator fires immediately. Closing prices get snapshotted at 5 PM. Sunday morning produces a weekly calibration report.

The most important piece is what the trade evaluator grades against. It doesn't just ask whether the trade made money — it reads the thesis's core belief, its key assumptions and its invalidation conditions, and asks which of them actually held. A winner on a belief that turned out wrong is luck, and it gets written down as luck.

## Price monitor

Runs every hour during market hours. Checks all open positions via Alpaca and flags any that are approaching their target (80%+ of the way there) or getting close to the stop-loss level. Hard stops get closed automatically without waiting for the next Daily Run.

```reads
Alpaca prices?provider=alpaca — live price for every open position
```

## Trade evaluator

Fires on every position close. A GPT-4o pass reviews the closed trade against the belief it was written on — was the thesis correct? Was the entry well-timed? What would you do differently?

```writes
GPT-4o trade review — belief correctness, timing quality, lessons learned
```

## EOD snapshot

At 5 PM ET each trading day, closing prices get captured for all open positions. This builds the equity curve over time and feeds into the weekly accuracy scorer.

## Accuracy scorer

Every Sunday at 10 AM, the scorer calculates win rate, per-confidence-bucket calibration (does the analyst's 80%-confidence calls actually win 80% of the time?), and per-sector breakdowns. Results land in an `AccuracyReport` row and feed back into the next week's analyst prompts.

## Health page

`/health` answers one question on demand: is Alpaca telling the same story as our database? Per book, it shows orphans, stale rows, duplicates, quantity mismatches and cost-basis drift off the hourly heartbeat, and each row can be reconciled from there.
