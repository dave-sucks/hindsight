# Situations

**It knows what needs attention.** A stock is in a situation when something about it needs an answer today.

There are sixteen. They're worked out fresh every time a stock is read, and each one brings its own instructions for the analyst.

<!-- asset: card situations -->

## What a situation is

A situation is a reason a stock needs a decision: a sale fired, a buy level arrived, earnings are close, the research is stale, you said something the analyst hasn't answered. It's how the agents know where to spend their attention. A [morning run](../agents/morning-runs.md) reads its whole book, but it only works on the stocks in a situation; the rest are one quiet line each.

- **Several at once.** A stock can be in more than one. The most urgent leads, and none are hidden behind it.
- **One answer covers all.** A single save on the stock answers every situation it's in.
- **No situation, no work.** A quiet stock is left alone, so the attention goes where it's needed.
- **Never stored.** A situation is worked out from the facts on every read, so it can't go stale. Answer it and it's gone; leave it and it's back tomorrow.

## Where they come from

Every read looks at the same facts about each stock and turns them into its list of situations:

- **Its [triggers](triggers.md):** one that fired, or one whose condition is true right now. A sale that fired is a "sale signal", a buy that fired is "buy level reached", a review that fired is "review due".
- **The review clock:** each [thesis](theses.md) has a schedule for its next look.
- **The research date:** older than the [analyst](analysts.md)'s limit, and it's "research stale".
- **The plan against the price:** a buy level left behind, a target passed, a floor inside the day's normal swing.
- **The floor against the gain:** a holding up 30% with its floor still at our entry is a "floor to fix".
- **Your words:** a note, a declined sale, a resized approval no run has answered yet.
- **A recent sale:** a stock sold in the last two weeks is owed one look back.

## Who sees them

- **[Morning runs](../agents/morning-runs.md)** get them in the read: each stock's situations on its row, and the instructions for each situation once, however many stocks share it.
- **[Trigger runs](../agents/trigger-runs.md)** get the situations of the one stock they woke for.
- **[Chat](../agents/chat.md)** sees them on any stock it reads.
- **You** see them on the thesis sheet, as the line that says why a stock needs attention.

## Where each one leads

**Act on the plan**

- **Sale signal:** a floor, a trail or a trim fired on a holding, or a sale you declined or let expire is still past its line. Sell or trim (a [proposal](approvals.md)), propose the sale again with today's reasons, or tighten the line. Never loosen it.
- **Buy level reached:** a watched stock hit its buy. Check the setup's confirmation, then propose the buy, re-price it, or set the plan down.
- **Buy blocked, full:** a buy fired but the analyst holds all it may. Say which holding it would replace and why; replacing one is your call.
- **Add or near target:** an add fired, or a holding is three quarters of the way to its target. Press, raise the floor to lock the gain, or take it.
- **Promoted to live:** a stock moved from paper to live money. Re-enter, or go back to watching.

**Keep the plan honest**

- **Floor to fix:** a gain with too little floor under it, or a floor that would lose too much of the account. Raise it under real structure, trim, or say why it stands.
- **Plan check:** the plan contradicts the price or the calendar. Fix the number, say why it's parked there, or set the plan down.
- **Review due:** the review clock came round, or a review fired. Check the belief against its "wrong if" list and patch the plan, or say what was checked.
- **No setup named:** a researched stock with no setup says nothing about how to trade it.

**Send it back to the Writer**

- **First research due:** a stock on the watchlist with no view yet. Send it to [the Writer](../agents/writer.md).
- **Research stale:** the research is older than the analyst allows. Refresh it, or say in one sentence why it still stands.
- **Watch woke up:** a watch with no plan hit one of its wakes. Bring it back with fresh research, move the wakes, or let it go.

**Answer what happened**

- **Earnings:** a report is close, or just landed. The reaction is the information.
- **New filing:** the company filed something that matters. Read it first.
- **Your word unanswered:** you left a note or made a decision since the analyst's last answer. It's answered before anything else, quoting you.
- **Sold, one look:** a stock sold recently gets one look back: watch it again with a re-entry level, or let it go.

## The instructions travel with the stock

The [Situations library](../reference/situations-library.md) lists all sixteen with their codes and the exact text an agent is sent for each.

What an analyst should do in each situation lives in one table, not in any agent's prompt. When a stock is in a situation, that situation's instructions arrive with it, once per read. A morning with three stocks in two situations carries two texts, not the whole table.

Each text says when it applies, what to check in order, what the analyst can do, what counts as an answer, and the mistakes to avoid. Changing how every agent handles, say, a buy that arrives is one edit to one text: `SITUATIONS` in `lib/agent/situations.ts`.

<details>
<summary>Technical details</summary>

#### The list
`situationsFor` in `lib/agent/situations.ts`, over the flags from `computeNeedsAction`, today's lead first. A fired trigger maps by its action and measures (`fireCodes`).

#### The texts
`SITUATIONS`, the one table of what an agent is told per situation; each text is held under 2,200 characters by test.

#### One feed
`loadWorkInputs` and `loadStockFacts`, shared by the read, the thesis sheet, the quote route and the run close-out.

#### Sent by
`get_theses`, once per read and only for the codes on today's list; a trigger run reads its stock the same way.
</details>
