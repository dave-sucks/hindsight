# Discovery

**Find it before it's obvious.** Discovery looks for stocks an analyst doesn't cover yet, and sends the best to the Writer. It's a job [chat](chat.md) does when you ask; there is no separate Discovery run.

It's where a stock's life starts. It screens wide, scores fast and hands off. It never writes a stock's triggers and never buys.

```facts
Starts: In chat · when you ask
Saves: A pass or a watch
```

```chat
caption: Discovery for the PEAD Specialist, asked in chat.
user: Find drift names off this week's reports.
tools: Pulling reported earnings outside your coverage (+1 more)
- 41 companies reported in the last 3 days · 9 beat by 5% or more
- Screening for Post-earnings drift: 6 held their gap, 3 fit the analyst's universe
text: Three clear the rules. $CRWD (+6.8%) and $ADBE (+4.1%) beat, raised the year and held the gap on heavy volume. $NKE (−2.2%) beat but guided down, which is no drift. Sending the two to the Writer.
tools: Sending $CRWD to the Writer (+1 more)
- CRWD [watch]: With the Writer · its playbook's watch triggers come back with the thesis
- ADBE [watch]: With the Writer · its playbook's watch triggers come back with the thesis
- NKE: Passed: guidance went down. Recorded, so it isn't pitched again.
```

## What it does

Discovery fills an [analyst](../concepts/analysts.md)'s watchlist. It looks where new names show up (this week's earnings, today's movers, the analyst's playbook screens, dated catalysts), checks each one against the analyst's rules, and sends the few worth researching to [the Writer](writer.md).

Finding a stock and making the case for it are separate jobs. Discovery is wide and quick; the Writer is narrow and deep. Keeping them apart means every [thesis](../concepts/theses.md) on the book was researched the same way, whoever found the stock.

## When it runs

When you ask in [chat](chat.md). "Find drift names off this week's reports" is a discovery pass, best with an analyst selected so the search stays inside its universe.

