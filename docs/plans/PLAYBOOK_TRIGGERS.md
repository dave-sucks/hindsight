# Playbook triggers (roadmap 9.0)

**Status: a draft for the owner to approve. Nothing here is built; roadmap 9.5 builds it.**

A stock has triggers and nothing else. A playbook (one of the 12 setups in `lib/agent/knowledge/setups.ts`, shown in Settings → Playbook) is a list of stock triggers: the ones the Writer writes on a watch, and the ones the buy adds when it becomes a holding. This page gives that list for each playbook, in the words the app uses for a trigger. Where a playbook's prose asks for something no trigger can say, the section flags it and writes nothing.

## How playbooks fit the trigger levels

Nothing about the levels changes:

- **Account → Analyst → Stock.** An analyst's trigger overrides the account's of the same kind, and a stock's overrides both. Same kind means the same measure, direction, variable and action; the number doesn't count. That is the only thing that decides which trigger applies.
- **A playbook writes stock triggers, and nothing else.** They are ordinary stock triggers: they show on the stock, anyone can edit them, and they override the analyst's and the account's exactly as a trigger you add by hand does. A playbook adds no rule about when a trigger applies, is skipped or is silenced.
- **The watch list** is written by the Writer when it writes the stock, through `triggers` on the new thesis and `add_triggers` after that.
- **The buy** does what it does today (after roadmap 14.1, PR #994). It removes the buy lines, keeps every other line on the stock, and adds the horizon's review clock and the playbook's exits (`setupExitTriggers`, `lib/agent/triggers/setup-exits.ts`). It skips any line whose kind the stock already has.
- **So the floor is written on the watch.** Every watch carries "Stop watching if below $X". When the stock is bought, the buy keeps that line, and from then on it reads "Sell if below $X": the holding's floor. Every holding has one. `place_trade` already refuses a buy without it.
- **Stop when buying** is an account setting (an analyst may have its own), and it acts at the buy exactly as today. This spec doesn't change it. On this account it is on at 6%. A floor more than 6% under the buy is replaced by its Auto-sell 6% under. A tighter floor stays, as "Review if below $X", with the 6% Auto-sell under it.

How the lines are written:

- **Levels come from the chart** (the `chart.` fields from `get_stock_data`), never round numbers. We set no price target of our own; "target" only means Wall Street's. There is no minimum reward for the risk.
- **A moving line uses its variable** (the 50-day average, the high since we bought), never the day's number typed in. **Dates count from the event date.** A playbook never writes a copy of an analyst or account rule.
- **A line keeps its "on the close" setting** after the buy.
- **On fire:** every buy, add, trim and sale is Send to Agent; a review is Flag for Review unless the table says Send to Agent. Auto is never set; it is the owner's alone.
- **Sessions:** where a playbook counts sessions, the line is saved in calendar days on the market calendar, as `setupExitTriggers` already does.

## What every stock already inherits

These are the live rules on 2026-11-16. Editing one reaches every stock, which is why a playbook never copies them.

| Rule | From | Reaches a watch | Reaches a holding |
|---|---|---|---|
| Review every 7 days | Account | No: a watch's clock is its own | Yes, unless the stock has its own clock |
| Review within 5 days before earnings | Account | Yes | Yes |
| Review if earnings beat · Review if earnings miss (Send to Agent) | Account | Yes | Yes |
| Review if it files something material with the SEC | Account | Yes | Yes |
| Add if above 7% from yesterday's close (Send to Agent) | Account | No | Yes |
| Sell if below 6% from the high since we bought (Send to Agent) | Account | No | Yes |
| Stop when buying, 6% | Account | — | At the buy |
| Review 10 days before the event date · Review 30 days after the event date · Review if it files an 8-K 8.01 or 7.01 | Catalyst Event PM | Yes | Yes |
| Review if above 10% from our entry · Review if below 12% from our entry | PEAD Specialist | No | Yes |
| Review if below 15% from the high since we bought · Review if below the 200-day average · Review if above 15% from our entry · Review if below 15% from our entry | Secular Compounder | The 200-day review only | Yes |

## The six playbooks the analysts use

Each table lists the watch's lines. Below it are the lines the buy adds, and what the holding ends up with.

### Pre-catalyst run-up (`PRE_CATALYST`): Catalyst Event PM

The stock needs its event date on the thesis, because the date lines count from it.

| | Trigger | How the level is picked | On fire |
|---|---|---|---|
| Parked, more than 70 days out | Review 70 days before the event date | The buying window opens | Flag for Review |
| Way in, inside the window (the first the chart offers) | Buy if above $P on the close, at least 1.5× normal volume, and below $C | P: the base's pivot plus 0.1–0.3%. C: 5% past P. Only when the stock passes the breakout's checks | Send to Agent |
| | Buy if within 2% of the 50-day average | Only on a rising 50-day the stock's pullbacks held | Send to Agent |
| | Buy if above $H on the close | H: the 20-day high, above today's price (the reclaim) | Send to Agent |
| Clock | Review every 7 days | Moves H to the latest 20-day high, so the reclaim doesn't sit at an old high | Flag for Review |
| Floor | Stop watching if below $S on the close | S: the last swing low, at least 1 ATR under the buy level | — |
| The event | Stop watching 14 days before the event date | The window has closed | — |

The run that answers the 70-day review writes the way in and the clock, and removes the 70-day review. That review is the same kind as the analyst's "Review 10 days before the event date", so while it's on the stock the analyst's one doesn't apply.

- **At the buy:** the floor becomes "Sell if below $S on the close". The event line becomes "Sell 14 days before the event date", which is the run-up's exit two weeks before the decision. To hold through the event, the run removes that line and says why. The 7-day clock stays. The playbook has no exits of its own to add.
- **Size:** half the normal risk, and a 50% gap may cost at most 0.5% of the account, because a gap skips any floor.
- **Can't be written:** "the run-up stalls" and "a peer's decision reads across", which the 7-day clock judges. "Never inside the last 21 days" can't be written either. Between 21 and 14 days a buy can still fire, and the trigger run is already told the window closed at 21.
- **Inherited:** the analyst's event and filing reviews. The account's earnings and filing reviews, its 7% add and its 6% trailing sale.

### Base breakout (`BASE_BREAKOUT`): Catalyst Event PM, Secular Compounder

| | Trigger | How the level is picked | On fire |
|---|---|---|---|
| Way in | Buy if above $P on the close, at least 1.5× normal volume, and below $C | P: the base's pivot plus 0.1–0.3%. C: 5% past P (the chase limit) | Send to Agent |
| Clock | Review every 7 days | The base can extend and its pivot move | Flag for Review |
| Floor | Stop watching if below $S on the close | S: under the last contraction's low, or the base's low if within 8% of P. At least 1 ATR under P, never more than 8% under it | — |

- **The buy adds:**
  - "Review 20 sessions after the buy": no progress in 10–20 sessions is a failed breakout.
  - "Trim 50% if above N% from our entry", with N twice the floor's distance.
  - "Review if above N% from our entry", with N the floor's distance. That review's run moves the floor up to the buy price. It's new: the catalog has the breakeven in its prose but writes nothing for it. On a Compounder stock it takes the place of that analyst's +15% review, because it's the same kind.
- **Can't be written:**
  - The Trend Template. No measure reads whether an average is rising, so the run answering the buy checks `chart.trendTemplate`.
  - "Volume drying up". Volume only reads "at least".
  - "Earnings at least 10 days away". A buy can't read the report date, so the run checks it.
  - "A close under the 21-day EMA". No measure reads an EMA.
  - The 8-week rule (a stock up 20% within 3 weeks holds 8 weeks instead of taking the partial). The run answering the trim checks it.

### Pullback to a rising average (`MA_PULLBACK`): all three analysts

| | Trigger | How the level is picked | On fire |
|---|---|---|---|
| Way in | Buy if within 2% of the 50-day average (or the 20-day) | The average the stock's pullbacks held, only while it is rising | Send to Agent |
| Clock | Review every 7 days | | Flag for Review |
| Floor | Stop watching if below $S on the close | S: the last swing low, or 1 ATR under the average if that is higher. At least 1 ATR under the buy level | — |
| Setup over | Stop watching if below the 50-day average and at least 1.5× normal volume | "A close below the 50-day on volume ends the setup" | — |

- **At the buy:** both lines become sales.
- **The buy adds:** "Review 10 sessions after the buy". With question 2, also "Trim 50% if above N% from our entry" (N twice the floor's distance).
- **Can't be written:**
  - That the average is rising. The Writer checks it, and the clock re-checks it.
  - The reversal (a close above the prior day's high). No variable holds it, so the run checks it.
  - "Below-average volume" on the pullback.
  - The 50-day line can't wait for the close: an average reads during the day.

### Post-earnings drift (`PEAD`): PEAD Specialist

| | Trigger | How the level is picked | On fire |
|---|---|---|---|
| Way in | Buy if above $X on the close | X: today's price. The stock is written on days 1–3 after a report that qualifies: EPS 5%+ over, a revenue beat, guidance raised, reaction volume 2×+, not already 10% past the gap, never a beat the stock fell on | Send to Agent |
| Clock | Review every 7 days | The first review after day 3 re-writes the stock on the pullback playbook or lets it go | Flag for Review |
| Floor | Stop watching if below $S on the close | S: the gap day's low, or 8% under X if that is higher; at least 1 ATR under X | — |

A stock we watch before its report needs nothing extra: the account's "Review if earnings beat" wakes a run at the first open after the report.

- **The buy adds:** "Review 60 days after the buy" (hold 30–60 days). "Trim 50% if above N% from our entry", with N twice the floor's distance.
- **Can't be written:**
  - A wake on the session after the report. For a report before the open, the beat fires on the reaction day itself.
  - "The gap held" as a condition. "Above today's price, on the close" is the nearest line.
  - "Out before the next print" as a sale. An earnings condition only takes a review, and the account's pre-report review asks.
  - "Revisions follow", because we have no estimate history.

### Episodic pivot (`EPISODIC_PIVOT`): PEAD Specialist

| | Trigger | How the level is picked | On fire |
|---|---|---|---|
| Way in, before the gap | Review if at least 8% gap up and at least 3× normal volume | | Send to Agent |
| Way in, after the gap | Buy if above $H on the close | H: the gap day's high. When it already holds above the gap day's middle on day 2, H is today's price | Send to Agent |
| Clock | Review every 7 days | Moves the levels to the finished gap day if a run priced them mid-day | Flag for Review |
| Floor | Stop watching if below $L on the close | L: the gap day's low. A filled gap ends the setup | — |
| Early warning | Review if below $M on the close | M: the gap day's middle | Send to Agent |

- **The buy adds:** "Review 5 sessions after the buy". After 3–5 sessions of progress, that review's run takes the partial.
- **Can't be written:**
  - "Neglected before the news", which is research.
  - A partial "after N days of progress" as one trigger: a day count stands alone.
  - The 10-day trail: there is no 10-day average.

### Compounder accumulation (`COMPOUNDER_ACCUMULATION`): Secular Compounder

| | Trigger | How the level is picked | On fire |
|---|---|---|---|
| Way in, whichever comes first (one trigger) | Buy if above $P on the close and at least 1.5× normal volume, or within 2% of the 50-day average, or above the 50-day average | P: the base's pivot. The two 50-day ways in only while the 50-day is rising. When one is already true, "Buy if above $X" at today's price | Send to Agent |
| Clock | Review every 30 days | | Flag for Review |
| Floor | Stop watching if below $X on the close | X: under the last base's low or swing low, at most 25% under the buy level and at least the playbook's ATR distance under it | — |

- **At the buy:** the floor becomes "Sell if below $X on the close". The 30-day clock stays. Stop when buying then does what it does today (above).
- **The buy adds:**
  - "Review 60 days after the buy": the business checkpoint.
  - "Add if above 7% from our entry": the second half. This is new; the prose has it, and the catalog's exits have no add today.
- **The first buy:** half of full size.
- **Can't be written:**
  - The quality tests, which are research.
  - That the 50-day is rising. The Writer checks it, and the clock re-checks it.
  - The named invalidation (guidance cut twice, a margin break). The account's miss and filing reviews and the analyst's reviews are where it gets read.
  - The second half on a held 50-day pullback. Written at the buy, it would already be true on a 50-day way in.
  - Trims at valuation extremes: no measure reads a valuation.

## The other six (no analyst uses these today)

### Momentum-leader flag (`MOMENTUM_FLAG`): no analyst uses this today

- **Watch:** Buy if above $F on the close and at least 1.5× normal volume (F: the flag's high) · Review every 7 days · Stop watching if below $L on the close (L: the flag's low).
- **The buy adds:** Review 5 sessions after the buy (no follow-through in 3–5 sessions means out; a third to a half comes off after 3–5 days of progress).
- *Can't be written:* the 10-day trail, and "the buy day's low" as the floor before the buy day. The run answering the buy may raise the floor to it.

### Mean-reversion bounce, RSI-2 (`RSI2_BOUNCE`): no analyst uses this today

- **Watch:** Buy if above the 200-day average and below RSI 10 (2-day RSI) · Stop watching if below the 200-day average.
- **Floor and exit:** the flush's low isn't known until the flush. So the run that answers the buy writes the floor, "Stop watching if below $L" (L: the flush's low), and the exit, "Stop watching if above RSI 65 (2-day RSI)", before it buys. Written earlier, the exit would end the watch on most days. `place_trade` refuses a buy without a floor.
- **The buy adds:** Review 5 sessions after the buy.
- *Can't be written:* "buy the close" (RSI reads the morning's numbers), and the 5-day average.

### 52-week-high momentum (`RS_52W_HIGH`), a screen: no analyst uses this today

Writes nothing of its own. A stock it finds is written on the breakout, the flag or the pullback. As a wake on a watch: Review if within 5% of the 52-week high and at least 0 points ahead of the S&P (3 months).

### Insider cluster buying (`INSIDER_CLUSTER`), a screen: no analyst uses this today

A wake on a watch, "Review if at least 3 insiders buying in the last 30 days", then the breakout's or the pullback's lines. The floor is the lowest insider purchase price, or 12% under the buy level, whichever is higher. *Can't be written:* insiders selling.

### Estimate-revision momentum (`ESTIMATE_REVISION`) and sector rotation (`SECTOR_ROTATION`), screens: no analyst uses these today

No triggers of their own. We have no estimate history, and no measure reads a group's rank. A stock they find is written on PEAD, the breakout or the pullback.

## What 9.5 builds

1. **The Writer writes each playbook's watch lines** (the tables above). Today it writes a buy and a floor and picks the rest.
2. **Two new lines in the playbook's exits** (`setupExitTriggers`): the breakout's breakeven review and the Compounder's +7% add.
3. **Two catalog numbers**, both visible in Settings → Playbook: the questions below.

No setting, level or override changes.

## Checked against recent trades

These lines were replayed on real daily prices against the last five sales, three passed stocks and five watched ones. Three findings shaped the tables:

- **A floor that is a sale matters.** One pre-catalyst holding's floor fired and it was sold three days before a 20% gap down; it is about 40% under the buy today.
- **A falling 50-day isn't a pullback.** "Within 2% of the 50-day" on a falling average would have bought a watched stock that is down more than 40% since.
- **A reclaim level written once goes stale.** Re-set weekly to the 20-day high, one pre-catalyst watch would have bought its run-up, which is about 12% higher today.

## Questions for the owner

1. **Turn off the "beat the market sold" review in the catalog?** The buy writes it today for five playbooks. The account's "Review if earnings beat" fires on the same report, so one report starts two runs. *Recommended:* off.
2. **Give the pullback playbook a partial at twice the floor's distance?** Its prose takes a partial at the prior high. The catalog writes none for it, and a prior high can't be computed at the buy. *Recommended:* yes, the same as the breakout and PEAD.
