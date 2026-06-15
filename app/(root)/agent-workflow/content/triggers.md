---
id: triggers
title: Trigger Evaluator
summary: Checks every active thesis's structured predicates against fresh prices and just-arrived signals. When one hits, it fires the event that wakes a [Tactical Run](agent:tactical).
---

Every thesis can carry structured trigger predicates — price levels, technical levels, earnings outcomes, SEC filing types, time elapsed. The Trigger Evaluator's job is simple: check those predicates against reality and fire an event when one matches.

It has two paths. Signals wake it instantly. Prices get checked on a cron. Either way, the output is the same: an audit row and an event that hands the matched thesis off to a [Tactical Run](agent:tactical) for a focused decision.

## Signal-driven path

When the [Intelligence Pipeline](agent:intelligence) emits `app/signal.routed`, the evaluator wakes immediately and checks every signal-side predicate across all active theses that overlap with the routed ticker. Earnings beats, guidance changes, and 8-K filings are evaluated here.

## Price-driven path

Every 15 minutes during market hours, the evaluator loads all `HOLDING` and `WATCHING` theses with non-empty triggers, batch-fetches fresh quotes for unique tickers (capped at 200 per interval), and evaluates price and time-based predicates against the live data.

```reads
Finnhub /quote?provider=finnhub — batch price fetch, up to 200 unique tickers per interval
```

## Cooldown gate

A per-trigger cooldown window prevents the same predicate from firing twice in a short period. `EXIT` triggers skip the cooldown entirely — a stop hit or target reached must always fire, even if the same trigger fired recently.

## Fire

When a predicate matches, the evaluator stamps `lastFiredAt` on the trigger, writes a `ThesisUpdate` audit row (type `TRIGGER_FIRED`) with the thesis ID, trigger ID, and any matching signal IDs, and emits `app/thesis.trigger.fired`. That event is what the [Tactical Run](agent:tactical) consumes.

```writes
ThesisUpdate — TRIGGER_FIRED audit row with thesisId, triggerId, signalIds
app/thesis.trigger.fired — event that spawns a Tactical Run
```
