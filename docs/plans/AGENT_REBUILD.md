# Agent rebuild — every stage, rebuilt against the playbook

> **What this is.** The plan to make Hindsight's analysts trade the way the
> playbook (`TRADING_PLAYBOOK.md`) describes: find names by numbers,
> recognise the setup, write the plan as conditions with the numbers set by
> rule, size by risk, manage by horizon, sell by plan, keep score by setup.
> Every stage of the system is covered: discovery, dispatch, the thesis
> writer, the daily run, the tactical run, the trigger vocabulary, the sell
> side, sizing, and the scorecard. Nothing about the approval gate, the
> trigger spine, or the thesis lifecycle changes shape.
>
> Rewritten 2026-09-10 after the playbook research. The first draft of this
> file compressed the fix to "let the writer say buy now"; that was one
> item of thirty. This version is the full map.
>
> **Status:** final after Dave's line-by-line review (2026-09-10). Section 1
> is what's wrong, stage by stage, with the evidence. Section 2 is what each
> stage becomes. Section 3 is the trigger vocabulary. Section 4 is the PR list
> with its blocking order. Section 5 is how the work runs (definition of
> done, sessions, the review cycle). Section 6 is Dave's part.
>
> **Five laws from the review, binding on every PR:** (1) no new refusal in
> `place_trade` or `complete_run` — judgment shows up as a flag on the row or
> a line in the proposal Dave approves; (2) money moves through one path —
> "buy now" is a trigger that fires, never a shortcut from a writer to a
> proposal; (3) sizing adds one setting, not three; (4) a trigger kind that
> cannot fire is deleted, not parked, and a new kind is evaluable and
> editable in the existing popover the day it ships; (5) one session edits
> the agent prompts at a time.

---

## 0. The diagnosis in one paragraph

The framework is right: a thesis is a plan, a plan is a set of triggers, a
run decides, money moves only through proposals. What's missing is
everything a professional puts *inside* that framework. Discovery reads
headlines instead of screens, and has been off since May 31. The writer is
asked for four prices with six numbers of chart data and no notion of what
kind of trade it is writing, so it guesses one fixed level above or below
the price; it is forbidden from saying "buy now." The trigger vocabulary
can express "price crosses $X" and "up X% today" for a stock we don't own,
and nothing else that works. Every holding on every seat wears the same 8%
trail. Size comes from a conviction band, not from the distance to the
stop, so the biggest losses were the biggest positions. And when a buy
trigger fires, "raise the level" is offered as an equal answer to
"buy," which is how MSFT's buy trigger fired six times in August and was
never bought. The record is still positive (+$2,672 live, 56% wins, winners
1.7× losers) because the exits work. The entries and the sizing don't.

---

## 1. What's wrong, stage by stage

### 1.1 Discovery

- **Source is headlines.** The prompt's step 1 is `read_signals` (dead
  since 05-31), market movers and the earnings calendar — a firehose of
  ~900 names a week, mostly micro-caps, that the model is asked to triage
  by reading. Professionals screen by numbers first (playbook B2, D7).
- **Cron paused since 2026-05-31.** Every name added since June came from
  you by chat. The seats do not source their own ideas.
- **The composite is vibes.** Trend 0–3, relative strength 0–3, entry 0–2,
  catalyst 0–2 are model judgments with no computed input behind them.
- **No setup recognition.** A candidate is "interesting" or not; nobody
  says "this is a base breakout two weeks from its pivot" or "this is
  day 2 of an earnings gap."

### 1.2 Dispatch

- The handoff to the writer is five fields and a prose `reason`. No setup,
  no screen numbers, no chart levels. The writer starts from zero.

### 1.3 The thesis writer

- **Blind to the chart.** Ninety days of bars reduced to price, day range,
  52-week range, RSI, the 20- and 50-day in dollars, a volume ratio and one
  word of trend. No 200-day, no ATR, no swing highs/lows, no base, no pivot,
  no relative strength, no gap detection. Then it must "cite the level."
