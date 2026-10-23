# Discovery

**Find it before it's obvious.** Discovery looks for stocks an analyst doesn't cover yet, and sends the best to the Writer. It's a job [chat](chat.md) does when you ask; there is no separate Discovery run.

It's where a stock's life starts. It screens wide, scores fast and hands off. It never writes a plan and never buys.

```facts
Runs in: Chat
Starts: When you ask
Saves: A pass or a watch
```

```chat
caption: Discovery for the PEAD Specialist, asked in chat.
user: Find drift names off this week's reports.
tools: Pulling reported earnings outside your coverage (+1 more)
- 41 companies reported in the last 3 days · 9 beat by 5% or more
- Screening for Post-earnings drift: 6 held their gap, 3 fit the analyst's universe
text: Three clear the rules. $CRWD (+6.8%) and $ADBE (+4.1%) beat, raised the year and held the gap on heavy volume. $NKE (−2.2%) beat but guided down, which is no drift. Sending the two to the Writer.
tools: Dispatching $CRWD thesis-writer (+1 more)
- CRWD [watch]: Writing the thesis · buy trigger, floor and target required
- ADBE [watch]: Writing the thesis · buy trigger, floor and target required
- NKE: Passed: guidance went down. Recorded, so it isn't pitched again.
```

## What it does

Discovery fills an [analyst](../concepts/analysts.md)'s watchlist. It looks where new names show up (this week's earnings, today's movers, the analyst's setup screens, dated catalysts), checks each one against the analyst's rules, and sends the few worth researching to [the Writer](writer.md).

Finding a stock and making the case for it are separate jobs. Discovery is wide and quick; the Writer is narrow and deep. Keeping them apart means every [thesis](../concepts/theses.md) on the book was researched the same way, whoever found the stock.

## When it runs

When you ask in [chat](chat.md). "Find drift names off this week's reports" is a discovery pass, best with an analyst selected so the search stays inside its universe. Nothing runs it on a schedule.

> Find drift names off this week's reports.
>
> Run the pullback screen and research what's left.
>
> Any FDA decisions in the next 60 days that fit?

## What it reads

First, the analyst's brief: its strategy, universe, rules and record by setup. A stock the analyst used to own, with a fresh catalyst, counts as a lead.

Then the places new names show up:

- **Setup screens:** `run_screen` returns candidates for one setup, with every reject and its reason.
- **Earnings:** `get_earnings_calendar`, who just reported (biggest beats first) or who reports soon.
- **Movers:** `get_market_movers`, today's gainers, losers and most active.
- **Catalysts and the web:** `get_catalyst_calendar` for dated FDA decisions; `web_search` and `twitter_search` to check a story.

Asked for the analyst's universe, these tools hide every stock it already watches or holds, so a pass never brings back names it covers.

## What it decides

It works in two passes. The first reads the whole pool and drops what plainly doesn't fit. The second checks the rest: `get_theses` confirms no other analyst already covers the stock, and `get_stock_data` gives the price, chart and news.

Each stock that survives is scored out of 10: trend (3), strength against the market (3), entry (2) and how fresh its catalyst is (2). A 4 or better earns research. Every stock ends one of four ways:

- **Research:** `dispatch_thesis_research` sends it to the Writer. Five per conversation at most, the best scores first.
- **Watch:** strong but not ready to price, or past the five. Saved with `record_thesis` as a watch with a wake-up (a price, a move, an earnings beat or miss, or days before the report), so "no room this week" never means "never." A watch with no wake-up at all is just a name on the list, waiting for you.
- **Pass:** researched and declined. Saved as Passed with what would change the verdict, so it isn't pitched again without a reason.
- **Skip:** dropped in the first pass. One line in the summary; nothing is saved.

## What happens next

The Writer researches each stock it was sent and puts it on the watchlist with a buy, a floor and a target. From there the [trigger](../concepts/triggers.md) check watches the buy all day, [morning runs](morning-runs.md) review it, and a buy happens only when the trigger fires and a [trigger run](trigger-runs.md) agrees, with your [approval](../concepts/approvals.md) on the live account.

A watch sleeps until its wake-up comes true. Then the stock is in the "watch woke up" [situation](../concepts/situations.md), and the next morning run decides whether to bring it back.

The Writer runs it started land on their own; `wait_for_thesis_refresh` brings them back into the conversation.

## Tools

Discovery uses chat's tools: see [Chat](chat.md).

<details>
<summary>Technical details</summary>

#### Prompt
The batched-discovery section ("Triage flow") of the chat prompt, `buildPrincipalSystemPrompt` in `lib/agent/modes.ts`.

#### Mode
`principal` in `lib/agent/modes.ts`. The standalone `discovery` mode, its prompt and its run (`lib/inngest/functions/discovery-run.ts`) were deleted; old DISCOVERY runs still open on the runs page.

#### Score and cap
The 10-point composite, its bar of 4 and the cap of five dispatches a conversation are rules in the chat prompt.

#### Outcomes
`record_thesis` with `direction: PASS` is a pass; with `status: WATCHING` as well, a watch without a plan. A new plan is always the Writer's.

#### Screens
`lib/discovery/screens.ts`; setups in `lib/agent/knowledge/setups.ts`. Playbook: `docs/DISCOVERY_PLAYBOOK.md`.
</details>
