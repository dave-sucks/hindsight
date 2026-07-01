---
id: triggers
title: Trigger Evaluator
summary: Checks every active thesis's structured predicates against fresh prices and just-arrived signals. When one hits, it fires the event that wakes a [Tactical Run](agent:tactical).
---

Every thesis can carry structured trigger predicates — price levels, percent moves, technical levels, earnings outcomes, SEC filing types, time elapsed. The Trigger Evaluator's job is simple: check those predicates against reality and fire an event when one matches.

It has two paths. Signals wake it instantly. Prices get checked on a cron. Either way, the output is the same: an audit row and an event that hands the matched thesis off to a [Tactical Run](agent:tactical) for a focused decision — unless the trigger is set to act directly (see Fire mode below).

## What you can trigger on

- **Target Price** — fires when the last quote crosses a fixed level (above or below). Enter / Exit / Review.
- **Movement Amount** — fires when the stock is up or down X% **on the day** (vs the prior close). This is the "% alert." Enter / Exit / Review.
- **Events** — earnings beats/misses, guidance changes, SEC filings (evaluated on the signal path).
- **Housekeeping** — time elapsed, scheduled review date.

## Signal-driven path

When the [Intelligence Pipeline](agent:intelligence) emits `app/signal.routed`, the evaluator wakes immediately and checks every signal-side predicate across all active theses that overlap with the routed ticker. Earnings beats, guidance changes, and 8-K filings are evaluated here.

## Price-driven path

Every 5 minutes during market hours, the evaluator loads all `HOLDING` and `WATCHING` theses with non-empty triggers, batch-fetches fresh quotes for unique tickers (capped at 200 per interval), and evaluates price and time-based predicates against the live data. The daily **Movement Amount** % uses the quote's own daily change, so it fires here; multi-day windows and moving-average crosses need the candle data the daily run pulls.

```reads
Finnhub /quote?provider=finnhub — batch price fetch (incl. daily % change), up to 200 unique tickers per interval
```

## Fire mode

Each Exit trigger chooses how it acts when it fires:

- **Trigger Tactical Run** (default) — wakes a [Tactical Run](agent:tactical) so the agent validates and decides.
- **Automatically Exit** — skips the agent and closes directly (cheaper, for mechanical stops). Either way, if your account requires approval for sells, the close is **proposed** for you to approve — it never auto-sells behind an approval gate.

## Cooldown gate

A per-trigger cooldown window prevents the same predicate from firing twice in a short period. Terminal `EXIT` stops may opt out (`cooldownDays: 0`) so a stop hit always fires; every other action gets a sane default.

## Fire

When a predicate matches, the evaluator stamps `lastFiredAt` on the trigger, writes a `ThesisUpdate` audit row (type `TRIGGER_FIRED`) with the thesis ID, trigger ID, and any matching signal IDs, and either closes directly (Automatically Exit) or emits `app/thesis.trigger.fired` for a [Tactical Run](agent:tactical). `Review` triggers are batched into the next daily run rather than waking an agent immediately.

```writes
ThesisUpdate — TRIGGER_FIRED audit row with thesisId, triggerId, signalIds
app/thesis.trigger.fired — event that spawns a Tactical Run
```
