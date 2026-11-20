# Situations

**It knows what needs attention.** A situation is a reason a stock needs an answer today: a sale fired, a buy level came, a report landed, a review came due.

Situations are how the agents spend their attention. On a given morning a few stocks on a book of forty are in one; those get the work, and the rest are one quiet line each.

<!-- asset: card situations -->

## Where they come from

Two causes, one result. Either a **trigger** fires, or a **check in the code** finds something on its own, and the stock is left with a situation: a to-do for the next run that reads it, with the instructions for answering it.

Each time a stock is read, its facts are turned into its list of situations. The facts come from one place, so the read, the thesis sheet and a run's close-out can't disagree.

<!-- asset: situation-flow -->

A stock can be in several at once. The most urgent leads, and none are hidden behind it.

## How they're answered

What to do in each situation is written once, as a short skill: one markdown file that says what to find out, in order, what can follow, and what done looks like. A skill names no tool and has nothing filled in by code. It has a part for a stock we hold and a part for a stock we watch, and the run is sent the part that fits its stock.

What an analyst may do is the same every time (propose a sale, a trim, a buy or an add, change its triggers, send the stock to [the Writer](../agents/writer.md), stop watching, or leave it), so it is said once, in the morning run's and the trigger run's own instructions, and in no skill.

The note is the write-up of what the situation sent the agent to find out. Every note has the same shape, set once in the house rules: what is going on and why, what it means for why we own it, then one sentence on what the analyst did.

- **The text goes to the run that answers.** A [morning run](../agents/morning-runs.md) gets the skills for the situations on its own list, once per read however many stocks share one; a [trigger run](../agents/trigger-runs.md) gets those of the one stock it woke for.
- **Every other reader gets the name.** A read of one stock by ticker, the [Portfolio Manager](../agents/portfolio-manager.md)'s rows and [chat](../agents/chat.md) see each situation by name on the stock's row. The skills are listed in the knowledge library, so chat reads one when you ask it to act. You see the names on the thesis sheet.
- One note on the stock answers every situation it's in. Many answers end in a [proposal](approvals.md), a trigger moved, or the stock sent back to the Writer.
- Nothing is stored. Answer a situation and it's gone; leave it and it's back tomorrow.
- **A card waiting for you silences only that trade.** While a sale or trim waits for your approval, no sale signal is raised on the stock (not the fire, not the price still past the line, not a sale you declined before): the card is yours to answer. Every other situation still lists the stock, and its row says the sale is waiting. A second sale is refused by the sell tool, which says the card is yours. A stock with only the card is a quiet line.
- How often each one comes up, and what the runs did with it, is on Performance, under Agent work.

## The situations

A situation is why a stock is in front of its analyst now. There are three kinds, and two more that are their own case.

| Kind | Situation | When |
|---|---|---|
| A trigger written in advance fired | **Sale signal** | A sell or trim trigger fired on a holding, or a sale you declined is still past its line. Not while a sale card for it waits for you. |
| | **Buy price reached** | A buy trigger fired on a watch, or its condition is still true when the morning run reads the stock. |
| | **Add** | An add trigger fired on a holding. Nearing an upside line is no situation of its own: the house has no target. |
| Something happened | **A report** | A trigger on the company's earnings report fired, before it or after it. |
| | **A filing** | A trigger on the company's SEC filings fired. |
| | **News** | Something happened to the company, or the stock had a day far outside its normal. The skill is written; nothing puts a stock in it yet. |
| It is time to look again | **Review due** | The review clock came round, or the price reached a level the analyst asked to look at again. |
| | **Floor to fix** | A holding's floor locks in much less than its gain, or a sale there would lose more than 1.5% of the account. |
| | **Just sold** | Sold in the last two weeks, and no run has looked at it since. |
| Its own case | **A note to answer** | You left a note, a decline or a resized approval that no run has answered, or a note is pinned on the stock. |
| | **Promoted to live** | A paper analyst was promoted to live money, and its holdings need a decision. |

On a watch, a review, a report and news can each end in a buy: when the case is stronger and the playbook's buy is true today, the analyst proposes it.

Some things are deliberately not situations. A buy into a full analyst is refused by the buy tool, which says to name the holding the stock would replace. A sale that already waits for you is refused by the sell tool. A watch with no view yet has no case to review: when its review clock or one of its triggers comes due, code sends it to the Writer, and no run is asked to.

A pinned note is a high-impact note the [Market Reviewer](../agents/market-reviewer.md) wrote at 7:30 on one stock or several, or one you wrote to several stocks at once (lib/agent/shared-notes.ts); it is a paragraph of "a note to answer".

A trade a trigger set to Auto made is written up by its own agent, the post-trade write-up (or, for a buy or an add sent at once, [After the buy](../agents/after-the-buy.md)), from its own instructions; it is not a situation.

Each one's code, what it means and the exact text an agent is sent are in the [Situations library](../reference/situations-library.md).

<details>
<summary>Technical details</summary>

#### The list
`situationsFor` in `lib/agent/situations.ts`, over the flags from `computeNeedsAction`, today's lead first. A fired trigger maps by what it watches when that is a report or a filing, and by its action (`fireCodes`); any other is a review. A watch with no view carries no flag (`computeNeedsAction`); `sendNoViewWatch` (`lib/agent/thesis-writer-dispatch.ts`) sends it to the Writer from the morning job and from a fire. A sale or trim card waiting for you is read there, as a waiting buy is: `computeNeedsAction` leaves out the sale fires, the sales true now and the declined sale, and nothing else. The close-out owes the stocks the read lists (`listsTheStock`), so it owes these too.

#### The texts
The skill files in `lib/agent/engine/skills/`, one per situation, named in `SITUATIONS`; `lib/agent/situation-skills.ts` reads them and picks the part for a stock we hold or one we watch. Each is held under 1,500 characters by test, with no tool name and nothing for code to fill in. Promoted and a note to answer keep their text in the table. An Auto trade's note is written by its own agent, the post-trade write-up (`lib/agent/engine/agents/post-trade-writeup.ts`), which gets no situations.

#### One feed
`loadWorkInputs` and `loadStockFacts`, shared by the read, the thesis sheet, the quote route and the run close-out.

#### Sent by
`get_theses`, on the morning run's own list only, once per read and only for the codes on it; a trigger run gets its stock's through the `situations` context item. Every other read carries the names on the row. `read_knowledge_library` (topic `situation`) lists the skills and returns one.

#### Counted by
`lib/performance/agent-work.ts` reads each morning run's codes back from its saved thread (the first `get_theses` result) for the Agent work tab (`components/performance/AgentWorkTab.tsx`); a code saved before the 2026-11-15 merge counts as the one it is now (`MERGED_CODE`), and a trigger run's situation is its trigger's action's.
</details>
