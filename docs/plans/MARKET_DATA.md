# Market data — what it is, where it lives, and how it moves money

> **What this is.** The plain-language answer to "how do earnings, movers and
> the rest of the data I already pay for actually get used" — by triggers, by
> discovery, by runs — and what it takes to kill the Signals machinery
> cleanly so none of it is in the way. Written 2026-09-10 at the principal's
> direction. Companion to `EARNINGS_AND_MOVERS.md` (the earnings-trigger
> build) and the parked `SIGNALS_REDESIGN.md` (news — not this).
>
> **Status:** in motion. Section 1's cuts are in #625 (one dashboard action
> is still the principal's). The earnings triggers and the sheet block are in
> #621. Sections 2–7 explain the model. Section 8 is the scope table — what's
> in, what's next, what's parked, what doesn't matter.

---

## 0. The whole thing in five lines

1. **Signals, monitors, searches, newsletters — treat as gone.** Most of it
   is already off. Four wires are still live and should be cut (section 1).
2. **Market data is not news.** A price, a reported EPS, a movers list: a
   vendor, a fixed shape, arithmetic. It gets *fetched and computed*, never
   summarised, routed or stored as a "signal."
3. **There is no new entity.** The vendor is the database. What gets stored
   is what the system *did* with the data — a trigger fire with the numbers
   on it, a review, a trade.
4. **Triggers read it; discovery screens it; runs get handed it.** Same two
   vendor calls feed all three.
5. **The biggest untapped win is discovery, not alerts:** a deterministic
   *screen* — "reported this week, beat by 5%+, up 3%+ on the day, not on
   the book" — computed before any AI touches it. That is literally the
   PEAD seat's job, and today it is done by hand-writing Grok prompts.

---

## 0a. What V1 is, in the principal's words

Earnings incorporated into every feature and touchpoint where it belongs:

