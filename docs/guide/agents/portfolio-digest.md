# The Portfolio Digest

**Your account's day, written at 8 PM from one snapshot of your portfolio.** It is given its instructions and, after the date line, the portfolio snapshot, and nothing else.

It never trades. It is a run you can open on /runs, and its Context button shows exactly what the model was sent.

```facts
Model: gpt-5.4
Starts: Weekdays · 8:00 PM ET
Steps: 1 call
Tools: None
Saves: The digest, and the snapshot it read
```

## What it is given

<!-- asset: context portfolio_digest -->

1. **Its instructions:** write 3 to 5 short paragraphs on how the account did that day and which holdings moved it, what was bought or sold, a view on each proposal waiting for you, and what stands out about the account as a whole. Every number comes from the snapshot. A proposal is not a trade until you approve it. It never names a new price level.
2. **The portfolio snapshot,** written by code. Nothing else: no run logs, no ids, no buying power.

## The portfolio snapshot

The one set of numbers about your account, as plain text. With made-up amounts, it reads:

```
The account, Wed, Nov 11 at the close
Value $80,000.00 · cash $40,000.00 (50.0% of the account)
Wed, Nov 11: +0.6% (+$500) · since the start: −20.0% (−$20,000) on $100,000 put in

Holdings (2), largest first:
- AAA: 100 shares at $250.00 = $25,000 (31.3%) · day +4.2% (+$1,000) · since bought at $200.00: +25.0% (+$5,000) · 5-day +6.1%, 20-day +12.4% · conviction HIGH · Analyst One
- BBB: 50 shares at $300.00 = $15,000 (18.8%) · day −3.2% (−$500) · since bought at $400.00: −25.0% (−$5,000) · 5-day −4.0%, 20-day −9.8% · conviction MEDIUM · Analyst Two

Bought or sold on Wed, Nov 11: nothing.

Waiting for the owner's approval (proposals, not trades, until approved):
- Sell 50 shares of BBB, proposed 9 times since Tue, Oct 20 · Analyst Two. Its reason: "BBB closed under your sell line again, and I proposed selling all 50 shares. Nothing new broke at the company today."
- Buy 10 shares of CCC, proposed Wed, Nov 11 · Analyst One. Its reason: "CCC crossed your buy level after a strong quarter."
```

Where each number comes from:

- **Cash, shares and what you paid:** your broker account.
- **Prices:** the app's one price, the same as everywhere else: the latest trade while the market is open, the close outside it. The broker's own after-hours marks are never used. At 10 PM on Nov 11 the broker valued CEG at an after-hours $271.81 and called its day −1.1%; it closed at $274.73, up 2.6%.
- **The day:** for each stock, what its shares are worth now less what they were worth at the prior close, less what that day's buys cost, plus what that day's sales brought in. A stock that didn't trade that day is flat.
- **Since you started:** the account's value less the money you put in, net of withdrawals.
- **Bought or sold:** orders the broker filled that day. A proposal is never listed here.
- **Waiting for your approval:** every proposal waiting for you, how many times that stock's proposal has been made (expired and declined ones count), since when, and the analyst's reason, cut at a sentence inside 280 characters.

## Who reads it

- You: the digest on the home page, on the digest card's **Portfolio** tab (the Market tab beside it holds the 7:30 [market digest](market-reviewer.md); the card opens on whichever was written last), and its run on /runs.
- The agents whose context lists them, in the Market and portfolio reads: the [market numbers](market-reviewer.md#the-market-numbers), the latest 7:30 [market digest](market-reviewer.md), the snapshot, written fresh for that request, and the latest portfolio digest, each digest from the last 4 days and stamped with when it was written. The morning run, the post-trade write-up and the chat get all four; the Portfolio Manager all but the portfolio digest, so it forms its own view; the Market Reviewer the numbers and the snapshot; the trigger run and the Writer the market numbers alone. The house rules tell them: where these and a stock's own row differ, the row is right; where the portfolio digest and the snapshot differ, the snapshot is right.
- `get_portfolio_context`, the read morning runs and the chat call for the book: its value, cash, day and since-started figures, and each holding's price, value, share, day and gain since bought, are the snapshot's, so they match the block to the cent. It adds what the snapshot doesn't carry: the floor and upside level, days held, the distance from the high, buying power and the open risk, all at the snapshot's prices.

<details>
<summary>Technical details</summary>

#### Runs as
`portfolio-digest` at 8:00 PM ET, Mon–Fri, one read-only run per traded book (`lib/inngest/functions/portfolio-digest.ts`), opened and kept by the agent runner (`runAgentAsRun`, `lib/agent/engine/run.ts`).

#### Model
`gpt-5.4` on OpenAI's Chat Completions API, one call with a 6,000-token budget and 120 seconds (`lib/agent/digest-writer.ts`). When the run writes nothing, the digest is the snapshot's own lines (`narrativeOf`). On the same snapshot, gpt-4o skipped a waiting proposal and told the owner what to do with the cash. Its instructions (its own text, the same on every run) and its context (the portfolio, after the date line) are its record, `PORTFOLIO_DIGEST` in `lib/agent/engine/agents/portfolio-digest.ts`, which the agent engine (`lib/agent/engine/engine.ts`) builds the request from, naming each part for the run's Context panel.

#### The snapshot
`loadPortfolioSnapshot` (`lib/portfolio/load-snapshot.ts`) reads the broker, the quotes and the orders; `buildSnapshot`, `snapshotText` and `portfolioPieceText` (`lib/portfolio/snapshot.ts`) make the numbers and the text. A holding's 5- and 20-day moves are the trigger check's own measure off the 06:30 chart numbers, and its conviction is its thesis's. The digest row's `facts` column keeps the snapshot.

#### The Market and portfolio reads
`loadPortfolioPieces` (`lib/agent/portfolio-block.ts`) reads the four, and the agent engine prints each one the agent's record lists under the one heading: the market numbers (`loadMarketNumbers`, `lib/market-data/load-market-numbers.ts`), the latest market digest, the snapshot and the latest digest, under `## Market and portfolio`. The numbers and the snapshot are read in parallel, each given up after 15 seconds (5 in the chat) with one line saying it couldn't be read. The morning run gets it through `buildRunInput`, the trigger run in `tactical-run.ts` before the stock's row, the Writer in `run-thesis-writer.ts`, and the chat on its newest message (its record is a conversation; `chatNewest`, `lib/agent/system-prompts/chat.ts`), so its system prompt stays cached.

#### get_portfolio_context
`lib/agent/tools/get-portfolio-context.ts` calls `loadPortfolioSnapshot` and matches each open position to the snapshot's holding by ticker. The open risk is `loadAccountRisk` given the snapshot, so its equity is the snapshot's value. Buying power is read from the broker (`getAccount`): the snapshot doesn't carry it.

#### What was sent
One `RunMessage` row with role `request` per call, shown by the Context panel (`lib/agent/run-requests.ts`, `components/agent/RunContext.tsx`).

</details>
