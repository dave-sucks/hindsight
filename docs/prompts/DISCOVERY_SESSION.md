# Discovery session — the brief

> Written 2026-09-28 by the Signals lane at the end of five days of discovery work
> (09-24 → 09-28). A new session reads this first. Every number was read from the
> production rows of the account that trades (davembixler@gmail.com) unless it says
> otherwise. When this file and the database disagree, the database wins — check it.

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
2. This file.
3. `docs/discovery-prep/2026-09-24-REFRAME.md` — discovery by source; what each
   tool does and doesn't do.
4. `docs/discovery-reviews/2026-09-25-CATALYST.md` — the one session reviewed end
   to end; the review method in practice.
5. `docs/plans/ANALYST_LINEUP.md` — why there are three analysts, and why the
   Momentum analyst was deleted (don't propose rebuilding it without answering that).
6. `lib/agent/knowledge/setups.ts` — every setup's entry, floor, target and window.
7. `docs/TRIGGERS.md` — trigger kinds and the account-wide rules.

## The three analysts, as of 2026-09-28

| | PEAD Specialist | Catalyst Event PM | Secular Compounder |
|---|---|---|---|
| Trades | The drift after a clean beat-and-raise report | The run-up into a dated FDA decision | Businesses worth more in 3–5 years; months-to-years holds |
| Fence | Any sector, $200M+ | Biotech, pharma, devices, life-science tools, semis, software; $500M–$20B | Tech, healthcare, industrials, utilities, comms, energy, materials; themes: AI infrastructure, datacenter buildout, GLP-1, energy transition, defense, onshoring, demographics |
| Trade size | $3k–$14k | $3k–$8k (half size into an event) | $4k–$10k |
| Min score to buy | 6/10 | 5/10 | 7/10 |
| Open slots | 6 (holds MU, NVDA) | 5 (holds nothing) | 6 (holds CEG, WST, ASML, ABT) |
| When it can buy | Days 1–3 after a report; after that only as a pullback (`MA_PULLBACK`) | 70 to 21 days before the FDA date | Pullback to a rising average, a breakout, or a reclaim of the 50-day |

**The Compounder's instructions say "My book is 3-4 names, each a real
commitment."** Its settings allow 6. It holds 4, so it turns down its own buys
(five times in 30 days, per the state-of-the-cycle review). As of 09-28 the line
is unchanged. This is the single biggest thing between Dave's cash and a purchase.

**What nobody covers.** Consumer (food, retail, restaurants, travel), financials and
real estate get in only through PEAD, and only in the 1–3 days after a report. The
only months-long seat is the Compounder, and it's theme-locked. So "a strong
business to buy and hold for a few months" outside AI, power, defense and medtech
has no home. That's a lineup decision for Dave — see "Open decisions".

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
| `web_search` (Perplexity), `twitter_search` (Grok on X) | Outside facts, named sources | Budget-limited |
| `dispatch_thesis_research` | Sends a stock to the thesis writer (`mint` new, `refresh` existing) | 5 per chat session |
| `wait_for_thesis_refresh` | Waits for a writer and returns what saved | **Works on `mint` runs too**, despite its description; on a failure it gives no reason |
| `get_theses`, `update_thesis`, `record_thesis` | Read and edit the watchlist | — |
| `read_trade_results`, `list_proposals`, `read_analyst_config`, `read_database` | Past trades, pending buys, settings, anything | — |

**Outside the app** (Dave pastes results into the analyst's chat):
Finviz screener (market-wide leaders: above the 50- and 200-day, within 10% of the
high, sorted by 1-month gain), OpenInsider cluster buys, Earnings Whispers, Zacks
Earnings ESP / Rank #1 (estimate revisions), MarketBeat upgrades, BioPharmCatalyst
and RTTNews FDA calendars, Grok on X. **No data plan we hold has analyst estimate
revisions or price targets** — those only come from outside.

## Limits you will hit (and who owns them)

| Limit | Effect | Owner |
|---|---|---|
| Chart screens pool only today's movers | The app can't find buyable leaders across the market by itself | **DAV-300 — parked by Dave on 09-24** (see Open decisions) |
| Chart numbers aren't split-adjusted | A stock that split this year reads as a broken chart (NOW shows a 52-week high of $974; the real one is ~$195); writers won't price it | DAV-333, Signals lane |
| The FDA calendar misses dates | Wording it doesn't search for, a 120-day look-back, a paging bug; AGIO, SMMT, CYTK, CORT all missed; moved and already-decided dates shown as upcoming | DAV-314, Signals lane |
| Buy-time checks | A triggered buy is refused if the thesis score is under the analyst's minimum, if there's no free slot, or if the stock has no committed direction (a "keep watching" row) | By design — check all three before calling a stock buyable |
| Dip-buys fire at the open | A buy that triggers on touching a level fires intraday; the analyst wants to see the close and passes (DOCU 09-28) | Known, in the state-of-the-cycle review |
| Proposals expire in about a day | MIRM and LUXE expired unclicked | Tell Dave when one is due |
| Morning runs are Mon / Wed / Fri 08:00 ET | Nothing corrects the watchlist on a weekend; a Tuesday report can be missed | By design |

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
   checks each against the analyst's rules → dispatches up to 5, with
   *"the thesis must carry a buy trigger, a floor and a target"* in the screen row.
3. **Then wait and read back.** `wait_for_thesis_refresh` on every child run, and
   end with one table: stock · buy trigger · floor · target · distance from the buy.
   A session isn't done until every dispatch has a thesis or a stated failure.
4. **Never quote a filing** — the agent can't open one. Unconfirmed is "unconfirmed".
5. **"Up to N, only names that clear."** The 09-24 chat relaxed a rule to fill a slot.
6. **Watch wide before a report, buy narrow after it.** The 09-26 PEAD chat threw out
   NKE, CCL, ACN and JEF partly for falling charts — not one of PEAD's rules. Watching
   into a report costs nothing; the report decides.

Grok and Perplexity: the app found every Catalyst candidate on 09-24; the outside
tools found none but **killed two false ones** (an approval that had already
happened, an invented filing quote). Grok's cold sweeps returned mostly past events.
Use them to verify and to fill what the app can't see (estimate revisions,
guidance), and ask for "future events only".

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

## Open decisions for Dave

Recommend one answer each; he decides.

1. **The Compounder's "3–4 names" line.** Changing it to "up to 6" (its setting) lets
   it buy PLTR / MSFT / ISRG / ETN when they fire. Done in the analyst editor.
2. **A home for plain long-term holds outside the Compounder's themes** — consumer,
   financials, the rest of the market. Either widen the Compounder's sectors and
   themes, or add one analyst for months-long holds of quality leaders on pullbacks,
   any sector. Read `ANALYST_LINEUP.md` first: it deleted Momentum because PEAD makes
   the same bet better; a quality/position seat is a different bet, but say so.
3. **Un-park DAV-300** (the screens' stock pool). It's the in-app way to find "a stock
   resting on a rising 20-day after a six-week climb" anywhere in the market. Until
   then, Finviz is the substitute.
4. **When a plan stops fitting**: the runs take the buy off and keep reviewing; the
   09-27 chats left a buy at the level where it would fit again. The state-of-the-cycle
   review calls this Dave's decision.
5. For the QB: whether a pre-FDA entry can be time-based (the setup's summary says
   "buy 6–8 weeks before" but its entry needs a chart shape), and MU (held, reports
   Wed 09-30 after the close; the PEAD rule says out before the print).

## This week (as of the 09-25 close)

- Reports: KMX and AIR Tue 09-29, JBL Wed 09-30 (all on PEAD's watchlist; buys, if
  any, come days 1–3 after), MU Wed after the close (held).
- Closest to their buy price: ISRG (close above $406, 0.2% away), MSFT (close above
  $518, 0.4%), DOCU (dip to $67, 0.7%), PLTR (above $192.75, 1.6%), GEV (back over
  its 50-day ~$973, 1.6%), ETN (close above $448, 1.8%). Four of the six are the
  Compounder's — see decision 1.
- Earnings season opens around Oct 12: 800+ real companies report Oct 12 – Nov 7,
  against about 15 this week. That's when PEAD has something to buy every day.

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
