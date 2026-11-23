# Portfolio Manager

**The one agent that looks at the whole account at once.** Each stock has its own analyst, who decides whether it is worth owning. The Portfolio Manager decides whether it is the best use of the account's money. Twice a week it reads the table of every stock you hold and watch (the stocks in a situation first, then the top and the bottom by the day's move), gets the thesis on the few it is weighing a trade on, and leaves a write-up plus, at most, three proposals for you.

It also runs once, on any day, when the account's market trigger fires: "Run the Portfolio Manager if the S&P is down 2% on the day" (Settings → Triggers).

Every trade it proposes waits for your approval, like any run's. It never rewrites a stock's case or its conviction, and it never sizes a trade: code does.

```facts
Model: gpt-5.4
Starts: Tue and Thu · 10:30 AM ET
Steps: up to 40
Tools: theses by ticker, stock data, a note, trigger edits, the trades, a research request
Saves: a write-up, notes on stocks, trigger edits, proposals, research requests
```

## When the market starts it

The account has one trigger of its own, on the market, shown in Settings → Triggers: "Run the Portfolio Manager if the S&P is down 2% on the day". The S&P is read by SPY against yesterday's close, on the same 5-minute check as every trigger, and never on a quote older than 15 minutes. When it fires, the Portfolio Manager runs once for the account, the same run as a scheduled one, with one more line in its first message: the S&P's move today and the trigger that fired.

- **At most one a day.** Like every trigger it fires when it becomes true, and not again until a 4:20 PM close finds it false. After a day that closes down 2% or more, it stays quiet until a day closes better than that.
- **On a Tuesday or Thursday** it fires all the same. After 10:30 the fall is news since the morning's run. Before 10:30 both runs happen, one after the other, and the second reads the first's write-up.
- **No stock inherits it.** It is the account's, not a rule for every stock: a fall in the market starts one run, not one per stock.

## What it's given

<!-- asset: context portfolio_manager -->

