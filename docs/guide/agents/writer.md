# The Writer

**Deep research on one stock, in about four minutes.** The Writer pulls the numbers, reads the filings and the web, and writes the thesis.

It writes the case for and against, the one belief everything else rests on, and a plan made of triggers.

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

The Writer is the only agent that writes a whole [thesis](../concepts/theses.md). It researches one stock in depth for one [analyst](../concepts/analysts.md), in that analyst's strategy, and saves the result: a new thesis on the watchlist, a pass, or a rewrite of a thesis that already exists. It runs on Claude Sonnet with Claude's own web search, because in a side-by-side test it wrote the most grounded notes and got fiscal years right where other models quoted a year-old quarter as current.

The Writer never trades and never sizes anything. It writes the claim and the plan; the other agents act on them.

## Who sends it a stock

Any agent can, with `dispatch_thesis_research`. Each request runs as its own run, five at a time, and the agent that asked can wait for the result with `wait_for_thesis_refresh`.

- **[Discovery](discovery.md)** sends every new stock it wants to watch.
- **[Chat](chat.md)** sends one when you ask to research a stock, or type `/research`.
- **[A morning run](morning-runs.md)** sends a stock when its [situation](../concepts/situations.md) calls for research: a stock you added that's due its first research, research older than the analyst allows, or a watch whose wake fired and needs a fresh look.

## How it researches

Before the model starts, seven data sets are pulled in code, all at once: five years of statements, the earnings record, insider trades, peers, analyst coverage, recent filings and the price and chart. A source that fails is named as missing, never guessed. That data is the ground truth for every number in the note.

Then one research call with up to four web searches fills in what data can't: the call, the guidance, what changed this week. Every paragraph carries its source, and a catalyst dated after today is written as expected, never as reported.

## What it writes

A research note in nine sections, always the same ones:

- Snapshot, recent catalysts, fundamentals and the latest earnings.
- Dated catalysts and events in the next one to three months.
- The bull case and the bear case, the bear case even on a buy.
- Analyst consensus, insiders and the chart.

Then the decision:

- **A direction:** long, short, or pass. A pass is a real answer, saved so the stock isn't pitched again.
- **A belief:** one sentence that can be proven wrong, with an outcome, a timeframe and the reason.
- **A setup and its plan:** the buy, the floor and the target all come from the setup's rules and the chart, never a round number. The reward has to be at least twice the risk.
- **The [triggers](../concepts/triggers.md)** that carry the plan, and a wake-up if the stock isn't ready to price yet.

It never sizes the trade. The buy is sized later by the risk to its floor, so an honest, tight floor is what earns size.

## Checked before it's saved

The decision goes through the same checks as every other save: the prices in the right order, the 2-to-1 reward, triggers that fit a stock we only watch. A problem goes back to the Writer to fix in the same run; the thesis is saved only when it passes.

## What happens next

- **A new stock** lands on the watchlist as Watching, with its buy, floor, target and review clock. The [trigger](../concepts/triggers.md) check starts watching its buy the same day.
- **A pass** is saved as Passed, with what would change the verdict, so the stock isn't pitched again without a reason.
- **A refresh** rewrites the research and the claim on a thesis that exists. The agent that asked re-reads the stock and changes its levels if the new work changed the view.
- From there, [morning runs](morning-runs.md) review it, a [trigger run](trigger-runs.md) acts when its buy fires, and the buy becomes a [proposal](../concepts/approvals.md) you approve. The research stays the Writer's: other agents change the plan around it, and the belief changes only with a new write-up or when you change it through chat.

## Tools

The data tools run in code before it writes; web search and the save are its own.

<!-- asset: tools writer -->

<details>
<summary>Technical details</summary>

#### Runs as
Its own run, started by `dispatch_thesis_research` through `app/thesis.write.requested` (`lib/inngest/functions/thesis-writer.ts`).

#### Model
`claude-sonnet-4-6` with Anthropic's web search, up to 4 searches and 8 steps.

#### Pipeline
`lib/agent/run-thesis-writer.ts`; data in `thesis-research/pull-data.ts`; the decision's checks in `thesis-research/decision.ts`.

#### Saved through
`submit_thesis`, then `record_thesis` or `update_thesis`, with the same checks as every other save.
</details>
