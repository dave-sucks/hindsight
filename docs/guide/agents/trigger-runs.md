# Trigger runs

**When a stock moves, an analyst looks.** A trigger comes true, and within minutes its analyst reads that one stock and decides.

It checks the fire against what's true now, then proposes the trade, redraws the line, or holds and says why.

```facts
Model: gpt-5.4
Starts: Minutes after a fire
Steps: Up to 15
Tools: 14
Saves: 11 fields: plan, note
```

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

A trigger run is an analyst's short look at one stock, started when one of its [thesis](../concepts/theses.md)'s [triggers](../concepts/triggers.md) comes true. The plan said "buy here" and "sell there"; this is where the plan meets the live price. One stock, one decision, fifteen steps at most. Deep research goes to [the Writer](writer.md) instead.

Why a run and not an automatic order? A level is a call made days ago. The run checks it against today (the news, the volume, the market) before anything reaches you, and says what it saw either way.

## When it runs

Every five minutes while the market is open, plus a pass at 4:20 PM for levels read on the close, every trigger on every stock is checked. When a buy, add, trim or sale trigger comes true, the fire is written into Activity and a trigger run starts on that stock.

- **A buy fires on the crossing:** the moment the price reaches its level, not every day it stays there. A sale keeps asking every day its condition holds.
- **Reviews wait for the morning.** A review is a question, not an order, so it goes on the stock's list for the next [morning run](morning-runs.md). The one exception: a worrying new filing on a stock we hold gets a look the same day.
- **Some sales skip the run.** A floor can be set to propose its sale straight away, with no analyst. It goes through the same [approval](../concepts/approvals.md) as any sale.

## What it reads

The stock's row, the same one `get_theses` gives every agent: the position, the plan, every trigger with its id, the belief and what would prove it wrong, and your notes. It comes with the trigger that fired and the instructions for each [situation](../concepts/situations.md) the stock is in. Then `get_stock_data` gives the live price and the news.

A give-back is measured from the highest price since the buy, over the whole holding. The run can't call a fire false by reading a lower high off a short chart; declining a sale takes new evidence about the business.

## What it decides

- **Act:** propose the sale with `close_position`, the trim or add with `manage_position`, or the buy with `place_trade`. The [proposal](../concepts/approvals.md) reaches your queue, your email and your phone at once.
- **Tighten the line:** move the trigger to a level the chart supports. It can raise a floor; it can never lower one, widen a trail or delete a protective trigger on a stock we hold. If it thinks the line is wrong, it says so and names the level, and lowering it is yours to do on the thesis.
- **Hold, with a reason:** "not acting yet," and why. A sale it doesn't make asks again every day the price stays past the line, and so does one you declined or let lapse.

Whatever it decides, it brings the stock's other triggers up to date: after an add the floor goes up, and a level the price blew through is reset off the new chart, not a round number.

## What happens next

The run ends with at most one trade, exactly one `update_thesis` that says what it did and why, linked to the trigger that fired, and `complete_run`. If you declined this same trade before, the note answers you.

- **A buy fills:** the stock becomes a holding. Its floor and target are set from the fill, and its sell side takes over.
- **A sale fills:** the thesis is retired as sold, and a later [morning run](morning-runs.md) gives it one look back.

## Tools

Everything a trigger run can call, read from `lib/agent/modes.ts`.

<!-- asset: tools trigger -->

<details>
<summary>Technical details</summary>

#### Wake
`lib/inngest/functions/trigger-evaluator.ts` sends `app/thesis.trigger.fired`; `tactical-run.ts` starts the run. A review writes its fire and waits, unless a same-day filing calls for a look (`filingNeedsSameDayLook`).

#### Mode
`tactical` in `lib/agent/modes.ts`: `gpt-5.4`, up to 15 steps.

#### Prompt
`lib/agent/system-prompts/intraday-tactical.ts`, with the analyst brief, the house rules and the stock's row from `row-for-model.ts`.

#### Fire rules
`shouldFire` in `lib/agent/triggers/evaluate.ts`: a buy fires on its crossing, a protective rule every day it holds.

#### Floors
`lib/agent/triggers/ratchet.ts` refuses any agent edit that lowers, widens or deletes a protective level. Your edits on the thesis sheet don't go through it.

#### Direct sales
`fireMode: DIRECT` on a sale skips the run and goes to `closeOpenPosition`.
</details>
