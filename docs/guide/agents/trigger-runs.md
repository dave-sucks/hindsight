# Trigger runs

**When a stock moves, an analyst looks.** A trigger comes true, and within minutes its analyst reads that one stock and decides.

It checks the fire against what's true now, then proposes the trade, redraws the line, or holds and says why. When the trigger was set to Auto, the trade is already made, and the run writes it up.

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

Every five minutes while the market is open, plus a pass at 4:20 PM for levels read on the close, every trigger on every stock is checked. When a trigger set to **Send to Agent** comes true (every trigger but a review, unless you chose otherwise), the fire is written into Activity and a trigger run starts on that stock.

- **A buy fires on the crossing:** the moment the price reaches its level, not every day it stays there. A sale keeps asking every day its condition holds, until the stock is sold. An add or a trim asks again each time its rest period ends: a day on a price line, a week on the move from our entry.
- **Reviews are flagged for the morning, unless sent to the agent.** A review is a question, not an order, so by default (**Flag for Review**) it goes on the stock's list for the next [morning run](morning-runs.md). Set to **Send to Agent**, it starts a trigger run the same day, which answers it with the review's guidance (each one is a run, about 6–18 cents). A worrying new filing on a stock we hold always gets a look the same day.
- **A trim names its size.** The run is told "Trim 30% if above $150", and a partial sale it makes without naming a size sells that 30%.
- **An Auto trade is made first, then written up.** An Auto-sell, Auto-trim, Auto-buy or Auto-add happens with no agent deciding: the trigger run makes the trade the agent would have made, with the same tool, sizing and checks, and it goes through the same [approval](../concepts/approvals.md) as any trade. Then the same run reads the stock and writes the note, with no trade tools: what's going on with the company and why, what it means for why we own it, the trade, and whether the analyst agrees. That note is the trade's reason on the card and in the email. A refused trade is written up the same way. An Auto buy, add or trim is used once and comes off the stock; an Auto-sell keeps asking.

## What it reads

The stock's row, the same one `get_theses` gives every agent: the position, the plan, every trigger with its id, the belief and what would prove it wrong, and the stock's newest 8 Activity lines exactly as you see them on the Overview. It comes with the trigger that fired (and its note, when someone wrote one; a default that only restates the trigger isn't shown) and the instructions for each [situation](../concepts/situations.md) the stock is in. Then `get_stock_data` gives the live price and the news, and one web search gives the stock's latest news, so the note can say why it moved.

A give-back is measured from the highest price since the buy, over the whole holding. The run can't call a fire false by reading a lower high off a short chart; declining a sale takes new evidence about the business.

## What it decides

- **Act:** propose the sale with `close_position`, the trim or add with `manage_position`, or the buy with `place_trade`. On the live account, the [proposal](../concepts/approvals.md) reaches your queue, your email and your phone at once.
- **Tighten the line:** move the trigger to a level the chart supports. It can raise a floor; it can never lower one, widen a trail or delete a protective trigger on a stock we hold. If it thinks the line is wrong, it says so and names the level, and lowering it is yours to do on the thesis.
- **Write up an Auto trade:** with no trade tools, what is going on with the company and why, what it means for why we own it, the trade, and whether it agrees. If it would have done otherwise, it says so; you decide on the card. Its note is the trade's reason.
- **Hold, with a reason:** what is going on with the stock and why it isn't acting. A sale it doesn't make asks again every day the price stays past the line, and so does one you declined or let lapse. While a sale is waiting for your approval, the stock is yours to decide and no run touches it.

Whatever it decides, it brings the stock's other triggers up to date: after an add the floor goes up, and a level the price blew through is reset off the new chart, not a round number.

## What happens next

The run ends with at most one trade, exactly one `update_thesis` that says what it did and why, linked to the trigger that fired, and `complete_run`. If you declined this same trade before, the note answers you.

- **A buy goes through:** the stock becomes a holding. Its floor and target are set to the levels the trade went in with, and its sell side takes over.
- **A sale goes through:** the thesis is retired as sold (or goes back to Watching after a sale at the target), and a later [morning run](morning-runs.md) gives it one look back.

## Tools

Everything a trigger run can call, read from `lib/agent/modes.ts`.

<!-- asset: tools trigger -->

<details>
<summary>Technical details</summary>

#### Wake
`lib/inngest/functions/trigger-evaluator.ts` sends `app/thesis.trigger.fired`; `tactical-run.ts` starts the run. A fire set to the next morning run (a review, unless set otherwise) writes its fire and waits, unless a same-day filing calls for a look (`filingNeedsSameDayLook`).

#### Mode
`tactical` in `lib/agent/modes.ts`: `gpt-5.4`, up to 15 steps.

#### Prompt
`lib/agent/system-prompts/intraday-tactical.ts`, with the analyst brief, the house rules and the stock's row from `row-for-model.ts`.

#### Fire rules
`shouldFire` in `lib/agent/triggers/evaluate.ts`: a buy fires on its crossing, a protective rule every day it holds.

#### Floors
`lib/agent/triggers/ratchet.ts` refuses any agent edit that lowers, widens, deletes or slows a protective sale. Your edits on the thesis sheet don't go through it.

#### Auto
`fireMode: DO_IT` skips the agent's decision: a sale goes to `closeOpenPosition`; a trim, a buy or an add calls `manage_position` or `place_trade` with the trigger's own arguments (`doItCall`), a buy or an add paid from cash (`ToolContext.payFromCash`). The order carries `autoTradeLine` until the write-up's note replaces it (`putNoteOnOrder`, `lib/proposals/auto-writeup.ts`); the write-up has no trade tools (`NOT_IN_A_WRITEUP`) and is sent the `AUTO_TRADE` situation.
</details>
