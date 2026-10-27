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

**Stop when buying.** Like a broker's stop on buy: with "Automatically set Stop Limits when Buying a Stock" on, a new holding gets two lines.

- **The sale floor** is always that percent under the buy price: an ordinary "Sell if below" trigger set to Auto-sell, set as yours, so only you can lower it.
- **The review line** is the analyst's own floor, when it was tighter than that: it stays where the analyst put it as "Review if below", with the analyst's note, set to Send to Agent. That's where it looks first; the sale floor below it is the hard stop. A stock has one review line; if it already had one, the higher of the two is kept.

A tighter floor you set yourself is left exactly as it is, including a stop you type on the Trade ticket (the ticket starts from the analyst's floor; left as it was, that stays the analyst's). With the setting on, a buy is sized for the wider of the two stops, so a loss at the sale floor stays within the analyst's risk per trade. Turn it on for the account in Settings → Triggers; an analyst's Triggers tab shows the account's choice until you give the analyst its own, and "Use account setting" puts it back. Adding to a stock you already hold doesn't move either line. With it off, the buy sets no floor of its own beyond the one the trade names.

## When one comes true

Triggers are checked every five minutes while the market is open, plus a pass at 4:20 PM for levels that read the close.

> **Some triggers fire every day.** A sale on a stock we hold asks every day its condition holds, until the stock is sold, whatever its On fire. So does an add, trim or review on a price line or a day's move, for as long as it stays true. **A buy fires once,** on the day the price crosses its level, and an Auto-buy, Auto-add or Auto-trim comes off the stock once used.

| | How often it fires |
|---|---|
| Buy | **Once**, on the day the price crosses its level. Not again while the price stays past it; only a new crossing fires it again. |
| Add | Again each time its rest period ends, while its condition holds. An Auto-add fires once. |
| Trim | Again each time its rest period ends, while its condition holds. An Auto-trim fires once. |
| Sell | **Every day** its condition holds, until the stock is sold, in every On fire mode. While a sale waits for your approval it starts nothing new; declined or left to expire, it asks again. |
| Review | Again each time its rest period ends, while its condition holds. |

**The rest period** is how long a trigger stays quiet after it fires, so one condition doesn't ask fifty times a day. It comes with the kind of trigger:

- **A day:** a price line, a day's move, a gap, volume, RSI and the trail.
- **A week:** the move from our entry (a sale on it asks daily, like every sale), a beat or a miss, strength against the S&P, and a review of a state like "below the 200-day".
- **A month:** an earnings window and insider buying.
- **Once per filing** for a filing, and **its own interval** for a schedule.
- **None:** the hard stop a new plan starts with. If a trigger run holds instead of selling, it asks again at the next check.

A trigger's popover shows its rest ("At most once a day") and when it last fired.

What happens next is the trigger's **On fire**, in the next section. The whole path from the price check to the run, with every rule that holds a fire back: [From fire to run](../deep-dives/trigger-fire-to-run.md).

## On fire

| | Auto | Send to Agent | Flag for Review |
|---|---|---|---|
| What happens | The trade, with no agent. With your approval switch on, it comes to you as a proposal right away, with the research brief | A trigger run starts within minutes: one stock, one decision | Goes on the stock's list; the next morning run answers it |
| Buy | ✓ one-time; only you set it | ✓ default | ✓ |
| Add | ✓ one-time; only you set it | ✓ default | ✓ |
| Trim | ✓ one-time, sells its size; only you | ✓ default | ✓ |
| Sell | ✓ asks again every day until sold; agents may set it | ✓ default | ✓ |
| Review | — (a review is asking) | ✓ the same day | ✓ default |

What a trigger does when it comes true, the same three choices on every trigger:

- **Auto** (Auto-sell, Auto-buy, Auto-add, Auto-trim): the trade, with no agent. It's sized and checked exactly as an agent's would be: a buy needs a floor and a target and is paid from cash, never margin; a trim sells its size. With nothing to trade (a buy on a stock we already hold), the agent is asked instead. A review can't be Auto; it is asking.
- **Send to Agent:** a [trigger run](../agents/trigger-runs.md) starts within minutes to look at that one stock and decide.
- **Flag for Review:** the fire goes on the stock's list and the next [morning run](../agents/morning-runs.md) answers it. A worrying new filing on a stock we hold still gets a look the same day.

