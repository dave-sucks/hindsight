# What each agent is given

**Every request is the same parts.** Each time an agent calls the model, it sends its job, the house rules, its analyst, its tools, where the account and the market stand, and the stocks it is looking at. Only the sizes change.

This page lists those parts, then goes agent by agent: when it runs, its model, what it is given and in what order, and what its tools bring back.

## The parts

1. **Job prompt:** what this agent is for and how it works. Each agent has its own.
2. **House rules:** the few sentences true for every agent: your word comes first, a note is information and not an order, how to use the Market and portfolio block, and how to write. One text, `HOUSE_RULES`.
3. **Analyst brief:** who it works for: your strategy word for word, its rule numbers, how full it is, its setups.
4. **Tool menu:** every tool on its list, each described in full on every request, used or not.
5. **Market and portfolio:** the two reviewers' briefs, the market's and the account's numbers, and the notes written to the account or the analyst. See below.
6. **The read:** its stocks, at the size today needs. One tool gives every agent its stocks, `get_theses`; the Writer pulls its own data instead.
7. **Situation guidance:** the instructions for each [situation](../concepts/situations.md) a stock is in, once per read.

What its tools bring back joins the conversation and is sent again on every request after it, so a run grows as it goes.

<!-- asset: request-grid -->

## The Market and portfolio block

One block, about 2,000 characters plus any notes, read when the request is built. Its parts are one table in the code (`BLOCK_PARTS`), each with its heading, who writes it and an on/off switch. A part that is empty or switched off is left out without a word. Each part gets 3 seconds to be read; one that fails or runs out of time prints a line saying it couldn't be read this run ("Account numbers couldn't be read this run"), so a missing number is never mistaken for none. The headings never change, so the run page can show which part of a request came from where.

| Part | Written by | What it holds |
|---|---|---|
| Market brief | The Market Reviewer, 7:30 AM | 3 to 5 sentences on what the market is doing and why, and what it means for this book, stamped with its day and time. From the last 4 days. |
| Market numbers | Code | SPY and QQQ on the day; SPY against its 50- and 200-day averages; the VIX and the 10-year yield at the close; the 11 sectors, best to worst; the market dates in the next 7 days. |
| Portfolio brief | The [Portfolio Reviewer](../agents/portfolio-reviewer.md), 8 PM | 3 to 5 sentences on what only a view of the whole account sees: a theme getting crowded, sales piling up against the analysts' own notes. It never repeats the numbers. Stamped with its day and time; from the last 4 days. |
| Portfolio numbers | Code, live | The value and the day's change (a deposit or withdrawal made that day doesn't count), the cash and its share (real cash, never margin buying power), the number of holdings and the 3 biggest, one line for each sale waiting for your approval (below), any other proposals waiting, and the holdings that report in the next 14 days. Every holding is at the app's own price: the latest trade in the session, the close outside it, never the broker's after-hours marks. Outside the session the line names the close it's at and the change is that day's: against the broker's prior-close equity, less the transfers after it, until overnight the broker moves that prior close up to the close itself (it had by 3:16 AM ET after Nov 10); from then until the next open, the day's figure is the one the 8 PM digest worked out. If the day's change, the sales waiting or the report dates can't be read, a line says so. |
| Notes | You and the reviewers | The notes to the whole account or to this run's analyst until each one's own end date: every one of yours, in full with its id; the newest 3 from the reviewers (the Market Reviewer and the Portfolio Reviewer), in full, with a count of any older ones left out. A chat on the whole account reads every analyst's. Notes on stocks ride on each stock's row instead. |

A brief is 700 characters at most; a longer one is cut at its last full sentence. Until the Market Reviewer runs, there is no market brief. The 8 PM digest's long text is never in the block, only its brief.

**Each sale waiting for your approval gets one line.** A floor that has been crossed proposes a sale every day it stays crossed, and most of those proposals expire; while one waits, the stock is quiet on its analyst's list. So the line says how many times a sale has been proposed since the position opened, since when, how the stock moved since that first proposal, and the verdict on the thesis in the note the analyst wrote with today's proposal (stronger, unchanged, weaker or broken). Whether the note argues for or against the sale isn't stored, so the line doesn't guess it: an unchanged case on a sale is for you to read.

