# Architecture

**How the pieces fit.** Data comes in, one record holds it, clocks wake the agents, and every trade waits for you.

Every agent works on one shared record, and [the analyst builder](agents/analyst-builder.md) sets up the analysts they work for. Each part of the system is defined in one place, so no two parts can disagree about a stock.

<!-- asset: system-layers -->

## The parts

1. **The data.** Live prices and bars from Alpaca, company numbers and news from Finnhub, filings from the SEC, and the web. Read live, and named as missing when a source has nothing.
2. **The record.** The database: analysts, theses with their triggers, positions, orders, your notes, and Activity, one line for every change.
3. **The clocks.** The chart numbers at 6:30, [morning runs](agents/morning-runs.md) at 8, the [trigger](concepts/triggers.md) check every five minutes. They decide when an agent wakes.
4. **The read.** What an agent sees of its book. Each stock is a row at the size today needs, with its [situations](concepts/situations.md) and their instructions attached.
5. **The agents.** [The Writer](agents/writer.md), [morning runs](agents/morning-runs.md), [trigger runs](agents/trigger-runs.md), [After the buy](agents/after-the-buy.md), [chat](agents/chat.md), [Discovery](agents/discovery.md), the [Portfolio Manager](agents/portfolio-manager.md), the [Market Reviewer](agents/market-reviewer.md) and the [Portfolio Digest](agents/portfolio-digest.md). Each is its instructions, its context, its tools, its message and the moment it runs ([How an agent is built](concepts/agents.md)), on top of the parts every agent shares.
6. **The save.** Every change to a thesis goes through the same tool and the same checks, whoever makes it: an agent, the Writer, or you on the thesis sheet. Each agent may send only the fields its job needs, and no agent can lower a floor on a stock we hold.
7. **The gate.** Every buy, sale, add and trim becomes a [proposal](concepts/approvals.md). On the live account nothing reaches the broker until you approve it; paper trades skip approval unless you turn it on.

## One place for each thing

Each of these is defined once, and everything that needs it reads it from there. A second copy anywhere else is a bug.

- **The live price:** `lib/market-data/live-quote.ts`, Alpaca first and Finnhub behind it. How old a price is: `lib/market-data/quote-age.ts`.
- **The facts about a stock:** `loadStockFacts` in `lib/agent/stock-facts.ts`, fed by `loadWorkInputs` in `lib/agent/work-inputs.ts`. The read, the thesis sheet, the quote route and a run's close-out all use them.
- **What a stock needs today:** `computeNeedsAction` in `lib/agent/needs-action.ts`, turned into situations by `situationsFor` in `lib/agent/situations.ts`.
- **What an agent is told in a situation:** its skill file in `lib/agent/engine/skills/`, named in `SITUATIONS` (`lib/agent/situations.ts`). Never a prompt, and no code writes a word of it.
- **A stock's row in the read:** `lib/agent/row-for-model.ts`, at one of three sizes.
- **The analyst's brief:** `analystBrief` in `lib/agent/analyst-brief.ts`.
- **The rules every agent shares:** `lib/agent/engine/agents/rules.md`, the house rules then how it writes, which each agent's own markdown file there imports (`@rules.md`).
- **A trigger edit:** `applyTriggerOps` in `lib/agent/triggers/ops.ts`, for agents and the trigger editor alike. Its words: `lib/agent/triggers/condition/describe.ts`. When it fires: `shouldFire` in `lib/agent/triggers/evaluate.ts`.
- **The size of a trade:** `sizeByRisk` in `lib/agent/position-sizing.ts`, shared by the trade tools and the Settings screen.
- **The approval gate:** `maybeAwaitApproval` in `lib/proposals/maybe-await-approval.ts`. What an approval does to the thesis: `lib/proposals/thesis-flips.ts`.
- **The floor rule:** `protectiveRatchetViolations` in `lib/agent/triggers/ratchet.ts`.
- **What an agent is made of:** its record and instructions in `lib/agent/engine/agents/`, its facts in `lib/agent/context/`, its tools in `lib/agent/tools/`, its schedule in `lib/agent/engine/schedule.ts`. The morning run, the trigger run and chat take their tool lists from `lib/agent/modes.ts`.

