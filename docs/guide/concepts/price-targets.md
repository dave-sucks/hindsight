# Price targets

**Hindsight has no price target of its own, and no plan.** A stock has its [triggers](triggers.md) and nothing else. "Target" only ever means Wall Street's number, shown as a card and watchable by a rule, never a level we set.

## What a stock carries instead

Each of these is an ordinary trigger, written one at a time by an analyst or by you, and named for its kind:

- **The buy.** The price the analyst wants to pay: "Buy if above $401". On a stock we hold it is gone; what we paid is the fill.
- **The floor.** The sale that caps the loss: "Sell if below $384". A buy needs one; it sizes the trade. There is no minimum reward for taking a trade, and no ratio is computed: the house has no target to measure one against.
- **A Trim, only where the playbook has one.** "Trim 50% if above $X" at the prior high, its price named by the run that proposes the buy and shown on the proposal; it goes on at the fill as a Trim. Most of the twelve [playbooks](../reference/setups.md) carry none, and that is complete.

There is no separate field for any of them, no second way to write them and no template that stamps them. An agent changes one by its id, the way it changes any trigger.

## Stop watching if

A stock we only watch has no floor. It has the place it would stop watching, its own kind of trigger: **"Stop watching if below $384 · only on the close"**. When the stock closes below it (the 4:20 PM pass, never an intraday dip, because that is how it is saved), the watch ends: the thesis retires as dropped, with one line in its Activity naming the trigger. No agent wakes and nothing waits for your approval, because no money moves. It never sells.

The holding's sale comes with the buy. The proposal carries its own "Sell if below" price, which the analyst picks from the setup's sell rule, at least the setup's minimum ATR from the buy and, on a trade, no wider than its cap. You can change it in Edit & Approve, and a price you change is yours. When the buy goes through, the buy and the Stop watching line come off and "Sell if below" goes on at the price you approved. A fire of that line proposes the sale, which waits for you.

## Wall Street's targets

Every stock on the book has Wall Street's 12-month targets, pulled each morning: the low, the average and the high, with the ratings split and the EPS revisions. They are shown as the Analyst targets card on the stock's page and read by every agent on the stock's row, as Wall Street's numbers alone.

A rule can watch them. The Street's average, high and low are [trigger](triggers.md) variables, reached from below only: "Review if above the Street average" moves when analysts move. The Street is never a floor: "Sell if below the Street average" cannot be saved.

## Why

A target the house computed to clear a ratio was a number nobody believed, and it was quoted three times on every row an agent read. A plan written in three boxes beside the triggers was a second copy that could disagree with them: on 2026-11-16 a blank box deleted a stock's buy, floor and review. The buy and the floor are the analyst's conviction in two triggers; the Street is evidence; the upside, where there is one, is a rule to look again.

## Technical details

A stock's prices are its triggers (`lib/agent/triggers/`), edited by `edit_triggers` (`add`, `edit`, `remove`) and by `triggers` on a new thesis (`record_thesis`; the Writer's save writes its playbook's watch triggers, priced from the chart). Nothing stores a price, and nothing sums the triggers into a buy, floor or target: an agent reads each trigger as its sentence, the sheet lists them in its Triggers section, and the chart draws one line per price trigger labelled with its sentence (`priceLines` in `lib/agent/triggers/price-levels.ts`, which keeps only that, a trigger's own price and the one-per-slot rule). Rows and cards show none of them. What we paid is the position's `avgCost`. A buy carries its own sale: `place_trade` takes `sell_if_below` and `sell_reason`, holds it to the playbook's sale rules (`saleRuleProblem` in `lib/agent/position-sizing.ts`, with the account's playbook numbers and the 06:30 snapshot's ATR), sizes the buy off it and stores it on the pending position (`stopLoss`, `stopReason`); `armHeldLadderOnFill` (`lib/proposals/thesis-flips.ts`) writes it at the fill through the FLOOR level op. The playbook's other triggers that come with the buy are written by code at the fill, each number from the chart then and the buy (`withTheBuyTriggers` in `lib/agent/knowledge/playbooks.ts`); a new proposal leaves `targetPrice` empty. A Stop watching trigger retires the watch through `stopWatching` (`lib/agent/triggers/stop-watching.ts`), called by the trigger evaluator. The Street rows are `StreetConsensus`, one per stock per day (`lib/market-data/street-consensus-store.ts`); the Street variables are `street_avg`, `street_high` and `street_low` in `lib/agent/triggers/condition/variables.ts`, and the row's Street line is `streetLine` in `lib/market-data/street-consensus.ts`.
