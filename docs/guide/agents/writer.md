# The Writer

**Deep research on one stock, in about three minutes.** The Writer researches one stock for one analyst and writes its thesis: the case, the belief and the stock's first triggers.

Every thesis on the book is written here, whoever found the stock. It never trades and never sizes. A stock we already own is refreshed by its own agent, the Holding refresh: the same research and the same shared rules, but it keeps the holding's sale, trim and add triggers current and writes none of a watch's.

```facts
Model: claude-sonnet-4-6
Starts: When asked
Steps: Up to 8
Tools: 9
Saves: the whole thesis, and its playbook's watch triggers
```

```chat
caption: The Writer researching CRWD for the PEAD Specialist.
tools: Pulling $CRWD's 5-year financials (+6 more)
- Financial statements, earnings track record, insider activity
- Peers, analyst coverage, recent filings, the live price
tools: Searching the web for "CrowdStrike Q2 call guidance" (+3 more)
- The call, the guide raise, estimate revisions since the print
tools: Writing the thesis on $CRWD
- CRWD [watch]: Post-earnings drift · Buy if above $401 · Stop watching if below $384
- The Street's average target is 2.4 times the risk away
```

## What it does

The Writer is the only agent that writes a whole [thesis](../concepts/theses.md). It researches one stock in depth, in one [analyst](../concepts/analysts.md)'s strategy, and saves one of three things: a new thesis on the watchlist, a pass, or a rewrite of a thesis that already exists.

One writer means one standard. Every thesis on the book was built from the same data, the same sections and the same checks, so the agents that act on its triggers can trust their numbers.

It runs on Claude Sonnet with Claude's web search. In a side-by-side test it wrote the most grounded notes, and got fiscal years right where other models quoted a year-old quarter as current.

## When it runs

When asked: by another agent with `dispatch_thesis_research`, by you with Send to Agent on a stock, or when an analyst is promoted to live money. Each request is its own run, five at a time.

- **[Discovery](discovery.md)** sends every new stock it wants watched.
- **[Chat](chat.md)** sends one when you ask for research, or type `/research`.
- **[A morning run](morning-runs.md)** sends one when the stock's [situation](../concepts/situations.md) calls for it: a stock you added that's due its first research, research older than its horizon allows, or a watch whose wake-up fired.
- **[A trigger run](trigger-runs.md)** sends one when the research is too old to act on.

A rewrite asked for on a passed or retired thesis can't save, so the request decides for itself: the analyst's live thesis on the stock is rewritten instead, or, with none, it is new research linked to the old one, which stays as it was.

## What it reads

<!-- asset: context writer -->

Its first message opens with the date line and the sender's brief (below), then its context: the [market numbers](market-reviewer.md#the-market-numbers), written by code when the request is built (the S&P 500 and Nasdaq 100, the regime, the 11 sectors, VIXY, our stocks reporting in the next 14 days); on a refresh, the stock's row, the same one `get_theses` gives every agent (the belief, every trigger with its id, a promoted stock's paper record); this analyst's record by playbook; and the stock's data. It gets no portfolio snapshot and no digest: it researches one stock, and the account is the [Portfolio Manager](portfolio-manager.md)'s.

Before the model starts, code pulls seven data sets at once: five years of statements, the earnings record, insider trades, peers, analyst coverage, recent filings, and the price and chart. A source that fails is named as missing, never guessed. That data is the ground truth for every number in the note.

The same pull reads our own history with the stock, and the data block opens with it: what we hold, each trade we closed on it and how it ended, the last thesis (its status, conviction and what it believed), and other analysts' coverage and trades on it. A stock we have never touched gets no such section.

Then up to four web searches fill in what data can't: the call, the guidance, what changed this week. Every paragraph names its source, and a catalyst dated after today is written as expected, never as reported.

Its message, right after the date line and before the data, is the brief the agent that sent the stock wrote: why this stock, what it found (the numbers, the links), whose idea it is and its own view, and the link to the post or article when the idea came from one. It tests the idea's claims against the data and says which held. The thesis keeps the link as where it came from, shown on its first Activity line. The sender names only the stock: code finds its thesis (the analyst's live one is refreshed; with none, it is new research, linked to a passed or retired one), and the Writer picks the playbook.

When a chat sends the stock, code also hands over what the Writer can't pull itself: the chat's web searches on the stock, with their links. The model doesn't retype them; they arrive under "What the chat already found" in the Writer's first message (newest first, about 12,000 characters at most), and the Writer searches only for what they leave open. Everything its own pull fetches (the news, filings, the calendars, prices, the Street, our trades on the stock) comes fresh from that pull, never as a second copy. The run page's Context shows the section as sent.

