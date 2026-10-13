# Theses

**Every position starts with a thesis.** What we believe, why, what would prove us wrong, and the triggers that act on it.

A thesis is born in research, watched by its triggers, reviewed by every run after that, and kept until the stock is sold or set down. Every stock an analyst covers has exactly one.

<!-- asset: card theses -->

## What a thesis is

A thesis is one [analyst](analysts.md)'s view of one stock, and its plan. Every stock on the book has one, whether the analyst holds it or only watches it, and every agent reads the same one: a [morning run](morning-runs.md), a [trigger run](trigger-runs.md), [chat](chat.md) and [the Writer](writer.md) all see the stock through its thesis. It's short on purpose: everything a decision needs, nothing it doesn't.

## What's in it

<!-- asset: thesis-anatomy -->

- **The belief:** one sentence we can be wrong about, with an outcome, a timeframe and the reason. Every agent reads it as the claim of record.
- **What it rests on:** the two or three assumptions that have to hold.
- **What would prove it wrong:** written before the buy, so a bad day isn't mistaken for a broken story. A run checks these before it acts on a fire.
- **The case for and against:** the strongest points on both sides, each with its source, and the research note behind them.
- **The setup:** the kind of trade, from the analyst's playbook, with how it fails, how it's managed and how long it's held.
- **Score and conviction:** a score out of 10, and a conviction that scales the size of the buy.
- **The plan:** its [triggers](triggers.md), saying when to buy, add, trim, sell and look again.
- **What's been said:** your notes and decisions, and the analyst's last answer to them, carried into every review.

## How a thesis is born

Only [the Writer](writer.md) writes a whole thesis. It reaches the Writer one of three ways:

- **[Discovery](discovery.md) finds it.** A stock that fits the analyst's universe and setups is sent to the Writer, up to five a run.
- **You ask for it.** "Research CRWD" or `/research CRWD` in [chat](chat.md) sends it to the Writer.
- **You put it on the watchlist yourself.** A stock you add (or the analyst builder suggests) starts as a seed with no view yet. When its review clock comes round, it's in the "first research due" [situation](situations.md), and the next [morning run](morning-runs.md) sends it to the Writer.

The Writer researches the stock, writes the claim and prices the plan from the setup's rules and the chart. The result is a direction: long, short, or a pass. A pass is saved too, as **Passed**, so the stock isn't pitched again without a reason. Anything else lands on the watchlist as **Watching**, with its buy, floor and target set.

## Watching: waiting for the buy

A watched stock costs nothing while it waits. Its buy trigger is checked every five minutes, and it fires on the cross: the day the price reaches its level.

- **The buy fires.** A [trigger run](trigger-runs.md) looks at the stock within minutes, checks that the setup's confirmation happened and the price still holds, and proposes the buy. Nothing fills until you [approve](approvals.md) it.
- **The plan goes stale.** Every [morning run](morning-runs.md) checks the plan against the price. A buy the price has left behind, a target already passed, a plan under 2-to-1: each puts the stock in the "plan check" [situation](situations.md), and the run re-prices it, explains it, or sets the plan down.
- **The research gets old.** Past the analyst's limit, the stock goes back to the Writer for a refresh before anything is bought on it.

## Holding: guarded by its triggers

When the buy fills, the thesis turns from **Watching** to **Holding**. The floor and target are set to the levels the trade went in at, and a holding's review clock and its earnings reviews are added. Then its sell side takes over:

- **The floor and the trail** usually come from the analyst's sell rules, inherited by every stock it holds. The thesis can carry its own, tighter ones.
- **A sale or trim fires:** a [trigger run](trigger-runs.md) decides within minutes, or a floor set to sell straight away proposes the sale with no agent. Either way it's a [proposal](approvals.md).
- **A review fires,** or the review clock comes round: the next [morning run](morning-runs.md) looks again.
- **Something changed:** a gain with no floor under it, a report coming, a new filing, the price three quarters of the way to the target. Each is a [situation](situations.md) the morning run answers.

No agent can lower a floor on a stock we hold. It can sell, trim, propose the sale again, or raise the floor; only you move it down.

## The plan is triggers

The buy, the floor and the target aren't separate fields. They're triggers like any other: the buy is "buy if near $401", the floor is "sell if below $384". So a thesis has one plan, it can't disagree with itself, and the system checks every line of it all day. Changing the floor is an edit on the floor trigger, and it lands in Activity as one line.

## How a thesis changes

Agents change a thesis with `update_thesis`, one trigger at a time: add one, edit one by its id, or remove one. A save is a patch, so a value that didn't change does nothing, and a field that can't be saved comes back by name while the rest lands. Every change is one line in the stock's Activity.

Who may change what:

- **The Writer** writes the whole thesis, including the research and the claim.
- **Chat** can also change the belief and the direction, when you ask.
- **A morning run** changes the plan, gives its verdict, and leaves a note.
- **A trigger run** changes the plan and leaves a note.
- **You** can edit any trigger on the thesis sheet, approve or decline what's proposed, and leave a note through [chat](chat.md). Your words come first: the next run answers them before anything else.

## How it ends

<!-- asset: thesis-lifecycle -->

- **Sold.** The sale is approved and the thesis is retired as sold. For the next two weeks it's owed one look back (the "sold, one look" [situation](situations.md)): watch it again with a re-entry level, or let it go.
- **Proven wrong.** Something on its "wrong if" list happened. A holding is sold; a watch is retired.
- **Set down.** Dropped from the watchlist, or replaced by a newer thesis. The history stays.

## Kept honest

- **Research has a date.** Older than the analyst's limit, and the next run sends the stock back to the Writer.
- **The plan is checked against the price.** Every day, by every read.
- **Your word comes first.** A note or a decision you leave is answered on the next run before anything else.

<details>
<summary>Technical details</summary>

#### Stored as
`Thesis`: `status` WATCHING · HOLDING · PASSED · RETIRED (with `retiredReason` DROPPED · SOLD · INVALIDATED · REPLACED) · PROMOTED; `direction` LONG · SHORT, or none on a seed. Sold is RETIRED with SOLD.

#### The parts
`coreBelief`, `keyAssumptions`, `invalidationConds`, `bullCase`, `bearCase`, `snapshot`, `scoring`, `conviction`, `setupId`, `triggers`

#### Written by
The Writer (`submit_thesis`, saved through `record_thesis` / `update_thesis`). A seed is minted by the app or the analyst builder, never by an agent.

#### Edited by
`update_thesis`: `add_triggers`, `edit_triggers` by id, `remove_trigger_ids`. The fields each agent may send are pinned by `update-thesis-doors.test.ts`: the Writer 35, chat 21, a morning run 18, a trigger run 11.

#### Status changes
The buy's fill turns WATCHING into HOLDING: `armHeldLadderOnFill` in `lib/proposals/thesis-flips.ts` sets the floor and target from the trade, adds the held review clock and earnings reviews, and leaves the sell rules inherited. An approved sale retires the thesis as SOLD.

#### Floors
`protectiveRatchetViolations` in `lib/agent/triggers/ratchet.ts` refuses any agent edit that lowers or loosens a protective level on a stock we hold.

#### Plan prices
`entry_price`, `target_price` and `stop_loss` are edits on the buy, target and floor triggers; the columns are a cache of them.

#### Reference
`docs/THESIS_ARCHITECTURE.md` · `lib/agent/triggers/ops.ts`
</details>
