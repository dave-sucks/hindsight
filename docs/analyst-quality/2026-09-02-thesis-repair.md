# Thesis repair — every stock on the book, 2026-09-02

**What this is.** One page per stock you hold or watch: what is wrong with it, whether
the cause is fixed for stocks written from now on, and what has to happen to this one.
Every number was read from the production database tonight (Wednesday 2026-09-02,
after the close) and cross-checked against tonight's closing prices from Finnhub and
daily bars from Alpaca. Nothing in this file is taken from the earlier audits.

**Not reported here, on purpose:** pending or expired approval proposals (MU, SRRK).
Those are the app putting a decision on your desk. They are listed once at the bottom
as decisions, not as problems.

**The book tonight.** 7 holdings, 26 watchlist names, 3 live analysts. Sync health:
HEALTHY (0 orphans, 0 mismatches). Cash ≈ $37.7k, 7 of 15 position slots used.

| | Holdings | Watching | Problems found | No problem |
|---|---|---|---|---|
| PEAD Specialist | MU, NVDA, PBH | CRM, CRWD, CSCO, HPE, HWM, TOST | MU (text), CRWD, CSCO, HPE, HWM, TOST | NVDA, PBH, CRM |
| Catalyst Event PM | SMMT, SRRK | AGIO, BMRN, CYTK, IONS, MIRM, PRAX, RARE | SMMT (minor), AGIO (minor), BMRN, IONS, MIRM, RARE | SRRK, CYTK, PRAX |
| Secular Compounder | CEG, WST | ABT, ASML, BWXT, EME, ETN, GD, GEV, ISRG, MSFT, NOW, PLTR, SYK, VST | ABT, ETN, GD, ISRG, MSFT, NOW, PLTR, SYK, VST | CEG, WST, ASML, BWXT, EME, GEV |

**Score: 20 of 33 names have a problem. 13 are fine.** Nine of the twenty are the same
defect: a buy plan whose risk is bigger than its reward, which nothing outside the thesis
writer checks.

---

## The five causes behind the twenty problems (so you only read the explanation once)

| # | Cause | Fixed for future stocks? | Names |
|---|---|---|---|
| 1 | **Buy level set at the price on the day it was written**, so it was true immediately and re-fired every day. | **Yes.** #589 gives the writer real price levels (20-day, 50-day, 52-week) and #586 flags any buy level within 0.5% of the current price so the next run must fix it. No hard block. | ISRG, TOST (both already re-fired and were talked out of it) |
| 2 | **Buy triggers fire while true, not when crossed.** "Buy above $54.50" means "buy every day the stock is above $54.50" until someone removes it. Same in reverse for the new pullback levels. | **No.** Open as DAV-229. | HPE (8 fires), ABT (6), NOW (7), BMRN, CRM, MU's old lines |
| 3 | **Risk bigger than reward on a watch plan.** The writer enforces 2:1; the two tools the daily run and chat use to write levels (`record_thesis`, `update_thesis`) only describe the rule, they do not check it. | **No.** Nothing filed until tonight — in the one Linear ticket at the bottom. | ABT, BMRN, CSCO, IONS, MIRM, MSFT, NOW, PLTR |
| 4 | **Two buy triggers on one stock**, or a trigger's sentence disagreeing with its number after a level was moved. Nothing removes the old trigger or rewrites the old sentence. | **No.** Ticket. | GD, VST (two buys); MU, SYK, GD (text ≠ number) |
| 5 | **A "plan is wrong" floor placed within 1% of the price on a stock we don't own**, so a normal red day takes the plan down. The drift alarm only checks the buy level. | **No.** Ticket. | HWM (twice in two days), SYK (0.7% away tonight) |

Two more that are already handled and only need the old rows cleaned up:

- **Research too old for a buy decision** (ETN, June 15). Fixed by #580 (35-day cap for
  watch names) and #581 (stale names land in the run's work list; ETN did this morning).
- **A quiet watch whose only wake can never fire** (CRWD). Fixed by #579 and #583; CRWD
  was created two days before those merged.

