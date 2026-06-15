---
id: discovery
title: Discovery Run
summary: Per analyst — two-pass funnel that triage-scores the week's discovery candidates and hands off survivors to the [Thesis Writer](agent:thesis-writer) for a full research note. The cadence safety net for new tickers.
---

Discovery runs as a two-pass funnel. Pass 1 is cheap triage: the Discovery agent scans the week's signals, scores the candidates on a four-dimension composite, and decides who makes the cut. Pass 2 is delegated: survivors get handed off to the [Thesis Writer](agent:thesis-writer) sub-agent, which pulls deep data and synthesizes a full research note. Discovery never mints `LONG` or `SHORT` theses itself — that's the Thesis Writer's job. Discovery only calls `record_thesis` directly for `PASS` rows (institutional memory, terminal at write).

The agent can't touch coverage it already holds — the [Daily Run](agent:agent) and [Tactical Run](agent:tactical) handle that.

## Step 1: Read

Pull the discovery surfaces in one parallel turn. Which tools run is gated by the analyst's feed subscriptions — no force-pulling a firehose the analyst didn't opt into.

```reads
read_signals — always; pulls this week's discovery-bucket signals, auto-excluding already-covered tickers
get_market_movers?provider=fmp — only for analysts subscribed to a MARKET_MOVERS_* feed
get_earnings_calendar?provider=finnhub — only for analysts subscribed to the EARNINGS_CALENDAR feed
```

## Step 1.5: Triage

Before calling any `get_stock_data`, the agent narrates a gut-take on every candidate: what caught the eye, and what needs verifying to be worth a deeper look. Names dismissed here (penny stocks, fence mismatches, obvious junk) get no thesis row — just a note in the run summary.

## Step 2: Pass-1 research

For every candidate that survived triage, run cheap research. First a cross-analyst overlap check, then a stock data pull. Both are parallelized across all candidates — no serializing.

```reads
get_theses — cross-analyst overlap check; if another analyst already holds the same direction, skip
get_stock_data?provider=finnhub — quote, technicals, 7-day news
```

Score each candidate on the four-dimension composite:

- **Trend strength** (0–3) — is the underlying price action constructive?
- **Relative strength** (0–3) — how is it performing vs. sector and market?
- **Entry quality** (0–2) — is there a clean technical setup?
- **Catalyst freshness** (0–2) — is there a recent or upcoming catalyst?

The composite is the gate between Pass 1 and Pass 2.

## Step 3: Per-candidate action

Three outcomes, picked by composite:

- **Composite ≥ 4** → dispatch the [Thesis Writer](agent:thesis-writer). It produces the full research note and mints the `WATCHING` thesis. Capped at 2 dispatches per run (testing phase; production target is 5).
- **Composite < 4, but researched** → write a `PASS` thesis directly via `record_thesis`. Terminal at write; kept as institutional memory so future re-encounters can read the prior verdict and the conditions that would flip it.
- **Dismissed in triage, not researched** → skip entirely. No thesis row.

```writes
dispatch_thesis_research — fire-and-forget; returns a childRunId and the Thesis Writer runs asynchronously
record_thesis — PASS rows only; direction='PASS', reasoning_summary, invalidation_conditions
```

## Immediate-buy exception

The default outcome is `WATCHING` — the [Daily Run](agent:agent) promotes to `HOLDING` the next morning when an entry trigger fires. The exception is a hot-catalyst setup where waiting risks missing the move.

All four criteria must hold: composite ≥ 7, a specific dated catalyst within the next 5 trading days, no existing open position on this ticker, and an open slot.

When all four are met, the flow is sequential rather than fire-and-forget:

```writes
dispatch_thesis_research — with mode:mint and the immediate-buy reason
wait_for_thesis_refresh — blocks until the Thesis Writer completes (up to 150s)
place_trade?provider=alpaca — same-day entry; atomically flips WATCHING → HOLDING on fill
```

If the wait fails or times out, do not place the trade. The `WATCHING` thesis still exists; let the next Daily Run promote it normally.

## Step 4: Recap

```writes
record_run_summary — ranked picks: every candidate + which bucket it landed in (dispatch / PASS / skip)
complete_run — marks the run COMPLETE and fires the Briefing Agent inline
```