- **Its instructions:** one document, `portfolio-manager.md`: its job, then the rules it imports (the house rules and how it writes).
- **Its context**, in its first message after the date line: the market numbers, the 9:00 market digest and the [portfolio snapshot](portfolio-digest.md#the-portfolio-snapshot) (not the 8 PM portfolio digest, so its view of the proposals waiting for you is its own); the stock table (every stock you hold and watch, a line each with the same columns: its analyst, its situation, price, the day's move and volume, the 5-day and 1-month moves, where it sits against the S&P, its 50-day average and its 52-week high, the gain since the buy, outlook, conviction and the next report); and its own last write-up, so it remembers what it was weighing.

It is given nothing in a format of its own. The stock table is the one an analyst's morning run gets for its own stocks, here for the whole account, and the run page shows the same rows.

## What it asks for

It asks `get_theses` for stocks by ticker, the tool every agent uses. One field rule, for comparing stocks, decides what comes back, the same for a holding and a watch:

- the [situations](../concepts/situations.md) the stock is in, by name: its analyst answers them, and the Portfolio Manager sees that something is up
- the belief, its key assumptions, what would prove it wrong, and the reason for its conviction
- its triggers
- its Activity, the same list an analyst reads: from the last 45 days, the last 3 reviews, 3 news notes of medium or high impact, 3 of your notes and your last decline
- Wall Street's view and the catalyst date
- the chart numbers, the playbook (on a watch, the triggers that come with the buy), the position and any proposal waiting

It does not get the bull and bear cases; those go to the analyst on the stock's review.

It may ask about any stock you own, and 8 watched stocks a run. It has no web search: the Market Reviewer reads the news each morning, and a thesis that looks out of date goes to research.

## The question it asks

For each stock it weighs: would we buy it today, at today's price, knowing what we know now? What we paid is not part of the answer. A stock's outlook and conviction are its analyst's rating; only a holding's outlook comes with its reason in the first message, and the rest come with the thesis.

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
- A case that looks wrong goes to research (the [Writer](writer.md)); it does not rewrite the case. The research is for the analyst whose thesis it is; on a stock two analysts hold or watch, the request names which one, or is refused with both listed.
- Its note on a stock is not the analyst's review: the stock's review clock keeps counting.
- Doing nothing is a normal result.

## What its tools hold it to

A run told a limit in its job text went past it, so these are in code:

- **8 watched stocks a run** from `get_theses`.
- **Three proposals a run.** A fourth is refused.
- **Its trades always wait for you**, whatever your approval switches say.
- **A note only with a trade, a research request or a trigger edit** it made on that stock this run. Its view of every other stock is in its write-up, so its notes don't fill a stock's Activity.
- **Its save is a note and its trigger edits** ("buy it if X happens"): no status or conviction, and no lowering a floor.

The rest of its rules above are instructions in its job text.

## Its write-up

Its last reply, kept on the run: where the money is, the ranking, what it did, open questions for its next run, and what the account needs (for the next search for new stocks).

<details>
<summary>Technical details</summary>

#### Runs as
Its line in the schedule (`SCHEDULE`, `lib/agent/engine/schedule.ts`): 10:30 AM ET, Tue and Thu, one run per traded book, not on a market holiday. The one scheduler (`agent-scheduler`, `lib/inngest/functions/agent-scheduler.ts`) runs it through the runner, mode `PORTFOLIO_MANAGER`.

#### The market trigger
Stored on `Account.marketTriggers`, in the trigger shape, with its fire state on it; a stock's triggers are read from `Account.triggers` only. Its measure is `market` (`lib/agent/triggers/condition/measures/market.ts`) and its action `RUN_PORTFOLIO_MANAGER`; no Add trigger menu and no agent's tool offers either, and a save of either on a stock is refused (`actionProblem`, `addProblem`). The trigger check reads it after the stocks on each pass (`checkMarketTriggers`, `lib/agent/triggers/market.ts`, with `shouldFire`), and a fire sends `app/market.trigger.fired`. The scheduler takes that event and runs the Portfolio Manager for each traded book of the account, with the fire's line as its message; the scheduler runs one function at a time, so this run and a scheduled one never overlap. The migration that added the column wrote the one rule on every account. The run takes no messages afterwards (`READ_ONLY_RUN_MODES`, `lib/runs/modes.ts`).

#### The run
`runPortfolioManager` (`lib/agent/portfolio-manager/run.ts`) runs its record, `PORTFOLIO_MANAGER` (`lib/agent/engine/agents/portfolio-manager.ts`), through the agent runner (`runAgent`, `lib/agent/engine/run.ts`, `docs/plans/AGENT_ENGINE.md`), which builds its request with the agent engine (`buildAgentRequest`, `lib/agent/engine/build.ts`) and makes the call with the record's model, step limit (40) and time limit (770 seconds). The record holds its job text, the context blocks it is given (the house rules, how you write, the market numbers, the market digest, the portfolio snapshot and the Watching block, with no portfolio digest), and its tools: `get_theses`, `get_stock_data`, `write_note`, `edit_triggers`, `place_trade`, `add`, `sell`, `dispatch_thesis_research`. Its run keeps which part of the request is which, and the run page's Context panel shows one row per part. Its job runs it as a saved run (`runAgentAsRun`, the same file): the runner opens the run, runs it, and saves its thread (it has no message, so the run page opens with its reply; its reads, the last write-up among them, are in the Context panel), its token use, its notes on its proposals, its write-up (`keepWriteup`, kept by `PORTFOLIO_MANAGER_RUN`) and its status, COMPLETE or FAILED only while the run is still RUNNING. The Agents page (`/how-it-works/agents`) shows the record.

#### Its theses, its limits and its save
`get_theses` on its run takes tickers; each row is built by `rowForModel` with `comparing` (`COMPARING_FIELDS`, `lib/agent/row-for-model.ts`). The limits are `lib/agent/portfolio-manager/limits.ts`: `managerPick` counts the watches asked about, and `withRunLimits` wraps the run's tools with the proposal count and the note rule. `isManagerRun` at each trade tool's approval check makes its trade a proposal (`always`, `lib/proposals/maybe-await-approval.ts`). `write_note` on its run has two fields, the thesis and the note; `edit_triggers` has no playbook field.

#### Acting for the stock's analyst
It has no analyst of its own. Each write acts for the stock's own analyst, under that analyst's sizes and limits, the way the unpinned chat does (`accountWide`, `lib/agent/analyst-scope.ts`). Unlike the chat it has none of the owner's powers: no size field, no reason field, no lowering a floor.

#### The write-up
A `RunEvent` of type `portfolio_writeup` on the run. The next run reads the newest one for the book.

#### Trying it with nothing saved
`npx tsx --env-file=.env.local scripts/portfolio-manager-dry-run.ts LIVE` reads the real book and prints every write instead of making it, and the size of each request.

</details>
