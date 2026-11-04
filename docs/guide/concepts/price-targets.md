# Price targets

**Hindsight has no price target of its own.** A stock's plan is its triggers: the buy, the floor, and whatever upside rule the setup gives it. "Target" means Wall Street's number, shown as a card and watchable by a rule, never a level we set.

## The three things that look like a target

- **The buy.** The price the analyst wants to pay, as a trigger: "Buy if above $401". On a stock we hold it is the fill.
- **The floor.** The sale that caps the loss, as a trigger: "Sell if below $384". A buy needs a floor; it sizes the trade. There is no minimum reward for taking a trade: under twice the floor's distance, the analyst says why in its note.
- **An upside rule, only where the setup has one.** "Review if above the Street's average target", "Trim 30% if above the prior high". A review, not a sale, is the usual shape: reaching it is a decision point, not an exit. Four of the twelve [setups](../reference/setups.md) carry none, and that is a complete plan.

## Wall Street's targets

Every stock on the book has Wall Street's 12-month targets, pulled each morning: the low, the average and the high, with the ratings split and the EPS revisions. They are shown as the Analyst targets card on the stock's page and read by every agent on the stock's row, with one computed line: how much room there is to the Street's average against the floor's distance.

A rule can watch them. The Street's average, high and low are [trigger](triggers.md) variables, reached from below only: "Review if above the Street average" moves when analysts move. The Street is never a floor: "Sell if below the Street average" cannot be saved.

## Why

A target the house computed to clear a ratio was a number nobody believed, and it was quoted three times on every row an agent read. The buy and the floor are the analyst's conviction in two numbers; the Street is evidence; the upside, where there is one, is a rule to look again.

## Technical details

The levels are triggers (`lib/agent/triggers/`); the `entryPrice`, `targetPrice` and `stopLoss` columns on a thesis are a cache computed from the trigger list on every write (`canonicalLevels`): the buy is the ENTER rule, the floor the tightest protective sale under the price, the target the first upside rule. A buy needs the floor only (`lib/agent/tools/place-trade.ts`). The Street rows are `StreetConsensus`, one per stock per day (`lib/market-data/street-consensus-store.ts`); the Street variables are `street_avg`, `street_high` and `street_low` in `lib/agent/triggers/condition/variables.ts`, and the room line is `roomWords` in `lib/market-data/street-consensus.ts`.
