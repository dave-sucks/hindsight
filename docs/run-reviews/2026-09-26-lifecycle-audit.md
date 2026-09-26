# Lifecycle audit — every situation a stock can be in

> **What this is.** A walk through the twelve situations a stock passes
> through, each answered four ways: what a real trader does, what our own
> docs promise, what the system actually did on the real stocks in that
> situation in the last 15 trading days, and where the gaps are.
>
> **Window:** 2026-09-05 → 2026-09-26. **Book at the time of writing:** 6 open
> positions (MU, NVDA · PEAD; ABT, ASML, CEG, WST · Compounder), 29 watched,
> 0 held by the Catalyst Event PM. **Data:** production, read 2026-09-26
> 08:12 UTC. Every claim below names a row. Where the answer is "I could not
> observe it," it says so instead of guessing.
>
> **Reading note on times.** Stored timestamps are UTC. ET is UTC−4. The
> morning run starts 12:00 UTC (08:00 ET) Mon/Wed/Fri. Today's run had not
> started when this was written.
>
> **Fix nothing here.** This is the finding document; one ticket per hole.

---

## The short version

Four things work well enough to say so: the ladder fires when it should, the
audit trail is complete, protective sales are labelled and proposed within
minutes, and the double-fire that used to send two proposals in one minute
stopped after 2026-09-17.

Three things are structurally broken, and all three have the same shape —
**a rule is enforced where a thing is created and nowhere else, so the edit
path walks straight through it:**

1. **21 of 29 watched stocks cannot be bought.** They have no entry trigger.
   The mint gate requires one; `update_thesis` removes it freely; the
   `NOTHING_CAN_WAKE` check passes them because they still have a review
   clock. They wake, get reviewed, and can never become a position.
2. **A declined sale is never re-decided.** IOT asked five times over nine
   days, was declined four, and sold 5.0% lower than the first ask. The
   morning runs in between added unrelated triggers and never touched the
   level that had been refused.
3. **Analyst and account rules are frozen as copies on the holdings.** Five
   of six holdings carry `source: DEFAULT` copies of rules that live above
   them. Changing the Compounder's trail would not reach ABT.

Measured cost of #2 on two names in ten days: **about $624** (IOT ~$476,
FIVE ~$148). Both were paper.

---

## A. A held stock whose sell line hit and Dave declined or let it expire

**1. What a real trader does.** A stop is a decision made in advance. If you
override it, you have changed your mind about the trade, and the next thing
you do is re-set the level — to a new structure you can name, or to none at
all, accepting you now hold it without a floor. You do not leave a line
standing that you have already refused. Playbook E2.4: on a held position the
stop only rises, and standard raises are named.

**2. What the docs promise.**
- `TRIGGERS.md` §5: *"A protective or review rung is a **standing order**
  (principal ruling 2026-08-16): it fires every day its condition is true, and
  a declined or expired proposal means 'did nothing today', so it asks again
  tomorrow."*
- `THESIS_GAME_PLAN.md` non-negotiables: *"A proposal expiring unclicked can
  be a deliberate hold (MU 7/07) — that is the system working, not a bug."*
- `THESIS_GAME_PLAN.md` §4, Moment 3: *"'Reviewed — no changes' is
  structurally rejected on a holding whose floor doesn't reflect its gain."*

So the docs promise the re-ask. **Nothing in any doc promises that the level
gets re-decided after a decline.** That is the hole, and it is a hole in the
design, not only in the code.

**3. What actually happened.**

**IOT** — bought 09-14 at $39.83, 230 shares. Dave set the stop to $41.40
himself on 09-15 18:01 and set it to fire automatically.

| Date | Fired at | Dave |
|---|---|---|
| 09-16 19:15 | $41.39 | rejected — *"its moving here and there. Im gonna see if theres any chance it picks back up."* |
| 09-17 19:15 | $40.20 | expired |
| 09-21 17:30 | $39.56 | expired |
| 09-23 17:40 | $38.82 | expired |
| 09-25 17:45 | $39.83 | **approved — sold $39.32, −$116** |

Between the asks there were morning runs on 09-16, 09-18, 09-21, 09-23, 09-25.
What they decided: 09-21 16:00 *"Added: review every 60 days, Added: Any
earnings beat and price down 3% today → review."* Two new triggers. **The
$41.40 line that had been refused twice by then was not touched, discussed or
re-priced by any of the five runs.** First ask $41.39, sale $39.32 — **5.0%
worse, about $476.**

