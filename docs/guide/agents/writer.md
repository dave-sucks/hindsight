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

A rewrite asked for on a passed or retired thesis can't save, so the request decides for itself: the analyst's live thesis on the stock is rewritten instead, or, with none, it is new research linked to the old one, which stays as it was.

## What it reads

The [Market and portfolio block](portfolio-digest.md#the-portfolio-snapshot) comes with every request: the [market numbers](market-reviewer.md#the-market-numbers), written by code when the request is built (the S&P 500 and Nasdaq 100, the regime, the 11 sectors, VIXY, our stocks reporting in the next 14 days), the latest 7:30 [market digest](market-reviewer.md), your portfolio snapshot, written by code when the request is built (the value and cash, every holding and how it moved, the day's buys and sells, the proposals waiting for you), and the latest 8 PM [digest](portfolio-digest.md). Where it and a stock's own row differ, the row is right.

Before the model starts, code pulls seven data sets at once: five years of statements, the earnings record, insider trades, peers, analyst coverage, recent filings, and the price and chart. A source that fails is named as missing, never guessed. That data is the ground truth for every number in the note.

Then up to four web searches fill in what data can't: the call, the guidance, what changed this week. Every paragraph names its source, and a catalyst dated after today is written as expected, never as reported.

It also reads what the agent that sent the stock found first: its reason, its notes (the numbers it pulled, what it read) and, when the stock came from someone's thesis, the post or article itself, with who wrote it, the link and the day. It tests that author's claims against the data and says which held. The thesis keeps the author as where it came from, shown on its first Activity line.

## What it decides

First, a research note in three parts: the company in two sentences (what it does and how it makes money), the bull case and the bear case, with a bear case even on a buy. The company's numbers, its earnings history, the street's view and the chart are live data on the stock's page, not prose in the note. On a new stock the Writer's own decision note is the first line you read. Then the decision:

- **A direction:** long, short or pass, decided by the research, never by the chart. A pass is a real answer: a stock the research says not to own. A stock it would look at again is a watch, not a pass.
- **A belief:** why we own the company, in two or three plain sentences: what it does, why it's worth owning, and what has to stay true. Never a price path or a target.
- **A setup and its plan:** once there is a view, the setup prices it. The buy, the floor and the target come from the setup's rules and the chart, never a round number. The floor's note says first what a close below it would mean for the belief, then the chart level, and the run that answers the floor reads it. There is no minimum reward: under twice the risk, the Writer says why in the note. When no setup fits the chart yet, the view is saved with no buy, no floor and no setup, and with a review that brings it back (a price to look again at, or a date).
- **The [triggers](../concepts/triggers.md)** that carry the plan, and a wake-up if the stock isn't ready to price yet.

It never picks a size. The buy is sized later by the risk to its floor, so an honest, tight floor is what earns size.

The decision goes through the same checks as every other save: prices in the right order, triggers that fit a stock we only watch. A problem goes back to the Writer in the same run, twice at most. After that the thesis saves without the trigger or optional field the save still refuses, and the stock's Activity names each one as "Not applied". The research is never thrown away over one trigger: only a decision the save refuses as a whole (the claim, a level) goes unsaved, and the run says why.

## What happens next

- **A new stock** lands as Watching, with its buy, floor and target, and a review clock only if the agent that asked set one. The trigger check starts watching the buy that day. A view with no setup yet lands as Watching with only its review.
- **A pass** on a new stock is saved as Passed, with what would change the verdict, so it isn't pitched again without a reason.
- **No thesis** when the save refused the decision as a whole: the asking agent, and chat, get the Writer's reason. A chat waits up to five minutes; a Writer still going after that is named with the step it's on, and saves on its own.
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
`submit_thesis`, then `record_thesis` or `update_thesis`, with the same checks as every other save. `submit_thesis` runs the save's check on every decision and says accepted only when it would save; triggers are read with the save's own schema (`readOneTrigger`), and past two hand-backs `saveWhatCan` leaves out what the save refuses, written on the stock as `fieldChanges.notApplied`. A refused real save goes without the same way before the one model retry, which runs only while a chat's wait has time left. A rewrite on a passed or retired thesis becomes new research in `dispatch_thesis_research`.

#### What was sent
The run page's Context shows the request the run's newest model call started with (the research call, or its save retry), exactly as it was sent, kept by `modelFor` (`lib/agent/model.ts`).
</details>