**A trim's size** is its own field, shown whenever the action is Trim: the share of the position it sells (50% filled in). It means the same thing in every mode, and the trigger says it everywhere: "Trim 30% if above $150". Auto sells that share. A trigger run woken by the trim sells it too unless the analyst names another size, and the morning run reads it in the same sentence.

Left unset, a review is Flag for Review and everything else is Send to Agent. Auto is always chosen: the stop set when buying and a new analyst's trailing sale are Auto-sells.

An Auto-buy, Auto-add or Auto-trim is yours alone: you set it on the stock itself, or chat sets it at your word, never as an account or analyst rule. It is a one-time order: once it fires and its trade is tried (proposed, sent or refused), it comes off the stock, with a line in Activity ("Used once: Trim 30% if above $150 (Auto-trim)"). An Auto-sell keeps asking every day, like any sale, and an agent may set one.

Every trade, the agent's or an Auto one, goes through your [approval](approvals.md) switch for its side, buys or sales: with it on, it is a proposal you approve, and an Auto trade waits for you like any other. The dialog says so under On fire.

- **On a stock we only watch,** a close below the floor, or the price reaching the target before we bought, takes the plan down on the spot, whatever On fire says. No agent wakes and nothing is proposed; the stock stays on watch.

Otherwise the stock is now in a [situation](situations.md), which tells the agent how to answer it.

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
`shouldFire` in `lib/agent/triggers/evaluate.ts`: a buy fires on the crossing; every other action fires again while true, once its rest is over. A sale fire on a position whose sale is still waiting is dropped before its rest starts (`saleUnderWay`, `lib/proposals/position-lock.ts`).

#### On fire
`fireMode` in `lib/agent/triggers/fire-mode.ts`: `DO_IT` (Auto), `ASK_NOW` (Send to Agent) or `NEXT_MORNING` (Flag for Review), stamped on every write. An Auto trade is the tool an agent would call (`doItCall`, `lib/agent/triggers/do-it.ts`), so the approval switch, sizing and checks are the same; an Auto buy, add or trim comes off the stock once used (`useOnce`).

#### Write path
`applyTriggerOps` in `lib/agent/triggers/ops.ts`, shared by `update_thesis`, the trigger editor and the buy going through (`armHeldLadderOnFill`).

#### Floors
`protectiveRatchetViolations` in `lib/agent/triggers/ratchet.ts`; your edits on the sheet are exempt.

#### Stop when buying
`autoStopOps` and `loadAutoStop` in `lib/trading/auto-stop.ts`, applied by `armHeldLadderOnFill` after the trade's own levels: the sale floor `DO_IT` and the owner's, the review line `ASK_NOW` in the price-below review slot. Sizing: `sizingStop` in `lib/agent/position-sizing.ts`, called by `place_trade` and `manage_position`'s add. `Account.autoStopOnBuy` / `autoStopPct` (default off, 8%); `AgentConfig` holds the same two, null meaning the account's. Saved by `saveAutoStop` in `lib/actions/auto-stop.actions.ts` (0.5–50%).

#### Rest periods
Each measure's default `cooldownDays`, in its catalog entry; `effectiveCooldownDays` in `lib/agent/triggers/defaults.ts` reads it. `flooredCooldownDays` (`lib/agent/triggers/state-cooldown.ts`) holds a review of a state to a week and a trade flagged for the morning to a day. The horizon templates write the hard stop with `cooldownDays: 0`; a same-slot replace (the stop set when buying) keeps the floor's rest. The popover's line is `TriggerPill.tsx`.

#### Reference
`docs/TRIGGERS.md` · `docs/plans/TRIGGER_MODEL.md` · `docs/plans/TRIGGER_TYPES.md`
</details>
