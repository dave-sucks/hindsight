# The Portfolio Digest

**Your account's day, written at 8 PM from one snapshot of your portfolio.** It is given two things, its instructions and the portfolio snapshot, and nothing else.

It never trades. It is a run you can open on /runs, and its Context button shows exactly what the model was sent.

```facts
Model: gpt-5.4
Starts: 8:00 PM ET, every weekday
Steps: 1 call
Tools: None
Saves: The digest, and the snapshot it read
```

## What it is given

1. **Its instructions:** write 3 to 5 short paragraphs on how the account did that day and which holdings moved it, what was bought or sold, a view on each proposal waiting for you, and what stands out about the account as a whole. Every number comes from the snapshot. A proposal is not a trade until you approve it. It never names a new price level.
2. **The portfolio snapshot,** written by code. Nothing else: no run logs, no ids, no buying power.

## The portfolio snapshot

The one set of numbers about your account, as plain text. With made-up amounts, it reads:

```
The account, Wed, Nov 11 at the close
Value $80,000.00 · cash $40,000.00 (50.0% of the account)
Wed, Nov 11: +0.6% (+$500) · since the start: −20.0% (−$20,000) on $100,000 put in

Holdings (2), largest first:
- AAA: 100 shares at $250.00 = $25,000 (31.3%) · day +4.2% (+$1,000) · since bought at $200.00: +25.0% (+$5,000) · Analyst One
- BBB: 50 shares at $300.00 = $15,000 (18.8%) · day −3.2% (−$500) · since bought at $400.00: −25.0% (−$5,000) · Analyst Two

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

- You: the digest on the home page, and its run on /runs.
- Every agent that decides on stocks (morning runs, trigger runs, chat and the Writer), on every request, in the Market and portfolio block: the snapshot, written fresh for that request, and the latest digest from the last 4 days, stamped with when it was written. The house rules tell them: where the block and a stock's own row differ, the row is right; where the digest and the snapshot differ, the snapshot is right.

<details>
<summary>Technical details</summary>

#### Runs as
`portfolio-digest` at 8:00 PM ET, Mon–Fri, one read-only run per traded book (`lib/inngest/functions/portfolio-digest.ts`, `lib/runs/account-run.ts`).

#### Model
`gpt-5.4`, one call (`lib/agent/digest-writer.ts`). On the same snapshot, gpt-4o skipped a waiting proposal and told the owner what to do with the cash.

#### The snapshot
`loadPortfolioSnapshot` (`lib/portfolio/load-snapshot.ts`) reads the broker, the quotes and the orders; `buildSnapshot` and `snapshotText` (`lib/portfolio/snapshot.ts`) make the numbers and the text. The digest row's `facts` column keeps the snapshot.

#### Every agent's block
`loadPortfolioBlock` (`lib/agent/portfolio-block.ts`): the snapshot and the latest digest, under `## Market and portfolio`. The morning run gets it through `buildRunInput`, the trigger run in `tactical-run.ts` before the stock's row, the Writer in `run-thesis-writer.ts`, and the chat on its newest message (`withTheTime`, `lib/agent/old-lookups.ts`), so its system prompt stays cached.

#### What was sent
One `RunMessage` row with role `request` per call, shown by the Context panel (`lib/agent/run-requests.ts`, `components/agent/RunContext.tsx`).

</details>