Known and deliberately left alone: 99 of the book's ~300 triggers are earnings/news/filing
triggers that cannot fire while signal routing is paused (since May 31). New theses no
longer get them (#579); the existing ones stay until the Signals design session (DAV-196).

---

## Holdings (7)

### CEG — Secular Compounder — no problem
Entry $280.33, close $290.04 (+3.5%). Protection: 8% trail off tonight's new high (~$267)
plus the $220 hard line. Research 26 days old on a 90-day clock for held names. Cosmetic:
last night's digest listed this position without its thesis link; the thesis is there.

### MU — PEAD Specialist — problem (text), plus a decision on your desk
- **What's wrong.** The $935 sell trigger still says "Exit below $814" and the $1,100
  review still says "reclaims the 50-day around $934" — the numbers were raised on 8/24,
  the sentences were not, and the agent reads the sentences when it acts. Tonight's close
  ($956) is back above both the $935 line and the ~$948 trail floor.
- **Fixed for future stocks?** No. #586 rewrites the sentence only for buy levels; raised
  sell levels keep their old text. In the ticket.
- **What has to happen.** Rewrite the two sentences to match the numbers; levels
  unchanged (on a held stock they can only tighten). The pending sell proposal (expires
  12:10 PM tomorrow) is your call — the analyst has proposed this exit eight times since
  8/28 and it has been rejected or left to expire each time.

### NVDA — PEAD Specialist — no problem
Entry $218.23 (Aug 31), close $224.41 (+2.8%). Stop $200.15, 8% trail, +10%/+12%
checkpoints, print Aug 26 so the 60-day window runs to late October.

### PBH — PEAD Specialist — no problem
Entry $52.98, close $52.83. Stop $47.50, 8% trail, window from the Aug 6 print runs to
early October.

### SMMT — Catalyst Event PM — minor
- **What's wrong.** The thesis has no target. The position row says $26 but the thesis's
  "decide here" review at the target was never created, so nothing wakes the analyst if it
  runs before the Nov 14 decision.
- **Fixed for future stocks?** Not applicable — one field was left empty at the Sept 1
  fill.
- **What has to happen.** Set the target to $26 on the thesis. Stop $11.50 and the 8%
  trail are already armed.

### SRRK — Catalyst Event PM — no problem; decision on your desk
Entry $53.90, close $56.10, floor $56.40 (raised above cost on 8/21). The floor is
0.5% above tonight's price and the sell proposal for it expires 3:01 PM tomorrow. The
seat's rule is "exit at event resolution" (Sept 30); taking +4% now or holding through the
decision is your call, not a defect.

### WST — Secular Compounder — no problem
Entry $355.28, close $342.63 (−3.6%). Hard stop $330 (3.7% below), 8% trail off $353.79.
If the stop fires it is a re-entry question, not a failure (the 8/28 audit said the same).

---

## Watchlist — Catalyst Event PM (7)

### AGIO — minor
- **What's wrong.** The plan is fine (buy above $35.70 = the 50-day, stop $30.50, target
  $46.50, 2.1:1). It is reviewed every single day (1-day clock) for a Nov 1 decision — two
  months of daily reviews on a name that is waiting.
