# Discovery session — the brief

> Written 2026-09-28 by the Signals lane at the end of five days of discovery work
> (09-24 → 09-28). A new session reads this first. Every number was read from the
> production rows of the account that trades (davembixler@gmail.com) unless it says
> otherwise. When this file and the database disagree, the database wins — check it.
>
> **Updated 2026-11-16** against how the app works now (Dave's pinned Product, Vision,
> Strategy page and the Hindsight Roadmap). Numbers that go stale (slots, sizes, holdings)
> were replaced with where to read them live. New: start from the account, a full plan or
> no dispatch, name the source, and getting ready to automate.

## Your job

Dave's money is mostly sitting in cash. He wants **stocks worth buying this week**,
from the whole market — not only biotechs with FDA dates and stocks that just
reported. That includes plain long-term holds: "a strong business we buy and hold
for a few months."

You do that through **discovery in his own app** (the chat at `/chat`, with an
analyst selected), plus outside research he pastes in. Then you **review** what
each session produced from the database, so every stock that lands is actually
buyable and was dispatched correctly. If the analyst lineup can't cover what he
wants, you **propose the change** — an edited analyst or a new one — and he decides.

Rules of the road (these are his, and they're binding):

- Plain language. Stocks, analysts, runs, triggers, theses, buy price, floor, target.
  No invented jargon. He is not a trader. Don't hand him a menu of trading-rule
  choices — recommend one thing, say why in a line.
- Merges, trade approvals and money are his clicks. Never merge. Never approve.
- Never patch rows with SQL. A wrong row gets fixed through the app (a chat
  instruction, the analyst editor, the trigger popover) or a code fix.
- No fleets of subagents without his say-so and a cost estimate.
- Trading-rule questions (entry rules, what a setup allows) go to the QB session;
  write him the paste.
- Verify before you claim. Five times in five days a confident claim here was wrong
  (see "Mistakes already made" below).

## Read first, in this order

1. `docs/run-reviews/2026-09-28-state-of-the-cycle.md` — the whole cycle, stage by
   stage, from the rows. **Its four data traps apply to every query you run.**
2. This file, then the newest file in `docs/discovery-prep/` (the current calendar and
   pastes).
3. `docs/discovery-prep/2026-09-24-REFRAME.md` — discovery by source; what each
   tool does and doesn't do.
4. `docs/discovery-reviews/2026-09-25-CATALYST.md` — the one session reviewed end
   to end; the review method in practice.
5. `docs/plans/ANALYST_LINEUP.md` — why there are three analysts, and why the
   Momentum analyst was deleted (don't propose rebuilding it without answering that).
6. `lib/agent/knowledge/setups.ts` — every setup's entry, floor, target and window.
7. `docs/TRIGGERS.md` — trigger kinds and the account-wide rules.

## The three analysts

**Read slots, sizes, minimum scores and holdings live** (`read_analyst_config`,
`get_portfolio_context`). Numbers written in this file have been wrong before. What each
one trades doesn't change often; as of 2026-11-16:

| | PEAD Specialist | Catalyst Event PM | Secular Compounder |
|---|---|---|---|
| Trades | The drift after a clean beat-and-raise report | The run-up into a dated FDA decision | Businesses worth more in 3–5 years; months-to-years holds |
| Setups | `PEAD`, `EPISODIC_PIVOT`, `MA_PULLBACK` | `PRE_CATALYST`, `BASE_BREAKOUT`, `MA_PULLBACK` | `COMPOUNDER_ACCUMULATION`, `BASE_BREAKOUT`, `MA_PULLBACK` |
| Fence | Any sector, $200M+ | Health Care and Information Technology; $500M–$20B | All 11 sectors, no size band |
| When it can buy | Days 1–3 after a report; after that only as a pullback (`MA_PULLBACK`) | 70 to 21 days before the FDA date | Pullback to a rising average, a breakout, or a reclaim of the 50-day |

**Settled since 09-28:** the Compounder's "3–4 names" line is gone, and its sectors now
cover the whole market, so a plain long-term hold in any sector has a home. The
industries and themes an analyst hunts are words in its strategy text, not fence
fields (those were removed 2026-10-31).

## Start from the account, not the analyst

Each analyst sees only its own stocks. The account sees all of them, and that's where
a discovery session should start:

- **Read what the account holds as a whole** before sourcing. Today that's the latest
  8 PM Portfolio Reviewer digest (a read-only run, mode `PORTFOLIO_DIGEST`): what's
  crowded, the cash, what reports soon. Once roadmap 5.4 ships, the weekly account
  review ends with a few "what the account needs" lines, such as "nothing in
  healthcare; too much in AI and power". Read those instead.
- **At equal quality, rank a candidate outside the account's biggest bet first.** On
  2026-11-15, five of seven holdings (CEG, GEV, PLTR, MU, NVDA) were one bet on AI and
  power, and Catalyst held nothing. That's ranking, never a gate: a great name inside
  the bet still gets dispatched.
- **Check the market calendar against that bet** (Fed, CPI, jobs, bellwether reports)
  and say it in one line if a big date lands on it.

## What's at your disposal

**In the app chat** (the principal chat's tool list, `lib/agent/modes.ts`):

| Tool | What it gives | Limits |
|---|---|---|
| `get_earnings_calendar` | Who reports, forward or back; actuals, surprise % | 30 days either way |
| `run_screen` | A candidate list per setup, each row ready to dispatch | **PEAD's pool is the calendar (works). The chart screens — MA_PULLBACK, BASE_BREAKOUT, MOMENTUM_FLAG, EPISODIC_PIVOT — pool only the day's top gainers and most-actives, first 40.** They can't see a leader resting quietly; on 09-27 one stock passed out of 40, and 09-21 was zero out of 40 on all four. `scope: "book"` screens the watchlist instead. |
| `get_catalyst_calendar` | FDA decision dates read from companies' own 8-Ks, with the sentence | PDUFA only. Misses dates (see Limits) |
| `get_market_movers` | Gainers / losers / most-active, with 5-day, 1-month, 6-month moves | Today's list only |
| `get_stock_data` | Quote, profile, financials, chart structure, news | Chart numbers not split-adjusted (see Limits) |
| `get_earnings_data` | Beat history, next report date | — |
| `get_sec_filings` | Filing list with item codes and links | **No filing text.** The agent can't open a document |
| `web_search` (Perplexity) | Outside facts, named sources | Budget-limited. There is no X search in the app: bring X posts in by pasting them |
| `dispatch_thesis_research` | Sends a stock to the thesis writer (`mint` new, `refresh` existing), with what the chat found and, for someone's thesis, the post itself | 5 per chat session |
| `wait_for_thesis_refresh` | Waits for a writer and returns what saved | **Works on `mint` runs too**, despite its description; on a failure it gives no reason |
| `get_theses`, `update_thesis`, `record_thesis` | Read and edit the watchlist | — |
| `read_trade_results`, `list_proposals`, `read_analyst_config` | Past trades, pending buys, settings | — |

**Outside the app** (Dave pastes results into the analyst's chat):
Finviz screener (market-wide leaders: above the 50- and 200-day, within 10% of the
high, sorted by 1-month gain), OpenInsider cluster buys, Earnings Whispers, Zacks
Earnings ESP / Rank #1 (estimate revisions), MarketBeat upgrades, BioPharmCatalyst
and RTTNews FDA calendars, Grok on X. **No data plan we hold has analyst estimate
revisions or price targets** — those only come from outside.

## Limits you will hit (and who owns them)

| Limit | Effect | Owner |
|---|---|---|
| Chart screens pool only today's movers | The app can't find buyable leaders across the market by itself | **Roadmap 13.1** (screens per setup; was DAV-300, parked 09-24) |
| Chart numbers aren't split-adjusted | A stock that split this year reads as a broken chart (NOW shows a 52-week high of $974; the real one is ~$195); writers won't price it | DAV-333, Signals lane |
| The FDA calendar misses dates | Wording it doesn't search for, a 120-day look-back, a paging bug; AGIO, SMMT, CYTK, CORT all missed; moved and already-decided dates shown as upcoming. It also ignores the seat's size and sectors, reaches 70 days for a 21-day buy window, and reads filings one at a time | DAV-314; **roadmap 13.2** |
| Buy-time checks | A triggered buy is refused if the thesis score is under the analyst's minimum, if there's no free slot, or if the stock has no committed direction (a "keep watching" row) | By design — check all three before calling a stock buyable |
| Dip-buys fire at the open | A buy that triggers on touching a level fires intraday; the analyst wants to see the close and passes (DOCU 09-28) | Known, in the state-of-the-cycle review |
| Buy cards wait for you | No 24-hour expiry since #976. A card comes down at the 4:20 close only if the price closes back past its line | By design |
| Morning runs are Mon / Wed / Fri 08:00 ET | A report no longer waits for one: since 2026-11-15 the account's beat and miss rules send any held **or watched** stock to a run the day it reports | By design |

## What changed, 09-28 → 11-16 (all live on main)

- **Buy and sale cards wait for you** (#976); a card comes down at the 4:20 close if the
  price closes back past its line.
- **A report wakes a run that day** on anything held or watched (the account's beat and
  miss rules, switched to Send to Agent on 11-15).
- **Review triggers fire once, on the crossing** (#981), as a buy already did.
- **Eight situations, one per trigger action** (#986). A watch with no view yet is
  "Review due".
- **Two reviewers read every weekday:** the Market Reviewer at 7:30 AM (notes on stocks
  the news touches) and the Portfolio Reviewer at 8 PM (the whole account).
- **The Compounder's book cap line is gone** and its sectors cover the market.

## What changed, 09-24 → 09-28 (all live on main)

- **Writers stopped losing theses.** On 09-24, 4 of 5 dispatched writers died
  (a 400-character limit refused every first answer, then a library rule ended the
  loop before the retry). Fixed 09-25; every re-sent writer since has saved.
- **The app sizes every buy** inside the analyst's band; agents don't send a size.
- **A refused tool call is retried in the run** and carried to the next one.
- **A declined sale comes back** as the next run's question.
- **A watched stock with no buy is flagged to the run** (unless it waits on a date).
  A stricter version that forbade removing a buy was merged and reverted the same day.
- **FDA calendar reads month-only dates** ("February 2027") and the extended-date
  wording EXEL used.
- **Copied rules are off the holdings**; each stock inherits its analyst's rules.

## The discovery loop that worked

From three sessions (09-24 Catalyst, 09-26 PEAD, 09-27 "make every watch buyable"):

1. **One chat per analyst, analyst selected.** Start with its own watchlist:
   `get_theses`, then every watch either gets a buy trigger or is retired. The
   buy trigger doesn't have to be today's price — **it's the level where the
   analyst's setup becomes true**: a pullback to a rising 20- or 50-day, a break
   above the last swing high, or a close back above the 50-day. It fires only if
   the stock turns. This took buyable watches from 8 to 15 on 09-27.
2. **Then new names**: `run_screen` / the calendars / outside pastes → the chat
   checks each against the analyst's rules → dispatches up to the analyst's free
   slots (never more than 5), with *"the thesis must carry a buy trigger, a floor,
   a target and a review clock"* in the screen row.
   - **A named setup and a full plan, or no dispatch.** A stock that fits no setup is
     not a trade today, however good the story; pass it with the reason. A watch with
     no buy level is a reminder, not a plan, and the roadmap's "every watch has a plan,
     or it goes" rule (9.1) will drop it. Since 10-01, ANGX, DOCU and HPE were saved
     with no setup.
   - **Name the source.** Every thesis lands with source kind `WEB_SEARCH`, whatever
     found it. The dispatch's one-line source is the only record of where a stock came
     from, so name the screen, the calendar, or the X account and post. A source nobody
     wrote down can't be graded later.
3. **Then wait and read back.** `wait_for_thesis_refresh` on every child run, and
   end with one table: stock · buy trigger · floor · target · distance from the buy.
   A session isn't done until every dispatch has a thesis or a stated failure.
4. **Never quote a filing** — the agent can't open one. Unconfirmed is "unconfirmed".
5. **"Up to N, only names that clear."** The 09-24 chat relaxed a rule to fill a slot.
6. **Watch wide before a report, buy narrow after it.** The 09-26 PEAD chat threw out
   NKE, CCL, ACN and JEF partly for falling charts — not one of PEAD's rules. Watching
   into a report costs nothing; the report decides. Since 11-15 the report itself wakes
   a run on anything watched, so loading PEAD's watchlist before a wave of reports is
   most of PEAD's discovery.

Grok and Perplexity: the app found every Catalyst candidate on 09-24; the outside
tools found none but **killed two false ones** (an approval that had already
happened, an invented filing quote). Grok's cold sweeps returned mostly past events.
Use them to verify and to fill what the app can't see (estimate revisions,
guidance), and ask for "future events only".

**Numbers first, people second.** Ideas come from what's working (a calendar, a screen,
a beat-and-raise), and X is the check: is the date real, how crowded is the trade, did
anyone credible call it. The exception is the Compounder, whose universe has no
calendar; there, agreement among multi-year holders is real signal
(`docs/DISCOVERY_PLAYBOOK.md`, the Scout Loop).

## How to review a session (from the database)

Scripts run with `npx tsx --env-file=.env.local <file>` against Prisma. Read the
state-of-the-cycle traps first (two accounts; timestamps stored as UTC and read as
local).

- The chat: `ResearchRun` with `mode = PRINCIPAL_CHAT`; its full conversation is the
  `RunMessage` with `role = 'thread'`.
- Its writers: `ResearchRun` with `mode = THESIS_WRITER` and
  `parameters.parentRunId` = the chat. `parameters.error` / `submitAttempts` say
  what happened; **the writer's own thread holds the exact refusal text**.
- A stock's analyst: `Thesis → researchRun.agentConfigId`. Positions:
  `Position.analystId`. Chart numbers: latest `TickerIndicators.snapshot`.

For every stock a session left on the watchlist, check — and say which check failed:

1. It has an ENTER trigger (or waits on a dated event, and says so).
2. The floor is at least one average day's move (1 ATR) below the buy. CORT and HPE
   were saved inside it on 09-27; a "15:1" reward-to-risk is the tell.
3. Reward-to-risk is at least 2:1.
4. The thesis score is at or above the analyst's minimum.
5. The analyst has a free slot — and its instructions don't cap it lower (the
   Compounder).
6. The direction is set (LONG), not a "keep watching" row.
7. Dates and claims trace to a source the chat actually read.

## Open decisions

The September list is settled or has moved to the roadmap: the Compounder's cap line is
gone, its sectors now cover the market, the screens' stock pool is roadmap 13.1, and
"when a plan stops fitting" is roadmap 9.1 ("every watch has a plan, or it goes").
Open product decisions live on the Hindsight Roadmap and its task tracker (Dave's
pinned pages). Recommend one answer each; he decides.

For the QB: the setup catalog (`lib/agent/knowledge/setups.ts`) has `INSIDER_CLUSTER`,
`ESTIMATE_REVISION`, `RS_52W_HIGH`, `RSI2_BOUNCE` and `SECTOR_ROTATION`, and no analyst
uses any of them.

## This week

Read the newest file in `docs/discovery-prep/` for the calendar, the ideas and the
pastes. Don't write a dated week into this file: it goes stale in days.

## Getting ready to automate

Dave plans to automate discovery (roadmap 13, "Discovery by the numbers"). Run the
manual sessions in the shape the automated one will take, so each step can be handed to
code:

1. **Code builds the list**, per setup: the earnings calendar for PEAD (works today), the
   FDA calendar for Catalyst (roadmap 13.2), and market-wide screens for the chart setups
   and the Compounder (roadmap 13.1).
2. **Read the account and the free slots** before triage (above).
3. **The model triages a short list**, never a firehose, capped to free slots.
4. **The Writer writes a full plan**, or the stock is passed with its reason.
5. **Every thesis records its source.**
6. **A monthly look-back grades the sources** (the scout roster's tally today; roadmap 12
   later).

Order: **PEAD first.** Its list is already a calendar plus numbers, and the report rule
already wakes a run on watched names, so the first automated step can be code that puts
upcoming in-fence reporters on its watchlist. **Catalyst second**, once 13.2 fixes its
calendar. **The Compounder last**, since it needs the market-wide screens.

What not to automate: **X**. The app has no X search, and any vendor that offers one gets
probed live before anyone plans on it. The Signals pipeline (deleted 2026-09-15) pushed
headlines at the analysts and was noise. X stays an on-demand check on a candidate.

## Mistakes already made here — don't repeat them

- "Nothing wakes MU before its report" — wrong; an account-wide rule ("reports within
  3 days → review") does. Before saying nothing wakes a stock: check the thesis's
  triggers, the analyst's, the account's, and cooldowns.
- "MIRM never had a buy price" — wrong; it had one, the buy fired, the proposal
  expired, and a run removed the plan. Read the history, not today's row.
- "DYN broke the analyst's rule" — wrong; the rule covers companies under $1B only.
  The discovery prompt applied a stricter rule, which also cost SMMT and COGT a
  thesis on 09-24.
- A guessed cause for the writer failures was written into a ticket; the writers' own
  saved threads had the real one. Read the thread before diagnosing.
- "The calendar has the date" — check the calendar's date against the company's
  newest statement; a newer filing wins.
