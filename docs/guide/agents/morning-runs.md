# Morning runs

**Your analysts, at 8 AM.** Every run day, each analyst reads its whole book and answers the stocks that need it.

It acts on what changed and leaves the quiet stocks alone. Every trade it wants goes through your approval gate.

```facts
Model: gpt-5.4
Starts: 8:00 AM ET, run days
Steps: Up to 65
Tools: 15
Saves: 18 fields: plan, verdict, note
```

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

The morning run keeps an analyst's book honest. Once a day it reads every stock the analyst holds or watches, takes one action on each stock that's in a [situation](../concepts/situations.md), and leaves the rest alone.

[Triggers](../concepts/triggers.md) watch prices all day, but a price can't tell you that research went stale, a review came due, a gain has no floor under it, or you left a note nobody answered. The morning run catches all of that, once a day, across the whole book.

Its buys, sales, adds and trims are [proposals](../concepts/approvals.md). On the live account each one waits in your queue for a yes; on paper, approval is off by default and they go straight to the broker. Every change to a [thesis](../concepts/theses.md) lands in Activity the moment it's made.

## When it runs

At 8 AM Eastern on the analyst's run days, Monday to Friday by default. Market holidays are skipped. The Run button on an analyst's page starts one on any day, and you can watch it stream in.

## What it reads

Two reads open the run. `get_portfolio_context` gives positions, cash, the account's open risk and the market's mood. `get_theses` gives the book, each stock at the size today needs:

- **A quiet stock** is one line: the price, the plan, the next review.
- **A stock in a situation** gets a short row (position, plan, triggers, belief) and that situation's instructions, once.
- **A stock that needs a new plan** gets the full row, research and all.

<!-- asset: read-demo -->

The sizes are the point. The whole book at full size is tens of thousands of tokens, re-sent on every step. Sized this way, the run's attention goes to the stocks that need it.

It also reads the analyst's brief: your strategy, word for word, its rules on direction and size, and how many slots are free.

## What it decides

It works the list one stock at a time and takes exactly one action on each. One `update_thesis` answers all of a stock's situations at once. Before any trade it calls `get_stock_data` for the news and a fresh quote, and before any note on a stock it searches the web once for that stock's latest news. The note leads with what happened to the stock and why, then what it means for your position ([what you read](../concepts/theses.md#what-you-read)).

- **Sell or trim:** `close_position` or `manage_position`, as a proposal with its reason. A sale you declined or let lapse, with the price still past the line, is proposed again with today's reasons, or the note says why the analyst holds.
- **Buy or add:** `place_trade` or `manage_position`. The size is worked out by risk, inside the analyst's band; the run never picks it.
- **Redraw the plan:** `update_thesis`, one trigger at a time. It can raise a floor; it can never lower one on a stock we hold.
- **Get fresh research:** `dispatch_thesis_research` sends the stock to [the Writer](writer.md).
- **Answer you:** your notes come first, quoted, with what it decided on each.
- **Leave your queue alone:** a stock with a sale waiting for your approval is yours to decide, so it carries no work; its row says the proposal is waiting. A waiting buy isn't proposed twice.
- **Look back once:** a stock sold in the last two weeks is either watched again with a re-entry level or let go.
- **Change nothing:** one sentence on what it checked and what would change its mind.

The market's mood sets how hard it leans in. Risk-on is full size. Cautious (the S&P more than 1% under its 50-day) halves buys and holds off on breakouts. Risk-off (more than 1% under its 200-day) tells it to take only event-driven and mean-reversion buys. And idle cash is a decision: over a quarter of the account in cash, a watched stock at its buy and a risk-on market means the run acts or says why not.

## What happens next

`record_run_summary` lists every stock the run touched, each with a one-word action. `complete_run` then checks that summary against the orders: on a stock we hold, a pick marked exit, reduce or add needs a matching sale, trim or add from this run, or the run can't finish. A summary that says "sold" when nothing was sold is the one mistake the run isn't allowed to end on.

On the live account, its proposals wait in your queue. Its new levels are triggers, and from here [trigger runs](trigger-runs.md) act on them through the day.

## Tools

Everything the morning run can call, read from `lib/agent/modes.ts`.

<!-- asset: tools morning -->

<details>
<summary>Technical details</summary>

#### Schedule
`lib/inngest/functions/morning-research.ts`, cron `0 8 * * 1-5` Eastern, then each analyst's `runDaysOfWeek` (default Monday to Friday); skipped when `isTradingDay()` is false. A manual run skips both.

#### Mode
`research-run` in `lib/agent/modes.ts`: `gpt-5.4`, up to 65 steps, an 800-second limit.

#### Prompt
`lib/agent/system-prompt.ts`, with the analyst brief and the house rules. Situation texts come from `SITUATIONS` in `lib/agent/situations.ts`, never the prompt.

#### The read
`get_theses` builds each row with `lib/agent/row-for-model.ts` at one of three sizes.

#### Close-out
`complete_run` credits a sale from the `Order` table, not the run's words (`lib/agent/summary-action-check.ts`).
</details>
