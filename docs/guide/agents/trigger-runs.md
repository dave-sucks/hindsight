# Trigger runs

**When a stock moves, an analyst looks.** A trigger fires, and within minutes its analyst reads that one stock and decides.

It checks what's true now, then proposes the trade, redraws the line, or holds and says why.

```chat
caption: A sale trigger fires on SHOP during the day.
tools: Trigger fired on $SHOP
- SHOP: Sell if below $96 · $95.12 at 10:40 AM
tools: Pulling $SHOP's snapshot (+1 more)
- SHOP: $95.12 · 0.9% under the floor · volume 1.6× normal
- No company news since the report; software is down 2.4% on the day
text: Selling $SHOP (−3.4%) at $95.12. The floor sat under the gap-day low and broke on heavy volume with nothing new on the business. The drift has failed.
tools: Closing $SHOP position
- SHOP [sell] {Proposal}: Sell 120 shares at about $95.12 · waiting for your approval
```

## What it does

A trigger run is the analyst's short, focused look at one stock, started by one of the [thesis](../concepts/theses.md)'s [triggers](../concepts/triggers.md). The plan the Writer wrote said "buy here", "sell there"; the trigger run is where that plan meets the live price. It reads only that stock, checks whether the fire still holds, and makes one decision. It has fifteen steps at most; deep research goes to [the Writer](writer.md) instead.

## What wakes it

Every five minutes while the market is open, plus a pass at 4:20 PM for levels that read the close, every trigger on every stock is checked. When a buy, add, trim or sale trigger comes true, the fire is written into Activity and a trigger run starts on that stock.

- **Reviews wait for the morning.** A review is a question, not an order, so it goes on the stock's list for the next [morning run](morning-runs.md). The one exception: a worrying new filing on a stock we hold wakes a run the same day.
- **Some sales skip the run.** A floor can be set to propose its sale straight away, with no analyst at all. It still waits for your approval.
- **A buy fires on the crossing.** It fires the moment the price reaches its level, not every day it stays there. A sale keeps asking every day its condition holds.

## What it reads

The stock's row, the same one `get_theses` gives every agent: the position, the plan, every trigger with its id, the belief and what would prove it wrong, and anything you've said. The trigger that fired comes with the words you wrote when you set it, and each [situation](../concepts/situations.md) the stock is in brings its instructions. Then `get_stock_data` gives the live price and the news.

A give-back is measured from the highest price since the buy, kept over the whole holding. The run can't call a fire false by reading a lower high off a short chart; declining a sale takes new evidence about the business.

## What it can do

- **Act:** propose the sale with `close_position`, the trim or add with `manage_position`, or the buy with `place_trade`. It's a [proposal](../concepts/approvals.md), and it reaches your queue, your email and your phone at once.
- **Tighten the line:** move the trigger to a level the chart supports. It can raise a floor; it can never lower one, widen a trail or delete a protective trigger on a stock we hold. If it thinks the line is wrong, it says so in its note and names the level for you.
- **Hold, with a reason:** "Not acting yet" and why. A sale it doesn't make asks again every day the price stays past the line, and so does one you declined or let expire.

Whatever it decides, it then brings the stock's other triggers up to date: after an add the floor goes up, and after a level is blown through it's reset off the new chart, not a round number. When a buy it proposed fills, the stock becomes a holding and its sell side takes over; when a sale fills, the thesis is retired as sold and gets one look back on a later [morning run](morning-runs.md).

## How it ends

At most one trade, then exactly one `update_thesis` saying what it did and why, linked to the trigger that fired, and `complete_run`. If you declined this same trade earlier, the note answers you by name.

## Tools

Everything a trigger run can call, read from `lib/agent/modes.ts`.

<!-- asset: tools trigger -->

<details>
<summary>Technical details</summary>

#### Wake
`lib/inngest/functions/trigger-evaluator.ts` sends `app/thesis.trigger.fired`; `tactical-run.ts` starts the run. A review writes its fire and waits, unless a same-day filing calls for a look.

#### Mode
`tactical` in `lib/agent/modes.ts`: `gpt-5.4`, up to 15 steps.

#### Prompt
`lib/agent/system-prompts/intraday-tactical.ts`, with the analyst brief, the house rules and the stock's row from `row-for-model.ts`.

#### Fire rules
`shouldFire` in `lib/agent/triggers/evaluate.ts`: a buy fires on its crossing, a protective rule every day it holds.

#### Direct sales
`fireMode: DIRECT` on a sale skips the run and goes to `closeOpenPosition`, which still waits for approval.
</details>
