# Portfolio Manager

**The one agent that looks at the whole account at once.** Each stock has its own analyst, who decides whether it is worth owning. The Portfolio Manager decides whether it is the best use of the account's money. Twice a week it goes through every stock you hold and watch, gets the thesis on the few it is weighing a trade on, and leaves a write-up plus, at most, three proposals for you.

Every trade it proposes waits for your approval, like any run's. It never rewrites a stock's case or its conviction, and it never sizes a trade: code does.

```facts
Model: gpt-5.4
Starts: Tue and Thu · 10:00 AM ET
Steps: up to 40
Tools: theses by ticker, stock data, a note, the trades, a research request
Saves: a write-up, notes on stocks, proposals, research requests
```

## What it's given

- **Its job**, then the house rules.
- **The [Market and portfolio block](portfolio-digest.md#the-portfolio-snapshot) every agent gets**, with two settings of its own: it also gets the Watching block (every stock you watch, a line each), and it does not get the 8 PM portfolio digest, so its view of the proposals waiting for you is its own.
- **Its own last write-up**, so it remembers what it was weighing.

It is given nothing in a format of its own. Your holdings are the snapshot's holdings; your watches are the Watching block.

## What it asks for

It asks `get_theses` for stocks by ticker, the tool every agent uses, and the same field rules decide what comes back: a holding with the fields a sale's decision reads (what would prove it wrong among them), a watch with the fields a buy's reads (Wall Street's view and the playbook's triggers that come with the buy). It does not get the long bull and bear cases; those go to the analyst on the stock's review.

It may ask about 8 stocks in a run, and the tool holds that limit: a run told a limit in its job text asked for the whole account anyway. It has no web search. The Market Reviewer reads the news each morning and its notes are on each stock's Activity; a thesis that looks out of date goes to research.

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

These are instructions in its job text. How many stocks it can ask about and what its save can change are limits in its tools.

## Its write-up

Its last reply, kept on the run: where the money is, the ranking, what it did, open questions for its next run, and what the account needs (for the next search for new stocks).

<details>
<summary>Technical details</summary>

#### Runs as
`portfolio-manager` at 10:00 AM ET, Tue and Thu, one run per traded book, mode `PORTFOLIO_MANAGER` (`lib/inngest/functions/portfolio-manager.ts`). The run takes no messages afterwards (`READ_ONLY_RUN_MODES`, `lib/runs/modes.ts`).

#### The run
`runPortfolioManager` (`lib/agent/portfolio-manager/run.ts`): the job text (`prompt.ts`), `loadPortfolioBlock` with `watching: true` and `portfolioDigest: false`, and `MANAGER_TOOLS`: `get_theses`, `get_stock_data`, `update_thesis`, `place_trade`, `manage_position`, `close_position`, `dispatch_thesis_research`.

#### Its theses and its save
`get_theses` on its run takes tickers and counts them against the run (`lib/agent/portfolio-manager/stocks-a-run.ts`); each row is built by `rowForModel` with `fieldsOf` a sale's situation on a holding and a buy's on a watch (`ROW_FIELDS`, `lib/agent/row-for-model.ts`). `update_thesis` on its run has two fields, the thesis and the note.

#### Acting for the stock's analyst
It has no analyst of its own. Each write acts for the stock's own analyst, under that analyst's sizes and limits, the way the unpinned chat does (`accountWide`, `lib/agent/analyst-scope.ts`). Unlike the chat it has none of the owner's powers: no size field, no reason field, no lowering a floor.

#### The write-up
A `RunEvent` of type `portfolio_writeup` on the run. The next run reads the newest one for the book.

#### Trying it with nothing saved
`npx tsx --env-file=.env.local scripts/portfolio-manager-dry-run.ts LIVE` reads the real book and prints every write instead of making it, and the size of each request.

</details>
