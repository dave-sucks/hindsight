# Triggers

**Write the plan once. Triggers keep it.** A trigger is one sentence that says when to act on a stock: "Buy if near $401", "Sell if below $384", "Review 7 days before earnings".

Triggers are how a thesis's plan runs while nobody is watching. They're checked all day, and when one comes true, the right agent looks at the stock.

<!-- asset: card triggers -->

## A condition and an action

Every trigger pairs a condition with one of five actions:

- **Buy** a stock we watch.
- **Add** to a winner we hold.
- **Trim** part of a position.
- **Sell**: the floor, the trail or a time limit.
- **Review**: look again and decide, with no order behind it.

The same sentence shows everywhere: on the thesis sheet, in Activity, and in what the agent reads. A [thesis](theses.md)'s buy, floor and target are triggers too, so its whole plan is in one place.

## What a trigger can watch

Five kinds: the price, the chart's indicators, earnings, filings and a schedule. Pick one to see real examples and how each is checked.

<!-- asset: trigger-kinds -->

## Where a stock's triggers come from

A stock answers to three layers of triggers, and the closest one wins:

1. **Its thesis.** [The Writer](../agents/writer.md) writes the first plan, priced from the setup's rules and the chart. The buy's fill sets the floor and target to where the trade went in. After that, runs keep it current one trigger at a time, and you can edit any of it on the thesis sheet.
2. **Its analyst.** The [analyst](analysts.md)'s sell rules guard every stock it holds, like the Secular Compounder's "Sell if 25% off the high".
3. **The account.** Rules for every holding, set in Settings. By default there's one: consider adding when a holding is up 7% in a day.

An inherited rule is never copied onto the thesis, so changing an analyst's style changes every holding at once. Every edit, from any layer, is one line in the stock's Activity.

## When one comes true

Triggers are checked every five minutes while the market is open, plus a pass at 4:20 PM for levels that read the close. A buy fires once, on the day the price crosses its level. A sale or a review keeps firing every day its condition holds, so it can't be quietly forgotten.

What happens next depends on the action:

- **A buy, add, trim or sale** wakes a [trigger run](../agents/trigger-runs.md) within minutes to look at that one stock and decide. A floor that's a plain price, or a percent off the close, our entry or the high, can be set to propose its sale straight away, with no agent.
- **A review** waits for the next [morning run](../agents/morning-runs.md), except a worrying new filing on a stock we hold, which wakes a trigger run the same day.
- **On a stock we only watch,** a close below the floor, or the price reaching the target before we bought, takes the plan down on the spot. No agent wakes and nothing is proposed; the stock stays on watch.

Otherwise the stock is now in a [situation](situations.md), which tells the agent how to answer it, and anything it leads to is a [proposal](approvals.md) you approve. A trigger never trades on its own.

## Floors only go up

On a stock we hold, no agent can lower a floor, widen a trail, remove a protective trigger, or switch a floor from selling straight away to asking an agent first; the save refuses it. On a stock we only watch, the floor is free to change. A sale you decline or let expire is proposed again each day the price stays past the line. An agent that thinks the line is wrong names the level in its note, and only you move it down.

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

#### Rest periods
Each measure's default cooldown, in its catalog entry: a price level, a day's move, volume or RSI at most once a day; the move from our entry once a week; a beat or a miss once a week; an earnings window once a month; strength against the S&P once a week; a filing once per filing; insider buying once every 30 days; a review on a state at most once a week while it holds; the floor and the trail on a holding every day until answered.

#### Reference
`docs/TRIGGERS.md` · `docs/plans/TRIGGER_MODEL.md` · `docs/plans/TRIGGER_TYPES.md`
</details>
