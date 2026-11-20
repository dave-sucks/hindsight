# Triggers

**A stock has triggers and nothing else.** A trigger is one sentence that says when to act on a stock: "Buy if near $401", "Sell if below $384", "Review 7 days before earnings".

Triggers are how a thesis acts while nobody is watching. They're checked all day, and when one comes true, the right agent looks at the stock.

<!-- asset: card triggers -->

## A condition and an action

Every trigger pairs a condition with one of five actions:

- **Buy** a stock we watch.
- **Add** to a winner we hold.
- **Trim** part of a position.
- **Sell**: the floor, the trail or a time limit.
- **Review**: look again and decide, with no order behind it.

The same sentence shows everywhere: on the thesis sheet, in Activity, and in what the agent reads. A [thesis](theses.md)'s buy and floor are triggers like any other: there is no plan or price target beside them ([Price targets](price-targets.md)).

## What a trigger can watch

Six kinds: the price, the chart's indicators, earnings, filings, news and a schedule. Pick one to see real examples and how each is checked.

<!-- asset: trigger-kinds -->

Every measure, with its numbers, variables, settings and the shape it's saved in: [Trigger measures](../reference/trigger-measures.md).

## Where a stock's triggers come from

A stock answers to three layers of triggers, and the closest one wins:

1. **Its thesis.** [The Writer](../agents/writer.md) names its playbook, and the save writes that playbook's watch triggers, each priced by code from the chart; then the Writer tailors them with `edit_triggers`, each change with its reason, and adds any of its own. Nothing else is added. At the fill, the watch triggers come off and the floor goes on: the buy, the "Stop watching if below" and the triggers marked as the playbook's watch triggers come off, and "Sell if below" goes on at the approved price. Then one run on the stock, [After the buy](../agents/after-the-buy.md), puts on the playbook's holding triggers by reference, each fitted to the thesis with its reason. A trigger written by hand stays. Nothing is written from the horizon: a holding with no playbook inherits the account's review clock. After that, runs keep them current one trigger at a time, and you can edit any of them on the thesis sheet.
2. **Its analyst.** The [analyst](analysts.md)'s rules cover every stock it holds, like the Secular Compounder's "Review if below the 200-day average".
3. **The account.** Rules for every stock on the account, set in Settings → Triggers. A new account starts with these, all yours to change:
   - "Sell if below 6% from the high since we bought", on every holding, set to Send to Agent.
   - A look every 7 days, for a stock with no review clock of its own.
   - A look on a big day: up 7% or more from yesterday's close on at least twice the normal volume, and the same down. Each is set to Send to Agent.
   - A look in the 5 days before a report (Flag for Review), and one the day after it (Send to Agent).
   - A look when the company files something material with the SEC (Flag for Review).

An inherited rule is never copied onto the thesis, so changing an analyst's style changes every holding at once. Every edit, from any layer, is one line in the stock's Activity.

**Stop when buying.** Like a broker's stop on buy: with "Automatically set Stop Limits when Buying a Stock" on, a new holding gets two lines.

- **The sale floor** is always that percent under the price when you approve the buy, moved to that percent under what you paid once the fill comes in: an ordinary "Sell if below" trigger set to Auto-sell, set as yours, so only you can lower it.
- **The review line** is the analyst's own floor, when it was tighter than that: it stays where the analyst put it as "Review if below", with the analyst's note, set to Send to Agent. That's where it looks first; the sale floor below it is the hard stop. A stock has one review line; if it already had one, the higher of the two is kept.

