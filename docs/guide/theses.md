# Theses

**Every position starts with a thesis.** What we believe, why, what would prove us wrong, and the triggers that act on it.

A thesis is written once by the Writer and kept current by every run after it.

<!-- asset: thesis-anatomy -->

## What a thesis is

A thesis is one analyst's view of one stock. Every stock on the book has one, whether the analyst holds it or only watches it, and every agent reads the same one. It's short on purpose: everything a decision needs, nothing it doesn't.

## What's in it

- **The belief:** one sentence we can be wrong about, with an outcome, a timeframe and the reason. Every other agent reads it as the claim of record.
- **What it rests on:** the two or three assumptions that have to hold.
- **What would prove it wrong:** written before the buy, so a bad day isn't mistaken for a broken story. A trigger run checks these before it acts on a fire.
- **The case for and against:** the strongest points on both sides, each with its source, and the research note behind them.
- **The setup:** the kind of trade, with how it fails, how it's managed and how long it's held.
- **Score and conviction:** a score out of 10, and a conviction that scales the size of the buy.
- **The plan:** its [triggers](triggers.md), saying when to buy, add, trim, sell and look again.
- **What's been said:** your notes and the analyst's last answer, carried into every review.

## The plan is triggers

The buy, the floor and the target aren't separate fields. They're triggers like any other: the buy is "buy if near $401", the floor is "sell if below $384". So a thesis has one plan, it can't disagree with itself, and the system checks every line of it all day. Changing the floor is an edit on the floor trigger, and it lands in Activity as one line.

## How a thesis changes

Agents change a thesis with `update_thesis`, one trigger at a time: add one, edit one by its id, or remove one. A save is a patch, so a value that didn't change does nothing, and a field that can't be saved comes back by name while the rest lands. You can edit a trigger by hand on the thesis sheet, or leave a note through [chat](chat.md).

## A thesis has a life

From the watchlist to a position and back, nothing is lost.

<!-- asset: thesis-lifecycle -->

- **Watching:** on the watchlist, waiting for its buy.
- **Holding:** bought. The buy filling turns a watch into a holding.
- **Passed:** researched and declined, kept so the stock isn't pitched again without a reason.
- **Retired:** sold, dropped from the watchlist, proven wrong, or replaced by a newer thesis. The history stays.

## Kept honest

- **Research has a date.** Older than the analyst's limit, and the next run sends the stock back to the Writer.
- **The plan is checked against the price.** A buy the price has left behind, a target already passed, a floor inside the stock's daily swing: each puts the stock in a [situation](situations.md) until it's fixed.
- **Your word comes first.** A note or a decision you leave is answered on the next run before anything else.

<details>
<summary>Technical details</summary>

#### Stored as
`Thesis`: `status` WATCHING · HOLDING · PASSED · RETIRED (with `retiredReason` DROPPED · SOLD · INVALIDATED · REPLACED) · PROMOTED; `direction` LONG · SHORT. Sold is RETIRED with SOLD.

#### The parts
`coreBelief`, `keyAssumptions`, `invalidationConds`, `bullCase`, `bearCase`, `snapshot`, `scoring`, `conviction`, `setupId`, `triggers`

#### Written by
The Writer (`submit_thesis`, saved through `record_thesis` / `update_thesis`). Edited with `update_thesis`: `add_triggers`, `edit_triggers` by id, `remove_trigger_ids`. A save is a patch: unchanged values do nothing.

#### Plan prices
`entry_price`, `target_price` and `stop_loss` are edits on the buy, target and floor triggers; the columns are a cache of them.

#### Reference
`docs/THESIS_ARCHITECTURE.md` · `lib/agent/triggers/ops.ts`
</details>