- **Discovery, from the chat.** "Do discovery using earnings from the last
  two weeks" → `get_earnings_calendar(window: "reported", scope:
  "universe")` → the agent reads the rows the way an analyst would (both
  lines beat and guidance up first; a profit beat on a revenue miss is
  cost, not demand; a beat the stock fell on means read the call; a miss
  is wrong-or-early) → dispatches the writer on the ones worth a thesis.
  The chat is the door. No cron, no dashboard.
- **Triggers set.** Every held and watched name carries the three earnings
  wakes as account rules; the writer knows the four kinds and when a
  thesis wants its own.
- **Triggers firing.** The 5-minute evaluator reads the calendar every
  pass; a fire carries the figures into the activity row and the tactical
  kickoff. First live fire: MU, 2026-09-27 (heads-up) and 2026-09-30.
- **Every reviewing agent** — daily, tactical, writer, chat — has the tool
  on its allowlist, knows when to call it, and carries the same playbook.
- **A person can see it** — the `/earnings` page, the stock tab, the sheet.

If any of those five is not true on a given day, V1 is not done. §8 is the
ledger.

**The extension is the same shape, per data type.** Movers (already a
pull tool; discovery input, never a trigger), SEC filings via EDGAR, and
any other structured event: one shared reader off the vendor, a page, an
agent tool, trigger kinds where the event is deterministic, and the
reading order in the prompts. Never through Signals.

---

## 1. Killing Signals cleanly — what it actually takes

You asked whether it's more than deleting monitors and turning off
newsletters. **Yes, a little.** Here is the honest state, measured today.

### Already dead (nothing to do)

| Thing | State |
|---|---|
| `firm-market-sweep`, `portfolio-watchlist-monitor`, `domain-monitor`, `signal-router` | Paused in the Inngest dashboard since 2026-05-31. Zero output since. |
| Monitors | 84 of 91 disabled. The 7 still "enabled" are driven by the paused jobs above, so they never run. |
| `read_signals` in the daily run | Removed 2026-05-31. The morning run does not read the inbox. |
| Routing | Zero routes since 2026-05-31. Every "routed signal" surface is reading an empty table. |

### Still live — cut these

| Wire | What it does today | How to cut it |
|---|---|---|
| **Newsletter webhook** (`/api/intelligence/email-ingest`) | Resend forwards every newsletter; GPT-4o-mini extracts "signals" (92 last week); it then calls the dead router **and can spawn a full daily run on any held ticker it labels BREAKING.** That spawn hasn't fired in 30 days, but it is armed and it is a real cost path. | **Cut in #625** — the route now acknowledges and drops. **Still yours: stop the forward at Resend**, or the mailbox keeps paying for delivery. |
| **Discovery prompt** hard-requires `read_signals` | "ALWAYS call read_signals" is step 1 of the discovery run. With routing dead it returns nothing and the analyst starts from an empty pool. Discovery is paused today, so it's dormant — but the day you resume it, this fires first. | **Cut in #625** — two pull tools every week, no `feeds` gate. |
| **`AgentConfig.feeds`** | A subscription dimension that routes the movers/calendar firehose into the inbox. All 3 enabled analysts have it set. It has delivered nothing since May and depends on two paused jobs. Nothing reads it any more after #625. | Delete the field, the `lib/universe/feeds.ts` enum, and the archetype defaults. A column drop — two PRs per house rule. |
| **Builder / editor "inbox" tools** (`discover_signals_for_fence`, `read_analyst_inbox_stats`) | Read the empty route table and tell the builder "no signals match this fence" — which reads as a fact about the market, not about a dead pipeline. | **Bigger than it looked.** Both prompts use these as hard rules ("watchlist tickers MUST come from `…tickerFrequency`", "if it returns 0, do NOT proceed"). Detaching is a rewrite of ~15 rule sites, not an allowlist flip. Own PR. |

### Dormant — leave until the news decision (DAV-196)

The trigger evaluator's signal path, the tactical run's signal lookup, the
earnings predicate's signal fallback, `record_thesis(source_kind:
ROUTED_SIGNAL)`, the monitor-ROI credit in the trade evaluator, the
`/intelligence` page, `Thesis.sourceSignalIds` (one live thesis cites any).
None of it runs. None of it costs. All of it is the shape a rebuilt news
layer would plug back into. Deleting it before that decision throws away the
sockets; leaving it costs nothing. **Pretend it doesn't exist** is the right
instruction — and after the four cuts above, that's literally true.

`pipeline-cleanup` (11 PM daily) is housekeeping on those tables. Harmless;
pause it or leave it.

---

## 2. The entity — what the data is and where it lives

**There isn't a stored one, deliberately.**

The data is two vendor calls, each with a fixed shape:

- **The earnings calendar** (Finnhub, one call for the whole market over a
  date window). Per company: report date, before/after the bell, EPS
  estimate, EPS actual (null until reported), revenue estimate and actual,
  fiscal quarter. Verified live: actuals land the same evening.
- **The movers lists** (FMP: top gainers, top losers, most active). Per
  stock: price, % change, volume.

Both are read *fresh* every time they're needed and held in memory for one
pass — exactly how the trigger evaluator already treats quotes. Nothing is
written to a table, because the vendor *is* the table and a local copy is
just a second one that goes stale. The Signals design got this wrong: it
summarised a number into a sentence, stored the sentence, and the number was
gone by the time anything needed it.

**What does get stored is the outcome.** A trigger that fires writes an
activity row on the thesis with the figures in it — *"Reported 2026-08-26
(after close): EPS $2.22 vs $2.14 est — beat by 3.8%. Revenue $96.22B vs
$94.01B est."* A review that results writes a review. A trade writes a trade.
The record lives where the decision lives, on the thesis, and nowhere else.

**Shown, not stored — the Earnings block on the thesis sheet (#621).** Next
report with the bell and the street estimate, and the last four quarters
as beat/miss, read live when the sheet opens — exactly how the price at the
top of the sheet works. Zero new storage.

One small exception still worth ruling on: **the next report date on the
row itself.** The sheet reads it live now, but the daily run and a
"reporting this week" list would want it without a vendor call per name.
`Thesis.catalystDate` already exists for exactly this idea (today only the
CATALYST-horizon theses use it). One write per morning, no new field.
Recommended; not done.

---

## 3. Triggers

### How the system uses it

The trigger evaluator runs every five minutes during market hours. It already
pulls a quote for every stock you cover. It now also pulls the calendar once
for the whole market, matches it against your names, and evaluates:

- **Earnings beat / miss** — reported EPS against estimate, arithmetic.
  *Built (#621).* Fires once per report, at the next open. The activity row
  carries the numbers.
- **Earnings within N days** — "MU reports in 2 days." *Built (#621).*
  Same call, one new trigger type. Fires once per approaching report, at
  the first open inside the window; the activity row carries the date,
  the bell, and the street estimate.
- **Guidance up / down, filings, news** — *cannot* be computed from a
  calendar. Parked with DAV-196. (Filings via SEC EDGAR is plausibly cheap
  and separate; not scoped here.)
- **Volume** — "trading 3× its average" — computable from the quote plus a
  daily average the system already fetches for other reasons. *Later, if
  wanted.* The lifecycle doc has flagged it before.

None of these ever trade by themselves. Every earnings-type trigger wakes an
analyst or lands in tomorrow's review; the "close it without asking" fast
path is blocked for them, correctly.

### How a trader actually uses it

The number is the *least* interesting part of an earnings event. What a
trader watches, in order:

1. **Before the print:** "I'm holding through this — am I sized for a 10%
   gap either way?" Often the answer is trim, or don't add until after. This
   is the *earnings-within-N-days* trigger, and it's the one that most
   affects buying at the right moment. Today nothing tells you it's coming.
2. **The print itself:** beat or miss, and by how much. Cheap, mechanical,
   now built. On its own it says "look," not "act."
3. **The reaction:** a beat that gaps *down* is the real information — the
   market wanted more. A miss that holds flat means it was priced in. This
   is the **daily-move trigger you already have**, and the combination is
   what matters: *beat AND down 5% on the day* → something is wrong with
   the story. Composite triggers already express that.
4. **Day two and three:** does it follow through or fade? Price triggers
   again — the trail-from-high and gain-from-entry ones.

So the trigger set for earnings is: a warning before, arithmetic on the
print, and the existing price triggers for the reaction. That's complete.
Nothing here needs news.

---

## 4. Discovery

### How the system uses it

Discovery's job is names you *don't* cover. It has two pull tools today —
`get_market_movers` and `get_earnings_calendar`, both with a "not on my
book" scope — and both work now, no pipeline required. The discovery cron is
paused by your decision; the manual run reads them fine.

What's missing is not data — it's that the analyst is handed a **firehose and
asked to triage it.** The earnings calendar for a week is ~900 names, mostly
micro-caps. The gainers list is dominated by biotech binary events and
$2 stocks. The AI spends its budget filtering noise.

**The proposal: compute the screen before the AI sees anything.** From the
same two calls, deterministically:

> Reported in the last 3 sessions · beat by ≥ 5% · revenue also beat · up
> ≥ 3% on the report day · market cap > $2B · not on any analyst's book

That list is typically 5–15 names. Hand *that* to the discovery run, not the
900. It's arithmetic, costs no AI, and it is exactly the funnel the PEAD seat
runs by hand every Wednesday and Friday via Grok prompts
(`docs/discovery-prep/2026-09-02-PEAD.md`). The same shape works for a
momentum screen (section 6).

### How a trader actually finds new names

Nobody scrolls the top-gainers list. They run a **screen with criteria** and
look at what survives:

- **Post-earnings drift:** big beat + raised guidance + gap up on volume
  that *holds*. The best-documented edge in retail-accessible trading; the
  PEAD seat exists for it.
- **Unusual volume:** a name trading 3–5× its average on no obvious news —
  someone knows something.
- **Breakouts:** new 52-week high on above-average volume, out of a base.
- **Sector rotation:** three names in one industry all moving together.

Every one of those is a filter over data you already fetch. None of them is
"read 300 headlines." The movers list is the crude raw material for the
second and third; the calendar is the raw material for the first. The
screen turns raw material into a candidate list, and the analyst's judgment
starts *there*.

---

## 5. Runs

### How the system uses it

| Run | What it gets, and when |
|---|---|
| **Daily review** | The trigger fires from yesterday, as work-list rows with the numbers on them (*built*). Proposed: one opening context line — "Reporting this week on your book: MU Tue, ABT Thu" — and the movers intersection: "2 of your names are on today's most-active list." Inputs, not alerts. |
| **Tactical run** | The kickoff message now carries the report figures for an earnings fire (*built*), so the agent starts deciding instead of starting by fetching. |
| **Discovery run** | The pre-computed screen (section 4) as its candidate pool, in place of "ALWAYS call read_signals." |
| **Thesis writer** (on a surfaced stock) | Already calls `get_earnings_data` — beat history, next date, estimates. Unchanged. |

### How an analyst updates a thesis as things happen

- **Two days before a print** (warning fires): re-read the thesis. Is the
  key assumption about to be tested? Decide hold-through / trim / wait. Set
  the floor where a bad print would break the story. This is a review, not
  a trade, most of the time.
- **Morning after a print** (beat/miss fires with numbers): re-underwrite.
  Did the assumption hold? Move the target up on a clean beat-and-raise;
  move the floor up to protect the gap; on a miss, decide whether the
  thesis is wrong or just early. Update the thesis with the new levels.
  Occasionally exit.
- **Beat but the stock is down** (composite fires): this is the one to take
  seriously. The market disagrees with the number. Read the call, check
  guidance, and either tighten or exit.
- **Between prints:** nothing earnings-related should be waking anyone.
  Price triggers carry the position.

Everything above is a `update_thesis` with new levels, which is the tool the
analysts use most already. No new verbs.

---

## 6. Movers, and catching a stock that's tracking up

Straight answer: **the movers list is a weak way to see your own stocks
moving and a decent way to find ones you don't own — but only after a
screen.**

For stocks you cover, you already have something better than any list: a
trigger on that stock's own live price, at your own threshold, five minutes
after it moves. A national top-gainers list tells you the same thing later,
and only if your name cleared an arbitrary cutoff. So: **no movers-based
triggers.** Nothing to build there.

For stocks you don't cover, the way to "see a stock tracking up and get on
it" is a **momentum screen**, computed the same way as the earnings one:

> On the gainers or most-active list · up ≥ 4% today · volume ≥ 2× average ·
> above its 50-day average · market cap > $2B · not on the book

That is the "something is happening here" list. Hand it to discovery. The
analyst's job becomes "which of these ten has a reason," not "which of these
three hundred is even a real company."

Two honest caveats. First, *tracking up* over days needs a close series
(the 5-day / 30-day moves) that the 5-minute evaluator was never given —
which is why those trigger windows were deleted. A daily screen can have it;
an intraday trigger shouldn't pretend to. Second, chasing a gainers list is
how retail loses money; the screen's thresholds (cap, volume, above-trend)
are what separate momentum from a pump. The thresholds should be yours.

---

## 7. What I am not proposing

- Any change to what earnings triggers *do* — they wake or defer, never
  trade alone.
- A stored earnings or movers table. The vendor is the store.
- News, guidance or sentiment of any kind. DAV-196.
- Movers as trigger conditions.
- Deleting the dormant Signals code. Detach it; don't demolish it.

---

## 8. The scope table

| Piece | Status | Note |
|---|---|---|
| Earnings beat / miss triggers off the calendar | **In — built, #621** | First fire 2026-09-30 (MU). |
| Fire carries the numbers into the audit row and tactical kickoff | **In — built, #621** | |
| Cut the newsletter webhook | **Done — #625** | Route is inert. **Stop the Resend forward** — that part is yours. |
| Delete `AgentConfig.feeds` | **Next — needs your go** | A deletion. Offsets #621's line count. |
| Drop `read_signals` and the `feeds` gate from discovery | **Done — #625** | Two pull tools every week. |
| Detach the builder / editor from the inbox tools | **Later, medium** | ~15 hard-rule sites across two prompts. Not an allowlist flip. |
| Earnings-within-N-days trigger | **In — built, #621** | `EARNINGS_WITHIN`, 1–14 days. In the add dialog as "Earnings". |
| Days-since-report trigger (`EARNINGS_SINCE`) | **In — built, #621** | The post-report entry window, 0–5 days. The rebuild's PEAD seat uses it. |
| Tiny estimates can't score | **In — built, #621** | Under $0.05 EPS the surprise is null in code — no trigger fires on it, no prompt has to say "ignore it". |
| Earnings block on the thesis sheet (live, not stored) | **In — built, #621** | Next report + last four quarters. |
| `/earnings` page and the stock page's Earnings tab | **In — built, #621** | Week of day boxes; a day's reporters with the figures; per-stock quarters and latest report. Live, not stored. |
| `get_earnings_calendar(window: "reported")` for the agent | **In — built, #621** | "Do discovery off this week's earnings" is one call. |
| **Earnings is not opt-in** — account rules: heads-up 3 days before, review on any beat or miss, on every held and watched name | **In — built, #621** | A standing wake, not a clock. Overridable per name; deletable in settings. Existing accounts get it once at the next morning run. |
| Thesis writer knows the earnings kinds, and when a thesis wants its own | **In — built, #621** | Never ENTER on a beat by itself. |
| The earnings playbook in the daily run and the tactical run | **In — built, #621** | Heads-up = sizing; both-lines beat → raise; EPS-beat-revenue-miss → nothing; beat-but-down → read the call; miss → wrong vs early. |
| Next report date onto the thesis row (`catalystDate`) | **Not doing** | Would be a stored copy of the calendar. The live "earnings on your book this week" line and the sheet's live block cover it. |
| Daily-run opening context: "earnings on your book this week" | **In — built, #621** | Who reports in the next 7 days, who reported in the last 3 with the figures. |
| Daily-run opening context: "on today's most-active list" | **Later, small** | One line off the movers call. |
| Post-earnings discovery screen (the PEAD funnel, computed) | **Later, medium** | Deterministic; replaces hand-written Grok prompts for that seat. |
| Momentum discovery screen (movers + volume + trend + cap) | **Later, medium** | Same shape. Thresholds are yours. |
| Volume trigger for held names | **Later, if wanted** | Cheap once a daily average is on the quote path. |
| SEC filings trigger via EDGAR | **Later, separate** | Plausibly cheap; not scoped. |
| Guidance / news / sentiment triggers | **Parked — DAV-196** | Needs a news layer. Not this. |
| Movers as trigger conditions | **Not doing** | Your own price trigger is strictly better. |
| Monitor ROI crediting, `/intelligence` page, signal fallback in the evaluator | **Dormant — leave** | Costs nothing; deletes with DAV-196's outcome. |
