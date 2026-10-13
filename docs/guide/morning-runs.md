# Morning runs

**Your analysts, at 8 AM.** Every weekday morning, each analyst reads its whole book and answers the stocks that need it.

It decides on what changed, leaves the quiet stocks alone, and sends every trade to you as a proposal.

```chat
caption: A morning run for the PEAD Specialist.
tools: Reading your book (+1 more)
- 11 stocks · 4 need an answer · 7 are quiet
- SPY above its 50-day · the market is risk-on
text: $SHOP (−3.4%) closed through its $96 floor on no company news. The drift has failed, so I'm proposing the sale.
tools: Closing $SHOP position (+2 more)
- SHOP [sell] {Proposal}: Sell 120 shares at about $95.12
- AVGO: Earnings review · held, floor raised to $1,610 to keep most of the gain
- ADBE: Plan check · buy moved to $402, under the 20-day
tools: Recording the run summary
- 1 proposal waiting for you · 2 plans changed · 7 stocks left alone
```

## What it does

The morning run is how an analyst keeps its whole book honest. Once a day it reads every stock it holds or watches, takes one action on each stock that's in a [situation](situations.md), and leaves the quiet ones alone.

It's the run that picks up everything the day before left behind: [reviews](triggers.md) that fired and waited for the morning, review clocks that came due, research that got old, plans the price moved past, gains with no floor under them, and anything you said that no run has answered. It never trades: buys, sales, adds and trims go to your queue as [proposals](approvals.md), and every change to a [thesis](theses.md) lands in Activity the moment it's made.

## When it runs

At 8 AM Eastern on the analyst's run days, every weekday by default. Market holidays are skipped. The Run button on an analyst's page starts one on any day, and you can watch it stream in.

## What it reads

The run opens with two reads. `get_portfolio_context` gives live positions, cash, the account's open risk and the market's mood. `get_theses` gives the book, with each stock at the size today needs:

- **A quiet stock** is one line: the price, the plan, the next review.
- **A stock in a [situation](situations.md)** gets a short row (position, plan, triggers, belief) and the instructions for that situation, once.
- **A stock whose research needs re-planning** gets the full row, research and all.

<!-- asset: read-demo -->

It also reads its analyst's brief: the strategy you wrote, word for word, its rules on direction and size, and how many slots are free.

## How it decides

It works the list one stock at a time, saying which one it's picking up and why, and takes exactly one action on each. A single `update_thesis` answers all of a stock's situations at once. Before a buy, a sale, an add or a trim it calls `get_stock_data` for the news and a fresh quote.

- **Sell or trim:** `close_position` or `manage_position`, as a proposal with its reason. A sale you declined or let expire, with the price still past the line, is proposed again with today's reasons.
- **Buy or add:** `place_trade` or `manage_position`. The size is worked out by risk inside the analyst's band; the run never picks it.
- **Redraw the plan or raise a floor:** `update_thesis`, one trigger at a time. It can tighten a floor; it can never lower one on a stock we hold.
- **Get fresh research:** `dispatch_thesis_research` sends the stock to [the Writer](writer.md): a stock you added that's due its first research, research past the analyst's limit, a watch whose wake fired.
- **Answer you:** your notes and decisions come first, quoted, with what it decided on each.
- **Look back once:** a stock sold in the last two weeks is either watched again with a re-entry level or let go.
- **Nothing to change:** one sentence on what it checked and what would change its mind.

## The market and cash

The market's mood sets how hard it leans in:

- **Risk-on:** full size.
- **Cautious** (the S&P more than 1% under its 50-day): buys are half size, and breakouts wait.
- **Risk-off** (more than 1% under its 200-day): only event-driven and mean-reversion buys.

Idle cash is a decision too. With more than a quarter of the account in cash, a watched stock at its buy level and a risk-on market, the run either acts or says in its summary why it didn't.

## How it ends

`record_run_summary` lists what the run did, each stock it touched with a one-word action. `complete_run` then checks the summary against the orders: a sale it names on a stock it holds needs a sale or a sale proposal from this run, or the run can't finish until it fixes one or the other.

## Tools

Everything the morning run can call, read from `lib/agent/modes.ts`.

<!-- asset: tools morning -->

<details>
<summary>Technical details</summary>

#### Schedule
`lib/inngest/functions/morning-research.ts`, cron `0 8 * * 1-5` Eastern, then each analyst's `runDaysOfWeek`; skipped when `isTradingDay()` is false. A manual run skips both.

#### Mode
`research-run` in `lib/agent/modes.ts`: `gpt-5.4`, up to 65 steps, an 800-second limit.

#### Prompt
`lib/agent/system-prompt.ts`, with the analyst brief and the house rules. Situation texts come from `SITUATIONS` in `lib/agent/situations.ts`, never the prompt.

#### The read
`get_theses` builds each row with `lib/agent/row-for-model.ts` at one of three sizes.

#### Close-out
`complete_run` credits a sale from the `Order` table, not the run's words (`lib/agent/summary-action-check.ts`).
</details>