A tighter floor you set yourself is left exactly as it is, including a stop you type on the Trade ticket (on a stock you don't hold the ticket starts empty: the price you type is your sale). With the setting on, a buy is sized for the wider of the two stops, so a loss at the sale floor stays within the analyst's risk per trade. Turn it on for the account in Settings → Triggers; an analyst's Triggers tab shows the account's choice until you give the analyst its own, and "Use account setting" puts it back. Adding to a stock you already hold doesn't move either line. With it off, the buy sets no floor of its own: the stock keeps the one it has.

## When one comes true

Triggers are checked every five minutes while the market is open, plus a pass at 4:20 PM for levels that read the close.

> **Triggers work like orders.** A trigger fires when it becomes true; one already true when you write it, or change its condition, fires at the next check. After that it fires again only once a market close (4:20 PM) has found it false: a stock wobbling around the line all day fires it once. A trade it leads to uses it up: when a trim or add fills, its trim or add triggers that fired come off the stock (never a sale's). A proposal you decline, or one that expires or is withdrawn, uses nothing up.

| | How often it fires |
|---|---|
| Buy | When it becomes true, then again after a close where it no longer holds. Two buys on one stock true on the same check start one run. The fill takes every buy off. |
| Add | When it becomes true, then again after a close where it no longer holds. Its fill takes it off. |
| Trim | When it becomes true, then again after a close where it no longer holds. Its fill takes it off. |
| Sell | When it becomes true, then again after a close back on the other side. Until then the stock is on the morning run's list every day, declined or not, until a new sale price is set or a close goes back past the line. While a sale waits for your approval nothing new starts; it waits until you answer it or the stock closes back past the line (4:20 PM). |
| Review | When it becomes true, then again after a close where it no longer holds. A review clock fires when due; the review starts the next period. |

There are no waits. A filing fires once per filing, an earnings heads-up once per report and a news note once per note, whatever else has fired. A trigger's card says when it fired and what makes it ready again: "Fired Nov 18 · fires again after a close back above $150".

**Two conditions are "and".** A trigger can need two conditions at once ("above $46.92 on the close, on 1.5× volume"). For either of two, write two triggers. A date count before the event can be one of them: it is then a window, the days the other condition may fire in ("Buy if within 2% of the 50-day average and within 70 days before the event date", the pre-catalyst buys). On its own it is a schedule and can't buy.

What happens next is the trigger's **On fire**, in the next section. The whole path from the price check to the run, with every rule that holds a fire back: [From fire to run](../deep-dives/trigger-fire-to-run.md).

Which triggers fired, how often the same one fired again, and what each fire led to are on Performance, under Agent work.

## On fire

Where each fire goes, and how what the agent writes comes back to the stock:

<!-- asset: fire-loop -->

| | Auto | Send to Agent | Flag for Review |
|---|---|---|---|
| What happens | The trade, with no agent deciding, then the analyst's write-up of it. With your approval switch on, it comes to you as a proposal right away | A trigger run starts within minutes: one stock, one decision | Goes on the stock's list; the next morning run answers it |
| Buy | ✓ only you set it | ✓ default | ✓ |
| Add | ✓ only you set it | ✓ default | ✓ |
| Trim | ✓ sells its size; only you | ✓ default | — (a trim can't wait for the morning) |
| Sell | ✓ agents may set it | ✓ default | — (a sale can't wait for the morning) |
| Review | — (a review is asking) | ✓ the same day | ✓ default |

What a trigger does when it comes true, the same three choices on every trigger but a sale or a trim, which has two:

- **Auto** (Auto-sell, Auto-buy, Auto-add, Auto-trim): the trade, with no agent deciding; the analyst then writes it up, and says so if it would have done something else. It's sized and checked exactly as an agent's would be: a buy is paid from cash, never margin; a trim sells its size. An Auto-buy names no sale of its own (no one chose one, and a watch's line is never the sale), so it gets its playbook's floor, priced from the chart and held to the playbook's sale rules; with none it is refused, and the refusal is a line in the stock's Activity. With nothing to trade (a buy on a stock we already hold), the agent is asked instead. A review can't be Auto; it is asking.
- **Send to Agent:** a [trigger run](../agents/trigger-runs.md) starts within minutes to look at that one stock and decide.
- **Flag for Review:** the fire goes on the stock's list and the next [morning run](../agents/morning-runs.md) answers it. A worrying new filing on a stock we hold still gets a look the same day. Not offered on a sale or a trim: a sale that waits until tomorrow morning isn't a stop.

**A trim's size** is its own field, shown whenever the action is Trim: the share of the position it sells (50% filled in). It means the same thing in every mode, and the trigger says it everywhere: "Trim 30% if above $150". Auto sells that share. A trigger run woken by the trim sells it too unless the analyst names another size, and the morning run reads it in the same sentence.

Left unset, a review is Flag for Review and everything else is Send to Agent. Auto is always chosen: the stop set when buying and a new analyst's trailing sale are Auto-sells.

An Auto-buy, Auto-add or Auto-trim is yours alone: you set it on the stock itself, or chat sets it at your word, never as an account or analyst rule. Like every trigger, it comes off the stock when its order fills, with a line in Activity ("Its order filled, so it came off: Trim 30% if above $150"). An agent may set an Auto-sell.

Every trade, the agent's or an Auto one, goes through your [approval](approvals.md) switch for its side, buys or sales: with it on, it is a proposal you approve, and an Auto trade waits for you like any other. The dialog says so under On fire.

- **On a stock we only watch,** the line that ends the watch is its own action, "Stop watching if below $384 · only on the close": when it fires, on the timing it saved, it retires the thesis on the spot with one line in its Activity, and a buy waiting for your approval goes with it. No agent wakes and nothing is proposed; no money moves. It has no other On fire choice. A "Sell if" line is only on a stock we hold; one on a watch is refused with the fix, and so is any trigger on our position (a move from our buy price, the high since we bought, days since the buy): it goes on after the buy.

Otherwise the stock is now in a [situation](situations.md), which tells the agent how to answer it.

## Floors only go up

On a stock we hold, no agent can lower a floor, widen a trail, remove a protective trigger, or slow a sale down (from Auto-sell to Send to Agent); the save refuses it. No agent can make a buy, add or trim Auto. On a stock we only watch there is no floor: its Stop watching line is free to change. A sale you decline asks the analyst again each day the price stays past the line, and the analyst proposes the sale again or says why it holds. An agent that thinks the line is wrong names the level in its note, and only you move it down.

<details>
<summary>Technical details</summary>

#### Shape
`{ watch, is?, value?, variable?, settings? }`, or `{ match: "all", conditions }` for two or more that must all hold, one level deep. Stored on the thesis, the analyst or the account.

#### Catalog
One entry per measure in `lib/agent/triggers/condition/measures/`, grouped into the six types by `catalog.ts`. Words from `describe.ts`. Each direction button carries what it fires on (`means`, "above fires once the price is above the value (a breakout, adding on strength)"): the agents' tools describe `is` with it (`directionWords`, read by `lib/agent/triggers/schema.ts`), and the measures reference prints it.

#### Check
`trigger-evaluator.ts`: every 5 minutes in market hours, plus a close pass 16:20–16:34 ET. Chart measures read the 06:30 `TickerIndicators` snapshot.

#### Fire semantics
`shouldFire` in `lib/agent/triggers/evaluate.ts`: a trigger fires when its condition holds and it has not fired since a close last found it false (`firedSinceFalseClose`, `lastFiredAt` against `falseAtCloseAt`); a filing and a heads-up read once per event (`oncePerEvent`). The close pass stamps `falseAtCloseAt` on each fired trigger whose condition is false on the close, with every input it reads loaded (`stampFalseAtClose`, `trigger-evaluator.ts`); an inherited rule's is in `Thesis.triggerState`. A change to the condition or action clears both (`freshFire`, `ops.ts`). A sale fire on a position whose sale is still waiting is dropped unstamped (`saleUnderWay`, `lib/proposals/position-lock.ts`). The morning read's `TRIGGER_MATCHING_NOW` reads a sale or trim on its condition alone (`conditionHolds`), so it stays listed while it holds.

#### On fire
`fireMode` in `lib/agent/triggers/fire-mode.ts`: `DO_IT` (Auto), `ASK_NOW` (Send to Agent) or `NEXT_MORNING` (Flag for Review, refused on an `EXIT` or `TRIM` by `fireModeProblem`), stamped on every write. An Auto trade is the tool an agent would call (`doItCall`, `lib/agent/triggers/do-it.ts`), so the approval switch, sizing and checks are the same. A trim's or add's fill takes its triggers off the stock (`takeOffFilled`, `lib/agent/triggers/filled.ts`, from `lib/inngest/functions/reconcile-orders.ts`).

#### Write path
`applyTriggerOps` in `lib/agent/triggers/ops.ts`, shared by `edit_triggers` (through the save), the trigger editor and the buy going through (`armHeldLadderOnFill`, which removes the buy and Stop watching triggers and every trigger marked `playbook: "WATCH"` and writes "Sell if below" at the approved price; the playbook's holding triggers are put on after the fill by After the buy, through `edit_triggers`, `lib/proposals/after-buy.ts`). A new thesis's watch triggers are its playbook's, written by the Writer's save (`writerPlaybookWrites`, `lib/agent/run-thesis-writer.ts`); the save has no field for a trigger. An `edit_triggers` add is one of the stock's playbook triggers by its reference (W1, W2… its watch triggers; H1, H2… a holding's, `playbookRefs`), or one of the agent's own, where a price or a move may be a chart key (`{gapDayHigh}`, the list in `PLACEHOLDERS`, `lib/agent/knowledge/setups.ts`): code writes today's number (`pricedTemplate` and `fillValue` in `lib/agent/knowledge/playbooks.ts`, the chart from `lib/proposals/fill-chart.ts`) before the save, and refuses an unknown key, naming the valid ones, or one the chart can't give today, with why. A live line (an average, a high or low, our entry, the high since we bought) stays a line, read at every check. The Writer, the Holding refresh and After the buy price only that way: their `edit_triggers` (`schemaFor`) takes a key or a line wherever a trigger is a price, and an edit moves a price to a key (`price`); a number that isn't a price (a %, days, a volume multiple) stays a number. Which action fits which stock is `actionProblem` in `condition/actions.ts`, read by every write path and the dialog's action menu (`allowedActions`).

#### The account's rules
Stored on `Account.triggers` (Settings → Triggers). A new account's are `accountSeedTriggers` in `lib/agent/triggers/seed-account.ts`: the review clock, `accountStandingRules` in `lib/agent/triggers/defaults.ts` (the trail and the two big-day looks), and the earnings and filing wakes. An account never seeded reads `unseededAccountFallback`, with the same ids on every read.

#### Stop watching
`STOP_WATCHING` is its own action ("Stop watching if", `actionLabel` in `condition/describe.ts`), on a stock we don't hold and never as an account or analyst rule. Its timing is its saved `settings.close`, shown the same in the pill and the dialog. The trigger evaluator sends its fire on a WATCHING thesis to `stopWatching` (`lib/agent/triggers/stop-watching.ts`), which retires it as DROPPED with one Activity line and withdraws a waiting buy; on a promoted row the fire is written down for the morning run. `resolveLadder` (`lib/agent/triggers/levels.ts`) reads a sale only on a holding and a Stop watching line only on a watch.

#### Floors
`protectiveRatchetViolations` in `lib/agent/triggers/ratchet.ts`; your edits on the sheet are exempt.

#### Stop when buying
`autoStopOps` and `loadAutoStop` in `lib/trading/auto-stop.ts`, applied by `armHeldLadderOnFill` after the trade's own levels: the sale floor `DO_IT` and the owner's, the review line `ASK_NOW` in the price-below review slot. An approval prices it off the live price then (`approveProposal`, `lib/proposals/execute.ts`); the fill moves it to the line under the price paid (`autoStopFillOps`, applied by `moveStopWhenBuyingToFill` in `lib/inngest/functions/reconcile-orders.ts`). Sizing: `sizingStop` in `lib/agent/position-sizing.ts`, called by `place_trade` and `add`. `Account.autoStopOnBuy` / `autoStopPct` (default off, 8%); `AgentConfig` holds the same two, null meaning the account's. Saved by `saveAutoStop` in `lib/actions/auto-stop.actions.ts` (0.5–50%).

#### The card
The card's line is `TriggerPill.tsx`, its words `firesAgainWords` in `condition/describe.ts`.

#### Reference
`docs/TRIGGERS.md` · `docs/plans/TRIGGER_MODEL.md` · `docs/plans/TRIGGER_TYPES.md`
</details>