**FIVE** — 09-23 16:01 the morning run tightened the stop $226.80 → $229.90.
At 17:35 the same day the new line fired at $226.08; the proposal expired
09-24 18:00. The 09-25 run wrote `fieldChanges: {}` — nothing. Sold 09-25 at
$219.935, −$675. First ask $226.08, sale $219.94 — **2.7% worse, about $148.**

**MU** — four asks in three days (09-14 ×2, 09-15, 09-16) on the 8%-off-the-high
trail. Rejected 09-17 with *"Look at that rebound!!! Why does it keep
triggering"*. The loop ended on **09-18 at 05:13 UTC — 1:13 AM ET — when Dave
deleted the trigger by hand.** He did the same to NVDA, FIVE, SMMT and IOT in
the same minute, and to ASML, CEG and WST three days earlier at 02:29 ET.

**NVDA** — three asks (09-14, 09-15, 09-16), all on the same trail, ended the
same way: deleted by hand at 1:13 AM.

**4. The holes.**
- **2→3:** the standing order is working exactly as documented. What is
  missing is any record that a decline happened. The next run cannot see it,
  so it cannot act on it. The only tool that ended any of these loops was
  Dave deleting the trigger at one in the morning.
- **1→2:** the doc frames a decline as "did nothing." A trader's decline is
  *information* — it says the level is wrong. Treating it as a no-op is the
  design error, and it is upstream of the code.

---

## B. A held stock moving up

**1. What a real trader does.** Raise the stop to breakeven at +1R; trail
under a moving average once the trend is established; lock roughly half the
gain past +20%; add only on strength and raise the floor with every add; take
a partial where the setup says to (playbook E2.4, E5, D1).

**2. What the docs promise.** `THESIS_GAME_PLAN.md` §2: *"The Ratchet
Invariant (the IONS rule). A holding's floor only moves up, and must always be
justified by the gain already earned."* §4 Moment 2: *"every add raises the
floor, every fired checkpoint gets replaced by the next one."*

**3. What actually happened.**

| Stock | Entry | Peak | Peak gain | Floor now | Floor locks |
|---|---|---|---|---|---|
| MU | $895.94 | $1,091.66 (09-23) | +21.8% | $1,041 | **+16.2%** |
| CEG | $276.90 | $303.40 (09-08) | +9.6% | $220 hard, 25% trail ⇒ ~$227.55 | −17.8% |
| NVDA | $218.23 | $234.18 (09-04) | +7.3% | $200.15 | −8.3% |
| WST | $355.28 | $381.68 (09-24) | +7.4% | $330 | −7.1% |
| ASML | $1,716.09 | $1,774.17 (09-08) | +3.4% | $1,580 | −7.9% |
| ABT | $103.66 | $104.23 (09-22) | +0.5% | $96 | −7.4% |

**MU is the system working.** Its floor was raised four times — $948.17
(09-04), $969 (09-07), then $1,041 on 09-23 with the audit line *"Stop $969 →
$1,041 (tightened)"*. The +15% checkpoint fired 09-08 and 09-21 and the
09-23 run acted on it. It also carries a partial at $1,150 and a review at
$1,100 that fired 09-25. **This is the IONS replay passing.**

No other holding has been up 10%, so no other floor was owed a raise. **B is
not broken.** CEG at +9.6% peak is the closest call and sits just under its
seat's +15% checkpoint.

**4. The holes.** One, and it is narrow: CEG's hard stop is still the day-one
$220 while the position is 20 sessions old and has been up 9.6%. Nothing is
wrong by the rules as written — the Compounder's 25% trail is the governing
floor and it does ratchet. Worth knowing, not a ticket.

---

## C. A held stock moving down but above its line

**1. What a real trader does.** Watch whether the reason for owning it is
still true. A close below the 200-day on a compounder is a review, not a sale
(playbook D11, E5). If the review keeps returning "nothing changed," the
honest move is to say so once and lengthen the clock — not to re-ask daily.

**2. What the docs promise.** `TRIGGERS.md` §2a — Secular Compounder:
*"below the 200-day → REVIEW."* `THESIS_GAME_PLAN.md` §4: the daily run is the
auditor and *"the review either patches the ladder or explicitly attests why
not."*

**3. What actually happened.**