A stock we own goes to the Holding refresh instead, with the same pull and the same shared rules. It is sent this:

<!-- asset: context holding_refresh -->

## What it decides

First, a research note in three parts: the company in two sentences (what it does and how it makes money), the bull case and the bear case, with a bear case even on a buy. The company's numbers, its earnings history, the street's view and the chart are live data on the stock's page, not prose in the note. On a new stock the Writer's own decision note is the first line you read. Then the decision:

- **A direction:** long, short or pass, decided by the research, never by the chart. A pass is a real answer: a stock the research says not to own. A stock it would look at again is a watch, not a pass.
- **A belief:** why we own the company, in two or three plain sentences: what it does, why it's worth owning, and what has to stay true. Never a stock price, a price path or a target.
- **What would prove it wrong:** two or more things in the business, each with where it's read (a guidance cut at the next report, a margin in the 10-Q). Never a stock price, an average or a gap: the floor holds the price.
- **A playbook, and its [triggers](../concepts/triggers.md) from it:** once there is a view, the Writer names the playbook and the save writes the triggers. The Writer's prompt shows each of its analyst's playbooks with its watch triggers, one line each: a reference, the sentence Settings → Playbook shows with each key and its name ("W1 · Buy if above {pivot} (the base's high) · only on the close and at least 1.5× normal volume and below {pivotChase} (…)"), and its reason; then where each key comes from. The save writes every one of them, each marked as the playbook's (`playbook: "WATCH"`), every key priced by code from the chart the Writer was shown. One whose key the chart doesn't have yet (an episodic pivot's buy before its gap) is not written, and the stock's Activity says which and why. A rewrite on the same playbook writes none; a rewrite that names another playbook takes the old playbook's watch triggers off and writes the new one's, and a trigger written by hand stays. On a stock we hold it writes none of them: the holding's floor came with the buy and its other triggers were put on by [After the buy](after-the-buy.md), and the Holding refresh's save has no playbook field (its playbook was set when it was bought). A playbook that can't be read is shown as that, and none of its triggers are written.
- **Its tailoring, after the save:** the Writer reads the stock's triggers as saved and changes, removes or adds one with `edit_triggers`, each change with its reason. A trigger of its own (an earnings review, a price to look again at) goes next to the playbook's unmarked. A price is a key (`{swingLow}`) code writes today's number for, or a line (the 50-day average), never a typed number: its `edit_triggers` takes no other, and an edit moves a price to a key. If they fit, it says so in one line. There are no separate price fields: a stock has triggers and nothing else ([Price targets](../concepts/price-targets.md)). A watch has no sell price: its "Stop watching if below" ends the watch and never sells, and the holding's sell price comes with the buy. That trigger's note says first what a close below it would mean for the belief, then the chart, with the price. There is no minimum reward. When no playbook fits the chart yet, the view is saved with no buy and no "Stop watching if below", with the review that brings it back: its save's `look_again` (the day after the next report, or a day, with why; code writes the one review) or, at a price, a review it adds with `edit_triggers`. Saved with nothing that can fire, it is told so once. Nothing else is added for it: a watch carries its playbook's watch triggers and the ones the Writer adds. A watch gets its playbook's watch triggers, its earnings review and the Writer's own looks, never a profit check, a partial sale or a sale-side review; a trigger on our position is refused on a watch at the save.

It never picks a size. The buy is sized later by the risk to the holding's sale, named with the buy, so an honest, tight sale is what earns size.

The decision goes through the same checks as every other save. A problem goes back to the Writer in the same run, twice at most. After that the thesis saves without the optional field the save still refuses, and the stock's Activity names each one as "Not applied". Only a decision the save refuses as a whole (the claim) goes unsaved, and the run says why. Its trigger edits after the save go through `edit_triggers`, as every agent's do: a refused one comes back with the reason and the rest land.

## What happens next

- **A new stock** lands as Watching, with its playbook's watch triggers and the Writer's own, and a review clock only if its playbook or the agent that asked set one. The trigger check starts watching the buy that day. A view with no playbook yet lands as Watching with only its review.
- **A pass** on a new stock is saved as Passed, with what would change the verdict, so it isn't pitched again without a reason.
- **No thesis** when the save refused the decision as a whole: the asking agent, and chat, get the Writer's reason. A chat waits up to five minutes; a Writer still going after that is named with the step it's on, and saves on its own.
- **A rewrite** replaces the research and the claim. It never changes a stock's direction or status: a different verdict is flagged for the agent that asked, which re-reads the stock and moves its triggers if the view changed. A rewrite you asked for in chat keeps the buy, floor and upside triggers you set: the playbook's are written only where none of yours stands, and there is no tailoring after it.

From there, [morning runs](morning-runs.md) review the stock and a [trigger run](trigger-runs.md) acts when its buy fires. The research stays the Writer's: other agents adjust the triggers around it, and the belief changes only with a new write-up or when you change it in chat.

## Tools

The data tools run in code before it writes; web search and the save are its own, and `edit_triggers` after the save.

<!-- asset: tools writer -->

<details>
<summary>Technical details</summary>

#### Runs as
Its own run, started by `dispatch_thesis_research` through `app/thesis.write.requested` (`lib/inngest/functions/thesis-writer.ts`, concurrency 5).

#### Model
`claude-sonnet-4-6` with Anthropic's web search, up to 4 searches (`WEB_SEARCH_MAX_USES`) and 8 steps.

#### Pipeline
`lib/agent/run-thesis-writer.ts`, whose research call runs through the agent runner (`runAgent`, `lib/agent/engine/run.ts`; `writerRun` gives it its 330 seconds, and the record its Anthropic web search with its cap and `endsWith: "submit_thesis"`, so the research call ends once the save accepts, and `afterSave: ["edit_triggers"]`), which builds its request with the agent engine (`buildAgentRequest` in `lib/agent/engine/build.ts`; `writerRequest` builds the same for the replay) from one of two records, picked by the thesis's status (`writerRecordFor`): `WRITER` (`lib/agent/engine/agents/writer.ts`) for a new stock, a watch or a promoted stock, and `HOLDING_REFRESH` (`holding-refresh.ts`) for a stock we own. Each one's instructions are one document of its own, which imports the rules (`@rules.md`: the house rules and how it writes) and the research rules both share (`@research-rules.md`: date awareness, the research note, the Street and the claim, earnings triggers, what the owner reads). Its run is about the thesis, and its context is read for it by one loader per fact (`lib/agent/context/`): the analyst it works for is sent before its instructions, and the Writer's analyst's playbooks, which it picks the stock's from, after them. Its first message, in the order its record lists it: the date line, its message, the sender's brief (`writerMessage`: the brief as "Why you were dispatched", with the red-flag filings line after it, the link an idea came from, what the chat found, and the ask), then its context: the market numbers, on a refresh the stock's row (read with `get_theses`), its record by playbook and the stock's data (the pull the run made, which its save checks against). Each part is named for the run's Context panel; the seven pulls in `thesis-research/pull-data.ts` (our history with the stock is `get_stock_data`'s `priorCoverage`, printed first by `format-data-block.ts`); the decision's checks in `thesis-research/decision.ts`.

