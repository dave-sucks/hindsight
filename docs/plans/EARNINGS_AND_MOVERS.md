# Earnings and Movers — where the market data you already pay for belongs

> **What this is.** A recommendation for how the earnings calendar and the
> market-movers lists should feed daily runs, tactical runs, triggers and
> discovery. Written 2026-09-02 at the principal's direction, off DAV-196;
> revised 2026-09-09 after review (counts re-measured, shipped half rebased).
>
> **What this is not.** A signals decision. Nothing here rebuilds news
> routing, and nothing here needs the router turned back on. DAV-196 stays
> the open question it is.
>
> **Status:** sections 1–4 await the principal's ruling. Section 5 is built —
> it is the cheap half the principal already asked for.

---

## 1. What I found when I looked

Three facts, all measured against production on 2026-09-02.

**The earnings and movers feeds are dead at the source, not just unrouted.**
`firm-market-sweep` — the job that writes the daily earnings-calendar and
market-movers rows — was paused in the Inngest dashboard on 2026-05-31 along
with the router. Its last output was 2026-05-30. So the picture in DAV-196 is
actually one step worse than described: turning the router back on would not
restore either feed, because nothing is producing them.

**Every signal in the last 30 days came from your email inbox.** 504 signals,
all of them ingested from newsletters. Zero from any market-data job. 138 are
tagged EARNINGS, and **not one of them carries a surprise number** — the field
the earnings triggers read is empty on every row. So even a fully restored
router would not have fired a single earnings trigger. That break is
independent of the pause, and it is the strongest argument for the change in
section 2.

**Every earnings trigger on the book has never fired once.** 49 of them across
25 stocks as of 2026-09-09, all with an empty "last fired" stamp — not stale,
never. All but one are REVIEW (a look, not a trade); the exception is an EXIT
(MU, sell on any miss).

Treat that count as a snapshot, not a constant: it read 57 across 30 on
2026-09-02 and 51 across 26 on the 3rd. The ladders get rewritten often enough
that any specific figure ages within days — the writer refresh drops and
re-authors them as it re-underwrites names. What doesn't move is the zero.

One thing in DAV-196 has already been fixed since it was written: GEV's buy
trigger is now a real price level ($875), not an earnings condition. There are
no buy-on-earnings triggers left on the book.

---

## 2. The recommendation, in one line

**Stop treating market data as news.** Read the earnings calendar and the
movers lists directly, the same way price quotes are already read. Leave the
signals pipeline to the thing it is actually for — unstructured news — and
leave that decision parked where it is.

The reasoning is short. A price quote is a number from a vendor with a fixed
shape, so the trigger evaluator fetches it and does arithmetic on it. Earnings
actuals and movers lists are exactly the same kind of thing: a vendor, a fixed
shape, arithmetic. Routing them through signals means a job has to summarise
them into a text row, a router has to score that row for relevance, and a
trigger has to hope the summariser remembered to attach the number. That last
hop is where all 138 earnings signals lost their surprise figure. The
pipeline was never the right shape for this data; it is the right shape for a
newsletter.

This also removes a dependency, which is the point. Today "can my earnings
triggers fire?" is blocked on a design session about news. After this, it
isn't.

---

## 3. Where each one belongs

### Earnings calendar → triggers, directly

The evaluator gains an earnings side next to its price side. Every five
minutes during market hours it already fetches quotes for every stock you
cover; it now also makes **one** call for the whole firm's recent earnings and
matches it against your names. Beat and miss become arithmetic — reported EPS
against the estimate — with no signal in the middle.

Cost is negligible: one extra vendor call per check, 18KB, against the 200
quote calls that check already makes.

This is section 5. It is built.

### Earnings calendar → don't get blindsided by your own stock

The second half of the earnings job, and the one that most affects *buying at
the right moment*: a stock you hold or are about to buy should never walk into
its own report unnoticed. Knowing the print is two days out is often the whole
decision — you size smaller, or you wait until Thursday.

This wants one new trigger type, "earnings within N days", read off the same
single calendar call section 5 already makes. It is genuinely cheap on the
back of that work.

**Not built — awaiting your ruling.** It is a new trigger type, and adding one
is exactly the kind of thing you have told me to justify before doing rather
than after.

### Movers → discovery and the daily run, never triggers

Movers should not become a trigger condition, and I recommend against wiring
them that way.

