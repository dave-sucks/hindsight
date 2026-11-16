# Situations

**It knows what needs attention.** A situation is a reason a stock needs an answer today: a sale fired, a buy level came, a review came due, you left a note.

Situations are how the agents spend their attention. On a given morning a few stocks on a book of forty are in one; those get the work, and the rest are one quiet line each.

<!-- asset: card situations -->

## Where they come from

Two causes, one result. Either a **trigger** fires, or a **check in the code** finds something on its own, and the stock is left with a situation: a to-do for the next run that reads it, with the instructions for answering it.

Each time a stock is read, its facts are turned into its list of situations. The facts come from one place, so the read, the thesis sheet and a run's close-out can't disagree.

<!-- asset: situation-flow -->

A stock can be in several at once. The most urgent leads, and none are hidden behind it.

## How they're answered

What to do in each situation is written once, in one table, and never in an agent's prompt. When a stock is in a situation, its instructions travel with it, once per read however many stocks share it: when it applies; what to find out, starting with the company and the stock (why is it down, what did they report, what has changed since the last note); what to check after that; what counts as an answer; what its note covers; and the mistakes to avoid.

The note is the write-up of what the situation sent the agent to find out. Every note has the same shape, set once in the house rules: what is going on and why, what it means for why we own it, then one sentence on what the analyst did.

- A [morning run](../agents/morning-runs.md) gets the situations across its whole book; a [trigger run](../agents/trigger-runs.md) gets those of the one stock it woke for; [chat](../agents/chat.md) sees them on any stock it reads; you see them on the thesis sheet.
- One save on the stock answers every situation it's in. Many answers end in a [proposal](approvals.md), a trigger moved, or the stock sent back to [the Writer](../agents/writer.md).
- Nothing is stored. Answer a situation and it's gone; leave it and it's back tomorrow.
- **A card waiting for you silences only that trade.** While a sale or trim waits for your approval, no sale signal is raised on the stock (not the fire, not the price still past the line, not a sale you declined before): the card is yours to answer. Every other situation still lists the stock, and its row says the sale is waiting, so the run answers with a note or an edit, never a second sale. A stock with only the card is a quiet line.
- How often each one comes up, and what the runs did with it, is on Performance, under Agent work.

## The eight

One per trigger action, and four the code finds with no trigger.

| Cause | Situation | When |
|---|---|---|
| A sell or trim trigger | **Sale signal** | It fired on a holding, or a sale you declined is still past its line. Not while a sale card for it waits for you. |
| A buy trigger | **Buy level reached** | It fired on a watch, or its condition is still true when the morning run reads the stock. |
| An add trigger, or the code | **Add or near upside** | An add trigger fired, or a holding is three quarters of the way to its upside level. |
| A review trigger | **Review due** | It fired, or the review clock came round. A trigger on a report or a filing is a review too. |
| The code | **Floor to fix** | A holding's floor locks in much less than its gain, or a sale there would lose more than 1.5% of the account. |
| The code | **A note to answer** | You left a note, a decline or a resized approval that no run has answered, or a note is pinned on the stock. |
| The code | **Just sold** | Sold in the last two weeks, and no run has looked at it since. |
| The code | **Promoted to live** | A paper analyst was promoted to live money, and its holdings need a decision. |

A case inside a situation is a paragraph of its text, not a situation of its own: a buy into a full analyst, a review on a report or a filing, a watch with no view yet, a pinned note. The row carries the fact that picks it. A pinned note is a high-impact note the [Market Reviewer](../agents/market-reviewer.md) wrote at 7:30 on one stock or several, or one you wrote to several stocks at once (lib/agent/shared-notes.ts).

A trade a trigger set to Auto made is written up by the trigger run that made it, from that run's own instructions; it is not a situation.

Each one's code, what it means and the exact text an agent is sent are in the [Situations library](../reference/situations-library.md).

<details>
<summary>Technical details</summary>

#### The list
`situationsFor` in `lib/agent/situations.ts`, over the flags from `computeNeedsAction`, today's lead first. A fired trigger maps by its action (`fireCodes`); one on a report or a filing is a review too. A sale or trim card waiting for you is read there, as a waiting buy is: `computeNeedsAction` leaves out the sale fires, the sales true now and the declined sale, and nothing else. The close-out owes the stocks the read lists (`listsTheStock`), so it owes these too.

#### The texts
`SITUATIONS`, the one table of what an agent is told per situation; each text is held under 2,200 characters by test, and the three that end in a paragraph per case (the buy, the review, the note) just above their length. The Auto write-up's text is `AUTO_WRITEUP` in `lib/agent/system-prompts/intraday-tactical.ts`.

#### One feed
`loadWorkInputs` and `loadStockFacts`, shared by the read, the thesis sheet, the quote route and the run close-out.

#### Sent by
`get_theses`, once per read and only for the codes on today's list; a trigger run reads its stock the same way.

#### Counted by
`lib/performance/agent-work.ts` reads each morning run's codes back from its saved thread (the first `get_theses` result) for the Agent work tab (`components/performance/AgentWorkTab.tsx`); a code saved before the 2026-11-15 merge counts as the one it is now (`MERGED_CODE`), and a trigger run's situation is its trigger's action's.
</details>
