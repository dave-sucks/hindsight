# Playbook triggers (roadmap 9.0)

**Status: a draft for the owner to approve. Nothing here is built; roadmap 9.5 builds it.**

A stock has triggers and nothing else. Its playbook (one of the 12 setups in `lib/agent/knowledge/setups.ts`, shown in Settings → Playbook) is the only recipe for which triggers it gets. This page says, for each playbook, what the Writer writes on a watch and what the buy writes on a holding, in the words the app uses for a trigger. Where a playbook's prose asks for something no trigger can say, the section flags it instead of inventing a measure.

## Rules every playbook follows

- **Every holding has a floor** (the owner's rule, 2026-11-16). The buy writes "Sell if below $X" on every holding, whatever the playbook: a typed price from the chart, at least the playbook's ATR distance under the buy. A playbook that calls a price drop a question still gets one; its reviews sit above the floor, never instead of it. The buy is sized on it: the risk for the trade divided by the distance to the floor.
- **The words.** On a watch: Buy if · Review if · Stop watching if. On a holding: Sell if · Trim N% if · Add if · Review if. "Stop watching if" is a sale line on a stock we don't own. When it comes true, no agent wakes and the watch ends (question 1).
- **Levels come from the chart**, read when the line is written: the base's pivot and low, the last swing high and low, the 20-day and 52-week highs and lows, the recent gaps' high, middle and low, and the ATR (the `chart.` fields from `get_stock_data`). They are never round numbers. We set no price target of our own: "target" only ever means Wall Street's (`street_avg`, `street_high`). There is no minimum reward for the risk. The numbers below are the catalog's, with any change the account made in Settings → Playbook applied on top.
- **On fire.** Every buy, add, trim and sale is Send to Agent. A review is Flag for Review unless the table says Send to Agent; it does for a price line on a holding and for an event that can't wait for the next morning run, since morning runs are Monday, Wednesday and Friday. This spec never sets Auto. Auto is the owner's alone.
- **One of each kind per stock.** A stock's own trigger replaces an inherited one of the same kind for that stock: same measure, same direction, same variable, same action. The number doesn't count. "Review 60 days after the buy" and "Review 20 days after the buy" are the same kind, so a stock carries only one of them, and a stock's "Review every 30 days" replaces the account's 7. The tables avoid the kinds the analyst and the account already fill, unless a row says it replaces one on purpose.
- **What the buy does.** It removes every buy line and every line that only makes sense on a watch: a date the watch ends, a review that opens a buying window, a wake for the report. It writes the holding rows below. A watch line that also means "the setup is over" stays and becomes a holding line. Nothing from the analyst or the account is copied onto the stock, at the buy or later. A copy freezes the rule. A near-copy of a different kind (a single filing item the analyst's filing review already covers) starts two runs on one event.
- **Moving lines stay moving.** A line on something that moves (an average, the high since we bought) is written with its variable, never typed as the day's number: "Review if below the 50-day average", not the 50-day's value on the day it was written. A typed price is only for a level the chart fixed: a pivot, a swing low, a gap.
- **Dates count from the event date.** An FDA date, or a report date a playbook counts from, is saved as the stock's event date, and its lines count from that ("Review 14 days before the event date"). The earnings trigger only knows report dates and never stands in for another event.
- **After a sale.** A stock sold and kept on watch gets its playbook's way in again, at a chart level. A buy at today's price is written once, and only when the playbook's condition is already true. A run never raises a buy line to follow the price up.
- **Sessions.** Where a playbook counts sessions, the line counts calendar days, converted on the market calendar when it is written (the buy already does this for the time limit). "20 sessions after the buy" is saved as about 28 days.
- **Stop when buying.** It is on for the live account at 6%. At the buy it turns a playbook's "Sell if below $X" into "Review if below $X" when X is tighter than 6% under the buy, and replaces it when X is wider. Either way the sale becomes its own Auto-sell 6% under the buy, set as the owner's. A stock has one "Review if below $X" line, and when two compete the higher one is kept. So on this account, every floor below ends up as one of those two, and a playbook floor wider than 6% is lost (question 2).
- **Three conditions.** An agent's save takes up to eight conditions. The trigger form builds at most two, so a three-part buy written by an agent can't be rebuilt in the form as it is.

## What every stock already inherits

These are the live rules on 2026-11-16. Editing one reaches every stock, which is why a playbook never copies them.

| Rule | From | Reaches a watch | Reaches a holding |
|---|---|---|---|
| Review every 7 days | Account | No: a watch's clock is its own | Yes, unless the stock has its own clock |
| Review within 5 days before earnings | Account | Yes | Yes |
| Review if earnings beat · Review if earnings miss (Send to Agent) | Account | Yes | Yes |
| Review if it files something material with the SEC | Account | Yes | Yes |
| Add if above 7% from yesterday's close (Send to Agent) | Account | No | Yes |
| Sell if below 6% from the high since we bought (Send to Agent), the owner's | Account | No | Yes |
| Stop when buying, 6% (an Auto-sell, the owner's) | Account | — | Written at the buy |
| Review 10 days before the event date · Review 30 days after the event date · Review if it files an 8-K 8.01 or 7.01 | Catalyst Event PM | Yes, all three | Yes |
| Review if above 10% from our entry · Review if below 12% from our entry | PEAD Specialist | No | Yes |
| Review if below 15% from the high since we bought · Review if below the 200-day average · Review if above 15% from our entry · Review if below 15% from our entry | Secular Compounder | The 200-day review only | Yes |

## The six playbooks the analysts use

### Pre-catalyst run-up (`PRE_CATALYST`): Catalyst Event PM

The stock needs its event date on the thesis, because every date line here counts from it.

**On a watch, written by the Writer**

| | Trigger | How the level is picked | On fire |
|---|---|---|---|
| Parked, more than 70 days out | Review 70 days before the event date | The buying window opens | Flag for Review |
| Way in, inside the window (the first the chart offers) | Buy if above $P on the close, at least 1.5× normal volume, and below $C | P: the base's pivot plus 0.1–0.3%. C: 5% past P. Only when the stock passes the breakout's own checks | Send to Agent |
| | Buy if within 2% of the 50-day average (or the 20-day) | The average its pullbacks held. Only when it passes the pullback's checks | Send to Agent |
| | Buy if above $H on the close | H: the highest high of the last 20 sessions, above today's price (the reclaim) | Send to Agent |
| Clock, inside the window | Review every 7 days | Re-sets H to the latest 20-day high. Written once, an old high can sit far above a stock that is basing, and the run-up starts without us | Flag for Review |
| Stop watching | Stop watching 21 days before the event date | The window closed and the run-up never started | — |
| Stop watching | Stop watching if below $S on the close | S: the last swing low | — |

The run that answers the 70-day review writes the buy and the clock, and removes the 70-day review. That review is the same kind as the analyst's "Review 10 days before the event date", and while it is on the stock the analyst's review doesn't reach it. A falling chart is never bought: every buy level sits above today's price.

- *Can't be written:* "the run-up stalls inside the window" and "a peer's decision reads across". No measure says either; the 7-day clock is where the analyst judges them. "Never the day before the event": no buy can rule out a date, though the 21-day line ends the watch long before. The cash runway and an advisory vote are research.
- *Inherited:* the analyst's event and filing reviews, and the account's earnings and filing reviews.

**On a holding, written at the buy**

| | Trigger | How the level is picked | On fire |
|---|---|---|---|
| Floor | Sell if below $S | S: the last swing low (the watch's line, kept), at least 1 ATR under the buy | Send to Agent |
| Clock | None written: the account's 7 days | | |
| Exit | Sell 7 days before the event date | The run-up sells one to two weeks before the decision | Send to Agent |
| Take profit | None by default. The analyst may add "Trim 50% if above $H" | H: the prior high | Send to Agent |
| Add · Trail | None. The event is the exit | | |

The floor is a sale, and the size backs it up: the buy is half the normal risk, and a 50% gap may cost at most 0.5% of the account, because a gap skips any floor. To hold through the event, the run answering the analyst's 10-day review removes the 7-day sale and says why. An agent may remove a date sale, but never the floor. The analyst's 30-days-after review then asks again.

- *Can't be written:* nothing beyond the watch's list.
- *Inherited:* the analyst's 10-day and 30-day reviews and its filing review. The account's 7%-day add and its 6% trailing sale also reach the stock, though the playbook has neither.

### Base breakout (`BASE_BREAKOUT`): Catalyst Event PM, Secular Compounder

**On a watch**

| | Trigger | How the level is picked | On fire |
|---|---|---|---|
| Way in | Buy if above $P on the close, at least 1.5× normal volume, and below $C | P: the base's pivot plus 0.1–0.3%. C: 5% past P (the chase limit) | Send to Agent |
| Clock | Review every 7 days | The base can extend and its pivot move | Flag for Review |
| Stop watching | Stop watching if below $L on the close | L: the base's low. A base that breaks down is no base | — |

- *Can't be written:* the Trend Template (a rising 150- and 200-day, the 50-day above both, near the high, off the low, ahead of the S&P), because no measure reads whether an average is rising; the run answering the buy checks `chart.trendTemplate`. "Volume drying up into the pivot": volume only reads "at least". "Earnings at least 10 days away": a buy can't read the report date (an earnings condition only takes a review), so the run checks it. "A risk-on market": no measure.
- *Inherited:* the account's earnings and filing reviews. On a Catalyst Event PM stock, the analyst's event and filing reviews too.

**On a holding**

| | Trigger | How the level is picked | On fire |
|---|---|---|---|
| Floor | Sell if below $S | S: under the last contraction's low, or the base's low if that is within 8%. At least 1 ATR under the buy, never more than 8% under it | Send to Agent |
| Failed breakout | Review if below $P on the close and at least 1.5× normal volume | P: the pivot it broke out of | Send to Agent |
| Clock | None written: the account's 7 days | | |
| Time limit | Review 20 sessions after the buy | No progress in 10–20 sessions is a failed breakout: sell or re-set | Flag for Review |
| Take profit | Trim 50% if above N% from our entry | N: twice the distance from the buy down to the floor | Send to Agent |
| Breakeven | Review if above N% from our entry | N: the distance from the buy down to the floor. The run moves the floor up to the buy price | Flag for Review |
| Add | None written: the account's 7%-day add | | |
| Trail | None written: the account's 6% trailing sale | | |

- *Can't be written:* "a close under the 21-day EMA". The chart shows it (`chart.ema.d21`), but no measure reads an EMA, and a line on an average can't wait for the close. The 8-week rule (a stock up 20% within 3 weeks holds 8 weeks instead of trimming): no trigger can depend on how fast a gain came, so the run answering the trim checks it. "Stop to breakeven" can't move a floor by itself; the breakeven review does it.
- *Clash:* on a Secular Compounder stock, the breakeven review is the same kind as the analyst's "Review if above 15% from our entry" and would replace it (question 3).

### Pullback to a rising average (`MA_PULLBACK`): all three analysts

**On a watch**

| | Trigger | How the level is picked | On fire |
|---|---|---|---|
| Way in | Buy if within 2% of the 50-day average (or the 20-day) | The average the stock's recent pullbacks held, and it must be rising (`chart.sma.d50.slope`) | Send to Agent |
| Clock | Review every 7 days | | Flag for Review |
| Stop watching | Stop watching if below the 50-day average and at least 1.5× normal volume | "A close below the 50-day on volume ends the setup" | — |

- *Can't be written:* that the average is rising (the Writer checks it, the clock re-checks it). The reversal, a close above the prior day's high: no variable holds the prior day's high, so the run answering the buy checks it. "The pullback came on below-average volume": volume only reads "at least". A line on an average can't wait for the close, so the stop-watching line reads during the day. "Ahead of the S&P over 3 months" can be a condition, but falling behind it can't.
- *Inherited:* the account's earnings and filing reviews; on a Compounder stock, the analyst's 200-day review.

**On a holding**

| | Trigger | How the level is picked | On fire |
|---|---|---|---|
| Floor | Sell if below $S | S: the pullback's swing low once it has printed; until then 1 ATR under the average bought. At least 1 ATR under the buy | Send to Agent |
| Setup over | Sell if below the 50-day average and at least 1.5× normal volume | The watch's line, kept | Send to Agent |
| Clock | None written: the account's 7 days | | |
| Time limit | Review 10 sessions after the buy | Ten sessions to reclaim the prior high | Flag for Review |
| Take profit | Trim 50% if above $H | H: the prior high the pullback came from (the last swing high) | Send to Agent |
| Add · Trail | None written: the account's | | |

- *Can't be written:* moving the floor to the swing low once it prints. No trigger moves a floor; the next review does. On a stock the Catalyst Event PM holds into an event, the floor above is "the structural stop until the event".

### Post-earnings drift (`PEAD`): PEAD Specialist

The report date is saved as the stock's event date, so the window can count from it.

**On a watch**

| | Trigger | How the level is picked | On fire |
|---|---|---|---|
| Way in, before the report | Review if earnings beat 5% or more | Replaces the account's any-size beat review for this stock: a smaller beat isn't this trade | Send to Agent |
| Way in, days 1–3 after the report | Buy if above $X on the close | X: the price when the run writes it. It writes it only when the print qualifies: EPS 5%+ over, a revenue beat, guidance raised, reaction volume 2×+, not already 10% past the gap, and never a beat the stock fell on | Send to Agent |
| Clock | None: the window ends the watch | | |
| Window | Review 3 sessions after the event date | The drift entry is gone; the run re-writes the stock on the pullback playbook or lets it go | Flag for Review |
| Stop watching | Stop watching if below $L on the close | L: the gap day's low | — |

- *Can't be written:* a wake on the session after the report. "Within N days after earnings" is already true on the report day, and a beat fires at the first open after the report, which for a report before the open is the reaction day itself. So for those reports the buy can come on the reaction day's close, a day early. "The gap held" (a close in the upper half of the day's range) isn't a condition; "above the price when written, on the close" is the nearest line. Revenue and guidance can't be buy conditions, since an earnings condition only takes a review; the run reads them from the release.
- *Inherited:* the account's miss, pre-report and filing reviews.

**On a holding**

| | Trigger | How the level is picked | On fire |
|---|---|---|---|
| Floor | Sell if below $S | S: the gap day's low or 8% under the buy, whichever is higher, and at least 1 ATR under the buy. The watch's line, moved | Send to Agent |
| Clock | None written: the account's 7 days | | |
| Time limit | Review 60 days after the buy | Hold 30–60 days; out before the next print | Flag for Review |
| Take profit | Trim 50% if above $H | H: the prior high above the buy. With none, twice the distance from the buy to the floor (question 4) | Send to Agent |
| Add · Trail | None written: the account's | | |

- *Can't be written:* "out before the next print" as a sale. A report can only start a review; the account's 5-day pre-report review asks, and in a normal quarter the 60-day review comes first. "Revisions don't follow in 1–10 days": no data vendor we pay for serves estimate history. The 20-day close trail on a short hold: a line on an average reads during the day.
- *Inherited:* the analyst's "Review if above 10% from our entry" (raise the floor) and "Review if below 12% from our entry". The second sits under every PEAD floor and the 6% stop, so only a gap through both reaches it.

### Episodic pivot (`EPISODIC_PIVOT`): PEAD Specialist

**On a watch**

| | Trigger | How the level is picked | On fire |
|---|---|---|---|
| Way in, before the gap | Review if at least 8% gap up and at least 3× normal volume | | Send to Agent |
| Way in, after the gap | Buy if above $H on the close | H: the gap day's high. When the stock already holds above the gap day's middle on day 2, H is today's price | Send to Agent |
| Clock | Review every 7 days | | Flag for Review |
| Stop watching | Stop watching if below $L on the close | L: the gap day's low. A filled gap ends the setup | — |

The run the gap wakes reads the news, which must be a real catalyst on a stock that was flat or down for months. It writes the buy and the stop-watching line from the gap day's bar so far, and the next clock moves both to the finished bar.

- *Can't be written:* "neglected before the news" (flat or down 3–6 months, not up 30% in 3), which is research. Volume staying heavy on day 2. The gap day's levels, which are final only at the close.

**On a holding**

| | Trigger | How the level is picked | On fire |
|---|---|---|---|
| Floor | Sell if below $L | L: the gap day's low | Send to Agent |
| Early warning | Review if below $M on the close | M: the gap day's middle | Send to Agent |
| Clock | None written: the account's 7 days | | |
| Time limit and partial | Review 5 sessions after the buy | A partial after 3–5 sessions of progress: the run trims if it has moved | Flag for Review |
| Add · Trail | None written: the account's | | |

- *Can't be written:* "a partial after N days of progress" as one trigger, because a day count stands alone and can't be combined with a price condition. The 10-day trail: there is no 10-day measure (the chart has `chart.ema.d10`), and the 20-day one reads during the day. Note too that the early warning and the stop-when-buying review line are the same kind; on this account the stock keeps the 6% Auto-sell and M as its one review line.

### Compounder accumulation (`COMPOUNDER_ACCUMULATION`): Secular Compounder

**On a watch**

| | Trigger | How the level is picked | On fire |
|---|---|---|---|
| Way in, whichever comes first (one trigger) | Buy if above $P on the close and at least 1.5× normal volume, or within 2% of the 50-day average, or above the 50-day average | P: the base's pivot. The two 50-day ways in only while the 50-day is rising; on a falling one, only the breakout. When one is already true, the Writer writes "Buy if above $X" at today's price instead | Send to Agent |
| Clock | Review every 30 days | | Flag for Review |
| Stop watching | Stop watching if below $L on the close | L: the 52-week low (question 6) | — |

- *Can't be written:* the quality tests (returns on capital, margins, cash flow), which are research. That the 50-day is rising: the Writer checks it, and the clock re-checks it. "With no pullback in 30 days of uptrend, take the breakout": no trigger counts days without a pullback, so the 30-day clock is where the analyst does it. The form can't build this buy (three ways in, one of them two conditions), though an agent can save it.
- *Inherited:* the analyst's 200-day review, and the account's earnings and filing reviews.

**On a holding**

| | Trigger | How the level is picked | On fire |
|---|---|---|---|
| Floor | Sell if below $X | X: the structure the case shouldn't lose (the last base's low or swing low), at most 25% under the buy and at least the playbook's ATR distance under it | Send to Agent |
| Clock | Review every 30 days | Replaces the account's 7 | Flag for Review |
| Time limit | Review 60 days after the buy | The business checkpoint: is what we said would happen starting to happen? | Flag for Review |
| Take profit | None | Trims only at valuation extremes, and no measure reads a valuation | |
| Add (the second half) | Add if above 7% from our entry | "+7% from the first fill" | Send to Agent |
| Add (the second half) | Add if within 2% of the 50-day average | A held 50-day pullback in a market-wide dip. The run checks the dip is the market's, not the company's. Not written at the buy, where it would already be true on a 50-day way in and ask for the second half the same day; the first review after the stock is more than 2% above the 50-day writes it | Send to Agent |
| Trail | Sell if below 15% from the high since we bought | The playbook's own trail. On this stock it replaces the account's 6% one (question 2) | Send to Agent |

The first buy is half of full size, sized on the distance to the floor. The run that buys the second half removes both add lines, or they keep asking every week. Replayed on recent holdings, the +7% add worked once and bought the top once; the run checks the business before it adds.

- *Can't be written:* the named invalidation (guidance cut twice, a margin break, a capital-allocation failure). These are facts about the business; the account's miss and filing reviews and the analyst's reviews are where they get read. "A new high after a pause": "Add if above the 52-week high" can say the new high but not the pause. "Never add into company-specific bad news" is the run's check.
- *Inherited:* the analyst's four reviews. Its "Review if below 15% from the high since we bought" would fire on the same day as the playbook's 15% trail and start a second run, so it comes off the analyst's Triggers tab. Its "Review if above 15% from our entry" also says it may be time for the second half, though the playbook's add comes at 7%. The account's stop when buying also reaches the stock (question 2).

## The other six (no analyst uses these today)

### Momentum-leader flag (`MOMENTUM_FLAG`): no analyst uses this today

- **Watch:** Buy if above $F on the close and at least 1.5× normal volume (F: the flag's high, the 20-day high) · Review every 7 days · Stop watching if below $L on the close (L: the flag's low).
- **Holding:** Sell if below $D (D: the buy day's low, never wider than one ADR) · Review if below $F on the close, the stock back inside the flag (Send to Agent; a second typed sale would be the same kind as the floor, so only one could stand) · Review 5 sessions after the buy (no follow-through in 3–5 sessions means out, and a third to a half comes off after 3–5 days of progress) · trail: the account's.
- *Can't be written:* "already up 30–100% in 1–3 months" fits only partly ("above N% from the close 20 days ago"). The ADR is on the chart, not a measure. There is no 10-day average.

### Mean-reversion bounce, RSI-2 (`RSI2_BOUNCE`): no analyst uses this today

- **Watch:** Buy if above the 200-day average and below RSI 10 (2-day RSI) · Stop watching if below the 200-day average · no clock.
- **Holding:** Sell if below $L (L: the low of the flush, at least 1 ATR under the buy). The prose sets no fixed stop, but every holding has a floor · Sell if below the 200-day average · Review 5 sessions after the buy (it snaps back in 1–5 sessions or it's out) · Sell if above RSI 65 (2-day RSI). The buy is sized on the distance to the floor.
- *Can't be written:* "buy the close". RSI is read from the morning's chart numbers, so the buy fires the next session. "A close above the 5-day average": there is no 5-day average. The prose calls it best as a scale-in on a held compounder; that would read "Add if above the 200-day average and below RSI 10 (2-day RSI)", and it is not in the Compounder's playbook unless the owner adds it.

### 52-week-high momentum (`RS_52W_HIGH`), a screen: no analyst uses this today

It writes nothing of its own. A stock it finds is written on the breakout, the flag or the pullback. As a wake on a watch: Review if within 5% of the 52-week high and at least 0 points ahead of the S&P (3 months). *Can't be written:* "relative strength rolls over", since no condition says behind the S&P.

### Insider cluster buying (`INSIDER_CLUSTER`), a screen: no analyst uses this today

- **Watch:** a wake, "Review if at least 3 insiders buying in the last 30 days", then the breakout's or the pullback's way in.
- **Holding:** that playbook's rows, with its floor replaced by "Sell if below $I" (I: the lowest insider purchase price, or 12% under the buy, whichever is higher).
- *Can't be written:* insiders selling into the rally. The measure counts buying only.

### Estimate-revision momentum (`ESTIMATE_REVISION`), a screen: no analyst uses this today

No triggers. No data vendor we pay for serves estimate history, so neither the screen nor its failure ("revisions turn down") can be a trigger. A stock it finds is written on PEAD or the pullback.

### Sector and theme rotation (`SECTOR_ROTATION`), a screen: no analyst uses this today

No triggers. No measure reads a group's rank, so "the group turns Lagging" can't be written. At most two names per industry group is a sizing rule, not a trigger. A stock it finds is written on the breakout or the pullback.

## What changes from today

**For every playbook:**

- The horizon template goes (roadmap 14.1). Today the buy writes a review clock from the horizon (Catalyst and Trade daily, Target weekly, Compounder monthly), a sale at the stock's stop column, a review or sale at our own target price, and on a compounder a review 8% under the buy. After this, the clock is the playbook's or the account's, the floor is the playbook's chart level, and there is no target of ours.
- Every holding gets a floor. Today a compounder's and a pre-catalyst stock's downside could be reviews alone; it no longer can.
- After a sale, the way back in is the playbook's chart level. Today the re-entry buy is reset to the day's price each day while each proposal expires, so it climbs with the stock.
- No stock carries its own copy of an inherited rule, a moving line typed as a number, or an event date written with the earnings trigger. All three are on stocks today.
- The buy removes the watch-only lines too. Today it removes only the buy lines.
- The "beat the market sold" review is no longer written at the buy (question 5).
- Every watch gets its way in, its stop-watching line and, where the table says so, its clock from the playbook. Today a watch gets a buy, a floor and our own target price, and a clock only if the agent that asked for it set one.

**By playbook:**

- **Pre-catalyst:** the parked 70-day review and the 21-day end of the window become triggers, and the weekly clock re-sets the reclaim level. The floor is a sale at the swing low, from the chart. The daily clock becomes the account's weekly one (question 8). It gains a new sale 7 days before the event (question 7).
- **Base breakout:** the watch gains its stop-watching line at the base's low and a 7-day clock. The holding gains the failed-breakout review and the breakeven review; the review or sale at our own target price goes.
- **Pullback:** the watch gains its stop-watching line, and on the holding that line becomes a sale. It gains a trim at the prior high (today this playbook writes no partial), and the review or sale at our own target price goes.
- **PEAD:** the watch gets its own beat wake at 5%, a buy at today's price on the close, a stop-watching line at the gap day's low and a window review. The trim moves from twice the floor's distance to the prior high (question 4).
- **Episodic pivot:** the watch gets the gap wake and a buy at the gap day's high. The holding gains the early warning at the gap's middle.
- **Compounder:** the watch gets the one three-way buy (its 50-day ways in only on a rising 50-day), a 30-day clock and a 52-week-low line. On the holding, the review 8% under the buy and the copied stop give way to a floor at the structure. The +7% add is new, and the 50-day add is written by the first review, not the buy. The 30-day clock and the 60-day checkpoint stay. The playbook writes its own 15% trailing sale, and the analyst's 15% review is deleted (question 2).
- **RSI-2 bounce:** gains a floor at the flush's low.

## Checked against recent trades

Before this draft went to the owner, its lines were replayed on real daily prices against the last five sales, three passed stocks and five watched ones. These findings changed the spec:

- **Reviews alone don't sell.** On compounder holdings, the reviews fired on the way down and nothing sold until a sale line did. Summed over five recent compounder holdings, reviews alone came to about −40 points. That is why every holding has a floor, and why question 2 asks for a trailing sale.
- **A pre-catalyst floor has to be a sale.** One holding's floor fired, and the stock was sold by hand three days before a 20% gap down; it is about 40% under the buy today. Under a review-only floor nothing would have forced the sale.
- **A falling 50-day isn't a pullback.** The Compounder's "within 2% of the 50-day" would have bought a watched stock on a falling average in June; it is down more than 40% since.
- **A reclaim level written once goes stale.** A pre-catalyst watch inside its window had no buy at all. Re-set weekly to the 20-day high, the reclaim would have bought the run-up, which is about 12% higher today.
- **Re-entry buys chased.** After two sales the buy was reset to the day's price four times in a row, about 2–3% higher in all, and every proposal expired.
- **The breakout rule would have waited.** One Compounder buy came under its base's top. The breakout rule would have bought the real breakout a month later instead.
- **Passes held up.** Two passed stocks fell 28% and 42% since, and the spec passes the first too. One rose 74%, and the spec would have missed it as well (it never pulled back, and its breakout ran past the chase limit).

## Questions for the owner

1. **Should a "Stop watching if" line end the watch?** Today a sale line on a stock we watch takes down the buy and keeps the stock on watch. Once roadmap 14.1 deletes those levels there is nothing to take down. *Recommended:* it ends the watch (dropped), with one Activity line naming the line that did it.
2. **Two account settings override the Compounder playbook's sale lines. Should the playbook's lines win?**
   - **Stop when buying (6%).** At the buy, it throws out any floor more than 6% under the buy price and writes its own sale at 6%. The Compounder playbook puts its floor under the last base or swing low, often 10–25% under the buy, so on this account that floor never survives the buy.
   - **The 6% trailing sale.** It sells any holding 6% off its high. A playbook trail wider than 6% can't fire before it.

   Replayed over five recent compounder holdings:

   | Rule | Summed result |
   |---|---|
   | Reviews alone | about −40 points |
   | 25% trailing sale | about −19 points |
   | 6% trailing sale | about +2 points |
   | 15% trailing sale | about +2 points |

   The 15% trail kept the two winners longer. A deeper floor doesn't risk more money, because the buy is sized on the floor's distance: twice as deep a floor means half the shares.

   *Recommended:* the Compounder playbook writes its own trail on each stock at the buy, "Sell if below 15% from the high since we bought", and on those stocks it replaces the account's 6% trail. Stop when buying leaves a floor alone when the playbook wrote one, so it only fills in for a buy that has no floor. Both loosen what your settings do today, so both are yours to approve.
3. **When the Compounder buys on a breakout or a pullback, which playbook manages the holding?** *Recommended:* it writes its stocks on Compounder accumulation, whose way in already is a breakout, a 50-day reclaim or a 50-day pullback. A stock written on Base breakout or Pullback is a trade, with that playbook's trims and time limits. Taking those two off its list is optional.
4. **PEAD's partial: the prior high, as the prose says, or twice the floor's distance, as the code writes today?** *Recommended:* the prior high when there is one above the buy, else twice the distance.
5. **Stop writing the "beat the market sold" review at the buy?** The account's beat review fires on the same report, and two reviews on one stock start two runs. *Recommended:* drop it; the run the beat starts reads the reaction.
6. **What ends a Compounder watch?** The options are a close below the 52-week low, or no price line at all (an exception to "every watch has a Stop watching line"). *Recommended:* the 52-week low. It fires rarely, wakes no one, and doesn't repeat the analyst's 200-day review.
7. **How does the run-up exit: a sale 7 days before the event, asking daily until sold or removed, or only the analyst's review 10 days before?** *Recommended:* the sale. Holding through the event is the run's call: it removes the sale and says why.
8. **Catalyst and short-trade holdings: a daily review clock (today) or the account's weekly one?** *Recommended:* weekly. Their price and date lines already wake them when something happens.