A trigger asks "did *this stock* do something?" — and for stocks you already
cover, the daily-move trigger answers that better than a movers list does. It
reads your stock's own live quote, at your own threshold, five minutes after
it happens. A top-gainers list would tell you the same thing later and only if
your name cleared an arbitrary national cutoff.

What movers genuinely add is the opposite: **names you don't cover yet.** That
is a candidate generator, and candidate generators belong in two places —

- **Discovery**, asking "what moved that I have no opinion on?" The pull tool
  already does this today (`scope: "universe"`).
- **The daily run's opening context**, as a line of fact: "3 of your stocks
  are on today's most-active list." An input the analyst reads, not an alert
  that wakes anything up.

Both are pull, both are cheap, both work right now.

### The subscription feeds → delete them

`AgentConfig.feeds` is a third way to get the same movers and calendar data:
subscribe an analyst and the whole firehose routes into their inbox. I
recommend deleting that path for `MARKET_MOVERS_*` and `EARNINGS_CALENDAR`
rather than reviving it.

It has produced nothing since May. It depends on both paused jobs. And the two
other ways of getting this data are better at it — the pull tools are fenced
and on-demand, and section 5 gives the triggers the numbers directly. Keeping
a third path alive means keeping a producer, a router hop and a config
dimension running to deliver data that arrives two better ways.

This is a deletion, so it is your call, not mine.

---

## 4. What I am not proposing

- **No change to how earnings triggers act.** They stay judgment calls that
  wake an analyst — the "close it without asking" fast path is already blocked
  for earnings conditions, correctly. Buying or selling a gap on arithmetic
  alone is not something I would wire up.
- **No news, guidance or filings.** Guidance changes and news triggers stay
  parked with DAV-196; there is no way to compute either from a calendar. SEC
  filings are plausibly a second cheap one via EDGAR, but that is its own
  piece of work and I have not scoped it here.
- **No sweep of the remaining dead triggers.** After section 5, guidance (15),
  filings (12) and news (12) are still inert — 39 as of 2026-09-09. They are
  harmless, and clearing them before the news decision would throw away the
  record of what the analysts actually wanted to watch.

---

## 5. What shipped (the cheap half)

Earnings triggers now evaluate off the calendar and reported results. No
signal required, no router required.

**How it works.** During market hours, each check pulls the last three days of
the firm-wide earnings calendar in one call, keeps the rows that have a
reported EPS, and computes the surprise: `(actual − estimate) ÷ |estimate|`.
Any stock you cover that reported gets that number attached, and its earnings
triggers evaluate against it.

**Why it can't fire twice for one report.** Every one of these triggers has a
7-day cooldown; the lookback is 3 days. A report is visible for at most three
checks and only the first one fires. Three days rather than one so a Friday
after-close report is still caught on Monday.

**Timing.** Reports land before the open or after the close, so the fire lands
at the next open — which is the first moment you could act on it anyway.

**What it turns on.** Every earnings trigger on the book (49 across 25 stocks
on 2026-09-09). All but one are REVIEW, which means they write a note and the
next morning's run handles them in batch — no per-trigger AI cost. The one
exception (MU, sell on any miss) wakes a tactical run and produces a proposal
for your approval.

**The first one to fire will be MU, on 2026-09-30 after the close.** Nothing
else on the book reports before then; ABT is next on 10-13. So the first live
exercise of this code is also the one trigger worth editing first — see below.

**One temporary duplication.** These two predicates now have two sources: the
calendar (what fires them) and a routed signal (what used to). The signal
branch is three lines and stays only so a restored router keeps working. When
DAV-196 is decided it should be deleted, not kept — one predicate, one source.

**One thing worth your eye:** MU's sell trigger has no minimum — *any* miss,
however small, proposes closing the position. Missing by a cent reads the same
to it as missing by 20%. That was harmless while it could never fire; it can
fire now, and MU reports 2026-09-30. I have left it exactly as you wrote it —
setting the number is your edit, not mine.

It also carries no cooldown, so it matches on every five-minute tick for the
three sessions the report stays in the window. That costs no AI: once a sell
proposal is open, the tactical runner bails before the agent rather than
re-proposing. It does emit an event each tick, which is noise rather than
spend. A minimum on the trigger fixes both.

**If the vendor call fails**, price triggers evaluate as normal and the
earnings side is skipped for that check with a log line. A dropped call means
a delayed look, never a blocked stop.