**ABT** — bought 09-11 at $103.66. *"Price below the 200-day — review"* has
fired **every single trading day since 09-15**: 09-15, 16, 17, 18, 21, 22, 23,
24, 25. Nine consecutive fires, every one *"deferred to the next daily
review."* What the reviews wrote:

| Morning run | fieldChanges |
|---|---|
| 09-16 | `{}` |
| 09-18 | added a 10-day review |
| 09-21 | `{}` |
| 09-23 | `{}` |
| 09-25 | `{}` |

**Five of six reviews changed nothing at all, while the condition that woke
them was true the whole time.** No attestation was written; `{}` is not an
attestation.

**WST** — no protective fires in the window; reviewed 09-21, nothing to
report. Correct behaviour for a quiet name.

**4. The holes.**
- **2→3:** the "patch or attest" gate is real but only for
  `UNPROTECTED_GAIN`, which needs a *gain*. A holding that is **down** can
  rubber-stamp forever. ABT did, nine times.
- **1→2:** "below the 200-day" is a structural condition that stays true for
  weeks, modelled as a standing order with a one-day cooldown. It nags daily
  by construction. A trader reviews that once and sets a date. No doc
  distinguishes a *state* from an *event*.

---

## D. A held stock going nowhere

**1. What a real trader does.** Time is a cost. Breakouts get 10–20 sessions,
PEAD 30–60 days, compounders a 60-day business checkpoint (playbook E6). No
progress in the window is itself the answer.

**2. What the docs promise.** `TRIGGERS.md` §2a on `REVIEW_CADENCE from:BUY`
— *"the playbook's time limits: 'sell 20 days after the buy if still held'."*
`AGENT_REBUILD.md` §2.4: *"Setup-aware review. A held name's review runs its
setup's checklist: the trail rule, the time limit, the partial-profit rung,
the beat-and-fade rule, the 60-day business checkpoint."*