## Everything runs on a clock

Eastern time, on trading days unless it says otherwise.

- **6:25 AM:** Every market-data source is probed; an email goes out if one is empty or erroring.
- **6:30 AM:** The chart numbers for every stock on the book: averages, highs, RSI, strength, gaps, insider buys. Then Wall Street's price targets and EPS consensus for the same stocks.
- **7:30 AM:** The [Market Reviewer](agents/market-reviewer.md), one run per book being traded: it researches the market itself and saves the market digest, and a note on each stock its research touched (a high-impact one starts a look on the stock when you have saved the rule for it).
- **8:00 AM:** Morning runs, on each analyst's run days.
- **9:30 AM – 4:00 PM (1 PM on half days):** The trigger check, every five minutes. Each check first brings every holding's high since the buy up to date for the trails. No order waits at the broker, so a floor broken overnight is acted on at the first check after the open. A buy or an add waits for a price from the last 15 minutes; a sale or a review doesn't.
- **4:00 AM – 8:00 PM:** Orders are matched to the broker's fills every five minutes, and proposals past their 24 hours lapse every thirty (a proposal a trigger made has none: the 4:20 PM trigger pass withdraws it on a close back past its line, or once its trigger is off the stock).
- **10:00 AM:** The morning digest: what the runs did, in one email.
- **10:00 AM, Tue and Thu:** The [Portfolio Manager](agents/portfolio-manager.md): reads the whole account in a line a stock and may propose up to three trades, each waiting for you.
- **4:20 PM:** The close pass: triggers that read "only on the close", checked once on the day's closing price.
- **5:00 PM:** End-of-day snapshots of every position, and the post-trade review of any position closed that day that hasn't had one.
- **8:00 PM:** The [Portfolio Digest](agents/portfolio-digest.md): your account's day, written from one snapshot of your portfolio (value, cash, every holding and its move, the day's buys and sells, the proposals waiting for you) and nothing else. On the home page, and in every agent's Market and portfolio block with the snapshot itself. It is a run you can open on /runs, and its Context button shows exactly what the model was sent.
- **Sundays 10:00 AM:** Weekly scorecards: win rate, and how well conviction matched outcomes, once an analyst has three closed trades.
- **When a buy or an add fills:** [After the buy](agents/after-the-buy.md), minutes later.
- **Discovery** is done in chat, when you ask. Its scheduled agent (Tuesday and Thursday, 9:00 AM) is off until you turn it on.

The two workflows these clocks drive, end to end: [From fire to run](deep-dives/trigger-fire-to-run.md) and [From proposal to fill](deep-dives/proposal-to-fill.md).

## Where the data comes from

Live prices and every bar come from Alpaca, off the consolidated tape, with Finnhub behind it if a price can't be had. A live price is never cached, and every quote carries the time it printed, so a stale one is said out loud instead of passed off as now. Earnings, company numbers, news and insider trades come from Finnhub; filings straight from the SEC; the web from Perplexity and Claude's own search.

Wall Street's price targets, its rating split and the EPS consensus with its revisions come from Nasdaq's own website feed: free, but a website's feed and not a licensed one, so it can change without notice and the 6:25 probe checks it every morning. A stock whose pull fails keeps the day before's numbers.

Some data isn't on any plan we hold: forward revenue estimates, an economic calendar and options chains. The tools say so when asked, and never guess.

## The right model for each job

- **Morning runs, trigger runs, After the buy, the Portfolio Manager, the Market Reviewer and Discovery:** GPT-5.4. Up to 65 steps for a morning run and 15 for a trigger run, with the prompt cached between steps.
- **The Writer:** Claude Sonnet 4.6. Won a side-by-side test on grounded research and getting fiscal years right.
- **Chat:** Claude Sonnet 4.6. With thinking on, for the questions that need a careful answer.
- **Analyst builder:** GPT-4o. Fast, because you're waiting on it in a conversation.

