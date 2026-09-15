# The Signals lane — brief

> For the session building earnings, SEC filings, insider buying, movers and
> other outside data. Read `docs/plans/LANES.md` first; this file only adds
> what's specific to your lane. Your roadmap is yours — this is how it lands.

## Read, in order

1. `CLAUDE.md` and your memory index.
2. `docs/plans/LANES.md` — ownership, the three doors, the laws, the shared files.
3. `docs/plans/MARKET_DATA.md` and `docs/plans/EARNINGS_AND_MOVERS.md`.
4. `docs/prompts/QB_SESSION.md` §3 and §4 — the rulings and how your PRs are reviewed.

## What exists

- Earnings off the calendar: `EARNINGS_BEAT`, `EARNINGS_MISS`, `EARNINGS_WITHIN`, `EARNINGS_SINCE`; account-level earnings wakes on every name; the Earnings page and stock tab; chat's reported-earnings window. First real fire expected around MU's report at the end of September.
- Insider buying: `INSIDER_CLUSTER` and the insider line in the writer's data.
- Movers from Alpaca's screener; statements from Finnhub's filed financials; the morning vendor probe.
- FMP is gone. Estimate revisions have no vendor on the current plan.

## Rules specific to your lane

- **A new kind ships whole** (Door 1 in `LANES.md`): types, schema, evaluator, sentence, popover, tests, one replayed from real data. If no real case exists yet, say so and show the closest real row.
- **You propose uses, you don't write them.** When a kind or field is live, file a ticket to the Agents lane with the proof and the setup you think it serves. Don't edit agent prompts or `setups.ts`.
- **Count your calls.** Every job and tool states Finnhub (or other vendor) calls per run in its PR. The trigger check has first claim on the quote budget.
- **Empty is not ok.** A source that failed or returned nothing is named in words everywhere it's shown — the tool result, the row, the log.
- **SEC filings return as kinds that actually fire** (for example an 8-K item, or an S-3 / 424B offering on a held name), never as a generic "filing" that nothing evaluates.
