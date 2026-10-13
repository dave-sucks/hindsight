# Under the hood

**Under the hood.** Where the data comes from, when everything runs, and which model does what.

The parts underneath the agents, for when you want to know how something actually works.

<!-- asset: system-layers -->

## Everything runs on a clock

Eastern time, on trading days unless it says otherwise.

- **6:25 AM:** Every market-data source is probed; an email goes out if one is empty or erroring.
- **6:30 AM:** The chart numbers for every stock on the book: averages, highs, RSI, strength, gaps, insider buys.
- **8:00 AM:** Morning runs, on each analyst's run days.
- **9:30 AM – 4:00 PM:** The trigger check, every five minutes. Holdings' highs are tracked hourly for the trails.
- **10:00 AM:** The morning digest: what the runs did, in one email.
- **4:20 PM:** The close pass: levels that read the closing price.
- **5:00 PM:** End-of-day snapshots of every position.
- **8:00 PM:** The portfolio digest the next morning's runs read.
- **Sundays:** Weekly scorecards: win rate, and how well conviction matched outcomes.

## Where the data comes from

Live prices and every bar come from Alpaca, off the consolidated tape, with Finnhub behind it if a price can't be had. A live price is never cached, and every quote carries the time it printed, so a stale one is said out loud instead of passed off as now. Earnings, company numbers, news and insider trades come from Finnhub; filings straight from the SEC; the web from Perplexity and Claude's own search; X from Grok.

Some data isn't on any plan we hold: analyst price targets, forward revenue and EPS estimates, an economic calendar and options chains. The tools say so when asked, and never guess.

## The right model for each job

- **Morning runs, trigger runs, discovery:** GPT-5.4. Up to 65, 15 and 45 steps a run, with the prompt cached between steps.
- **The Writer:** Claude Sonnet 4.6. Won a side-by-side test on grounded research and getting fiscal years right.
- **Chat:** Claude Sonnet 4.6. With thinking on, for the questions that need a careful answer.
- **Analyst builder:** GPT-4o. Fast, because you're waiting on it in a conversation.

## What an agent is told

Every agent is a job and a list of tools, plus the parts every agent shares: the house rules (how to write, and that your word comes first), the analyst's brief, and the read of its stocks. What a stock needs arrives with the stock, through its [situations](situations.md), never in a prompt. The Framework tab takes one request apart, piece by piece, with every size measured from the code.

[Open the Framework →](/docs/framework)

<details>
<summary>Technical details</summary>

#### Jobs
Inngest functions in `lib/inngest/functions/`, served from `app/api/inngest/route.ts`.

#### Live price
`lib/market-data/live-quote.ts`: Alpaca first, Finnhub behind it. Never cached.

#### Chart numbers
`indicator-snapshot.ts` → `TickerIndicators`, from `lib/market-data/price-structure.ts`.

#### Prompts
`lib/agent/system-prompt.ts` (morning), `lib/agent/system-prompts/intraday-tactical.ts` (trigger), `buildPrincipalSystemPrompt` in `lib/agent/modes.ts` (chat), `lib/agent/house-rules.ts`, `lib/agent/voice.ts`.

#### Plans
`docs/plans/AGENT_ARCHITECTURE.md` · `docs/PRINCIPLES.md`
</details>