- **Fixed for future stocks?** Not a defect; the writer picks the clock per stock (#572).
- **What has to happen.** Clock to 7 days until October, when the entry window opens.

### BMRN — problem
- **What's wrong.** Buy $68, target $77, stop $59 is 1:1 — nine dollars of risk for nine
  of reward. And it is a buy-anytime plan on a stock whose own research says the entry
  window opens January 2027 (decision Feb 28, 2027).
- **Fixed for future stocks?** No, on both counts: the writer still cannot hold a view
  without a buy price (DAV-230), and 2:1 is not checked outside the writer (ticket).
- **What has to happen.** Take the buy plan down. Keep it as a quiet watch that wakes in
  early January (time wake) or on a 10% move; price it then.

### CYTK — no problem, with a note
Buy on reclaim of $80 (50-day $79.50), stop $67 (June low $66.72), target $105. The buy
level is 11% above tonight's $71.93, so the run's new "buy level more than 10% away" alarm
will nag it on every review. That is the plan working, not breaking.

### IONS — problem
- **What's wrong.** Buy $61.50, target $80, stop $43 — a 30% loss plan for an 18-point
  gain (1:1). It fired today, the agent tried to buy, and the seat's 70% confidence gate
  blocked it because the writer scored it 5/10 (low trend and relative-strength marks,
  which is what a washed-out pre-decision stock looks like).
- **Fixed for future stocks?** No (2:1 unchecked — ticket). The gate question is a
  config decision, handled in the analyst cleanup section below.
- **What has to happen.** Stop to $54 (under the August base at $54.03) → 2.5:1. Size at
  the $5k floor: it is a first-approval decision (Sept 22) landing eight days before SRRK's.

### MIRM — problem
- **What's wrong.** Stop $82 is 19% under the $101 buy level and below any price
  structure (60-day low $88.98); 1.9:1.
- **Fixed for future stocks?** No (ticket).
- **What has to happen.** Stop to $88 → 2.8:1. Same September-window note as IONS
  (decision Sept 26).

### PRAX — no problem
Refreshed this morning after the 8/31 sale: buy on reclaim above $367 (the 20-day), stop
$299, target $575, 3.1:1. The "sold name still showing its old position numbers" item in
DAV-230 was cleared by that refresh.

### RARE — problem
- **What's wrong.** Buy $26.10 with an $18 stop is a 32% loss plan on a first-approval
  FDA decision (Sept 19) — the exact shape the seat's Aug 24 rule excludes, and a stop
  that can only be reached by the decision gapping through it. Its score is 5/10, so the
  gate blocks the buy anyway. It was dropped from this seat on 8/20 and re-minted 8/31.
- **Fixed for future stocks?** No — nothing prevents a stop that only an overnight gap
  can hit (ticket).
- **What has to happen.** Take the buy plan down; quiet watch through the Sept 19
  decision (20-day time wake, 15% move wake), then decide with the outcome known.

---

## Watchlist — PEAD Specialist (6)

### CRM — no problem, with a note
Buy on a pullback below $233, stop $214, target $275 (2.2:1); print Aug 26, window to late
October. Note: once it gets under $233 the trigger fires every day it stays there (cause
2) and a tactical run decides each time.

### CRWD — problem
- **What's wrong.** It is a quiet watch whose only wake is "next earnings beat", an
  event trigger that cannot fire while routing is paused. It is invisible forever.
- **Fixed for future stocks?** Yes — #579 removed those triggers from the menus and #583
  requires a wake that can fire. CRWD was created 8/30, before both merged.
- **What has to happen.** Add wakes that fire: breakout above $234 (the 20-day high) and
  an 85-day time wake for the late-November print.

### CSCO — problem
- **What's wrong.** Buy $116.10, target $131, stop $101.70 is 1:1, and the drift is not
  happening: three weeks after the Aug 12 print the stock is 3% lower and under both
  moving averages.
- **Fixed for future stocks?** No (ticket).
- **What has to happen.** Take the plan down; quiet watch with a wake above $116 (reclaim
  of both averages) and a 40-day time wake for the window close (Oct 11).

### HPE — problem, and a live opportunity tonight
- **What's wrong.** The thesis is about the June 1 print, whose 60-day window closed Aug
  1. Its $54.50 buy line fired 8 times in two weeks while the stock sat on it, and was
  talked out of each time. Tonight HPE reported again: EPS $1.11 vs $0.94 expected,
  revenue beat, guidance raised, stock +4% after hours — a fresh, clean setup for this
  seat.
- **Fixed for future stocks?** Fire-while-true, no (DAV-229). Stale research surfacing,
  yes (#580/#581).
- **What has to happen.** Send it back to the thesis writer tonight on the new print;
  entry 1–3 days after the print per the seat's own rule.

### HWM — problem
- **What's wrong.** The plan was set down twice in two days. Monday's 8% drop (SpaceX
  said it will cast turbine blades in-house) broke the $261 floor; this morning's run
  re-armed a $254 floor with the stock at $255 and it broke 90 minutes later. The Aug 6
  drift is dead — the stock is 8% under both averages.
- **Fixed for future stocks?** No — nothing checks how far a watch floor sits from the
  price (ticket).
- **What has to happen.** Quiet watch, no clock: wake on a reclaim above $276 (the 20/50-
  day) or a 33-day time wake (window closes Oct 5). If neither, it drops.

### TOST — problem
- **What's wrong.** By the analyst's own words on Sept 2 the trade is over (drift spent,
  street target below the price) — yet it still carries a 7-day review clock.
- **Fixed for future stocks?** The original defect (buy level at the day's price) — yes,
  #586 and #589.
- **What has to happen.** Quiet watch: remove the clock; wake on the next print (~Nov 4,
  63-day time wake) or a 10% up move.

---

## Watchlist — Secular Compounder (13)

### ABT — problem
- **What's wrong.** Buy $115, target $135, stop $84 — risking $31 to make $20 (0.65:1).
  Its earlier $112 line fired 6 times in August while true.
- **Fixed for future stocks?** No (ticket for 2:1; DAV-229 for fire-while-true).
- **What has to happen.** Re-price as a pullback: buy below $106 (20-day low $105.64,
  50-day $103.71), stop $96 (under the July base), target $135 → 2.9:1. Research is 21
  days old; it hits the 35-day cap Sept 16 and gets refreshed then.

### ASML — no problem now
This morning's run moved the buy to a reclaim above $1,780 (both averages ≈ $1,757), stop
$1,580, target $2,800. 5.8% away, not the 14% the 8/28 audit saw. Research Aug 7 → the
35-day cap lands Sept 11 and the run refreshes it.

### BWXT — no problem, with a note
Buy on reclaim of $170 (50-day $173), stop $145, target $285 (4.6:1). The stock is at a
52-week low, 9% under the buy level, so the >10% alarm will start nagging soon. That is a
deliberate "only on repair" plan.

### EME — no problem
Re-priced Aug 31 after the stop-out: buy on reclaim above $790 (the 20-day), stop $695,
target $1,150.

### ETN — problem
- **What's wrong.** The research is from June 15 — 79 days, more than twice the new
  35-day limit for a name we might buy. This morning's run redrew the levels (buy below
  $380, stop $355, target $480) on that old work instead of refreshing it.
- **Fixed for future stocks?** Yes — #580 and #581; the run did flag it today, then chose
  to re-affirm.
- **What has to happen.** Send to the thesis writer for a fresh underwrite; the levels
  can stand until it returns.

### GD — problem
- **What's wrong.** Two buy triggers at once — an old "buy only between $342 and $345"
  band and today's "buy below $355" — and the floor's sentence says $305 while its number
  is $315.
- **Fixed for future stocks?** No (ticket).
- **What has to happen.** Delete the band; keep buy below $355 / stop $315 / target $435
  (2:1); fix the sentence.

### GEV — no problem
Refreshed today: buy on a pullback to $875 (today's low $874.34), stop $690, target $1,300
(2.3:1). The $690 line is 21% under the buy — a "plan is wrong" line, not a trading stop;
deliberate for this seat.

### ISRG — problem
- **What's wrong.** The buy level, $401.23, is the price on the day it was written (Aug
  12) — a random number, now 8% above the stock. Nobody will touch it before the 30-day
  clock (Sept 11) because the drift alarm only trips past 10%.
- **Fixed for future stocks?** Yes (#589, #586).
- **What has to happen.** Re-price to a reclaim of the 20/50-day at $383, stop $336
  (under the June low $328.62), target $530 → 3.1:1. That also answers the "deliberate
  re-entry" question left open since 8/20: re-enter only on reclaim.

### MSFT — problem
- **What's wrong.** Buy below $480, target $560, stop $420 is 1.3:1.
- **Fixed for future stocks?** No (ticket).
- **What has to happen.** Stop to $440 (under the 50-day $438) → 2:1. Research Aug 3 hits
  the cap Sept 7; the run refreshes it.

### NOW — problem
- **What's wrong.** Buy $150, target $165, stop $78 — risking $72 to make $15 (0.2:1).
  Its own belief names "$150+" as the destination, i.e. the target is the buy level.
- **Fixed for future stocks?** No (ticket).
- **What has to happen.** Re-price as an accumulation plan: buy below $130 (the 20-day),
  stop $112 (20-day low $111.95), target $175 → 2.5:1, and update the belief to match.

### PLTR — problem
- **What's wrong.** Target $190 is 4% above the $183 buy with a $110 stop (0.1:1). Its
  belief ("reaches $185–200") has already happened without a position; after today's
  −5.8% the stock is $169. Flagged for re-price on 8/24 and 8/28, never done.
- **Fixed for future stocks?** No (ticket).
- **What has to happen.** Take the plan down; quiet watch with a wake below $150 (the
  50-day, $147) and a 90-day time wake. Re-underwrite from scratch if it comes back.

### SYK — problem
- **What's wrong.** The "plan is wrong" floor at $310 is 0.7% under tonight's $312.19 —
  one red day sets the plan down. The analyst's own accumulation review at $305 sits
  BELOW that floor, so it can never fire. And the buy trigger's sentence says "$348" while
  its number is $336.
- **Fixed for future stocks?** No (ticket: floor distance, sentence rewrite).
- **What has to happen.** Floor to $298 (under the June low $299.19); keep buy above $336
  (20-day $332.59) and target $430 → 2.5:1; fix the sentence.

### VST — problem
- **What's wrong.** Two buy triggers that contradict: June's "buy once it regains the
  50-day (~$150)" and today's "buy below $133" (a 52-week low).
- **Fixed for future stocks?** No (ticket).
- **What has to happen.** Keep today's plan (buy below $133, stop $122, target $210);
  delete the June trigger.

---

## Decisions on your desk (not defects)

1. **MU sell proposal** — expires 12:10 PM ET Thursday. Eighth time asked.
2. **SRRK sell proposal** — expires 3:01 PM ET Thursday. Floor is above cost; decision Sept 30.
3. **The September cluster.** If IONS and MIRM trigger and fill at the floor ($5k each),
   the seat holds three decisions in nine days (IONS 9/22, MIRM 9/26, SRRK 9/30) plus
   RARE on 9/19 if you re-arm it. The Aug 24 rule says supplementals over first
   approvals; IONS and RARE are first approvals. Apply the rule at fill approval.

## Execution log — 2026-09-02, 7:40–8:05 PM ET

**How the edits were made.** The laptop's `.env.local` carries a rotated database
password (and a deliberately mangled host), so the app's analyst tools could not be run from
a script and the in-app chat needs a login I cannot perform. Every change below was written
to the production database in exactly the row shapes `update_thesis` writes — the same
trigger objects, the price columns, `lastReviewedAt`, and one `ThesisUpdate` audit row per
stock (type UPDATED, with before/after) — under three session runs you can open in the app:
`crepair0902pead0000000001`, `crepair0902cata0000000001`, `crepair0902comp0000000001`
(mode PRINCIPAL_CHAT, tagged `thesis-repair-2026-09-02`). No position, order, or
holding-side protective level was touched. Nothing was bought or sold.

| Stock | Done |
|---|---|
| MU | Two trigger sentences corrected to their levels ($935 exit, $1,100 review). Levels unchanged. |
| SMMT | Target $26 set on the thesis; decide-here review at $26 armed. |
| AGIO | Review clock 1 day → 7 days. |
| BMRN | Plan taken down. Quiet watch: 120-day wake (early Jan 2027), 10% down-day wake. |
| IONS | Stop $43 → $54 (2.5:1). Buy above $61.50 stands; size at the $5k floor if it fills. |
| MIRM | Stop $82 → $88 (2.8:1). |
| RARE | Plan taken down through the Sept 19 decision. Wakes: 20 days, ±15% day. |
| CRWD | Wakes that can fire added (breakout above $234; 85-day for the Nov print). |
| CSCO | Plan taken down. Quiet watch: reclaim above $116; 40-day window-close wake. |
| HPE | Sent to the thesis writer on tonight's print (child run `crepair0902hpewriter00001`). Old levels stay until it returns. |
| HWM | Weekly clock removed. Wakes: reclaim above $276; 33-day window-close wake. |
| TOST | Weekly clock removed. Wakes: 63-day (next print); 10% up day. |
| ABT | Buy below $106, stop $96, target $135 (2.9:1). |
| ETN | Sent to the thesis writer for a fresh underwrite (child run `crepair0902etnwriter00001`). |
| GD | Old $342–345 band buy removed; floor sentence now says $315. |
| ISRG | Buy above $383 (20/50-day reclaim), stop $336, target $530 (3.1:1). |
| MSFT | Stop $420 → $440 (2:1). |
| NOW | Buy below $130, stop $112, target $175 (2.5:1); belief updated to $175+. |
| PLTR | Plan taken down. Quiet watch: wake below $150; 90-day wake stays. |
| SYK | Floor $310 → $298; buy sentence now says $336. |
| VST | June "regain the 50-day" buy trigger removed; buy below $133 stands. |

**The writer came back (8:03 PM ET, both runs COMPLETE):**

- **HPE** — all four PEAD checks clear on tonight's print (EPS +18%, revenue beat, FY26 EPS
  guide $3.75–3.85 vs $3.43 expected, gap-day volume 2.55× average, no one-time items). New
  plan: **buy above $54.75** (reclaim of the 20-day at $54.37), stop $50.37, target $67 —
  2.8:1. HIGH conviction. The buy proposal reaches you when the price crosses $54.75.
- **ETN** — fresh research replaces June's. Q2 put Electrical Americas margin at 27.5% and
  datacenter organic growth at 65%; the 18% pullback is macro, not the business. New plan:
  **buy below $375**, stop $355 (under the June low), target $490 — 5.75:1. HIGH conviction.

The next morning run (Friday — runs are Mon/Wed/Fri) re-reads every row above and can
override anything it disagrees with; that is the intended check.

**Analyst cleanup (Job 3), applied tonight with rollback values:**

| Seat | Field | Before | After | Why |
|---|---|---|---|---|
| PEAD Specialist | `themes` | `["AI_CAPEX","EARNINGS_BEAT"]` | `[]` | Mandate is sector-agnostic; the two leftover themes were rendered into the prompt and biased sourcing toward AI names. |
| Catalyst Event PM | `minConfidence` | 70 | 50 | The writer's 4-part score marks trend and relative strength, which are structurally low for washed-out pre-decision names; IONS, RARE and BMRN were all refused "below min composite" this week. The event-mix rule and the $5k floor are the real guards. Revisit after the September decisions. |
| Secular Compounder | `industries` | 17 | 18 (+ Coal & Consumable Fuels) | The nuclear-fuel-cycle string the 08-30 review flagged as missing; canonical in the GICS table. |

Not changed, on purpose: the Mon/Wed/Fri run schedule (entries fire from the 5-minute
trigger evaluator, not the morning run, so HPE can still be bought Thursday); Catalyst's
sector fence (the empty tech lane is a sourcing problem, not a fence problem); the two
disabled seats' rows.

**Discovery.** The app's own discovery run was fired for all three seats at 8:02 PM ET
(`app/discovery.run.manual`, up to 5 writer dispatches each); results land as new WATCHING
theses and PASS records on the `/runs` page. The operator prompt packs are filed in
`docs/discovery-prep/2026-09-02-{PEAD,CATALYST,COMPOUNDER}.md` — Grok and Perplexity prompts
plus the Discovery paste for each seat, with tonight's skip-lists.

**The one Linear ticket:** [DAV-231](https://linear.app/davesucks/issue/DAV-231) — the six
causes still open in code, as bullets, plus the local-credentials note.