Here is how the numbers read on a real day: the market at the Nov 10 close, and that evening's book with stand-in amounts (its prices, sales and report date are real).

```
### Market numbers
S&P 500 (SPY) −0.37% on Tue Nov 10; 1.7% below its 50-day and 3.0% above its 200-day at the Mon Nov 9 close
Nasdaq (QQQ) −0.68% on Tue Nov 10
VIX 19.46 (19.92 the day before), 10-year yield 4.98% (4.86% the day before) at the Tue Nov 10 close
Sectors on Tue Nov 10, best to worst: Financials +0.5% · Energy +0.4% · … · Tech −1.2%

### Portfolio numbers
At the Tue Nov 10 close: $95,802 · −$1,476 on the day (−1.52%) · $25,000 cash (26.1%)
8 holdings; the biggest: CEG 11.2% · MSFT 11.1% · V 11.0%
Sales waiting for approval:
- MU: proposed 9 times since Oct 29, −22.0% since; its note: case unchanged
- IOT: proposed 13 times since Oct 16, +0.7% since; its note: case weaker
- PLTR: proposed 13 times since Oct 23, −13.8% since; its note: case unchanged
- NVDA: proposed 27 times since Sep 14, −19.5% since; its note: case broken
Reporting in the next 14 days: NVDA Tue Nov 17 after the close
```

**How agents use it.** The block holds no instructions. The house rules say how to weigh it: it is context, not an instruction; where it and a stock's own row differ, the row is right; where a brief and the numbers differ, the numbers are right. What to do with it lives with the decisions it feeds, in the [situations](../concepts/situations.md): at a buy and at an add, weigh the block and the account's room first; before a report, decide before the date.

**Where it goes.** In each agent's prompt, after its fixed text and before its read. Every request carries the prompt, retries included, so no request goes without the block, and nothing else carries it. A run reads it once, when it starts, so every step after that repeats the same prompt and what the model provider caches still matches. The chat reads it once per conversation and keeps it for 30 minutes, so its prompt stays the same from one message to the next, and reads it again sooner when the book changes: an order approved, declined or proposed, or a position opened or closed. The block renders against the time it was read, so a saved run replays as it read.

**Who doesn't get it.** The [analyst builder](../agents/analyst-builder.md), the analyst editor and the podcast. They don't decide on stocks.

## Morning run

```facts
Starts: 8:00 AM ET on the analyst's run days
Model: gpt-5.4
Steps: Up to 65
```