There is also a Discovery agent that runs on its own, one run per analyst, on a schedule. It is **off** until you rewrite its job text (a draft today) and turn it on. See [The scheduled Discovery agent](#the-scheduled-discovery-agent).

> Find drift names off this week's reports.
>
> Run the pullback screen and research what's left.
>
> Any FDA decisions in the next 60 days that fit?

## What it reads

<!-- asset: context chat -->

First, the analyst's brief: its strategy, universe, rules and record by playbook. A stock the analyst used to own, with a fresh catalyst, counts as a lead.

Then the places new names show up:

- **Playbook screens:** `run_screen` returns candidates for one playbook, with every reject and its reason.
- **Earnings:** `get_earnings_calendar`, who just reported (biggest beats first) or who reports soon.
- **Movers:** `get_market_movers`, today's gainers, losers and most active.
- **Catalysts and the web:** `get_catalyst_calendar` for dated FDA decisions; `web_search` to check a story.

Asked for the analyst's universe, these tools hide every stock it already watches or holds, so a pass never brings back names it covers.

## What it decides

It works in two passes. The first reads the whole pool and drops what plainly doesn't fit. The second checks the rest: `get_theses` confirms no other analyst already covers the stock, and `get_stock_data` gives the price, chart and news.

For each stock that survives, the chat says in a sentence or two what is changing in the business and whether the chart gives a place to buy it. There is no score; the sentence is the judgment. Every stock ends one of four ways:

- **Research:** `dispatch_thesis_research` sends it to the Writer. Five per conversation at most, the clearest business reasons first.
- **Watch:** strong but not ready to price, or past the five. Saved with `watch_stock` as a watch with no view yet and its look-again, a price, the next report or an event's date, so "no room this week" never means "never." A watch with no wake-up at all is just a name on the list, waiting for you.
- **Pass:** researched and declined. Saved as Passed with what would change the verdict, so it isn't pitched again without a reason.
- **Skip:** dropped in the first pass. One line in the summary; nothing is saved.

## What happens next

The Writer researches each stock it was sent and puts it on the watchlist with its playbook's watch triggers: a buy and the line that ends the watch. From there the [trigger](../concepts/triggers.md) check watches the buy all day, [morning runs](morning-runs.md) review it, and a buy happens only when the trigger fires and a [trigger run](trigger-runs.md) agrees, with your [approval](../concepts/approvals.md) on the live account.

A watch sleeps until its wake-up comes true. Then the stock is in the "review due" [situation](../concepts/situations.md), whose paragraph on a watch with no view asks the next morning run whether to bring it back.

The Writer runs it started land on their own; `wait_for_thesis_refresh` brings them back into the conversation.

## The scheduled Discovery agent

The same job, written down once as its own agent: its job text, what it starts with, its tools and when it runs. It works for one analyst a run and is **off**. Its job text is a draft for you to rewrite.

- **Starts with:** the analyst (its strategy, rules, free slots and playbooks), its book (its `get_theses` read: every stock it holds and watches, a stock in a situation in full), and the earnings calendar outside its book (who reported in the last 7 days and who reports in the next 14).
- **Its message:** the schedule's kickoff, "Find this analyst's next stocks.", after the date line every run opens with.
- **Tools:** `get_earnings_calendar`, `run_screen`, `get_market_movers`, `get_stock_data`, `web_search`, and `dispatch_thesis_research`, which sends a stock to the Writer with its brief: the playbook, the numbers, what it found and where the stock came from.
- **At most three stocks a run** go to the Writer; the tool refuses a fourth. Sending none is a normal result.
- **It ends with a write-up:** each stock it sent and why, the best it passed on and why, and what its lists lacked.
- **When:** Tue and Thu at 9:00 AM ET on market days, once it is on.

<!-- asset: context discovery -->

## Tools

Discovery uses these of chat's tools. [Chat](chat.md) lists all of them.

- **Find candidates:** `run_screen`, `get_earnings_calendar`, `get_market_movers`, `get_catalyst_calendar`, `get_sec_filings`.
- **Check them:** `get_theses`, `get_stock_data`, `web_search`.
- **Hand off or record:** `dispatch_thesis_research` sends a stock to the Writer; `pass_on_stock` saves a pass and `watch_stock` a watch; `wait_for_thesis_refresh` brings the Writer's results back into the conversation.

<details>
<summary>Technical details</summary>

#### Prompt
The Batched discovery part of the chat's record, `CHAT` in `lib/agent/engine/agents/chat.ts`.

#### Mode
`principal` in `lib/agent/modes.ts`. The standalone `discovery` mode, its prompt and its run (`lib/inngest/functions/discovery-run.ts`) were deleted; old DISCOVERY runs still open on the runs page.

#### The cap
The cap of five dispatches a conversation is a rule in the chat prompt.

#### Outcomes
`pass_on_stock` is a pass, saved as Passed; `watch_stock` is a watch with no view and no buy, stamped as your add (`mintWatch` in `lib/thesis/mint-watch.ts`, the watchlist's own path), with its one look-again review written by code as the agent's, so `edit_triggers` can move it later. A new stock's first triggers are always the Writer's.

#### The scheduled agent
Its record is `DISCOVERY` (`lib/agent/engine/agents/discovery.ts`), whose run is about an analyst: its instructions (its own file, with the analyst, `the_analyst`, sent before it), its context (`the_book`, the analyst's `get_theses` read, and `earnings_calendar`, a read of `get_earnings_calendar` outside the book, each read for the analyst by its loader in `lib/agent/context/`) and its tools. Its run, `DISCOVERY_RUN` (`lib/agent/discovery/run.ts`), names the analyst and makes its tools for it in the run's book, with mode `DISCOVERY`. The runner (`runAgentAsRun`, `lib/agent/engine/run.ts`) opens the run and keeps its books; its thread opens with the book's `get_theses` card, the same read its first message carries (`lib/agent/book-card.ts`). Its line in the schedule (`SCHEDULE`, `lib/agent/engine/schedule.ts`) is per analyst, `0 9 * * 2,4`, off, and writes its kickoff, its message. The send limit is `SENDS_A_RUN`, held by `withSendLimit`. A DISCOVERY run takes no messages (`READ_ONLY_RUN_MODES`, `lib/runs/modes.ts`). Try it with nothing sent to the Writer: `npx tsx --env-file=.env.local scripts/discovery-dry-run.ts "PEAD Specialist" PAPER`.

#### Screens
`lib/discovery/screens.ts`; playbooks in `lib/agent/knowledge/setups.ts`. Playbook: `docs/DISCOVERY_PLAYBOOK.md`.
</details>
