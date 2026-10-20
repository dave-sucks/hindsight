# The Writer

**Deep research on one stock, in about three minutes.** The Writer researches one stock for one analyst and writes its thesis: the case, the belief and the plan.

Every plan on the book is written here, whoever found the stock. It never trades and never sizes.

```facts
Model: claude-sonnet-4-6
Starts: When asked
Steps: Up to 8
Tools: 9
Saves: 35 fields: the whole thesis
```

```chat
caption: The Writer researching CRWD for the PEAD Specialist.
tools: Pulling $CRWD's 5-year financials (+6 more)
- Financial statements, earnings track record, insider activity
- Peers, analyst coverage, recent filings, the live price
tools: Searching the web for "CrowdStrike Q2 call guidance" (+3 more)
- The call, the guide raise, estimate revisions since the print
tools: Writing the thesis on $CRWD
- CRWD [watch]: Post-earnings drift · buy $401 · floor $384 · target $480
- The reward is 2.4 times the risk
```

## What it does

The Writer is the only agent that writes a whole [thesis](../concepts/theses.md). It researches one stock in depth, in one [analyst](../concepts/analysts.md)'s strategy, and saves one of three things: a new thesis on the watchlist, a pass, or a rewrite of a thesis that already exists.

One writer means one standard. Every plan on the book was built from the same data, the same sections and the same checks, so the agents that act on a plan can trust its numbers.

It runs on Claude Sonnet with Claude's web search. In a side-by-side test it wrote the most grounded notes, and got fiscal years right where other models quoted a year-old quarter as current.

## When it runs

When asked: by another agent with `dispatch_thesis_research`, by you with Send to Agent on a stock, or when an analyst is promoted to live money. Each request is its own run, five at a time.

- **[Discovery](discovery.md)** sends every new stock it wants watched.
- **[Chat](chat.md)** sends one when you ask for research, or type `/research`.
- **[A morning run](morning-runs.md)** sends one when the stock's [situation](../concepts/situations.md) calls for it: a stock you added that's due its first research, research older than its horizon allows, or a watch whose wake-up fired.
- **[A trigger run](trigger-runs.md)** sends one when the research is too old to act on.

## What it reads

Before the model starts, code pulls seven data sets at once: five years of statements, the earnings record, insider trades, peers, analyst coverage, recent filings, and the price and chart. A source that fails is named as missing, never guessed. That data is the ground truth for every number in the note.

Then up to four web searches fill in what data can't: the call, the guidance, what changed this week. Every paragraph names its source, and a catalyst dated after today is written as expected, never as reported.

## What it decides

First, a research note in nine fixed sections, from the snapshot to the chart, with a bear case even on a buy. Then the decision:

- **A direction:** long, short or pass. A pass is a real answer.
- **A belief:** one sentence that can be proven wrong, with an outcome, a timeframe and the reason.
- **A setup and its plan:** the buy, the floor and the target come from the setup's rules and the chart, never a round number. The reward has to be at least twice the risk.
- **The [triggers](../concepts/triggers.md)** that carry the plan, and a wake-up if the stock isn't ready to price yet.

It never picks a size. The buy is sized later by the risk to its floor, so an honest, tight floor is what earns size.

The decision goes through the same checks as every other save: prices in the right order, the 2-to-1 reward, triggers that fit a stock we only watch. A problem goes back to the Writer in the same run, and nothing is saved until it passes.

## What happens next

- **A new stock** lands as Watching, with its buy, floor and target, and a review clock only if the agent that asked set one. The trigger check starts watching the buy that day.
- **A pass** on a new stock is saved as Passed, with what would change the verdict, so it isn't pitched again without a reason.
- **A rewrite** replaces the research and the claim. It never changes a stock's direction or status: a different verdict is flagged for the agent that asked, which re-reads the stock and moves its levels if the view changed. A rewrite you asked for in chat keeps the levels you set, fills only an empty one, and notes its own.

From there, [morning runs](morning-runs.md) review the stock and a [trigger run](trigger-runs.md) acts when its buy fires. The research stays the Writer's: other agents adjust the plan around it, and the belief changes only with a new write-up or when you change it in chat.

## Tools

The data tools run in code before it writes; web search and the save are its own.

<!-- asset: tools writer -->

<details>
<summary>Technical details</summary>

#### Runs as
Its own run, started by `dispatch_thesis_research` through `app/thesis.write.requested` (`lib/inngest/functions/thesis-writer.ts`, concurrency 5).

#### Model
`claude-sonnet-4-6` with Anthropic's web search, up to 4 searches (`WEB_SEARCH_MAX_USES`) and 8 steps.

#### Pipeline
`lib/agent/run-thesis-writer.ts`; the seven pulls in `thesis-research/pull-data.ts`; the decision's checks in `thesis-research/decision.ts`.

#### Saved through
`submit_thesis`, then `record_thesis` or `update_thesis`, with the same checks as every other save.
</details>
