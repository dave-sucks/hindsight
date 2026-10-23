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

Every measure, with its numbers, variables, settings and the shape it's saved in: [Trigger measures](../reference/trigger-measures.md).

## Where a stock's triggers come from

A stock answers to three layers of triggers, and the closest one wins:

1. **Its thesis.** [The Writer](../agents/writer.md) writes the first plan, priced from the setup's rules and the chart. When the buy goes through, the floor and target are set to the levels the trade went in with. After that, runs keep it current one trigger at a time, and you can edit any of it on the thesis sheet.
2. **Its analyst.** The [analyst](analysts.md)'s sell rules guard every stock it holds, like the Secular Compounder's "Sell if 25% off the high".
3. **The account.** Rules for every holding, set in Settings. By default there's one: consider adding when a holding is up 7% in a day.

An inherited rule is never copied onto the thesis, so changing an analyst's style changes every holding at once. Every edit, from any layer, is one line in the stock's Activity.

**Stop when buying.** Like a broker's stop on buy: with "Automatically set Stop Limits when Buying a Stock" on, a new holding gets a floor that percent under its buy price, unless it already has its own floor at or above that. It's an ordinary "Sell if below" trigger that proposes the sale straight away, set as yours, so only you can lower it. Turn it on for the account in Settings → Triggers; an analyst's Triggers tab shows the account's choice until you give the analyst its own, and "Use account setting" puts it back. Adding to a stock you already hold doesn't move it. With it off, the buy sets no floor of its own beyond the one the trade names.

## When one comes true

Triggers are checked every five minutes while the market is open, plus a pass at 4:20 PM for levels that read the close. A buy fires once, on the day the price crosses its level. A sale or a review keeps firing every day its condition holds, so it can't be quietly forgotten.

What happens next is the trigger's **On fire**, the same three choices on every trigger:

- **Auto** (Auto-sell, Auto-buy, Auto-add, Auto-trim): the trade, with no agent. It's sized and checked exactly as an agent's would be: a buy needs a floor and a target and is paid from cash, never margin; a trim sells the share it names (half, unless you set another). A review can't be Auto; it is asking.
- **Send to Agent:** a [trigger run](../agents/trigger-runs.md) starts within minutes to look at that one stock and decide.
- **Flag for Review:** the fire goes on the stock's list and the next [morning run](../agents/morning-runs.md) answers it. A worrying new filing on a stock we hold still gets a look the same day.

Left unset, a review is Flag for Review and everything else is Send to Agent. Auto is always chosen: the stop set when buying and a new analyst's trailing sale are Auto-sells. An Auto-buy, Auto-add or Auto-trim is yours alone, set on the stock itself (not as an account or analyst rule), and is a one-time order: once it fires it comes off the stock, with a line in Activity ("Used once: Trim 30% if above $150 (Auto-trim)"). An Auto-sell keeps asking every day, like any sale. When your approval switch for that side is on, an Auto trade still waits for your approval; the dialog says so under On fire.

- **On a stock we only watch,** a close below the floor, or the price reaching the target before we bought, takes the plan down on the spot, whatever On fire says. No agent wakes and nothing is proposed; the stock stays on watch.

Otherwise the stock is now in a [situation](situations.md), which tells the agent how to answer it. Every trade, the agent's or an Auto one, goes through your [approval](approvals.md) switch: with it on, it is a proposal you approve.

The whole path from the price check to the run, with every rule that holds a fire back: [From fire to run](../deep-dives/trigger-fire-to-run.md).

## Floors only go up

On a stock we hold, no agent can lower a floor, widen a trail, remove a protective trigger, or slow a sale down (from Auto-sell to Send to Agent, or from Send to Agent to Flag for Review); the save refuses it. No agent can make a buy, add or trim Auto. On a stock we only watch, the floor is free to change. A sale you decline or let expire is proposed again each day the price stays past the line. An agent that thinks the line is wrong names the level in its note, and only you move it down.

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

#### On fire
`fireMode` in `lib/agent/triggers/fire-mode.ts`: `DO_IT` (Auto), `ASK_NOW` (Send to Agent) or `NEXT_MORNING` (Flag for Review), stamped on every write. An Auto trade is the tool an agent would call (`doItCall`, `lib/agent/triggers/do-it.ts`), so the approval switch, sizing and checks are the same; an Auto buy, add or trim comes off the stock once used (`useOnce`).

#### Write path
`applyTriggerOps` in `lib/agent/triggers/ops.ts`, shared by `update_thesis`, the trigger editor and the buy going through (`armHeldLadderOnFill`).

#### Floors
`protectiveRatchetViolations` in `lib/agent/triggers/ratchet.ts`; your edits on the sheet are exempt.

#### Stop when buying
`autoStopOp` and `loadAutoStop` in `lib/trading/auto-stop.ts`, applied by `armHeldLadderOnFill` after the trade's own levels. `Account.autoStopOnBuy` / `autoStopPct` (default off, 8%); `AgentConfig` holds the same two, null meaning the account's. Saved by `saveAutoStop` in `lib/actions/auto-stop.actions.ts` (0.5–50%).

#### Rest periods
Each measure's default cooldown, in its catalog entry: a price level, a day's move, volume or RSI at most once a day; the move from our entry once a week; a beat or a miss once a week; an earnings window once a month; strength against the S&P once a week; a filing once per filing; insider buying once every 30 days; a review on a state at most once a week while it holds; the floor and the trail on a holding every day until answered.

#### Reference
`docs/TRIGGERS.md` · `docs/plans/TRIGGER_MODEL.md` · `docs/plans/TRIGGER_TYPES.md`
</details>
