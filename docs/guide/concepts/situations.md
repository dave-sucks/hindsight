# Situations

**It knows what needs attention.** A situation is a reason a stock needs an answer today: a sale fired, earnings are close, the research is stale, you left a note.

Situations are how the agents spend their attention. On a given morning a few stocks on a book of forty are in one; those get the work, and the rest are one quiet line each.

<!-- asset: card situations -->

## Where they come from

Each time a stock is read, its facts are turned into its list of situations. The facts come from one place, so the read, the thesis sheet and a run's close-out can't disagree:

- **Its [triggers](triggers.md):** one that fired, or one whose condition is true now.
- **Its clocks:** the review clock came round, or the research is older than its horizon allows (sooner on a stock we don't hold yet).
- **Its plan against the price:** a buy level left behind, a target passed, a floor too tight or too far, a gain with no floor under it.
- **Your words:** a note, a decline or a resized approval no run has answered yet.
- **A recent sale:** a stock sold in the last two weeks is owed one look back.

<!-- asset: situation-flow -->

A stock can be in several at once. The most urgent leads, and none are hidden behind it.

## How they're answered

What to do in each situation is written once, in one table, and never in an agent's prompt. When a stock is in a situation, its instructions travel with it, once per read however many stocks share it: when it applies; what to find out, starting with the company and the stock (why is it down, what did they report, what has changed since the last note); what to check after that; what counts as an answer; what its note covers; and the mistakes to avoid.

The note is the write-up of what the situation sent the agent to find out. Every note has the same shape, set once in the house rules: what is going on and why, what it means for why we own it, then one sentence on what the analyst did.

- A [morning run](../agents/morning-runs.md) gets the situations across its whole book; a [trigger run](../agents/trigger-runs.md) gets those of the one stock it woke for; [chat](../agents/chat.md) sees them on any stock it reads; you see them on the thesis sheet.
- One save on the stock answers every situation it's in. Many answers end in a [proposal](approvals.md), a trigger moved, or the stock sent back to [the Writer](../agents/writer.md).
- Nothing is stored. Answer a situation and it's gone; leave it and it's back tomorrow.

## The sixteen

- **Act on the plan:** sale signal, buy level reached, buy blocked (full), add or near target, promoted to live.
- **Keep the plan honest:** floor to fix, plan check, review due, no setup named.
- **Back to the Writer:** first research due, research stale, watch woke up.
- **Answer what happened:** earnings, new filing, your word unanswered, sold (one look).

Each one's code, what it means and the exact text an agent is sent are in the [Situations library](../reference/situations-library.md).

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
