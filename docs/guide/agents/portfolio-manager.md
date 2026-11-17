# Portfolio Manager

**The one agent that looks at the whole account at once.** Each stock has its own analyst, who decides whether it is worth owning. The Portfolio Manager decides whether it is the best use of the account's money. Twice a week it reads every stock you hold and watch in a line each, opens the few it may act on, and leaves a write-up plus, at most, three proposals for you.

Every trade it proposes waits for your approval, like any run's. It never rewrites a stock's case or its conviction, and it never sizes a trade: code does.

```facts
Model: gpt-5.4
Starts: Tue and Thu · 10:00 AM ET
Steps: up to 40
Tools: a read by name, stock data, web search, a note, the trades, a research request
Saves: a write-up, notes on stocks, proposals, research requests
```

## What it's given

- **Its job**, then the house rules and the same [Market and portfolio block](portfolio-digest.md#the-portfolio-snapshot) every agent gets.
- **The book in a line each**, written by code: what we own, biggest first, then what we watch. A line reads:

```
- NVDA · held, 14.2% of the account · since bought −12.3% · today −1.1%, 5 days −4.0%, 20 days −9.8% · against the S&P over a month −6.2 points · conviction HIGH · Secular Compounder · last look 3 days ago · AI data-centre demand keeps outrunning supply.
```

  The line also says what you have already been asked and said: a trade waiting for you, trades you declined or let lapse in the last three weeks and how often, the Market Reviewer's newest note (stronger or weaker, and its impact), and your own newest note.
- **Its own last write-up**, so it remembers what it was weighing.

## What it asks for

It has no read of the whole book. It opens stocks by name, in two sizes, and the tool holds the limits:

- **The card**, for up to 8 stocks a run: the belief, what would prove it wrong, the reason for the conviction, the triggers, the newest three Activity lines, the position and any proposal waiting.
- **The full case**, for up to 3 stocks a run, only for a stock it is about to buy or add to: the whole case, the chart numbers, Wall Street's view and the playbook's triggers that come with the buy.

A ninth stock is refused. On the live book on 2026-11-17 a run with no trade read about 66,000 tokens in three requests, the largest 26,000.

## The question it asks

For every stock: would we buy it today, at today's price, knowing what we know now? What we paid is not part of the answer.

## What it may propose

A buy, a sale, a trim or an add on any stock in the book. Each needs one of four reasons, and its note names which:

1. **The bet is too big** for how sure we are: one stock, or several that rise and fall together. A trim.
2. **We wouldn't buy it today**, and it can say what changed in the business or the case. A sale. A lower price alone is never the reason.
3. **Something else is a better use of the money.** A buy, or a sale and a buy.
4. **News or a move today changes the case.**

Its note on the stock, written right after the trade call, is the reason you read on the proposal.

## Its rules

- At most three proposals a run. The rest of its view goes in the write-up.
- Selling one stock to buy another is two proposals. You may approve one and not the other.
- A trade you declined, or let lapse, is not proposed again until something new has happened.
- Where you have written that you are holding a stock, it ranks the stock honestly and proposes no sale.
- A case that looks wrong goes to research (the [Writer](writer.md)); it does not rewrite the case. Its save on a stock is a note and nothing else: no trigger, status or conviction.
- Its note on a stock is not the analyst's review: the stock's review clock keeps counting.
- Doing nothing is a normal result.

These are instructions in its job text. What it can open and what its save can change are limits in its tools.

## Its write-up

Its last reply, kept on the run: where the money is, the ranking, what it did, open questions for its next run, and what the account needs (for the next search for new stocks).

<details>
<summary>Technical details</summary>

#### Runs as
`portfolio-manager` at 10:00 AM ET, Tue and Thu, one run per traded book, mode `PORTFOLIO_MANAGER` (`lib/inngest/functions/portfolio-manager.ts`). The run takes no messages afterwards (`READ_ONLY_RUN_MODES`, `lib/runs/modes.ts`).

#### The run
`runPortfolioManager` (`lib/agent/portfolio-manager/run.ts`): the job text (`prompt.ts`), the book table (`book-table.ts`), and `MANAGER_TOOLS`: `get_theses`, `get_stock_data`, `web_search`, `update_thesis`, `place_trade`, `manage_position`, `close_position`, `dispatch_thesis_research`.

#### Its read and its save
`get_theses` on its run takes tickers and `full`, counts the stocks opened against the run and builds the card or the full case (`lib/agent/portfolio-manager/card.ts`). `update_thesis` on its run has two fields, the thesis and the note. The flags on a line are `bookFlags` (`book-table.ts`).

#### Acting for the stock's analyst
It has no analyst of its own. Each write acts for the stock's own analyst, under that analyst's sizes and limits, the way the unpinned chat does (`accountWide`, `lib/agent/analyst-scope.ts`). Unlike the chat it has none of the owner's powers: no size field, no reason field, no lowering a floor.

#### The write-up
A `RunEvent` of type `portfolio_writeup` on the run. The next run reads the newest one for the book.

#### Trying it with nothing saved
`npx tsx --env-file=.env.local scripts/portfolio-manager-dry-run.ts LIVE` reads the real book and prints every write instead of making it, and the size of each request.

</details>
