# Real opinions: where the thesis data stands, who writes what, and how we get to a trader that forms opinions

Written 2026-11-03 by the QB session. The owner's framing, in my words: the
app's architecture is rebuilt, but the product never looped back to the
point, which is finding and reviewing stocks that make money. Stocks move
on an opinion about the business and how the market will react to it, not
on chart numbers. Setups are patterns worth recognising, but the research
behind a Sandisk, a Moderna, a Workday, a ServiceNow or an HP is a view on
the business that someone formed from public information before the move.
The agents must do that kind of research, keep reviewing the view, and act
on it. Two horizons: one-to-six-month holds for 30 to 100 percent, and
one-to-seven-day swings for 5 to 15 percent.

This doc is the plan for that, in four parts: what is built and true today,
the formula for who writes what at each stage of a stock's life, the list
that closes out the data work, and the path to real opinions.

## 1. What is true on 2026-11-03

**Built this week (#909 to #919).** Every thesis carries a company line,
the belief, the assumptions, what would prove it wrong, a bull case and a
bear case, a conviction tier with its reason, the variant view (what the
Street thinks against what the analyst thinks), the setup, the score and
the triggers. The street's numbers (targets, EPS consensus) land in
`StreetConsensus` every morning from Nasdaq's free feed, and for a new
stock on demand. Every review line carries a verdict on the belief and
the rule it answered, and its title says what kind of review it was.
Seventeen situations each say what the note is for that situation
(`lib/agent/situations.ts`). One Activity list: the Overview shows the
newest eight lines and the next run reads the same eight.

**The first write-up in the new shape: SNDK, 2026-11-03 evening.** The
owner's chat named the PEAD Specialist, the Writer ran, and it passed.
Read against the Writer's own bar:

| Field | The bar | SNDK |
|---|---|---|
| Company | two sentences: what it does, how it makes money | met (the second sentence carries a dated clause about AI demand; the line is meant to change only when the business changes) |
| Belief | why we would own it, what has to stay true; no price path, target or date | met; it says the stock "deserves a watchlist position" |
| Assumptions | two to four, each with the number and when and where it is checked | met: gross margin and revenue against the guide, at the January report |
| What proves it wrong | a reading and where it is read, never a price alone | met: EPS below the raised midpoint at the January report; a second peer confirming price declines |
| Conviction reason | why this tier | met; it says "watching without enthusiasm" |
| Variant view | the Street's view against the analyst's | met, and it is a real opinion: the cycle risk is nearer than the Street allows, from Kioxia's flat-pricing warning and the consumer revenue drop |
| Street numbers | present for a new name | one row, the day of the dispatch |
| The first Activity line | company and stock first, then the call, one paragraph | met: the beat, the gap down on it, the peer warning, the pass, and when it would look again |

**The one gap the read found.** The write-up says watch (the belief, the
conviction reason, and a closing "I would look again if it bases above the
200-day or if January confirms pricing held"), but the call is PASS, which
stores no trigger and wakes nobody. The Writer's own rule says a view that
is not ready to price is a level, not a pass. The decision came from the
setup score (no drift entry, chart broken), not from the opinion, and the
opinion was thrown away with it. The same thing the 11-02 Sandisk study
found at the bottom of the cycle: the business view existed in public, the
chart screen never saw it. Fix: a failing case from this run's recorded
input, then whatever makes the Writer write the re-look as a watch with
its wake. No gate.

**The 31 live theses, from production.** All were written under the old
Writer (research dated 2026-09-02 to 10-30). Thirty of 31 have a belief,
assumptions, invalidations, bull, bear, conviction reason and variant view;
none has the company line, because only the Writer writes it. Two CRWD
rows sit on watch at once (an old TRADE seed from 08-30 under the 10-02
one). ASML and ETN have no plan and no review clock, so nothing wakes
them. These are the rewrite's job and the app's, never a hand fix.

## 2. The formula: who writes what, stage by stage

The rules, one sentence each:

1. The Writer owns the claim (company, belief, assumptions, what proves it
   wrong, bull, bear, score, variant view); a review never rewrites it; a
   refresh does, through the same Writer.
2. Every wake of a stock ends in one note, written by its situation's
   rule: what is going on with the company and the stock and why, what it
   means for why we own or watch it, one sentence of what was done.
3. A review carries a verdict on the belief and names the line it answers;
   no code acts on the verdict, the analyst does, in the same run.
4. Triggers change one at a time, each its own Activity line; a plan level
   is a trigger.
5. The note a run writes on a stock is the trade's reason; one paragraph
   per trade.
6. The next run reads the newest eight Activity lines, the same eight the
   Overview shows.

| Stage | What wakes it | Who writes | What is written |
|---|---|---|---|
| Dispatch | the owner's chat (a new name, or "refresh X") | the Writer | the claim and the plan: buy, target, floor as triggers, a review clock; its rationale is the stock's first Activity line. A PASS stores the reasons and ends there |
| Watch | the clock, a buy level crossed, a report, a filing, the research going stale, a problem in the plan | the morning run or a trigger run | one note by the situation; a buy proposal when the level arrives; a refresh through the Writer when the research is stale or the stock was quiet a long time |
| Buy | the buy trigger's crossing | the trigger run | the proposal, with the run's note as its reason; the fill flips the row to HOLDING and the stop-on-buy floor goes under it |
| Hold | a protective fire, a winner's add or floor move, a report (the bar before, the answer after), a filing, the clock, the owner's unanswered word, an Auto trade | the trigger run or the morning run | one note by the situation; a trim, add, floor move or sale proposal with that note as its reason |
| Sell | a protective fire or the review's call | the trigger run or the morning run | the sale proposal and its reason; approval retires the row as SOLD |
| After the sale | the one look within two weeks | the morning run | what the stock did since, whether the belief survived; back on watch with a wake, or let go |

**What the formula still lacks.**

- A pass with a re-look has no wake (SNDK above).
- The refresh after each report is not built. It needs the last report
  date; Finnhub's earnings calendar asked by symbol alone returns the last
  report, so a source exists.
- A "weaker" or "broken" verdict on a watched stock leads nowhere by
  itself; the analyst must also refresh or pass in the same run. Watch
  Wednesday's morning notes for whether it does.

## 3. Closing out the data work

In order:

1. Read SNDK against the bar: done above.
2. Wednesday 2026-11-05 after 08:00 ET: the first morning run under the
   new rules. Read for verdicts on morning lines, "Scheduled review"
   titles, and whether the conviction reason and variant view on the
   morning row changed any decision (if not, trim them from that row).
3. The one-time rewrite of the 31 live theses through the Writer's
   refresh: three first, priced from the Writer's usage, then the rest.
   This fills the company line and brings every assumption to "the number,
   when and where it is checked".
4. The Writer writes a re-look as a watch (the SNDK case), with a failing
   case first.
5. Drop the seven old research columns, two PRs (code first, DROP second).
6. The refresh-after-each-report rule, from the Finnhub last-report date.
7. The two hygiene items (duplicate watch rows; a watch with no plan and
   no clock) as app fixes with a regression test each.

## 4. The path to real opinions

The 11-02 Sandisk pass showed the shape: the reason it ran (a NAND price
upcycle on AI storage demand, one pure-play ticker, estimates lagging) was
knowable from public information for most of a year, restated by the
company each quarter, and raised by the Street's estimates before the
targets. The app's discovery score was almost all chart (trend 3, strength
3, entry 2, catalyst 2 of 10 points), so the Writer only ever saw chart
winners, and the Writer could not read estimate revisions, consensus
numbers, transcripts or industry pricing.

**Step A. Seven stock studies, one template, no code.** Sandisk, Moderna,
Workday, ServiceNow, HP, and two that looked the same at the start and
went nowhere. For each, from public sources with dates:

1. The day the reason became knowable from public information, and the
   price that day.
2. What the stock did over the next week, month and three months.
3. Which data carried the reason: an industry price, a guide, a filing, an
   estimate change, a person's post.
4. Who said it publicly first, and what they were reading.
5. What the three analysts and the Writer could have seen that day with
   today's tools.

The two losers matter as much as the winners; without them the list only
says what winners look like after the fact. The QB does the studies with
web search and the app's own history, about a week, no subagents.

**Step B. The output is a short list of situations in plain words**, each
with the data it needs and the question an agent should ask. That list
decides what to add, what the Writer reads before it writes, and what the
morning asks.

**Step C. From the list: the data, the Writer's reading, the morning
question.** Decide buy, scrape or skip per item then, not before. The
street feed already covers targets, EPS consensus and revisions; the
likely gaps are industry prices, transcripts and estimate history.

**Step D. Build.** The research question on a clock (the schedules
framework from the architecture plan: any prompt on any clock through the
same door, with a list of handles as one input), discovery rebuilt as one
of those schedules, the Writer's reading list, and the reviews grading
each assumption on its date. The "any prompt on any clock" spec stays
unapproved until the studies say what the question is.

**Step E. Measure.** A month of the book under it, scored the way the
studies were: did the system name the situation before the move.

**The horizons.** The one-to-six-month hold is where these moves live and
where the app fits. The one-to-seven-day swing is a clock problem before it
is a research problem: one run a day, a proposal that expires in about a
day, and the owner as the click. Build the long one first.

## 5. For the owner to decide

1. A pass that names a re-look: stored as a watch with that wake, or left
   as a pass. The plan says a watch.
2. The rewrite of the 31: now, or after Wednesday's morning run is read.
3. The seven names for the studies, and the go.
