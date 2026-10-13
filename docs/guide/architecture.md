# Architecture

**How the pieces fit.** Data comes in, one record holds it, clocks wake the agents, and every trade waits for you.

Five agents work on one shared record, and each part of the system is defined in one place, so no two parts can disagree about a stock.

<!-- asset: system-layers -->

## The parts

1. **The data.** Live prices and bars from Alpaca, company numbers and news from Finnhub, filings from the SEC, the web and X. Read live, and named as missing when a source has nothing.
2. **The record.** The database: analysts, theses with their triggers, positions, orders, your notes, and Activity, one line for every change.
3. **The clocks.** The chart numbers at 6:30, [morning runs](morning-runs.md) at 8, the [trigger](triggers.md) check every five minutes. They decide when an agent wakes.
4. **The read.** What an agent sees of its book. Each stock is a row at the size today needs, with its [situations](situations.md) and their instructions attached.
5. **The agents.** [Morning runs](morning-runs.md), [trigger runs](trigger-runs.md), [chat](chat.md), [Discovery](discovery.md) and [the Writer](writer.md). Each is a job and a list of tools on top of the parts every agent shares.
6. **The save.** Every change to a thesis goes through the same tool and the same checks, whoever makes it: an agent, the Writer, or you on the thesis sheet.
7. **The gate.** Every buy, sale, add and trim becomes a [proposal](approvals.md). Nothing reaches the broker until you approve it.

## One place for each thing

Each of these is defined once, and everything that needs it reads it from there. A second copy anywhere else is a bug.

- **The live price:** `lib/market-data/live-quote.ts`, Alpaca first and Finnhub behind it. How old a price is: `lib/market-data/quote-age.ts`.
- **The facts about a stock:** `loadStockFacts` in `lib/agent/stock-facts.ts`, fed by `loadWorkInputs` in `lib/agent/work-inputs.ts`. The read, the thesis sheet, the quote route and a run's close-out all use them.
- **What a stock needs today:** `computeNeedsAction` in `lib/agent/needs-action.ts`, turned into situations by `situationsFor` in `lib/agent/situations.ts`.
- **What an agent is told in a situation:** `SITUATIONS` in `lib/agent/situations.ts`. Never a prompt.
- **A stock's row in the read:** `lib/agent/row-for-model.ts`, at one of three sizes.
- **The analyst's brief:** `analystBrief` in `lib/agent/analyst-brief.ts`.
- **The rules every agent shares:** `HOUSE_RULES` in `lib/agent/house-rules.ts`, with the writing rules in `lib/agent/voice.ts`.
- **A trigger edit:** `applyTriggerOps` in `lib/agent/triggers/ops.ts`, for agents and the trigger editor alike. Its words: `lib/agent/triggers/condition/describe.ts`. When it fires: `shouldFire` in `lib/agent/triggers/evaluate.ts`.
- **The size of a trade:** `sizeByRisk` in `lib/agent/position-sizing.ts`, shared by the trade tools and the Settings screen.
- **The approval gate:** `maybeAwaitApproval` in `lib/proposals/maybe-await-approval.ts`.
- **Which tools each agent has:** `lib/agent/modes.ts`.

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
