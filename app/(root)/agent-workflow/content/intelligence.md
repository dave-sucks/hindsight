---
id: intelligence
title: Intelligence Pipeline
summary: Four background jobs run between 6:30 and 7:30 AM ET — sweeping the market, monitoring your portfolio and watchlist, crawling tracked domains — then a router scores and assigns every signal to the analysts who should see it.
---

Your analysts wake up to signals, not to raw noise. The intelligence pipeline runs before the market opens and does the work of finding, filtering, and routing everything worth looking at. Each job produces structured `Signal` rows. The router's job is to match those rows against each analyst's universe and decide who sees what.

By 8 AM, every analyst has a ranked, novelty-filtered feed waiting in three buckets: signals on names it already holds, signals on its watchlist, and new discovery candidates.

## Step 1: Firm market sweep

The first job runs at 6:30 AM. It fires a set of firm-wide Perplexity Sonar queries covering the macro environment, sector moves, and today's notable events. It also pulls the FMP movers list (gainers, losers, most-active) and the Finnhub earnings calendar for the next seven days. Everything gets normalized into canonical GICS sectors and industries before it hits the database.

```reads
Perplexity Sonar?provider=perplexity — firm-wide market and sector queries
get_market_movers?provider=fmp — gainers, losers, most-active stocks
get_earnings_calendar?provider=finnhub — companies reporting in the next 7 days
```

## Step 2: Portfolio and watchlist monitor

At 7:00 AM, the pipeline runs a targeted Sonar search for every open position and watchlist ticker across all enabled analysts. Ticker injection forces the result to tag the symbol it was asked about, so a position on NVDA always comes back with NVDA signals even if the headline doesn't mention it by name.

```reads
Perplexity Sonar?provider=perplexity — per-ticker searches with forced ticker injection
```

## Step 3: Domain monitors

At 7:15 AM, tracked websites get checked via domain-filtered Sonar. When Firecrawl can extract the full article, it writes an `Artifact` row — a clean markdown copy the agent can deep-read later via `read_artifact`. This is how research reports, earnings transcripts, and long-form analysis end up in the pipeline.

```reads
Perplexity Sonar?provider=perplexity — domain-filtered queries for tracked sources
Firecrawl — full-page article extraction into Artifact rows
```

## Step 4: Email ingest

Newsletter emails arrive via a Resend inbound webhook any time they land. A GPT-4o-mini pass extracts one signal per distinct investable idea — pulling out tickers, themes, sentiment, and urgency from the prose. There's no fixed schedule; signals land whenever the email does.

## Step 5: Signal router

At 7:30 AM, the router evaluates every pending `Signal` against every analyst's universe. The match logic is AND across dimensions (sectors, industries, themes, feeds, market cap) and OR within each. Hard watchlist and open position matches bypass the fence entirely.

Each match gets a reason code (`DISCOVERY`, `WATCHLIST`, `POSITION`, `EARNINGS_CALENDAR`, etc.), a relevance score, and a novelty penalty that crushes stale names. Slots per analyst are capped with 20% reserved for genuine discovery candidates. The router then emits `app/signal.routed` — the event the [Trigger Evaluator](agent:triggers) consumes.

```writes
Signal routes — one AnalystSignalRoute row per analyst-signal match
app/signal.routed — event that wakes the Trigger Evaluator
```
