# Triggers

**Write the plan once. Triggers keep it.** Every trigger is one sentence: when to buy, add, trim, sell or look again.

The system checks each one all day, and the moment one comes true, the right agent looks at the stock.

<!-- asset: card triggers -->

## What a trigger is

A trigger is a condition and an action, written as one sentence: "Sell if below $40.80", "Review 7 days before earnings". The same sentence appears everywhere: on the pill on the thesis sheet, in Activity, and in what the analyst reads. A [thesis](theses.md)'s whole plan is its triggers, including its buy, its floor and its target.

There are five actions:

- **Buy** opens a position on a stock we watch.
- **Add** asks whether to press a winner.
- **Trim** takes part of a position off.
- **Sell** is the floor, the trail or the time limit.
- **Review** wakes the analyst to look and decide, without an order behind it.

## Where triggers come from

- **[The Writer](writer.md) writes the first plan** when it writes the thesis: the buy at a level from the setup's rules and the chart, the floor under real structure, the target, and a review clock. Never a round number, and the reward at least twice the risk.
- **The buy filling arms the holding.** The floor and target are set to the levels the trade went in at, and a holding's review clock and earnings reviews are added.
- **The analyst's sell rules guard every holding** without being copied onto it: the trail, the time limit, the style's own rules. See "Rules come from three places" below.
- **Runs keep the plan current,** one trigger at a time: a [morning run](morning-runs.md) re-prices a buy the price left behind or raises a floor under a gain; a [trigger run](trigger-runs.md) resets the rest of the plan after it acts.
- **You** can add, edit or delete any trigger on the thesis sheet, or ask for one in [chat](chat.md). "Sell under $62" in a note becomes a trigger, not just words.

Every change is one line in the stock's Activity, saying who made it and why.

## Five kinds

What a trigger can watch comes in five kinds: price, the chart's indicators, earnings, filings, and a schedule. Each kind below has real examples and how it's checked; the examples are in `lib/docs/trigger-examples.ts`.

<!-- asset: trigger-kinds -->

## When they're checked

Every five minutes while the market is open, plus a pass at 4:20 PM for levels that read the day's close. The chart numbers (averages, highs, volume, strength against the market) are worked out at 6:30 every morning, so every check that day reads the same numbers.

## When one fires

The fire is written into the stock's Activity, with the price that fired it. What happens next depends on the action:

- **A buy, add, trim or sale** wakes a [trigger run](trigger-runs.md) within minutes. It reads that one stock, checks the fire still holds, and decides.
- **A floor can be set to sell straight away:** it proposes the sale with no agent at all.
- **A review** waits for the analyst's next [morning run](morning-runs.md). A review is a question, not an order.

Every fire also puts the stock in a [situation](situations.md): a sale that fired is a "sale signal", a buy that fired is "buy level reached", a review is "review due". The situation carries the instructions for answering it. And a trigger never trades on its own: anything it leads to is a [proposal](approvals.md) you approve.

## Protection keeps asking. Buys don't chase.

- **Sales and reviews are standing orders.** They ask every day their condition holds. Decline a sale, or let it expire, and it's proposed again tomorrow while the price stays past the line, so a floor is never quietly forgotten.
- **A buy fires once, on the cross.** It fires on the day the price reaches its level, not every day it stays there. A level set after the close is measured from the price it was set at.
- **Only you lower a floor.** On a stock we hold, no agent can lower a floor, widen a trail or delete a protective trigger; the save refuses it. An agent that thinks the line is wrong names the level in its note, and you decide.

## Rules come from three places

A stock's triggers are its own, plus the ones it inherits from its [analyst](analysts.md) and from the account. The closest one wins: a trigger on the thesis beats the analyst's, which beats the account's.

1. **Account rules:** checks every holding gets, like a weekly review and a heads-up three days before every report.
2. **Analyst rules:** the analyst's style. The Secular Compounder's only automatic sale is "Sell if 25% off the high".
3. **This thesis:** its own triggers, written for this stock, like "Sell if below $384" under the gap-day low. They beat the rules above.

An inherited rule is never copied onto the thesis, so changing an analyst's style changes it on every stock at once. Deleting a thesis's own trigger lets the inherited one show through again.

## Rest periods

Each trigger knows when to stay quiet, so one condition doesn't ask fifty times a day.

- A price level, a day's move, volume or RSI: at most once a day.
- The move from our entry: once a week, so a milestone isn't asked twice.
- A beat or a miss, or a heads-up before a report: once per report.
- A new filing: once per filing. Insider buying: once every 30 days.
- A review on a state, like being below the 200-day: at most once a week while it holds.
- The floor and the trail on a holding: every day until it's answered.

<details>
<summary>Technical details</summary>

#### Shape
`{ watch, is?, value?, variable?, settings? }`, or `{ match, conditions }` for two or more. Stored on the thesis, the analyst or the account.

#### Catalog
One entry per measure in `lib/agent/triggers/condition/measures/`, grouped into the five types by `catalog.ts`. Words from `describe.ts`.

#### Check
`trigger-evaluator.ts`: every 5 minutes in market hours, plus a close pass 16:20–16:34 ET. Chart measures read the 06:30 `TickerIndicators` snapshot.

#### Fire semantics
`shouldFire` in `lib/agent/triggers/evaluate.ts`: a buy fires on the crossing; protective and review triggers fire again while true.

#### Fire modes
`TACTICAL` (the default) wakes a trigger run; `DIRECT` proposes a sale without the agent. Both go through approval.

#### Write path
`applyTriggerOps` in `lib/agent/triggers/ops.ts`, shared by `update_thesis`, the trigger editor and the buy's fill (`armHeldLadderOnFill`).

#### Floors
`protectiveRatchetViolations` in `lib/agent/triggers/ratchet.ts`; your edits on the sheet are exempt.

#### Reference
`docs/TRIGGERS.md` · `docs/plans/TRIGGER_MODEL.md` · `docs/plans/TRIGGER_TYPES.md`
</details>