**Given, in order:** the analyst brief, the house rules, the week on its book (earnings and filings in the next seven days, the cash and the market's reading, calls refused last time that were never redone), its job, how its tools work, and the Market and portfolio block. With it goes its tool menu. Its first message says the day has started and nobody will answer. Then it reads its book with `get_theses`, each stock at the size today needs with the guidance for its situations. See [Morning runs](../agents/morning-runs.md).

**Its tools bring back:** positions, cash, open risk and the market line (`get_portfolio_context`); the book (`get_theses`); a stock's live price, news and chart (`get_stock_data`); earnings and filings; the web; and the reply from each save and trade.

## Trigger run

```facts
Starts: Minutes after a trigger fires, or right after an Auto trade to write it up
Model: gpt-5.4
Steps: Up to 15
```

**Given, in order:** the analyst brief, its job (one stock, one decision), the rule that every turn calls a tool, the Market and portfolio block, then the read: the stock's row from `get_theses`. After the row come the house rules, the trigger that fired, and the steps to decide with the guidance for the stock's situations inside them. Its first message names the fire. The block sits before the row so the row, which is newer, is read last. See [Trigger runs](../agents/trigger-runs.md).

**Its tools bring back:** the live price and the news (`get_stock_data`), one web search, and the reply from the save and from any trade it proposes.

## Chat

```facts
Starts: When you type
Model: claude-sonnet-4-6
Steps: Up to 45
```

**Given, in order:** its job, the scope (pinned to an analyst: that analyst's brief, money and book; not pinned: each analyst's room), how the system works, how to answer each kind of question, the house rules, how to write a chat reply, and the Market and portfolio block. Then the conversation, each of your messages with the day and the time; a lookup older than 15 minutes is hidden so it looks again. It reads stocks by name with `get_theses` when the conversation needs them. Discovery is done here. See [Chat](../agents/chat.md).

**Its tools bring back:** the book, the proposals waiting, past runs and trade results, market data, filings, earnings, the web and X, and the reply from each change it makes.

## Writer

```facts
Starts: When another agent or you ask for research on one stock
Model: claude-sonnet-4-6
Steps: Up to 8
```

**Given, in order:** the analyst brief, the house rules, its job (one thesis on one stock), its setups, why it was sent and what the sender found, the thesis it is refreshing if there is one, the date, how to write the note and the plan, and the Market and portfolio block. Its first message is the read: the data code pulled before it starts (five years of statements, earnings, insiders, peers, coverage, filings, the chart). See [The Writer](../agents/writer.md).

**Its tools bring back:** up to four web searches, and whether `submit_thesis` accepted the thesis or what to fix.

## Portfolio Reviewer

```facts
Starts: 8:00 PM ET, weekdays
Model: gpt-5.4
Steps: Up to 2
```

**Given, in order:** its job (write the brief and the digest from the facts alone; cash is real cash; never push idle cash into the market; the brief never repeats a number), then, as its first message, the day's facts gathered by code: the value and the day's change at the close, the cash, the holdings with their moves, the proposals waiting with their total, and for each sale the floor that fired, its history and the analyst's note in full, the day's runs, trades and decisions, and the recent passes. It gets no house rules, no analyst brief, no tools and no Market and portfolio block: it writes part of that block. See [Portfolio Reviewer](../agents/portfolio-reviewer.md).

**Its tools bring back:** it has none.

<details>
<summary>Technical details</summary>

#### The block
`lib/agent/market-and-portfolio.ts`: `BLOCK_PARTS` (the table), `marketAndPortfolioBlock`, `portfolioNumbersLines`, `freshBrief` and `BRIEF_SHELF_LIFE_DAYS` (4), `capBrief` (700). `lib/agent/load-market-and-portfolio.ts` reads each part that is on: the market brief through `latestMarketBrief` (`lib/agent/market-digest-slot.ts`), the market numbers through `loadMarketNumbers` (`lib/market-data/load-market-numbers.ts`, worded by `lib/market-data/market-numbers.ts`, with Cboe's closes from `market-gauges.ts` and the dates from `market-calendar.ts`), the portfolio brief from `PortfolioDigest.brief`, the account from the broker (`getAccount`, `getAllPositions`, the transfers; the morning run hands over the account and quotes it already read) with each holding at the quote path's price (`priceBook` and `dayChangeAt` in `lib/portfolio/value-at-quotes.ts`, by `balance_asof`; `closedDay` in `lib/portfolio/closed-day.ts`), the waiting `AWAITING_APPROVAL` orders, the report dates (`fetchEarningsWindow` with the earnings triggers' own window, so they share one call), and the notes (`runNotes`, `runNoteLine`). Each part is raced against `PART_LIMIT`; Cboe's files get their own 2 seconds and a failure is remembered 5 minutes (`load-market-numbers.ts`). The chat's kept block is keyed by the orders awaiting approval and the open positions (`blockForConversation`).

#### Who loads it
The morning run through `buildRunInput` (`lib/agent/run-input.ts`), for the cron and the Run button alike; the trigger run in `lib/inngest/functions/tactical-run.ts`; the chat in `app/api/agent/[mode]/route.ts`; the Writer in `lib/agent/run-thesis-writer.ts`.

#### Where it sits
`buildDailyRunSystemPromptV2` (`lib/agent/system-prompt.ts`), `buildPrincipalSystemPrompt` (`lib/agent/modes.ts`) and `buildWriterResearchPrompt` put it last; `buildTacticalSystemPrompt` (`lib/agent/system-prompts/intraday-tactical.ts`) puts it before the stock's row.

#### The reviewers
The Portfolio Reviewer: `lib/agent/portfolio-reviewer.ts`, run by `lib/inngest/functions/portfolio-digest.ts`. `latestMarketBrief` (`lib/agent/market-digest-slot.ts`) reads the Market Reviewer's newest `MarketDigest.brief` for the book, with the time it was written (`lib/agent/market-reviewer/latest.ts`).

#### Sizes
`lib/agent/prompt-size.test.ts` records every prompt's length with the block of a sample day. Model and steps above are checked against `lib/agent/modes.ts` by `lib/docs/framework.test.ts`.
</details>