- **No setup.** It is asked for direction, horizon, entry, target, stop.
  Not "which pattern is this," so the plan cannot follow a pattern's rules.
- **"Never the current price."** The prompt and the schema forbid an entry
  the stock has reached. So PEAD, whose normal entry is *now* (day 1–3 after
  the print), mints pullback plans against its own rule (DOCU, FIVE, HPE on
  09-09), and a compounder whose confirmation came last week writes a
  breakout level above the price and waits.
- **One shape for the entry.** "PRICE_ABOVE(entry) for a breakout,
  PRICE_BELOW(entry) for a pullback; most theses need no custom triggers."
  No volume, no close basis, no moving-average reclaim, no gap, no
  days-since-earnings. 16 of 18 priced plans on the book are the fixed-level
  default; 2 use a moving-average rung that cannot fire.
- **Stops by feel.** No ATR in the data, so stops land inside daily noise
  (the `STOP_INSIDE_NOISE` flag catches it afterwards) or at round numbers.
- **Targets by feel.** The 2:1 floor is enforced; nothing asks for a
  measured move, a prior high, or a cited method.
- **No size suggestion.** The writer doesn't see the stop distance as risk.
- **Authors dead rungs.** Earnings/filing/signal rungs still hand-authored
  this week (AGIO, CYTK, MIRM) though they can't fire until #621.

### 1.4 The daily run

- **A fired buy has three equal exits: buy, retune, kill.** Retune is the
  path of least resistance. MSFT: fired 07-31, 08-03, 08-04, 08-05, 08-10,
  08-28; six "triggers updated," zero buys, level raised each time.
- **No regime.** `get_market_context` exists and is optional. Nothing
  halves size or blocks breakouts when SPY is under its 50-day.
- **No cash duty.** $37–40k idle with 22 watch names is a quiet day.
- **Reviews check the story, not the setup.** A held breakout is reviewed
  like a compounder; a PEAD name isn't asked "is it day 45 of 60?"
- **Plan sanity is good** (9 flags since 09-08) but has no chase flag
  (entry > 5% above the pivot) and no stale-entry flag (unfilled 20 days).

### 1.5 The tactical run

- **Confirmation gates are horizon-generic, not setup-specific.** Volume
  matters for a breakout, is irrelevant for a compounder pullback, and is
  the *whole point* for an earnings gap; today it's a horizon table.
- **Re-ladder duty is prose.** After an add or a fire the agent is told to
  "set levels like an analyst"; no template says what the ladder for this
  setup looks like.
- **Two sell rungs, two runs.** Stop and trail fire together (SRRK), each
  paying for a run.

### 1.6 The trigger vocabulary

Of 13 kinds, six fire for a name we don't own or hold: two price levels
(intraday only), the one-day move, gain-from-entry and trail (held only),
review cadence. Seven cannot fire: VS_SMA (no average ever supplied), RSI
(stub), and the five signal kinds (routing paused; #621 makes beat/miss
fire off the earnings calendar and adds a "reports within N days" kind). Nothing
expresses volume, a close, a new high, a gap, a distance from an average,
relative strength, or days around earnings. `AND`/`OR` exist and are
almost unused because there is nothing worth composing.

### 1.7 The sell side

- **One account ladder for every seat and horizon:** add ±7%, review +10%,
  **sell at 8% off the high**, review −12%. Seeded once from the TARGET
  template; the compounder template (15% review / 25% sell) is written and
  called by nothing.
- Result: 56 sell proposals in 30 days, 43 declined or expired, 38 of them
  on four names; winners sold 7–17 points off their peak (HPE, PRAX, VRDN,
  ANET); ASML/CEG/WST carry an automatic 8% sale their own mandate forbids.
- No partial-profit rung, no 8-week-rule rung, no climax-top review, no
  beat-and-fade review, no time exit for trades.

### 1.8 Sizing