#### Saved through
`submit_thesis` (the thesis fields, `setup_id` and `look_again`, no trigger; the Holding refresh's has no `setup_id`, `heldDecisionSchema`), then code runs the save, `record_thesis` for a new thesis or `update_thesis` for a rewrite (neither is on any agent's list), with the same checks as every other save. The playbook's watch triggers are the save's: `writerPlaybookWrites` prices each template from the pull's chart (`ThesisPullResult.priceStructure`) through `playbookWatchTriggers` and `pricedTemplate` (`lib/agent/knowledge/playbooks.ts`), on a new watch and on a watch whose playbook changes; one with no number today goes on the stock as `fieldChanges.notApplied`. `submit_thesis` runs the save's check on every decision and says accepted only when it would save; past two hand-backs `saveWhatCan` leaves out an optional field the save refuses, written the same way. A refused real save goes without the same way before the one model retry (120 s at most). Then `writerTailorPhase` continues from the note with only `edit_triggers` (4 steps, 120 s): its first message is `tailorMessage` (the decision sent, the triggers as saved with their ids, what wasn't written), and a directional watch left with nothing that can fire hears `nothingCanFire` once. A refresh the chat asked for has no tailoring. A rewrite on a passed or retired thesis becomes new research in `dispatch_thesis_research`.

#### What was sent
The run page's Context shows the request the run's newest model call started with (the research call, or its save retry), exactly as it was sent, kept by `modelFor` (`lib/agent/model.ts`). Code makes the save after the model's call, and the call that saved the thesis and what it returned go into the run's thread (`saveInThread`), so the page draws the thesis's card, which opens it; the tailoring's `edit_triggers` calls follow it.
</details>
