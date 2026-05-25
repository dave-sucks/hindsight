---
id: discovery
title: Discovery Run
summary: Per analyst — scans the past week's discovery signals, runs cheap pass-1 research, dispatches a deep-research [Thesis Writer](agent:thesis-writer) on the survivors. The cadence safety net for new coverage.
---

Discovery Run is how net-new tickers enter an analyst's coverage. Once a week, every enabled analyst spawns a focused agent that scans the past seven days of routed signals on names not already in the library, runs a cheap triage pass, scores survivors on a 4-dimension composite, and either dispatches a deep-research thesis-writer to mint a [WATCHING thesis](entity:thesis), opens an immediate-buy position on a hot-catalyst setup, or writes a PASS thesis for institutional memory.

It operates as a **two-pass funnel**:

- **Pass 1** is everything that happens inside this agent — cheap reads + 4-dim scoring on the candidate pool.
- **Pass 2** is delegated — for each surviving candidate, the agent fires [`dispatch_thesis_research`](tool:dispatch_thesis_research) and the [Thesis Writer](agent:thesis-writer) sub-agent runs asynchronously to produce the full multi-section research note.

Discovery cannot touch existing coverage — only the [Daily Run](agent:agent) and [Tactical Run](agent:tactical) can update or close theses. If conviction on a candidate is high enough at discovery time (composite ≥ 7 + dated catalyst within 5 trading days), it can dispatch the rewrite, wait for it to land, and place a starter trade in the same run — minting the [Thesis](entity:thesis) as `ACTIVE` from the jump. Otherwise everything goes to `WATCHING` and the next Daily Run decides.

## Step 1 · Scan

Pulls candidate [Signals](entity:signal) routed to this analyst by the [Intelligence Pipeline](agent:intelligence). The signal router has already fenced everything by the analyst's Universe (sectors, industries, themes, market cap, exclusions, **feeds**) — Discovery does not re-filter.

- [`read_signals`](tool:read_signals) — always runs. Returns this week's discovery-bucket signals on names not already on the analyst's `ACTIVE` or `WATCHING` book.
- [`get_earnings_calendar`](tool:get_earnings_calendar?provider=finnhub) — runs **only** if the analyst's `feeds` includes `EARNINGS_CALENDAR`. Returns upcoming earnings fenced to this analyst's universe.
- [`get_market_movers`](tool:get_market_movers?provider=fmp) — runs **only** if the analyst's `feeds` includes any of `MARKET_MOVERS_GAINERS / LOSERS / ACTIVES`. Returns today's top-list MINUS names already covered.

The pull tools are gated by `analyst.feeds` so we don't force-pull a firehose the analyst hasn't opted into. An analyst with empty feeds runs Step 1 on `read_signals` alone — a valid, intentional outcome for signal-driven mandates.

## Step 2 · Score

For each promising candidate from Step 1, pulls live stock data and scores on a 4-dimension composite. The composite IS the funnel — it decides which branch of Step 3 each candidate flows into.

- [`get_stock_data`](tool:get_stock_data?provider=finnhub) — quote + technicals + 7d news on the candidate.
- [`get_theses`](tool:get_theses) — cross-analyst overlap check. The thesis-writer rejects same-direction overlap, so it's cheaper to filter here than to waste a dispatch.

**The composite** sums four 0–3 / 0–2 dimensions, capped at 10:

| Dimension | Range | What it measures |
|---|---|---|
| `trendStrength` | 0–3 | Multi-week directional strength on this name |
| `relativeStrength` | 0–3 | Performance vs sector / peers |
| `entryQuality` | 0–2 | Clean setup vs chasing extended price |
| `catalystFreshness` | 0–2 | Proximity + specificity of a dated catalyst |

## Step 3 · Mint

Three branches based on the composite. Most candidates land as `WATCHING` and let the Daily Run promote later. A hot setup can land as `ACTIVE` same-day. Researched-but-passed candidates still get written for institutional memory.

- `composite ≥ 7` **and** a dated catalyst within 5 trading days **and** an open position slot → **immediate-buy**: [`dispatch_thesis_research`](tool:dispatch_thesis_research) (mint) → [`wait_for_thesis_refresh`](tool:wait_for_thesis_refresh) → [`place_trade`](tool:place_trade?provider=alpaca). Lands a [Thesis](entity:thesis) with `status: ACTIVE` + open position from today.
- `composite ≥ 4` → **dispatch to watchlist**: [`dispatch_thesis_research`](tool:dispatch_thesis_research) (mint). The [Thesis Writer](agent:thesis-writer) writes the full multi-section research note and the [Thesis](entity:thesis) lands as `status: WATCHING` with default per-horizon triggers.
- `composite < 4` → **institutional memory**: [`record_thesis`](tool:record_thesis) with `direction: PASS`. Terminal at write — the [Thesis](entity:thesis) lands as `status: ARCHIVED` so future re-encounters can read the prior rationale via `get_theses(include_history: true)`.

Each minted [Thesis](entity:thesis) is then reviewed in the [Daily Run](agent:agent) every weekday morning, and reactively by the [Tactical Run](agent:tactical) whenever a structured trigger on the thesis fires.

## Step 4 · Recap

Closes out the run. Two tool calls.

- [`record_run_summary`](tool:record_run_summary) — structured ranked-picks recap: every candidate the agent researched, the action that landed, the rationale.
- [`complete_run`](tool:complete_run) — marks the run COMPLETE in the DB. The [Briefing Agent](agent:briefing) fires inline to write next week's standup.

## Hard constraints

- Discovery **cannot** call [`update_thesis`](tool:update_thesis) — only Daily and Tactical can touch existing rows.
- Discovery **cannot** mint `LONG` / `SHORT` theses directly via [`record_thesis`](tool:record_thesis). Those go through the [Thesis Writer](agent:thesis-writer). The only direct `record_thesis` calls from Discovery are for `direction: PASS`.
- Dispatch fan-out is capped per run (see `DISPATCH_CAP` in `lib/agent/system-prompts/discovery.ts`) to keep the Anthropic per-org budget bounded.
