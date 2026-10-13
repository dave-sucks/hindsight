# Situations

**It knows what needs attention.** A stock is in a situation when something about it needs an answer today.

There are sixteen, worked out fresh on every read, each with its own instructions for the analyst.

<!-- asset: situation-explorer -->

## What a situation is

A situation is a reason a stock needs a decision: a sale fired, a buy level arrived, earnings are close, the research is stale, you said something the analyst hasn't answered. Situations are worked out from the facts every time a stock is read (its [triggers](triggers.md), the review clock, the research date, the plan against the price, and your words) and never stored.

- **Several at once.** A stock can be in more than one. The most urgent leads, and none are hidden behind it.
- **One answer covers all.** A single save on the stock answers every situation it's in.
- **No situation, no work.** A quiet stock is one line in the read and is left alone, so the attention goes where it's needed.

<details>
<summary>All sixteen, a sentence each</summary>

- **Promoted to live:** a stock just moved from paper to live money and needs a decision this run.
- **Sale signal:** a floor, a trail or a trim fired on a holding, or a sale you declined is still past its line.
- **Buy level reached:** a watched stock reached its buy level.
- **Buy blocked, full:** a buy fired while the analyst already holds all it may.
- **Add or near target:** an add level fired, or a holding is three quarters of the way to its target.
- **Earnings:** a report is close, or just landed with a beat or a miss.
- **New filing:** the company filed something that matters with the SEC.
- **Watch woke up:** a watch with no plan woke up and needs a fresh look.
- **Floor to fix:** a gain with no floor under it, or a floor too far below the price.
- **First research due:** a new stock on the watchlist is due its first research.
- **Review due:** the review clock came round and nothing else is going on.
- **Research stale:** the research is older than the analyst's limit.
- **Plan check:** the plan contradicts the tape: a buy level left behind, a target passed, a floor too tight.
- **Your word unanswered:** you left a note or made a decision since the analyst's last answer.
- **Sold, one look:** a stock sold recently is owed one look back.
- **No setup named:** a researched stock has no setup named, so nothing says how to trade it.
</details>

## The instructions travel with the stock

What an analyst should do in each situation lives in one table, not in any agent's prompt. When a stock is in a situation, that situation's instructions arrive with it, once per read, however many stocks share it. A morning with three stocks in two situations carries two texts, not the whole table.

<!-- asset: situation-sizes -->

Each text says when it applies, what to check in order, what the analyst can do, what counts as an answer, and the mistakes to avoid. Changing how every agent handles, say, a buy that arrives is one edit to one text. The texts themselves are `SITUATIONS` in `lib/agent/situations.ts`.

<details>
<summary>Technical details</summary>

#### The list
`situationsFor` in `lib/agent/situations.ts`, over the flags from `computeNeedsAction`, today's lead first.

#### The texts
`SITUATIONS`, the one table of what an agent is told per situation; each text is held under 2,200 characters by test.

#### One feed
`loadWorkInputs` and `loadStockFacts`, shared by the read, the thesis sheet, the quote route and the run close-out.

#### Sent by
`get_theses`, once per read and only for the codes on today's list; a trigger run reads its stock the same way.
</details>
