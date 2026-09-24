# Discovery — the running list

> Everything the Signals session turned up 2026-09-17 → 09-22, kept whole. Each item is
> labelled for what it actually is, because the first version of this file called all of it
> "holes" and that was wrong — a lot of it is the system working, or polish.
>
> **BUG** = broken, produces a wrong result · **WORKING** = behaving as designed, listed
> because it was invisible · **POLISH** = could be better, nothing is wrong ·
> **DECISION** = needs Dave, not code
>
> **Status:** living. Delete a line when it stops being true, not when it's inconvenient.

---

## What works — verified live this week, not theory

- **Trigger → tactical run → proposal, end to end, on names discovery found.** MIRM's buy
  fired and a proposal was created; IOT's exit fired; LUXE's beat review and AIR's heads-up
  both fired the morning after they were minted.
- **The filing rule** — one review per filing, named and linked (BMRN).
- **PEAD screen → dispatch → thesis with a plan** (LUXE, 09-17).
- **The 8-K item tape** — ~25 healthcare names in 7 days, market-wide, one query.
- **Merger proxies** — 17 in 21 days with vote dates in the documents.
- **Trailing 5D/1M/6M on movers** so a shell pop reads differently from a leader (#674).
- **The 09-22 Catalyst session.** Asked for merger proxies, the agent pulled 17 filings,
  fenced to healthcare, priced four spreads and concluded *"asymmetry is inverted — this seat
  risks 10–15% to make 25–40%; merger arb collects 0.5–2.2% with 20–30% downside; these belong
  to a dedicated arb seat."* Correct answer, correct reasoning, from the playbook. The lane was
  the Signals session's bad recommendation; the agent caught it.

---

## BUG — the chart screens can never return a name  ·  DAV-300

Run live 09-21, universe scope, all four returned **zero**:

```
MA_PULLBACK     0/40   15× "not within 3% of a rising average", 15× DOWNTREND
BASE_BREAKOUT   0/40   24× "Trend Template 5/8", 10× unreadable
MOMENTUM_FLAG   0/40   16× "hasn't run: 1M +4%, 3M −2%"
EPISODIC_PIVOT  0/1    no gap
```

Their pool is the day's top 50 gainers + top 50 most-actives. The rules then ask for the
opposite kind of stock — a pullback on *light* volume, volume *drying up* in a base, a stock
that has climbed for a month and is *resting* today. A name cannot be the most active stock of
the day and quietly resting. `EPISODIC_PIVOT` has a different mismatch: its pool is earnings
reporters, so a setup meant to catch *any* repricing event only ever sees earnings ones.

Only PEAD's pool matches its own definition, which is why it's the only screen that has ever
produced a name.

Fix: a daily pass over listed US common stock computing the same `PriceStructure` the screens
already compute, stored as a summary. `computePriceStructure` exists; a daily job already
writes it per ticker for the book (`TickerIndicators`). Widening, not new machinery.

**Impact today: low.** These screens aren't in the working discovery path.

---

## BUG — fixed, waiting on a merge click

- **AIR's report date** (#681). The vendor calendar said Sep 21; AAR's own announcement said
  Sep 29. The heads-up fired for a print that wasn't happening, and because a heads-up carries
  a **30-day** cooldown, the phantom fire would also have erased the real one. The thesis's own
  date now wins when the two disagree by more than a day, both dates show on the row, and fire
  memory is keyed to the report date. MU is a clean control.
- **The chat thread that wouldn't open** (#695). Fabricated message ids were written back into
  the thread and collided on the next load. Confirmed working.

---

## BUG — two agents overwrite each other in one pass  ·  DAV-301

CYTK, 09-21, seventeen seconds apart:

```
12:08:00  THESIS_WRITER  entry $73.50 → $70.25, target → $88.31, composite 6 → 3
12:08:17  MORNING_PLAN   Removed: buy above $70.25, Removed: sell below $64
```

The run deleted the plan it had just commissioned, on a different rationale, without citing
it. Both calls defensible alone; only the deletion survives, and neither half is visible.

---

## POLISH — the agent doesn't reach for what it has  ·  DAV-302

Every tool call in the 09-22 Catalyst session reviewing five biotechs:
`get_theses ×2, get_stock_data ×4, web_search ×2`. Zero calls to `get_sec_filings`,
`get_earnings_calendar`, `get_market_movers`, `run_screen`, `get_insider_activity`.

It still reached the right conclusions — this is about sourcing quality and cost, not
correctness. The FDA is barred from publishing pending PDUFA dates, so **the company's own
8-K is the primary source**; web_search is a secondary read of it. Same shape as the AIR
error, where a secondary source beat the primary record.

Underneath it is a missing map: nothing says *PEAD → the earnings calendar*, *a dated-event
name → read the filing first*, *an 8-K announcing a PDUFA → set a catalyst date, a review N
days out, half size*. The setup catalog knows the trade; the triggers can express it; the
tools can fetch it. The routing between them doesn't exist.

Open question, not decided: does that live in the prompts, in the setup catalog as a field, or
as a skill the agent loads per setup?

---

## POLISH — the Catalyst seat has no calendar  ·  DAV-305

No vendor we hold carries FDA dates, trial readouts, AdComs, court dates or contract awards.
PEAD has Finnhub's earnings calendar; this seat has nothing equivalent and never has, which is
why its discovery is hand-scouting. That has worked for months — this is an optimization, not
a break. Filed Urgent; it shouldn't have been.

Verified reachable and free (09-22):

- **ClinicalTrials.gov v2 API** — no key. 745 industry-sponsored trials with primary
  completion Oct–Dec 2026, with sponsor, phase and date.
- **Federal Register API** — FDA advisory-committee notices, dated, weeks ahead. The
  playbook's own finding: briefing docs ~2 days pre-panel move more than the vote
  (CAPR −60–70%, REPL −30–40% *before* a +100% vote).
- **EDGAR** — 8-K item 8.01 full-text for "PDUFA" / "target action date" mines dates from the
  filing itself.

**The caveat the merger run taught us:** a dated event is not automatically this seat's trade.
Any calendar needs an event-*kind* column, and the seat filters on kind, not on "has a date."
Lanes worth keeping separate: FDA/clinical · M&A milestones · legal dockets · contract awards ·
index rebalances · investor days. Only the first is clearly in-mandate.

---

## WORKING — four different states, one word on screen

Catalyst holds nothing against five watched names. Every reason is correct behaviour; none of
it is visible:

- **MIRM** — the buy fired 09-16 and 09-17, a proposal was created, and it **expired on 09-18
  without a decision**. The run then removed the level on 09-21, correctly: five days from the
  event is inside the seat's do-not-enter window. Reads as "no plan"; actually "you were asked
  and the clock ran out."
- **PRAX** — plan written and armed, but the composite is 3/10 against a 5.0 minimum, so a fill
  would be rejected even if the level fired. The gate is doing its job.
- **BMRN** — catalyst is Feb 2027. Correctly parked.
- **CYTK** — see DAV-301.

"Watching" covers armed, blocked, parked and expired, and the UI shows one word for all four.

---

## WORKING — an entry the portfolio can't take is invisible  ·  DAV-286

The Compounder is 4 of 4. ISRG's buy validated and was refused twice; ETN's the same. The cap
is correct; the refusal lives only inside a rationale string.

---

## POLISH — thesis history has no surface

Everything in the two sections above is recorded in `ThesisUpdate` and rendered nowhere. Every
fire, every proposal and its outcome, every level change and who made it. Cheapest high-value
UI work available.

---

## Screen mechanics worth knowing before trusting output

- **First failure wins** — a rejected name shows one reason, not all of them.
- **Pool cap 40**, silent about which names were skipped.
- **The $5 floor applies only to the movers pool**, not the calendar pool — which is why VRA
  ($97M) passed the screen and was then rejected by the seat's own $200M floor.
- **`run_screen` ignores the analyst's configured setups.** Each seat has a list (PEAD:
  PEAD/EPISODIC_PIVOT/MA_PULLBACK · Catalyst: PRE_CATALYST/BASE_BREAKOUT/MA_PULLBACK ·
  Compounder: COMPOUNDER_ACCUMULATION/BASE_BREAKOUT/MA_PULLBACK) and the tool reads none of it.
  The primary setup of both Catalyst and Compounder has no screen at all.
- **Stale comment** in `setups.ts` under PRE_CATALYST: "no trigger kind reads a catalyst date
  yet." One does now — the event-anchored day count fired on MIRM 09-18.

---

## DECISION — needs Dave

1. **The Compounder is 4 of 4 and blocking two armed buys.** Raise the cap or sell something.
2. Should a dated event that isn't the seat's trade shape (merger arb) be sourced at all, or
   should the fence exclude the event kind outright?
3. Where does the routing knowledge live — prompts, setup catalog, or a skill?
4. Is a fourth seat wanted for the lanes the current three reject? The lineup doc says the
   slot is deliberately open.
