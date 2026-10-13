# Discovery

**Find it before it's obvious.** Discovery finds new stocks for an analyst to watch.

It looks where new names show up, like fresh earnings, today's movers and setup screens, checks each one against the analyst's rules, and sends the best to the Writer to research.

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

Discovery only looks at stocks the analyst doesn't already cover; its tools hide everything on the book. You can ask it to find names off this week's earnings, run one of the analyst's setup screens, look for dated catalysts, or check tickers you paste in.

It doesn't manage the book (that's [the morning run](morning-runs.md)) and it never buys. New stocks land on the watchlist, and a buy happens only when a stock's buy trigger fires and you approve it.

## Starting it

Discovery runs when you ask. Ask in [chat](chat.md) with an analyst selected, or start a discovery run for one analyst. Try:

> Find drift names off this week's reports.
>
> Run the pullback screen and research what's left.
>
> Any FDA decisions in the next 60 days that fit?

## Where it looks

- **Setup screens:** `run_screen` gives a candidate list for one setup, numbers worked out, with every reject and its reason.
- **Earnings:** `get_earnings_calendar` shows who just reported, biggest beats first, or who reports soon.
- **Movers:** `get_market_movers` lists today's gainers, losers and most active outside the analyst's coverage.
- **Catalysts and the web:** `get_catalyst_calendar` for dated FDA decisions; `web_search` and `twitter_search` to check a story.

## How it decides

It reads the whole pool first and drops what plainly doesn't fit. For the rest, `get_theses` checks that no other analyst already covers the stock, and `get_stock_data` gives the price, chart and news. Each stock is scored on trend, strength against the market, entry and how fresh its catalyst is; 4 out of 10 or better earns a deeper look.

It works for one analyst and reads its strategy, rules, universe and record by setup first. A stock the analyst used to own, with a fresh catalyst, counts as a lead.

## What happens to each stock

- **Sent to the Writer:** `dispatch_thesis_research` starts [the Writer](writer.md), which writes the thesis with its buy trigger, floor and target. Up to five per run.
- **Kept on watch:** strong but not ready, saved with `record_thesis` and an optional wake-up, like a price or a date.
- **Passed:** recorded with what would change the verdict, so the next look starts from it.
- **Skipped:** dropped before research, a line in the summary.

The run ends with `record_run_summary`. Writers it started keep going and land as their own runs; in chat, `wait_for_thesis_refresh` waits for them.

## Tools

Everything discovery can call, read from `lib/agent/modes.ts`.

<!-- asset: tools discovery -->

<details>
<summary>Technical details</summary>

#### Prompt
`lib/agent/system-prompts/discovery.ts` (`buildDiscoverySystemPrompt`)

#### Mode
`discovery` in `lib/agent/modes.ts`: `gpt-5.4`, up to 45 steps. The chat (`principal`) carries the same discovery tools.

#### Started by
Chat, or the `app/discovery.run.manual` event, which can carry an analyst and a focus. `lib/inngest/functions/discovery-run.ts` also lists a Sunday 9 AM cron; in practice discovery is run by hand.

#### Writer cap
`DISPATCH_CAP` = 5 per run, enforced in `dispatch_thesis_research`.

#### Outcomes
`record_thesis` with `direction: PASS` is a pass; with `status: WATCHING` as well, a watch without a plan. A new plan is always the Writer's.

#### Screens
`lib/discovery/screens.ts`; setups in `lib/agent/knowledge/setups.ts`.

#### Playbook
`docs/DISCOVERY_PLAYBOOK.md` · `docs/prompts/DISCOVERY_SESSION.md`
</details>