## The agents side by side

Each agent's own page opens with its model, steps and tools. What sets them apart:

| Agent | Starts | Reads | May change | Trades |
|---|---|---|---|---|
| [Discovery](agents/discovery.md) | When you ask in chat | The tickers its analyst already covers, to skip them | A pass or a watch; new stocks go to the Writer | Never |
| [The Writer](agents/writer.md) | When an agent or you ask | Its own pull of one stock's data, and the web | The whole thesis; its playbook's watch triggers, then tailors them | Never |
| [Morning run](agents/morning-runs.md) | 8:00 AM ET on run days | Its whole book, each stock at the size today needs | Its triggers, conviction, catalyst date, whether we watch, its verdict and a note | Proposes |
| [Trigger run](agents/trigger-runs.md) | Minutes after a trigger fires; right after an Auto trade, to write it up | The one stock it woke for, with the fire | Its triggers and a note; an Auto trade's reason | Proposes (an Auto trade is made before it reads) |
| [After the buy](agents/after-the-buy.md) | Right after a buy or an add fills | The stock, its chart and its playbook's holding triggers | The holding's triggers (never the floor); the trade's note if none | Never |
| [Chat](agents/chat.md) | When you type | Stocks by name, when the conversation needs them | The triggers, conviction, catalyst date, whether we watch, notes; the belief goes through the Writer | Proposes, at your word |
| [Portfolio Manager](agents/portfolio-manager.md) | 10:00 AM ET, Tuesday and Thursday | The whole account, a line a stock | Notes and triggers | Proposes up to three |
| [Market Reviewer](agents/market-reviewer.md) | 7:30 AM ET on market days | The market, on the web | The market digest and notes on stocks | Never |
| [Analyst builder](agents/analyst-builder.md) | When you build or edit one | Your answers, the playbook, today's market | A whole analyst, on your yes | Never |

## What an agent is told

An agent is its instructions, its context and its tools, and what starts a run gives it a message ([How an agent is built](concepts/agents.md)). Its instructions are one document of its own, the same on every run, which imports the rules every agent that writes for you shares, the house rules and how it writes (the Writer's imports the research rules too), as CLAUDE.md imports with `@path`. Its context is the facts about what its run is about (the account, an analyst, a stock, or the chat), each a named read: the market and the portfolio, the book, the analyst it works for, the stock it is working on and its playbook, the stock's data. Most are in its first message; the analyst, the playbook and the stock's situations are sent with its instructions, where they were measured, and are listed as context all the same. Its message is the run's task, written by whoever starts the run: you, another agent's brief, the trigger check, the schedule; the record says where it goes in the first message (last, but for the Writer's brief, which comes before the stock's data). Every first message opens with one line, the date and time in New York and whether the account is paper or live. The agent engine builds each request from the agent's record, in the record's order. What a stock needs arrives with the stock, through its [situations](concepts/situations.md), never in an agent's own words. Pick an agent to see its parts in order, sized on its latest run: the numbers that run's Context panel shows, colored the same way. An agent with no saved run that names its parts yet is sized on a sample day, and says so.

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

#### Street targets
`lib/market-data/street-consensus.ts` (Nasdaq's feed and its parser) → `StreetConsensus`, written by `indicator-snapshot.ts` and on demand by `get_analyst_coverage`.

#### Prompts
`lib/agent/system-prompt.ts` (morning), `lib/agent/system-prompts/intraday-tactical.ts` (trigger), `lib/agent/system-prompts/chat.ts` (chat), each agent's record and instruction file in `lib/agent/engine/agents/` (the shared `rules.md` and `research-rules.md` they import), the context loaders in `lib/agent/context/`, `lib/agent/voice.ts`.

#### Plans
`docs/plans/AGENT_ARCHITECTURE.md` · `docs/PRINCIPLES.md`
</details>
