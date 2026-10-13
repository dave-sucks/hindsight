# Triggers

**Write the plan once. Triggers keep it.** Every trigger is one sentence: when to buy, add, trim, sell or look again.

The system checks each one all day and wakes the analyst the moment one comes true.

<!-- asset: trigger-log -->

## What a trigger is

A trigger is a condition and an action, written as one sentence: "Sell if below $40.80", "Review 7 days before earnings". The same sentence appears everywhere: on the pill on the thesis sheet, in Activity, and in what the analyst reads. A [thesis](theses.md)'s whole plan is its triggers, including its buy, its floor and its target.

There are five actions:

- **Buy** opens a position on a stock we watch.
- **Add** asks whether to press a winner.
- **Trim** takes part of a position off.
- **Sell** is the floor, the trail or the time limit.
- **Review** wakes the analyst to look and decide, without an order behind it.

## Five kinds

What a trigger can watch comes in five kinds: price, the chart's indicators, earnings, filings, and a schedule. Each kind below has real examples and how it's checked; the examples are in `lib/docs/trigger-examples.ts`.

<!-- asset: trigger-kinds -->

## When they're checked

Every five minutes while the market is open, plus a pass at 4:20 PM for levels that read the day's close. The chart numbers (averages, highs, volume, strength against the market) are worked out at 6:30 every morning, so every check that day reads the same numbers.

## When one fires

The fire is written into the stock's Activity, with the price that fired it. A buy, add, trim or sale wakes a [trigger run](trigger-runs.md) within minutes; a review waits for the analyst's next [morning run](morning-runs.md). Either way, a trigger never trades on its own: anything it leads to is a [proposal](approvals.md) you approve.

## Protection keeps asking. Buys don't chase.

- **Sales and reviews are standing orders.** They ask every day their condition holds. Decline a sale and it asks again tomorrow, so a floor is never quietly forgotten.
- **A buy fires once, on the cross.** It fires on the day the price reaches its level, not every day it stays there. A level set after the close is measured from the price it was set at.

## Rules come from three places

A stock's triggers are its own, plus the ones it inherits from its [analyst](analysts.md) and from the account. The closest one wins: a trigger on the thesis beats the analyst's, which beats the account's.

1. **Account rules:** checks every holding gets, like a weekly review and a heads-up three days before every report.
2. **Analyst rules:** the analyst's style. The Secular Compounder's only automatic sale is "Sell if 25% off the high".
3. **This thesis:** its own triggers, written for this stock, like "Sell if below $384" under the gap-day low. They beat the rules above.

An inherited rule is never copied onto the thesis, so changing an analyst's style changes it on every stock at once.

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
`shouldFire` in `lib/agent/triggers/evaluate.ts`: ENTER on the crossing; protective and review rungs re-fire while true.

#### Fire modes
`TACTICAL` wakes a trigger run; `DIRECT` proposes a mechanical sale without the agent. Both go through approval.

#### Write path
`applyTriggerOps` in `lib/agent/triggers/ops.ts`, shared by `update_thesis` and the trigger editor.

#### Reference
`docs/TRIGGERS.md` · `docs/plans/TRIGGER_MODEL.md` · `docs/plans/TRIGGER_TYPES.md`
</details>
