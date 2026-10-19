# Theses

**Every position starts with a thesis.** One analyst's view of one stock: what it believes, and the plan that acts on it.

A thesis is the record every agent reads and edits. Its life is a loop: researched, watched, bought, guarded, sold, and looked back on once.

<!-- asset: card theses -->

## A claim and a plan

A thesis has two halves, written and kept by different hands.

- **The claim** is the research, written by [the Writer](../agents/writer.md): the belief (one sentence we can be wrong about, with an outcome, a date and a reason), the two or three assumptions it rests on, what would prove it wrong, the case for and against, and a score. Every agent reads it as the claim of record. Only a new write-up, or you through [chat](../agents/chat.md), changes the belief, its assumptions and what would prove it wrong; a morning run can change the setup it trades as and its conviction.
- **The plan** is its [triggers](triggers.md): one sentence each saying when to buy, add, trim, sell or look again. The buy, the floor and the target are triggers too, so the plan can't disagree with itself. This is the half the agents keep up to date.

Alongside both sits what's been said: your notes and decisions, and the analyst's last answer to them.

## Where it comes from

Every thesis is researched by the Writer. A stock reaches it when [Discovery](../agents/discovery.md) finds one that fits the [analyst](analysts.md), when you ask in chat or press Send to agent on a stock's page, or when a stock you put on the watchlist comes due its first research.

The Writer reads the numbers, the filings and the web, and comes back with one of three answers:

- **Watch it, with a plan.** A buy level, a floor, a target and a review clock, priced from the setup's rules and the chart. The thesis is **Watching**, and with a review clock the sheet calls it an **Agent Watch**: the analyst looks at it again on that schedule.
- **Watch it, without a plan.** Strong but not ready to price. It waits on a wake, like a price or a date, that brings it back for a fresh look.
- **Pass.** Saved as **Passed**, with what would change the verdict, so the stock isn't pitched again without a reason.

## How it gets bought

While a stock is watched, its buy trigger is checked every five minutes. When the price crosses the level, a [trigger run](../agents/trigger-runs.md) looks at that one stock within minutes, checks the setup's confirmation and the news, and [proposes](approvals.md) the buy. On the live account, nothing fills until you approve it.

When the buy fills, the thesis becomes **Holding**. The floor and target move to where the trade actually went in, and a holding's review clock and earnings reviews are added. From then on the sell side guards it: the floor and the trail, usually inherited from the analyst's sell rules.

## When an agent looks at it

No agent reviews every thesis every day. A thesis gets attention for one of two reasons:

- **One of its triggers fires.** A buy, add, trim or sale wakes a trigger run within minutes. A review waits for the morning.
- **It's in a [situation](situations.md).** Every [morning run](../agents/morning-runs.md) reads the analyst's whole book but works only on stocks that need an answer today: a review that came due, a plan the price has moved past, a gain with no floor under it, a report coming, research past its date, a note from you. A quiet thesis is one line in the read and is left alone.

And you can ask about any thesis in chat, any time.

## How it changes

As the price and the story move, agents keep the plan current one trigger at a time: re-price a buy the price left behind, raise a floor under a gain, reset the levels after a fire. Each change is one line in the stock's Activity, with who made it and why. When the research gets old, the stock goes back to the Writer for a refresh.

Who may change what:

- **The Writer:** the whole thesis, claim included.
- **Chat:** the plan, and the belief and direction when you ask.
- **A morning run:** the plan, its verdict and a note.
- **A trigger run:** the plan and a note.
- **You:** any trigger on the thesis sheet, a yes or no on every proposal, and notes through chat, which the next run answers first.

One rule holds over all of them: no agent can lower a floor on a stock we hold. Only you move it down.

## How it ends

<!-- asset: thesis-lifecycle -->

- **Sold.** A sale at the target, or one where the analyst says the belief still holds, sends the thesis back to Watching with a one-day review to set a re-entry level. Any other sale retires it as sold, and within two weeks it gets one look back: watch it again, or let it go.
- **Proven wrong.** Something on its "wrong if" list happened. A holding is sold; a watch is retired.
- **Dropped or replaced.** Taken off the watchlist, or replaced by a newer thesis. The history stays.

## Statuses

- **Watching:** on the watchlist. An **Agent Watch** has its own review clock; a plain watch waits for its triggers.
- **Holding:** bought, guarded by its sell side.
- **Passed:** researched and declined.
- **Retired:** sold, dropped, proven wrong or replaced.
- **Promoted:** held on paper and just moved to live money; the next run re-enters or goes back to watching.

<details>
<summary>Technical details</summary>

#### Stored as
`Thesis`: `status` WATCHING · HOLDING · PASSED · RETIRED (with `retiredReason` DROPPED · SOLD · INVALIDATED · REPLACED) · PROMOTED; `direction` LONG · SHORT, or none on a seed. Sold is RETIRED with SOLD.

#### The parts
`coreBelief`, `keyAssumptions`, `invalidationConds`, `bullCase`, `bearCase`, `snapshot`, `scoring`, `conviction`, `setupId`, `triggers`

#### Written by
The Writer (`submit_thesis`, saved through `record_thesis` / `update_thesis`). A seed is minted by the app or the analyst builder, never by an agent. Send to agent on a stock's page is `sendToThesisWriter` in `lib/actions/watchlist.actions.ts`.

#### Agent Watch
`isAgentWatched` in `lib/agent/triggers/agent-watch.ts`: a watch with a review schedule of its own.

#### Edited by
`update_thesis`: `add_triggers`, `edit_triggers` by id, `remove_trigger_ids`. The fields each agent may send are pinned by `update-thesis-doors.test.ts`: the Writer 35, chat 21, a morning run 18, a trigger run 11.

#### Status changes
The buy's fill turns WATCHING into HOLDING: `armHeldLadderOnFill` in `lib/proposals/thesis-flips.ts` sets the floor and target from the trade, adds the held review clock and earnings reviews, and leaves the sell rules inherited. A filled sale retires it as SOLD, unless it was a profit-take at the target or the closing agent said the belief survived (`shouldRecycleToWatching`): then it goes back to WATCHING with a one-day review.

#### Floors
`protectiveRatchetViolations` in `lib/agent/triggers/ratchet.ts` refuses any agent edit that lowers or loosens a protective level on a stock we hold.

#### Plan prices
`entry_price`, `target_price` and `stop_loss` are edits on the buy, target and floor triggers; the columns are a cache of them.

#### Reference
`docs/THESIS_ARCHITECTURE.md` · `lib/agent/triggers/ops.ts`
</details>