- Conviction picks a dollar amount inside the seat's band. The distance to
  the stop plays no part. No portfolio heat, no sector cap. MU at ~$16k with
  a 14% stop = −$2,290; the same trade at 1% risk would have been ~$7k.

### 1.9 The scorecard

- Weekly accuracy per analyst. Nothing per setup, nothing in units of risk,
  nothing on give-back. The next tuning round has no evidence to stand on.

---

## 2. What each stage becomes

### 2.1 Discovery → screens, then triage

A `lib/discovery/screens.ts` module runs deterministic screens over a
universe (S&P 1500 constituents as a static list + Alpaca most-actives,
fenced by the seat's universe and a dollar-volume floor). One screen per
setup family, each returning ranked rows *with the numbers*:

| Screen | Criteria (playbook ref) | Seat |
|---|---|---|
| Trend Template | Minervini's 8 (D1) | all |
| Base breakout | Template + base ≥ 20d, depth ≤ 25%, last contraction ≤ 8%, volume drying, earnings ≥ 10d out; distance to pivot | PEAD (secondary), Compounder |
| Momentum flag | Top 2% by 1/3/6-month return, ADR ≥ 3%, above 10/20-day, orderly pullback | TRADE seats (none live today) |
| Earnings gap (7:45 / 9:45 ET) | Gap ≥ 8%, volume pace ≥ 3×, growth numbers, not up 30% in 3 months (D3). Reports from #621's `lib/market-data/earnings-calendar.ts`; the gap and volume from the bars module | PEAD |
| PEAD | Reported ≤ 3 sessions ago, surprise ≥ 5%, revenue beat, reaction volume ≥ 2×, gap held, not +10% past the gap (D4). Same two sources. #621's prose "earnings-driven discovery" step is the interim until this lands | PEAD |
| Pullback | Template + within 3% of 20/50-day, RS 3M > SPY, light-volume pullback (D5) | PEAD, Compounder |
| Quality | ROIC > 20%, GM stable/high vs industry, FCF margin ≥ 15%, theme keywords, in UPTREND or BASING (D11) | Compounder |
| Insider cluster | ≥ 3 open-market buyers in 30d (D9) | Compounder, Catalyst |
| Catalyst window | Manual list (no PDUFA vendor) + 4–10 weeks out (D8) | Catalyst |

A tool `run_screen(setup, scope)` returns the rows. The discovery prompt is
rewritten around it: read the seat's screens → triage the top 10–20 with
the numbers in hand → Pass-1 research → dispatch with `setup_id` and the
screen row. `read_signals`, movers-as-pool and calendar-as-pool are removed
from the prompt (the other session is deleting `feeds` and `read_signals`
from discovery; this rides on that). The composite's four dimensions get
computed defaults (trend from the Template, RS from the ranks, entry from
distance-to-pivot, catalyst from days-to-event) that the model can override
with a note. The Sunday cron is turned back on when this lands, plus a
weekday 7:45 ET run of the earnings-gap and PEAD screens for the PEAD seat.

### 2.2 Dispatch → carries the setup

`dispatch_thesis_research` gains `setup_id` and `screen_row` (the numbers).
The writer's "WHY YOU WERE DISPATCHED" block shows both. A chat dispatch
without a setup asks the writer to pick one.

### 2.3 The thesis writer → pick the setup, price it from the chart

**Inputs (the chart).** `lib/market-data/price-structure.ts`, pure over one
year of daily bars plus SPY and the sector ETF: SMA 20/50/150/200 with
slopes; EMA 10/21; ATR(14) $ and %; ADR(20)%; 20-day and 52-week high/low
and % off high; last swing high/low; base detection (length, depth, pivot,
last contraction %); volume ratio, 50-day average $-volume, up/down volume;
gaps in the last 10 sessions (size, volume, gap-day low/mid/high); RS vs
SPY and sector over 1/3/6 months; retracement/extension levels of the last
leg; days to / since earnings; Trend Template pass/fail; trend verdict
(UPTREND / PULLBACK_IN_UPTREND / BASING / DOWNTREND / BROKEN). Rendered as
a "Price structure" block in the data block and returned in
`get_stock_data.technicals` so every agent reads the same chart.

**The setup catalog.** `lib/agent/knowledge/setups.ts`: D1–D12 as data —
id, which horizons/seats it fits, preconditions, the entry template as
predicates with placeholders, the stop rule, the target rule, the size
rule, the trail template, the time limit, failure signs, and a paragraph.
Served by `read_knowledge_library`.

**The writer's job.** Read the note inputs and the chart → choose a setup
or PASS → fill the plan from the setup's rules and the chart's numbers →
submit. `submit_thesis` gains:

- `setup_id` (required for LONG/SHORT; persisted).
- `entry_kind`: `NOW` (condition true today and inside the chase limit) |
  `CONDITIONAL` | `UNPRICED`. **The "never the current price" rule and
  the `ENTRY_AT_PRICE` flag are deleted.** A `NOW` plan is stored as an
  ENTER trigger at the live price with `fireOnMatch: true` — one new
  trigger field meaning "standing-order semantics for the first fire"
  (the crossing rule would otherwise never fire a level the price is
  already past on a down day). It fires on the next five-minute check and
  produces the same approval-gated proposal as every other buy. **There is
  no path from the writer to a proposal.** The discovery prompt's
  "immediate-buy exception" (wait for the writer, then `place_trade`) is
  the same second path and is deleted in PR 9.
- `entry_condition`: the filled predicate template — `AND[PRICE_ABOVE
  pivot close, VOLUME_RATIO 1.5]`, `NEAR_SMA 50 + reversal`, `DAYS_SINCE_
  EARNINGS 1..3`, `GAP_UP …` — not a bare number. `entry_price` stays as
  the reference level.
- `stop_basis` and `target_basis`: which rule (E2/E3) produced the number,
  with the structure it cites. Validated in-loop against ATR (≥ 1 ATR from
  entry; ≤ 1 ADR or 8% for TRADE).
- `suggested_shares` from the risk rule (E4); `place_trade` recomputes.

The writer stops authoring signal-kind rungs. On a refresh, a conditional
entry unfilled for 20 trading days arrives as `ENTRY_STALE` and must be
re-priced, converted to NOW, or set down.

### 2.4 The daily run → a portfolio manager

- **Fired buy = a decision.** Two answers: `place_trade`, or set the plan
  down with a reason. "Retune" survives only as an explicit *re-priced
  condition* citing the chart (a new pivot, a new pullback level), never a
  level moved above the price to avoid buying. **No refusal.** A buy level
  raised above the price without a cited structure arrives the next day as
  a plan-sanity flag, `ENTRY_RAISED_AWAY {count}` ("buy level raised above
  the price for the third time; no structure cited"), it is named in the
  run summary, and it is visible on the thesis sheet. The MSFT pattern
  becomes loud, not impossible.
- **Book health** in `get_portfolio_context`: cash and % deployed, open
  risk vs the heat cap, regime (C), breadth of the book, sector/theme
  concentration, seats under capacity, and every watch name whose setup
  condition is true today or within 2% of firing.
- **Cash duty.** Cash > 25% of equity + an `ENTER_NOW` name + RISK_ON →
  act or explain in one sentence. Flagged like `UNPROTECTED_GAIN`.
- **Regime is an input, not a gate.** The run reads it from book health;
  in CAUTION the suggested size is halved and breakout setups are marked
  "not in this regime"; in RISK_OFF only event and mean-reversion entries
  are suggested. Every buy proposal carries the regime line ("regime
  CAUTION — half size suggested") so you see it when you click. `place_trade`
  does not refuse on regime.
- **Setup-aware review.** A held name's review runs its setup's checklist:
  the trail rule, the time limit, the partial-profit rung, the beat-and-fade
  rule, the 60-day business checkpoint.
- **Two new plan-sanity flags:** `ENTRY_CHASED` (level > 5% past the pivot
  / condition) and `ENTRY_STALE` (unfilled 20 trading days).

### 2.5 The tactical run → confirm per setup, re-ladder from a template

- The confirmation gate reads the setup: breakout → close + volume + not
  chased; pullback → reversal held; earnings gap → gap held + volume;
  compounder → thesis intact, volume irrelevant; catalyst → not day-before.
- After an add or a fire, the ladder is re-set from the setup's trail
  template (E5) with the new structure, not from prose.
- Same-bucket protective fires (stop + trail) collapse to one run.

### 2.6 The sell side → per horizon, per setup

Replace the single account ladder with per-horizon DEFAULT ladders in the
cascade that already exists, and wire the compounder template:

| Horizon | Rungs |
|---|---|
| TRADE | +8% review; partial-sell rung at 2R; trail = close under the 10/20-day or 3 ATR chandelier (sell, DIRECT-eligible); −7% sell; 20-day no-progress review |
| TARGET | +10% review; partial at 2R (optional per setup); after +10%: max(3 ATR, 12–15%) trail; −12% review; 8-week-rule flag when +20% inside 3 weeks (hold, don't sell the partial) |
| CATALYST | structural stop; exit at event / T+30 (exists); −10% review; run-up variant: sell 1–2 weeks before |
| COMPOUNDER | +15% review; 15% give-back **review**; close < 200-day review; **25% sell**; −15% review; 60-day business checkpoint |

#621 already seeds three account-level earnings rules on every held and
watched name (heads-up 3 days before, review on any beat, review on any
miss) and teaches the daily and tactical prompts the beat-and-fade reading.
PR 7 keeps those as account rules and adds the composite `AND[EARNINGS_BEAT,
PRICE_MOVE_PCT DOWN ≥ 3%]` as a TRADE/TARGET default so a beat the market
sold wakes a tactical run the same day rather than tomorrow's review. The 8
held names migrate with your approval (§5).

### 2.7 Sizing → risk, one setting

`position-sizing.ts` gains one analyst setting, **`riskPct`** (default 1%
of equity per trade), and the formula

    shares = (equity × riskPct × convictionMultiplier) ÷ (entry − stop)

clamped inside the three dollar limits that already exist (smallest trade,
largest trade, most in one stock). Everything else is a constant in code,
not a setting: the conviction multiplier table (LOW 0.5, MEDIUM 0.75, HIGH
1.0, STRONG 1.25), the binary-catalyst halving, the portfolio heat cap
(6%), the industry cap (2 names), and the theme cap (35% of heat). Regime
is a run input (2.4). **Nothing here refuses a trade.** Heat and caps show
up as lines in the proposal ("open risk would be 5.8% of 6% after this
buy"; "third name in Semiconductors"), and the suggested size is what the
formula says; you approve, edit, or decline as today.

### 2.8 The scorecard → by setup

The weekly scorer groups closed trades by `setup_id` × horizon: count, win
rate, average R, average hold, average give-back from peak, sell-proposal
decline rate. Rendered on /performance; one line per setup injected into
the discovery and writer prompts ("Breakouts: 12 trades, 42% win, 1.9R").

---

## 3. The trigger vocabulary this needs

Inputs first: a daily indicator snapshot (`TickerIndicators`: the 2.3
numbers for every book ticker + the screens' shortlist, computed 06:30 ET),
which the 5-minute evaluator reads next to the live quote, plus #621's
earnings calendar. Then:

| Predicate | Meaning | Source | Status |
|---|---|---|---|
| `PRICE_ABOVE/BELOW {level, basis: intraday\|close}` | close basis evaluated once after 16:00 | quote | extend |
| `VOLUME_RATIO {min}` | today's volume ÷ 20-day avg | quote + snapshot | new |
| `NEW_HIGH {window: 20\|52w}` | breakout whose level moves with the base | snapshot | new |
| `NEAR_SMA {period, withinPct}` | pullback arming | snapshot | new |
| `VS_SMA {period, direction}` | reclaim / loss of an average | snapshot | **make it fire** |
| `PRICE_MOVE_PCT {window: 1D\|5D\|20D}` | restore the multi-day windows | snapshot | extend |
| `PCT_FROM_52W_HIGH {max}` | momentum proximity | snapshot | new |
| `RS_VS_SPY {window, min}` | relative strength | snapshot | new |
| `GAP_UP {minPct, minVolRatio}` | earnings/news gap | snapshot | new |
| `RSI {period: 2\|14, …}` | real computation | snapshot | fix the stub |
| `EARNINGS_WITHIN {days}` | pre-print heads-up ("reports within N days") | #621 calendar | **built, #621** |
| `EARNINGS_SINCE {min,max}` | PEAD's entry window ("1–3 days after the print") | same calendar (`reportDate`) | requested from the #621 session; else PR 2 |
| `EARNINGS_BEAT/MISS {minSurprisePct?}` | reported EPS vs estimate | #621 calendar | **built, #621** |
| `INSIDER_CLUSTER {minBuyers, days}` | | daily Form-4 job | new, later |
| `ESTIMATE_REVISION {direction, days}` | | vendor-dependent | later |
| `AND` / `OR` | | | exists — finally used |

**Deleted in PR 2, not parked:** `GUIDANCE_CHANGE`, `FILING`, `SIGNAL_TYPE`
(and any `TIME_ELAPSED` remnant) — they cannot fire and will not until a
news layer exists. The kinds leave the type, the schema, the evaluator,
`describePredicate`, the popover, and the prompts in one PR, and a
migration script strips them from every stored ladder (pruning `AND`/`OR`
that become empty) with a before/after count in the PR. The RSI stub goes.
When the Signals project returns, its kinds are added fresh against a
source that exists.

**Every new kind ships whole:** evaluable on the 5-minute cron, described
by `describePredicate`, addable and editable in the existing
`AddTriggerDialog` / `TriggerPill`, with a test — the same day. No
half-kinds.

---

## 4. The PR list, in Dave's order, with what blocks what

Linear project **Agent Rebuild** (team Davesucks) holds one ticket per PR
with the blocking relations below encoded as Linear relations:
PR 1 = DAV-243 · PR 2 = DAV-247 · PR 7 = DAV-250 · PR 3 = DAV-244 ·
PR 4 = DAV-249 · PR 5 = DAV-253 · PR 8 = DAV-251 · PR 6 = DAV-254 ·
PR 9 = DAV-255 · PR 11 = DAV-248 · PR 10 = DAV-252. Dave's rulings =
DAV-245; the "#621 closed" gate = DAV-246. Each ticket is written to be run
by a fresh session with no other context.

Order: **1, 2, 7, 3, 4, 5, 8, 6, 9, 11, 10.** Sell rules come third so the
declined-sell noise ends first; entries next; sizing after; discovery last
because it is being done by hand anyway. Sizes are working days for one
session. "Blocked by" is what must be merged first; anything not listed can
run in parallel.

| # | PR | Blocked by | Adds | Deletes | Acceptance proof | Size |
|---|---|---|---|---|---|---|
| 1 | **The chart** — `lib/market-data/price-structure.ts`, one-year bars, SPY/sector bars, data-block "Price structure", `get_stock_data.technicals` | — | the 2.3 inputs; tests on synthetic bars | the 90-day bar window; the hand-rolled SMA/RSI in `get-stock-data.ts` | a MSFT writer run's data block shows the 200-day, ATR, pivot, base and RS in dollars/percent | 3 |
| 2 | **Triggers that fire** — daily indicator snapshot + evaluator; `basis: close`; `VOLUME_RATIO`, `NEW_HIGH`, `NEAR_SMA`, `PCT_FROM_52W_HIGH`, `RS_VS_SPY`, `GAP_UP`, 5D/20D moves; real RSI; VS_SMA fires; `fireOnMatch`; **delete** the three dead kinds with a ladder sweep | 1 | snapshot table + 06:30 job; predicates; popover + `describePredicate` for each | `GUIDANCE_CHANGE`, `FILING`, `SIGNAL_TYPE`, the RSI stub; the swept rungs (count in the PR) | GD's and SYK's VS_SMA buys evaluate on production; a test proves `AND[PRICE_ABOVE close, VOLUME_RATIO]` fires once on the close; a query shows zero dead-kind rungs on the book | 4 |
| 7 | **Sell rules per horizon** — per-horizon DEFAULT ladders in the cascade; the compounder template wired; partial-profit, 8-week, time-limit and beat-and-fade rungs; a migration for the held names on Dave's list | 2 (ATR trails); Dave's list (§6) | horizon-keyed defaults; the migration script | `standingProtectionTriggers` as the single seed; the one-horizon `seedAccount` | ASML/CEG/WST carry 15/25 not 8; a TARGET trail is max(3 ATR, 12%); the declined-sell count over the following two weeks, from the database | 3 |
| 3 | **Setup catalog** — `lib/agent/knowledge/setups.ts` (D1–D12 as data with trigger templates), served by `read_knowledge_library`; `Thesis.setupId` | — (defaults = playbook numbers unless §6 changes them) | catalog + column + tests | — | catalog unit-tested for shape; every template predicate is a kind that exists after PR 2 | 1 |
| 4 | **The writer** — setup-driven plan; `entry_kind` with `fireOnMatch`; `entry_condition`; stop/target bases validated in-loop vs ATR; risk-based share suggestion; dispatch carries `setup_id` + screen row. Rebases on #621's earnings block and keeps it | 1, 3, **#621 closed** | schema fields, persist path, prompt rewrite | "never the current price" (prompt + schema + data block); `ENTRY_AT_PRICE`; hand-authored signal rungs; the fixed-level ENTER template as the only shape | a PEAD writer run on a fresh beat-and-raise stores a `fireOnMatch` buy at the live price; a breakout thesis stores a composed close+volume entry; DOCU/FIVE/HPE re-dispatched as the live proof | 5 |
| 5 | **The daily run** — fired-buy law as a flag (`ENTRY_RAISED_AWAY`); book-health block; cash duty; regime as input; `ENTRY_CHASED` / `ENTRY_STALE`; setup-aware review. Rebases on #621's earnings section and keeps it | 2, 4 | `get_portfolio_context` block; plan-sanity flags; prompt | the "retune as an equal answer" paragraph; the per-horizon data-discipline block; the conviction→dollar table | a run with a fired ENTER either proposes or sets down; a level raise with no structure shows as `ENTRY_RAISED_AWAY` the next day; **no new refusal** | 3 |
| 8 | **Sizing** — `riskPct` (one setting), `sharesForRisk`, heat/industry/theme constants, regime input; proposal lines | 2 | one setting + formula + proposal text | the conviction dollar picker as the primary path | a STRONG buy with a 14% stop on a $100k book proposes ~$9k with the risk line in the proposal; **no new refusal** | 2 |
| 6 | **The tactical run** — per-setup confirmation; template re-ladder; same-bucket fire collapse | 4 | prompt + tactical-run | the horizon volume table | SRRK-shape double fire → one run; a breakout fire past the chase limit passes with the reason | 2 |
| 9 | **Discovery by screens** — `screens.ts`, universe list, `run_screen`, prompt rewrite, computed composite defaults, Sunday cron on + 7:45 PEAD/gap run | 2, 3, 4, #621 closed | screens + tool + prompt + cron | headline/mover/calendar pools; #621's prose earnings-discovery step; **the immediate-buy exception** | a Sunday run dispatches ≥ 1 writer from a screen row with numbers; no `place_trade` in discovery mode | 5 |
| 11 | **Scorecard by setup** — scorer grouping, /performance table, one line per setup into the prompts | 3 | | | /performance shows per-setup R and give-back | 2 |
| 10 | **Insider + revisions** — daily Form-4 cluster job, `INSIDER_CLUSTER`; `ESTIMATE_REVISION` if the vendor serves it | 2 | jobs + predicates | — | a cluster on a book name fires a review with the buyers listed | 2 |

Three tracks that can run at once:

- **Inputs:** 1 → 2 → then 7, 8 and 10 in parallel.
- **Knowledge:** 3 (day one, parallel with 1) → 11.
- **Judgment:** 4 (after 1, 3 and #621) → 5 → 6; 9 after 2 and 4.

≈ 32 working days of session time; with three tracks, about three
calendar weeks.

**Standing rules for every PR here.** No new refusal in `place_trade` or
`complete_run`. Every PR states its net line delta and names its deletion.
Prompts describe judgment; tools carry mechanics; the catalog carries the
rules. Cost stays flat: screens, indicators and the catalog are arithmetic
and data, not tokens.

---

## 5. How the work runs

**Sessions.** Each PR is its own fresh session, started from its Linear
ticket, which links this doc, the playbook, `docs/PRINCIPLES.md`,
`docs/TRIGGERS.md`, `docs/plans/TRIGGER_MODEL.md` and
`docs/THESIS_ARCHITECTURE.md`. One session at a time on
`lib/agent/system-prompt.ts`, `lib/agent/run-thesis-writer.ts`,
`lib/agent/system-prompts/*`, and `lib/agent/triggers/evaluate.ts`. The
earnings session (#621) closes before PR 4 opens. The session that wrote
this plan holds the rules and runs the production checks; it does not
write the code.

**Definition of done — the PR message must contain all five, or it goes
back:**

1. The net line delta and the deletion it names.
2. The acceptance proof from the table, shown from production or a test —
   not described.
3. The sentence "no new refusal in `place_trade` or `complete_run`."
4. The sentence "rebased onto main, not stacked."
5. For any prompt change: the exact paragraph deleted and the exact
   paragraph added.

**Review cycle.** Five lines from the session; then the twelve invariants
in `docs/prompts/RUN_REVIEW_INVARIANTS.md` run against production by the
rules session; then Dave's click. Nothing else.

---

## 6. Dave's part

**Rulings (they block only what they name):**

1. The catalog's numbers are the playbook's numbers (7–8% trade stop, 1.5×
   volume, 5% chase limit, 6% heat, 2 names per industry, 25% compounder
   catastrophe line). Bless them or change them; they are settings, not
   code.
2. `riskPct` default (1%) and the conviction multiplier table (0.5 / 0.75 /
   1.0 / 1.25). Blocks nothing; PR 8 ships the defaults and you change the
   one setting.
3. Which setups each seat may run: PEAD → D4, D3, D5; Compounder → D11 via
   D1/D5; Catalyst → D8 with D1/D5 entries. A TRADE seat (D2) does not
   exist today; the plan does not create one.
4. The held-name migration list in PR 7 (lowering a trail is your act).
   Blocks PR 7's migration step only; the defaults ship regardless.

**This week, no code:** lower the ASML/CEG/WST trails to 15% yourself
until PR 7; decide MSFT (buy now or set down); sell or move the floor on
SRRK and MU; keep discovery paused until PR 9.

**Coordination with #621 (the market-data session):** it owns the earnings
calendar module, the three earnings trigger kinds, the account earnings
rules, and the earnings surfaces (sheet block, /earnings page, calendar
tool). This plan consumes them and does not re-implement any of it. Two
asks are with that session: an `EARNINGS_SINCE {min,max}` kind on the same
calendar (PEAD's entry window), and moving the "ignore the surprise on a
tiny estimate" rule from prompt prose into `surprisePct` itself.

**Not in this plan:** news tiers (D13) stay parked with the Signals
project; PDUFA calendars have no vendor; statistical proof of any seat's
edge needs the scorecard and months.