**3. What actually happened.** The least-moved holding is **ABT**: +0.5% at
its peak, 11 sessions held. It carries `REVIEW_CADENCE 10 from BUY`, which
fired 09-21 17:40 — *"10 days after the buy — review — deferred to the next
daily review."* The 09-23 morning run that received it wrote `fieldChanges:
{}`.

So the time limit **exists, is correctly counted in sessions-to-calendar-days,
and fired on schedule.** The machinery is right. The review that received it
did nothing and left no sentence saying why.

**4. The holes.** Same as C: the time limit's fire has no answer obligation.
A `from:BUY` review that fires and produces `{}` is indistinguishable from one
that never fired. Not a separate ticket — it is the same missing "a review
that changes nothing must say what it checked."

---

## E. A held stock whose thesis broke without the price breaking

**1. What a real trader does.** Sells. A named invalidation is the only thing
that sells a compounder (playbook F). The trip-wires are written in advance
precisely so this is not a judgment call in the moment.

**2. What the docs promise.** `THESIS_ARCHITECTURE.md` §8 requires ≥2
`invalidationConds` on every LONG/SHORT thesis, and the trade evaluator
*"grades against the BELIEF: did each keyAssumption hold? Did any
invalidationCondition come true?"* — but only **after** the position closes.

**3. What actually happened.** **It has not happened in this window** — no
holding was retired for a broken story while its price held. The closest
thing: **PBH**, retired 09-25 with *"PBH still has no valid PEAD edge. At
$45.65 it remains below…"* — but the price had already broken (stopped out
09-11 at $46.99, −$802). The story-check came after the price-check, not
before.

**How would the system know?** It would not, on price data alone. Checking an
invalidation condition requires reading something — a filing, a guidance
change, a transcript. Two rules exist to wake that read (`SEC_EVENT` on the
account, and the Catalyst PM's own) and both fired in the window (FIVE 09-24,
AIR 09-24, SMMT 09-18). Every one was *"deferred to the next daily review,"*
and **the agent cannot open a filing** — the instruction to read one is not
executable today. That is already an open ticket.

**4. The holes.**
- **2→3:** invalidation conditions are written at mint, required by a gate,
  and then **read by nothing until the position is already closed.** No run
  walks them. There is no `invalidation` line in any review's output.
- **1→2:** the docs never say who checks the trip-wires or when. §4's
  scenario F ("Daily run finds $NVDA view broken") assumes it happens; no
  prompt, tool or flag makes it happen.

---

## F. A watched stock whose buy level never came

**1. What a real trader does.** Re-prices after about 20 sessions, or lets it
go. Playbook E6: *"A buy level that hasn't filled — re-price after 20 trading
days; a level parked for four months is a decision nobody made."* Raising a
buy level above the price to avoid buying is a rule violation, not a judgment.

**2. What the docs promise.** `AGENT_REBUILD.md` §2.4: *"'Retune' survives
only as an explicit re-priced condition citing the chart… never a level moved
above the price to avoid buying. **No refusal.** A buy level raised above the
price without a cited structure arrives the next day as a plan-sanity flag,
`ENTRY_RAISED_AWAY`."* Plus `ENTRY_STALE` at 20 unfilled sessions.

**3. What actually happened.** Both flags exist in `plan-sanity.ts`. What the
named stocks did:

| Stock | Buy trigger now | What happened |
|---|---|---|
| **MSFT** | **none** | Fired $497 on 09-11 → tactical run wrote *"Updated MSFT thesis"*, no buy. 09-14 morning run: *"Removed: buy above $497, Removed: sell below $448, Removed: review above $600."* |
| GEV | `VS_SMA` | 09-14: *"Removed: buy below $875, Removed: sell below $690, Removed: review above $1300"* — replaced with a moving-average entry. |
| **ETN** | **none** | Fired $418 on 09-14 → *"Updated ETN thesis"*, no buy. Entry since removed. |
| **BWXT** | `PRICE_ABOVE 148` | Live. Stop lowered $145 → $142 on 09-14; *"Price below $150 — review"* fired same day. |
| NOW | `PRICE_BELOW 130` | Live, untouched in the window. |
| **GD** | `VS_SMA` | Live. |
| **SYK** | `VS_SMA` | Live. |
| PLTR | `PRICE_ABOVE 192.75` | See G. |

**MSFT is the endpoint of the pattern the ticket describes.** Six fires and
six raises in August became, on 09-14, deletion of the entire plan. It is
today a HIGH-conviction LONG COMPOUNDER thesis with **no entry, no stop, no
target** and a 30-day review clock. Nothing flags it. It will be reviewed
monthly forever and can never be bought.

**4. The holes.**
- **2→3:** `ENTRY_RAISED_AWAY` and `ENTRY_STALE` both only exist for a thesis
  that *has* an entry price. The escape hatch the agent actually uses is not
  raising the level — it is **deleting it**, which every flag is blind to.
  The MSFT pattern did not become loud. It became invisible.
- **1→2:** the docs treat "set the plan down" as a legitimate terminal move
  for a fired buy (§2.4, "or set the plan down with a reason"). They never say
  the stock must then either leave the watchlist or get a new plan. So the
  legal move produces a permanent zombie and no doc calls that wrong.

---

## G. A watched stock whose buy level hit and no buy happened

**1. What a real trader does.** Buys, or writes down why not, that day.

**2. What the docs promise.** `AGENT_REBUILD.md` §2.4: *"**Fired buy = a
decision.** Two answers: `place_trade`, or set the plan down with a reason."*
And §5's acceptance proof: *"a run with a fired ENTER either proposes or sets
down."*

**3. What actually happened.** **PLTR, 2026-09-25 17:40 UTC** —
`TRIGGER_FIRED: "Price above $192.75 — consider entry"`, the tactical run
woke, and the only thing it wrote was `UPDATED — "Updated PLTR thesis"` with
no field changes. **There is no Order row for PLTR in the last 32 days.** No
proposal reached Dave. Neither of the two allowed answers happened.

**What happens the next day: I cannot observe it yet.** It is 04:12 ET on
09-26 and the morning run starts at 08:00 ET. What I *can* state is what it
will be handed: PLTR's buy trigger is unchanged at `PRICE_ABOVE 192.75`, and
because the trigger fired and the plan was neither taken nor set down, the
`BUY_FIRED_UNANSWERED` flag should surface it. That flag shipped four days
ago and **this is its first live test.** Whether it fires is worth checking at
08:15 ET today.

**4. The holes.**
- **2→3:** the agent reached the tactical run and produced neither answer,
  and nothing refused it. The documented cause is already ticketed (an agent
  inventing a buy size outside the limits kills the buy silently).
- **1→2:** the docs define the two answers but put no obligation on the
  *tactical* run to produce one — §2.4 is written about the daily run. A
  tactical run may end with a no-op update and that is legal.

---

## H. A watched stock with no buy level at all

**This is the largest hole in the audit.**

**1. What a real trader does.** A watchlist is a list of things you are
waiting to buy, each with the condition you are waiting for (playbook B,
steps 3–5). A name with no condition is not on a watchlist; it is on a
reading list.

**2. What the docs promise.** `THESIS_ARCHITECTURE.md` §9, hard tool gates:
*"**ENTER trigger required on LONG/SHORT WATCHING** — `record_thesis` — A
bullish/bearish watchlist thesis with no entry trigger (would sit inert
forever)."* And `plan-sanity.ts`'s `NOTHING_CAN_WAKE`: *"LONG with no buy
price, no trigger and no review of its own: nothing can bring this stock
back."*

**3. What actually happened. Of 29 watched theses, 8 carry an entry trigger.
21 do not.**

| Has an entry | AGIO, LUXE, BWXT, GD, GEV, NOW, PLTR, SYK |
|---|---|
| **Has none** | BBIO, BMRN, COGT, CORT, CYTK, EXEL, IBRX, MIRM, PRAX, SMMT, AIR, CRWD, CSCO, DOCU, HPE, TOST, EME, ETN, ISRG, MSFT, VST |

That is **every stock the Catalyst Event PM watches except AGIO** (10 of 11),
and it is why that seat holds nothing.

The mint gate is real and works. The **edit path walks through it**, in plain
language, on the record:
- TOST — *"Removing the executable buy plan on TOST after the refresh because
  the remaining PEAD window no longer supports…"*
- CRWD, 09-14 18:55 — *"CRWD plan set down — it reached the target without us,
  so the entry is stale."*
- MIRM, 09-21 — *"Removed: buy above $97.50, Removed: sell below $88…"*
- MSFT, 09-14 — *"Removed: buy above $497, Removed: sell below $448…"*

And `NOTHING_CAN_WAKE` does not catch any of them, because its condition is
`ownTriggerCount === 0 && entryPrice == null`. **Every one of these 21 still
has a review clock or an earnings review, so the flag passes them clean.**
The check asks "can anything wake this?" It never asks "can this ever be
bought?"

**What they are waiting for, and who is waiting:** nothing, and nobody. They
wake on a clock, get reviewed, cost tokens, and cannot become a position.

**4. The holes.**
- **2→3:** one invariant, enforced at one of its three write paths. The
  flag that should have been the backstop tests the wrong condition.
- **1→2:** the docs have no name for "researched, still interested, no
  executable plan." It is neither WATCHING as defined nor PASSED. Twenty-one
  stocks are in a state the state machine does not describe.

---

## I. A catalyst stock before its date

**1. What a real trader does.** Two ways to trade a dated binary (playbook
D8): buy 6–8 weeks before and **sell 1–2 weeks before**, never holding through
the coin flip; or hold through it at a size that survives a −60% gap. Either
way the position exists before the date, and **size is the stop.**

**2. What the docs promise.** `AGENT_REBUILD.md` §2.6: *"CATALYST |
structural stop; exit at event / T+30… run-up variant: sell 1–2 weeks
before."* `TRIGGERS.md` §2a, Catalyst Event PM: *"−10% → REVIEW (the event is
the exit; the thesis carries the stop)."* Playbook D8 on sizing: *"If a −50%
gap would cost more than 0.5% of equity, the position is too big."*

**3. What actually happened.**

| Stock | Event date | Entry trigger | Days out | Position |
|---|---|---|---|---|
| **MIRM** | **2026-09-26 — today** | **none (removed 09-21)** | 0 | none |
| AIR | 2026-09-29 | none | 3 | none |
| AGIO | 2026-11-01 | `PRICE_BELOW 31.5` | 36 | none |
| CYTK | 2026-11-14 | none | 49 | none |
| SMMT | 2026-11-14 | none | 49 | none |
| BBIO | 2026-11-27 | none | 62 | none |
| COGT | 2026-11-30 | none | 65 | none |
| CORT | 2026-12-17 | none | 82 | none |
| PRAX | 2026-12-27 | none | 92 | none |
| IBRX | 2027-01-06 | none | 102 | none |
| BMRN | 2027-02-28 | none | 155 | none |
| EXEL | 2027-03-03 | none | 158 | none |

**MIRM is the case.** Its plan was written, its buy fired twice (09-16 17:50
at $97.50, and again 09-17), the proposal **expired unclicked on 09-18**, the
event-date review fired correctly on 09-18 21:35 (*"10 days before the event
date"* — the analyst's own rule, working), and then the **09-21 morning run
deleted the buy, the stop and the target.** The FDA decision is today. The
seat holds nothing.

**Is there a review before the decision?** Yes, and it is the one thing in
this section that works: the Catalyst Event PM's own `REVIEW_CADENCE 10 from
EVENT side BEFORE` rule is live at analyst level and fired on MIRM on 09-18,
eight days before the date. **Is the position sized for a binary?** Unanswerable
— there is no position on any of the twelve. **Is the date right?** MIRM's
09-26 is correct; the catalyst-calendar fix landed yesterday.

**4. The holes.**
- **2→3:** the seat is designed around an event-driven entry and has no
  executable entry on 11 of 12 names. This is situation H concentrated in one
  analyst, and it is why the seat has a 0% conversion rate.
- **1→2:** the binary sizing rule (D8: cap a −50% gap at 0.5% of equity) is
  in the playbook and in `AGENT_REBUILD.md` §2.7 as "the binary-catalyst
  halving, a constant in code." **No trigger, flag or proposal line
  implements it.** Nothing would stop a full-size catalyst position today.
- The Catalyst seat carries **no trail and no drawdown rule of its own**, so
  its holdings would inherit the account's 8%-off-the-high automatic sale —
  the exact behaviour its mandate ("the event is the exit") forbids. Latent
  only, because it holds nothing. `TRIGGERS.md` §2a documents a "−10% →
  REVIEW" rule for this seat **that does not exist in the data.**

---

## J. A stock Dave passed on

**1. What a real trader does.** Keeps the note. Writes what would change the
verdict. Looks again when that thing happens, not on a timer.

**2. What the docs promise.** `THESIS_ARCHITECTURE.md` §3: *"PASS + ARCHIVED
[terminal at write — no transitions out]. When the ticker is re-encountered
later… the agent reads the prior PASS via `get_theses(include_history)` and
mints a fresh thesis chained via `parentThesisId`."* And the gate: *"PASS
requires `invalidation_conditions`… the flip-criteria for a future
encounter."*

**3. What actually happened.** PASSED rows in the window: **NUVB, PTCT, VRA**.
All three are terminal, all carry flip-criteria, none has a `closedAt`. **None
has been revisited.** That is correct so far — no discovery run has looked
again, because discovery is manual by design and none has run.

**Does it ever come back?** The only re-encounter path is a discovery run or
Dave in chat. There is no scheduled or condition-driven path from PASSED back
to WATCHING. The flip-criteria are stored and read by nothing automatic.

**4. The holes.**
- **2→3:** nothing is wrong with what happened. The hole is that the promise
  is conditional on a discovery run, and discovery is deliberately manual —
  so in practice a PASS is permanent unless Dave names the stock again. The
  flip-criteria are write-only.
- **1→2:** a trader's flip-criterion is a condition ("pullback to the 50-day
  with volume reset"), which is exactly a trigger. Storing it as prose on a
  terminal row instead of as a trigger on a watch row is the gap. **Low
  priority** — this is the one situation where nothing is actively costing
  anything.

---

## K. A stock that was sold

**1. What a real trader does.** Asks one question at the sale: did the story
break, or did the price? If the story survived, the name goes back on the list
with a re-entry level (playbook F).

**2. What the docs promise.** `TRIGGERS.md` §4: *"`shouldRecycleToWatching`
reads [the close reason] to decide whether a sold name stays on the re-entry
radar."* Plus the shipped sold-review: a sale puts the stock on the next daily
run's work list once, keyed on `status = RETIRED` **and** `retiredReason =
SOLD`, for 14 days (`lib/agent/sold-review.ts:71`).

**3. What actually happened.**

| Stock | Sold | P&L | `closeReason` | `retiredReason` | In the sold-review list? |
|---|---|---|---|---|---|
| FIVE | 09-25 | −$675 | STOP | **SOLD** | yes |
| IOT | 09-25 | −$116 | STOP | **SOLD** | yes |
| SMMT | 09-21 | **+$1,158** | STOP | **INVALIDATED** | **no** |
| SRRK | 09-14 | **−$193** | **TARGET** | **INVALIDATED** | **no** |

**FIVE and IOT work.** Both sold 09-25, both `RETIRED + SOLD`, both will reach
today's run as work items. That feature is live and correct.

**SMMT and SRRK do not.** Both were flipped to `retiredReason = INVALIDATED`
by a later write — SMMT on 09-25 08:06 (*"Invalidated by PASS thesis on
SMMT"*), SRRK on 09-18 16:05 (*"WATCHING → RETIRED"*). The sold-review filter
requires `SOLD` exactly, so **a sold stock that anything later re-classifies
drops silently out of the 14-day window.** SMMT was the best trade of the
month.

**SRRK also carries two wrong labels.** It closed at $51.83 against a $53.90
cost — `realizedPnl −$192.51`, `outcome LOSS` — and is stored with
`closeReason = TARGET`, summarised in the activity feed as **"Took profit on
SRRK on approved proposal — TARGET; kept on watch for re-entry."** A loss is
on the record as a profit taken at target. The per-setup scorecard reads
`closeReason`.

**SMMT's return is also malformed.** It came back on 09-25 as a *new*
WATCHING row with `direction = null`, no core belief, and one trigger — an
unresearched seed. The system sold it for +18% and re-added it as if it had
never been researched.

**4. The holes.**
- **2→3:** three defects in one situation — a 14-day window a later write can
  silently void, a loss labelled TARGET, and a re-watch that discards the
  research.
- **1→2:** the docs say the sold name "stays on the re-entry radar" but never
  say with *what plan*. "On watch" with no entry level is situation H again.

---

## L. A stock the run wanted to sell and never sold

**1. What a real trader does.** The decision and the order are one act.

**2. What the docs promise.** `summary-action-check.ts` (shipped 09-25, #708):
a ranked pick marked EXIT on a stock we hold must have a close or a sale
proposal behind it, credited from the **Order**, and `complete_run` refuses
the run otherwise.

**3. What actually happened. Since the 09-25 fix: no.** Three morning runs
completed on 09-25 (16:00–16:02 UTC), all `COMPLETE`, none `FAILED`. Both
sales that day — FIVE and IOT at 18:01 and 18:02 — have `PROPOSAL_APPROVED`
and `CLOSED` rows and filled Orders. No run in the window declared an EXIT
without one.

**One caveat on the evidence.** The fix has had exactly one run-day to be
tested, and on that day no run declared an EXIT that it failed to carry out —
so what is proven is that the new check did not produce a *false* refusal. It
has not yet been proven to catch a real one in production. The replay tests
cover that; live does not yet.

**4. The holes.** None observed. This one is closed until a counter-example
appears.

---

## Cross-cutting: the ladders are frozen copies

Not one of the twelve situations, but it sits under several of them.

`TRIGGERS.md` §2a: *"A held thesis carries only what is its own — the floor,
the target, the catalyst exit, the review clock, the earnings reviews. The buy
fill does not stamp sell rules or scale-ins onto the thesis: a thesis rung
beats every rule above it, so a stamped copy froze one 8% sell onto every
holding… and made the rules above powerless."*

The fill path is correct — `armHeldLadderOnFill` adds only the horizon
template and the setup's own exits, and `compounderDefaults` contains no
trail and no scale-in. **But the holdings carry the copies anyway**, stamped
`source: DEFAULT`:

| Stock | Frozen copies of rules that live above it |
|---|---|
| ABT | **trail 25% → exit**, **trail 15% → review**, add ±7%, +10% review, −12% review, earnings beat/miss, 30-day clock |
| ASML | add ±7%, +10% review, −12% review, earnings beat/miss, 30-day clock |
| WST | add ±7%, +10% review, −12% review, earnings beat/miss, 30-day clock |
| NVDA | add ±7%, −12% review, earnings beat/miss, 7-day clock |
| CEG | earnings beat/miss, 30-day clock |

ABT is the sharp case: its 25% trail is a *thesis-level copy* of the Secular
Compounder's 25% trail. Change the seat's number tomorrow and ABT keeps 25%
— which is the failure §2a says was fixed, at a different number.

Two related pieces of dirt found on the way:
- The **account** carries 12 standing rules including two exact duplicates
  (`add on +7% day` twice, `review every 7 days` twice). The resolver dedupes
  by bucket so nothing fires twice, but it is wrong on the settings page.
- `AGENT_REBUILD.md` §7 problem 6 records *"The account's down-7% add applying
  to trades → **moved** to the Compounder."* It was copied, not moved — the
  account still has it, and it fired on **MU on 09-14 at 17:40, five minutes
  after MU's stop fired at 17:35.** The system proposed selling and buying the
  same stock inside five minutes. The same pair fired on ASML that day.

---

## What is working — stated plainly

Because an audit that only lists holes is not an audit.

- **The ladder fires.** Every protective line that should have fired in the
  window did, within five minutes, with the price on the audit row.
- **The audit trail is complete.** Every claim in this document came from a
  stored row. Nothing had to be inferred from a log or a transcript.
- **MU is the IONS replay passing.** Floor raised four times, +15% checkpoint
  fired and acted on, partial armed at $1,150, and the floor now locks +16.2%
  on a position that peaked at +21.8%.
- **The double-fire is fixed.** Two proposals in the same minute happened on
  SRRK (09-08, 09-09, 09-10, 09-11), SMMT (09-15) and MU (09-14) — and **not
  once after 2026-09-17**, when the one-close-per-position work landed.
- **The event-date review works.** The Catalyst PM's "10 days before the
  event" rule is live at analyst level and woke MIRM on 09-18, eight days
  before its 09-26 decision.
- **The sold-review reaches the run** for stocks that keep the SOLD label —
  FIVE and IOT both will today.
- **Market-hours gating is correct.** Every fire in the window lands inside
  09:30–16:00 ET.
- **The end-of-run check no longer misreads prose.** Three runs completed
  clean on 09-25 including two real sales.

---

## The holes, as tickets

One per cause, most costly first. Rows are in the sections above.

| # | Hole | Situation | Evidence |
|---|---|---|---|
| 1 | A watched stock can lose its buy trigger and nothing notices; 21 of 29 cannot be bought | H, F, I | MSFT, CRWD, TOST, MIRM removals; `NOTHING_CAN_WAKE` tests the wrong condition |
| 2 | A declined sale is never re-decided | A | IOT 5 asks / 9 days / −5.0%; FIVE −2.7%; ~$624 |
| 3 | Holdings carry frozen copies of analyst and account rules | cross-cutting | ABT's 25% trail, 5 of 6 holdings |
| 4 | A review that changes nothing is indistinguishable from one that never ran | C, D, E | ABT: 9 fires, 5 × `fieldChanges: {}` |
| 5 | A sold stock silently leaves the 14-day review window if anything re-labels it | K | SMMT (+$1,158), SRRK |
| 6 | A losing sale is stored and shown as a profit taken at target | K | SRRK −$192.51, `closeReason = TARGET` |
| 7 | Invalidation conditions are read by nothing until after the position closes | E | no run walks them; PBH checked the story after the price broke |
| 8 | The account's down-7% add still applies to every seat | cross-cutting | MU sell 17:35 / buy 17:40 on 09-14; ASML same day |
| 9 | Binary-catalyst sizing is in two docs and no code | I | no trigger, flag or proposal line |
| 10 | A structural condition re-asks daily with no way to answer it once | C | ABT below the 200-day, 9 consecutive days |
| 11 | `TRIGGERS.md` §2a documents a Catalyst "−10% → REVIEW" rule that does not exist, and omits the account's 8% trail, +10% and −12% rules that do | I, A | analyst and account rule tables vs the data |
| 12 | The account carries two duplicated standing rules | cross-cutting | add +7% ×2, review 7d ×2 |

**First fix, as instructed: #2.** It is already written up and is the only
one with a measured dollar cost.

---

## Method

Read first: `THESIS_GAME_PLAN.md`, `TRIGGER_LIFECYCLE.md`, `TRIGGER_MODEL.md`,
`TRADING_PLAYBOOK.md`, `AGENT_REBUILD.md`, `THESIS_ARCHITECTURE.md`,
`TRIGGERS.md`, and the Run Book. Then production: `Thesis` (210 rows),
`ThesisUpdate` (510 rows, 22 days), `Order` (69 rows, 32 days), `Position`
(17), the exploded trigger ladders at all three levels (156 / 12 / 12), and
`TickerIndicators`. Code read where a row was ambiguous:
`lib/agent/triggers/bucket.ts`, `levels.ts`, `defaults.ts`,
`lib/proposals/thesis-flips.ts`, `lib/agent/plan-sanity.ts`,
`lib/agent/sold-review.ts`, `lib/agent/summary-action-check.ts`.

Two claims were checked and **withdrawn** before they reached this document:
that the market-hours gate was firing after the close (it was a UTC/ET
misread), and that the protective ratchet had let an agent delete NVDA's
trail on 09-14 (the deleted rung was a duplicate of an equal inherited one, so
the effective floor never weakened — the ratchet behaved correctly).
