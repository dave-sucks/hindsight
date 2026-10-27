# Architecture

**How the pieces fit.** Data comes in, one record holds it, clocks wake the agents, and every trade waits for you.

Five agents work on one shared record, and [the analyst builder](agents/analyst-builder.md) sets up the analysts they work for. Each part of the system is defined in one place, so no two parts can disagree about a stock.

<!-- asset: system-layers -->

## The parts

1. **The data.** Live prices and bars from Alpaca, company numbers and news from Finnhub, filings from the SEC, the web and X. Read live, and named as missing when a source has nothing.
2. **The record.** The database: analysts, theses with their triggers, positions, orders, your notes, and Activity, one line for every change.
3. **The clocks.** The chart numbers at 6:30, [morning runs](agents/morning-runs.md) at 8, the [trigger](concepts/triggers.md) check every five minutes. They decide when an agent wakes.
4. **The read.** What an agent sees of its book. Each stock is a row at the size today needs, with its [situations](concepts/situations.md) and their instructions attached.
5. **The agents.** [Morning runs](agents/morning-runs.md), [trigger runs](agents/trigger-runs.md), [chat](agents/chat.md), [Discovery](agents/discovery.md) and [the Writer](agents/writer.md). Each is a job and a list of tools on top of the parts every agent shares.
6. **The save.** Every change to a thesis goes through the same tool and the same checks, whoever makes it: an agent, the Writer, or you on the thesis sheet. Each agent may send only the fields its job needs, and no agent can lower a floor on a stock we hold.
7. **The gate.** Every buy, sale, add and trim becomes a [proposal](concepts/approvals.md). On the live account nothing reaches the broker until you approve it; paper trades skip approval unless you turn it on.

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
- **The approval gate:** `maybeAwaitApproval` in `lib/proposals/maybe-await-approval.ts`. What an approval does to the thesis: `lib/proposals/thesis-flips.ts`.
- **The floor rule:** `protectiveRatchetViolations` in `lib/agent/triggers/ratchet.ts`.
- **Which tools each agent has:** `lib/agent/modes.ts`.

## Everything runs on a clock

Eastern time, on trading days unless it says otherwise.

- **6:25 AM:** Every market-data source is probed; an email goes out if one is empty or erroring.
- **6:30 AM:** The chart numbers for every stock on the book: averages, highs, RSI, strength, gaps, insider buys.
- **8:00 AM:** Morning runs, on each analyst's run days.
- **9:30 AM – 4:00 PM (1 PM on half days):** The trigger check, every five minutes. Each check first brings every holding's high since the buy up to date for the trails. No order waits at the broker, so a floor broken overnight is acted on at the first check after the open. A buy or an add waits for a price from the last 15 minutes; a sale or a review doesn't.
- **4:00 AM – 8:00 PM:** Orders are matched to the broker's fills every five minutes, and proposals past their 24 hours lapse every thirty.
- **10:00 AM:** The morning digest: what the runs did, in one email.
- **4:20 PM:** The close pass: triggers that read "only on the close", checked once on the day's closing price.
- **5:00 PM:** End-of-day snapshots of every position, and the post-trade review of any position closed that day that hasn't had one.
- **8:00 PM:** The portfolio digest the next morning's runs read.
- **Sundays 10:00 AM:** Weekly scorecards: win rate, and how well conviction matched outcomes, once an analyst has three closed trades.
- **Discovery** has no schedule. It is done in chat, when you ask.

The two workflows these clocks drive, end to end: [From fire to run](deep-dives/trigger-fire-to-run.md) and [From proposal to fill](deep-dives/proposal-to-fill.md).

## Where the data comes from

Live prices and every bar come from Alpaca, off the consolidated tape, with Finnhub behind it if a price can't be had. A live price is never cached, and every quote carries the time it printed, so a stale one is said out loud instead of passed off as now. Earnings, company numbers, news and insider trades come from Finnhub; filings straight from the SEC; the web from Perplexity and Claude's own search; X from Grok.

Some data isn't on any plan we hold: analyst price targets, forward revenue and EPS estimates, an economic calendar and options chains. The tools say so when asked, and never guess.

## The right model for each job

- **Morning runs and trigger runs:** GPT-5.4. Up to 65 and 15 steps a run, with the prompt cached between steps.
- **The Writer:** Claude Sonnet 4.6. Won a side-by-side test on grounded research and getting fiscal years right.
- **Chat:** Claude Sonnet 4.6. With thinking on, for the questions that need a careful answer.
- **Analyst builder:** GPT-4o. Fast, because you're waiting on it in a conversation.

## The agents side by side

Each agent's own page opens with its model, steps and tools. What sets them apart:

| Agent | Starts | Reads | May change | Trades |
|---|---|---|---|---|
| [Discovery](agents/discovery.md) | When you ask in chat | The tickers its analyst already covers, to skip them | A pass or a watch; new stocks go to the Writer | Never |
| [The Writer](agents/writer.md) | When an agent or you ask | Its own pull of one stock's data, and the web | The whole thesis | Never |
| [Morning run](agents/morning-runs.md) | 8:00 AM ET on run days | Its whole book, each stock at the size today needs | The plan, its verdict and a note | Proposes |
| [Trigger run](agents/trigger-runs.md) | Minutes after a trigger fires | The one stock it woke for, with the fire | The plan and a note | Proposes |
| [Chat](agents/chat.md) | When you type | Stocks by name, when the conversation needs them | Also the belief and the direction | Proposes, at your word |
| [Analyst builder](agents/analyst-builder.md) | When you build or edit one | Your answers, the playbook, today's market | A whole analyst, on your yes | Never |

## What an agent is told

Every agent is a job and a list of tools, plus the parts every agent shares: the house rules (how to write, and that your word comes first), the analyst's brief, and the read of its stocks. What a stock needs arrives with the stock, through its [situations](concepts/situations.md), never in a prompt. Pick an agent to see the same parts at its sizes.

<!-- asset: request-grid -->

[Open the Framework →](/how-it-works/framework)

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
