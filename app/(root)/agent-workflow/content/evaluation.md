---
id: evaluation
title: Evaluation & Tracking
summary: Background jobs watch open positions hourly, evaluate each closed trade, snapshot EOD prices, and score weekly accuracy. The feedback loop that makes the intelligence pipeline self-improving.
---

While analysts research and trade, a set of background jobs is watching. The price monitor checks every open position every hour. When a position closes, the trade evaluator fires immediately. Closing prices get snapshotted at 5 PM. Sunday morning produces a weekly calibration report.

The most important piece is the source tracer inside the trade evaluator. When a trade closes, it follows the chain back — thesis → signal IDs cited → monitor that found those signals — and updates that monitor's win/loss counters. Monitors that keep producing losing theses drift toward a negative score; the Health tab on `/intelligence` surfaces it. That's what makes the pipeline self-improving over time.

## Price monitor

Runs every hour during market hours. Checks all open positions via Alpaca and flags any that are approaching their target (80%+ of the way there) or getting close to the stop-loss level. Hard stops get closed automatically without waiting for the next Daily Run.

```reads
Alpaca prices?provider=alpaca — live price for every open position
```

## Trade evaluator

Fires on every position close. A GPT-4o pass reviews the closed trade — was the original thesis correct? Was the entry well-timed? What would you do differently? Then it follows the provenance chain.

```writes
GPT-4o trade review — thesis correctness, timing quality, lessons learned
Monitor ROI credit — traces Thesis.sourceSignalIds → Signal → Monitor; increments tradesSourced, winsSourced, lossesSourced, recomputes successScore
```

## EOD snapshot

At 5 PM ET each trading day, closing prices get captured for all open positions. This builds the equity curve over time and feeds into the weekly accuracy scorer.

## Accuracy scorer

Every Sunday at 10 AM, the scorer calculates win rate, per-confidence-bucket calibration (does the analyst's 80%-confidence calls actually win 80% of the time?), and per-sector and per-signal-type breakdowns. Results land in an `AccuracyReport` row and feed back into the next week's analyst prompts.

## Health dashboard

The `/intelligence` Health tab surfaces pipeline drift on demand: crons that have gone silent for more than 48 hours, the signal funnel for each analyst (signals produced vs. routed vs. read), ticker concentration over the past seven days, novelty distribution, and monitor ROI sorted by `successScore`. Low-ROI monitors are candidates for pruning.
