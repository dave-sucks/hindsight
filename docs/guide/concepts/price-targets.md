# Price targets

**Hindsight has no price target of its own, and no plan.** A stock has its [triggers](triggers.md) and nothing else. "Target" only ever means Wall Street's number, shown as a card and watchable by a rule, never a level we set.

## What a stock carries instead

Each of these is an ordinary trigger, written one at a time by an analyst or by you, and named for its kind:

- **The buy.** The price the analyst wants to pay: "Buy if above $401". On a stock we hold it is gone; what we paid is the fill.
- **The floor.** The sale that caps the loss: "Sell if below $384". A buy needs one; it sizes the trade. There is no minimum reward for taking a trade: under twice the floor's distance to the Street's average, the analyst says why in its note.
- **A take-profit, only where the setup has one.** "Review if above the Street's average target", "Trim 30% if above the prior high". A review, not a sale, is the usual shape: reaching it is a decision point, not an exit. Four of the twelve [setups](../reference/setups.md) carry none, and that is complete.

There is no separate field for any of them, no second way to write them and no template that stamps them. An agent changes one by its id, the way it changes any trigger.

## Stop watching if

On a stock we only watch, the floor is its own kind of trigger: **"Stop watching if below $384 · only on the close"**. When the stock closes below it (the 4:20 PM pass, never an intraday dip, because that is how it is saved), the watch ends: the thesis retires as dropped, with one line in its Activity naming the trigger. No agent wakes and nothing waits for your approval, because no money moves. It never sells.

The holding's sale comes with the buy. The proposal carries its own "Sell if below" price, which the analyst picks from the setup's sell rule and you can change in Edit & Approve. When the buy goes through, the buy and the Stop watching line come off and "Sell if below" goes on at the price you approved. A fire of that line proposes the sale, which waits for you.

## Wall Street's targets

Every stock on the book has Wall Street's 12-month targets, pulled each morning: the low, the average and the high, with the ratings split and the EPS revisions. They are shown as the Analyst targets card on the stock's page and read by every agent on the stock's row, with one computed line: how much room there is to the Street's average against the floor's distance.

A rule can watch them. The Street's average, high and low are [trigger](triggers.md) variables, reached from below only: "Review if above the Street average" moves when analysts move. The Street is never a floor: "Sell if below the Street average" cannot be saved.

## Why

A target the house computed to clear a ratio was a number nobody believed, and it was quoted three times on every row an agent read. A plan written in three boxes beside the triggers was a second copy that could disagree with them: on 2026-11-16 a blank box deleted a stock's buy, floor and review. The buy and the floor are the analyst's conviction in two triggers; the Street is evidence; the upside, where there is one, is a rule to look again.

## Technical details

The levels are triggers (`lib/agent/triggers/`), edited by `add_triggers`, `edit_triggers` and `remove_trigger_ids` on `update_thesis` and by `triggers` on a new thesis (`record_thesis`, the Writer's `submit_thesis`). The `entryPrice`, `targetPrice` and `stopLoss` columns on a thesis are a cache computed from the trigger list on every write (`canonicalLevels` in `lib/agent/triggers/price-levels.ts`): the buy is the ENTER rule, the floor the tightest protective sale under the price, the upside level the furthest upside rule. On a watch the floor is the `STOP_WATCHING` line, on a holding the `EXIT`. A buy carries its own sale: `place_trade` takes `sell_if_below` and `sell_reason`, sizes the buy off it and stores it on the pending position (`stopLoss`, `stopReason`); `armHeldLadderOnFill` (`lib/proposals/thesis-flips.ts`) writes it at the fill through the FLOOR level op. A Stop watching line retires the watch through `stopWatching` (`lib/agent/triggers/stop-watching.ts`), called by the trigger evaluator. The Street rows are `StreetConsensus`, one per stock per day (`lib/market-data/street-consensus-store.ts`); the Street variables are `street_avg`, `street_high` and `street_low` in `lib/agent/triggers/condition/variables.ts`, and the room line is `roomWords` in `lib/market-data/street-consensus.ts`.
