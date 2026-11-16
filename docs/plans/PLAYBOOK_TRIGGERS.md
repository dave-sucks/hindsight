# Playbook triggers (roadmap 9.0)

**Status: a draft for the owner to approve. Nothing here is built; roadmap 9.5 builds it.**

A stock has triggers and nothing else. A playbook (one of the 12 setups in `lib/agent/knowledge/setups.ts`, shown in Settings → Playbook) says which triggers a stock gets: its watch lines, and the sell lines it brings when it is bought. This page gives both for each playbook, as trigger sentences.

## How it works

1. **The levels don't change.** Account → Analyst → Stock: an analyst's trigger overrides the account's of the same kind, and a stock's overrides both. Same kind means the same measure, direction, variable and action, whatever the number. A playbook only writes stock triggers.
2. **On a watch, there are three kinds of trigger:** Buy if, Review if, and Stop watching if. A "Stop watching if" line ends the watch. It never becomes a sale.
3. **The buy proposal brings the holding's sell triggers.** The playbook's rule sets them from that day's chart, when the proposal is made:
   - "Sell if below $S", at the chart level where the setup is wrong, at least the playbook's ATR distance under the buy.
   - The playbook's take-profit, if it has one, such as "Trim 50% if above $H" at a chart level like the prior high, never a price of our own choosing. The Street's average target can at most be a "Review if above".
   - The size is the risk for the trade ÷ (buy − S).

   You see these on the proposal and can change them with Edit & Approve, which already exists: the proposal's two prices, which the fill writes as triggers.
4. **At the fill**, every watch-only line comes off: the buy lines, the Stop watching lines, and any buying-window review. The approved sell triggers go on, and so do the playbook's holding lines (`lib/agent/triggers/setup-exits.ts`). The watch's review clock stays; a stock with none gets its horizon's (#994). The buy-time sell price you can set in Settings → Triggers is unchanged.
5. **After a sale back to watch**, the run that keeps the stock on watch writes the playbook's watch lines again.

**Writing the lines.** Every price comes from the chart (the `chart.` fields of `get_stock_data`), never a round number. A line on something that moves uses its variable ("the 50-day average"). Dates count from the stock's event date. A playbook never copies an analyst or account rule. Buys, adds, trims and sales are Send to Agent. Reviews are Flag for Review unless marked; Auto is never set. Session counts are saved as calendar days on the market calendar.

**What every stock already inherits** (live, 2026-11-16). The account's rules:

- Review every 7 days, on holdings only.
- Review within 5 days before earnings.
- Review if earnings beat or miss.
- Review if it files something material with the SEC.
- Add if above 7% from yesterday's close, on holdings.
- Sell if below 6% from the high since we bought, on holdings.

The analysts' rules:

- **Catalyst Event PM:** Review 10 days before the event date · Review 30 days after it · Review if it files an 8-K 8.01 or 7.01.
- **PEAD Specialist:** Review if above 10% from our entry · Review if below 12% from it.
- **Secular Compounder:** Review if below 15% from the high since we bought · Review if below the 200-day average · Review if above or below 15% from our entry.

## The six playbooks the analysts use

### Pre-catalyst run-up (`PRE_CATALYST`): Catalyst Event PM

The stock needs its event date on the thesis.

| On a watch | How the level is picked |
|---|---|
| Review 70 days before the event date | While parked: the buying window opens. The run that answers it writes the buy lines and removes this line, which is the same kind as the analyst's 10-day review |
| Buy if above $P on the close, at least 1.5× normal volume, and below $C | P: the base's pivot plus 0.1–0.3%; C: 5% past P. Only when the stock passes the breakout's checks |
| Buy if within 2% of the 50-day average | Only while the 50-day is rising and the stock's pullbacks held it |
| Buy if above $H on the close | H: the 20-day high, above today's price (the reclaim) |
| Review every 7 days | Moves H to the latest 20-day high |
| Stop watching if below $L on the close | L: the last swing low |
| Stop watching 21 days before the event date | The window closed with no buy |

| On a holding | How the level is picked | From |
|---|---|---|
| Sell if below $S | S: the last swing low on the day of the proposal, at least 1 ATR under the buy | Proposal |
| Sell 7 days before the event date | The run-up sells before the decision (question 2) | Fill |
| Trim 50% if above $H, only if the analyst believes it | H: the prior high | Proposal |
| Review every 7 days | The watch's clock | Kept |

The buy is half the normal risk, and a 50% gap may cost at most 0.5% of the account, because a gap skips any sell line. To hold through the event, the run answering the analyst's 10-day review removes the date sale and says why.

*Can't be written:* "the run-up stalls" and "a peer's decision reads across", which the 7-day review judges. "Never the day before the event."

### Base breakout (`BASE_BREAKOUT`): Catalyst Event PM, Secular Compounder

| On a watch | How the level is picked |
|---|---|
| Buy if above $P on the close, at least 1.5× normal volume, and below $C | P: the base's pivot plus 0.1–0.3%; C: 5% past P |
| Review every 7 days | The base can extend and its pivot move |
| Stop watching if below $L on the close | L: the base's low. A base that breaks down is no base |

| On a holding | How the level is picked | From |
|---|---|---|
| Sell if below $S | S: under the last contraction's low, or the base's low if that is within 8% of the buy. At least 1 ATR under the buy, never more than 8% | Proposal |
| Trim 50% if above $H | H: the prior high above the buy, else twice (buy − S) above the buy (question 1) | Proposal |
| Review 20 sessions after the buy | No progress in 10–20 sessions is a failed breakout | Fill |
| Review if above N% from our entry | N: (buy − S) ÷ buy. Once it is up one risk, the run raises "Sell if below" to the buy price | Fill |
| Review every 7 days | The watch's clock | Kept |

*Can't be written:*

- The Trend Template: no measure reads whether an average is rising, so the run answering the buy checks `chart.trendTemplate`.
- Volume drying up into the pivot.
- "Earnings at least 10 days away": a buy can't read the report date.
- A close under the 21-day EMA.
- The 8-week rule, which the run answering the trim checks.

### Pullback to a rising average (`MA_PULLBACK`): all three analysts

| On a watch | How the level is picked |
|---|---|
| Buy if within 2% of the 50-day average (or the 20-day) | The average the stock's pullbacks held, only while it is rising |
| Review every 7 days | Re-checks that the average is still rising |
| Stop watching if below the 50-day average and at least 1.5× normal volume | "A close below the 50-day on volume ends the setup." It reads during the day |

| On a holding | How the level is picked | From |
|---|---|---|
| Sell if below $S | S: the pullback's swing low, or 1 ATR under the average bought if that is higher; at least 1 ATR under the buy | Proposal |
| Sell if below the 50-day average and at least 1.5× normal volume | The setup is over | Fill |
| Trim 50% if above $H | H: the prior high the pullback came from (question 1) | Proposal |
| Review 10 sessions after the buy | Ten sessions to reclaim the prior high | Fill |
| Review every 7 days | The watch's clock | Kept |

*Can't be written:* the reversal (a close above the prior day's high), which the run answering the buy checks, and "below-average volume" on the pullback.

### Post-earnings drift (`PEAD`): PEAD Specialist

| On a watch | How the level is picked |
|---|---|
| None before the report | The account's "Review if earnings beat" wakes a run at the first open after the report |
| Buy if above $X on the close | X: today's price, written on days 1–3 after a report with EPS 5%+ over, a revenue beat, guidance raised, reaction volume 2×+, not already 10% past the gap, and never a beat the stock fell on |
| Review every 7 days | The first one after day 3 re-writes the stock on the pullback playbook or lets it go |
| Stop watching if below $L on the close | L: the gap day's low |

| On a holding | How the level is picked | From |
|---|---|---|
| Sell if below $S | S: the gap day's low or 8% under the buy, whichever is higher; at least 1 ATR under the buy | Proposal |
| Trim 50% if above $H | H: the prior high above the buy, else twice (buy − S) above the buy (question 1) | Proposal |
| Review 60 days after the buy | Hold 30–60 days | Fill |
| Review every 7 days | The watch's clock | Kept |

*Can't be written:*

- A wake on the session after the report: for a report before the open, the beat fires on the reaction day itself.
- "The gap held."
- "Out before the next print" as a sale: an earnings condition only takes a review.
- Estimate revisions, because we have no estimate history.

### Episodic pivot (`EPISODIC_PIVOT`): PEAD Specialist

| On a watch | How the level is picked |
|---|---|
| Review if at least 8% gap up and at least 3× normal volume | Send to Agent: the run reads the news and writes the lines below |
| Buy if above $H on the close | H: the gap day's high. On a day-2 hold above the gap day's middle, today's price |
| Review every 7 days | Moves the levels to the finished gap day |
| Stop watching if below $L on the close | L: the gap day's low. A filled gap ends the setup |

| On a holding | How the level is picked | From |
|---|---|---|
| Sell if below $L | L: the gap day's low, at least 1 ATR under the buy | Proposal |
| Review if below $M on the close | M: the gap day's middle. Send to Agent | Fill |
| Review 5 sessions after the buy | After 3–5 sessions of progress, the run takes a partial | Fill |
| Review every 7 days | The watch's clock | Kept |

*Can't be written:* "neglected before the news", which is research, and a 10-day average.

### Compounder accumulation (`COMPOUNDER_ACCUMULATION`): Secular Compounder

| On a watch | How the level is picked |
|---|---|
| Buy if above $P on the close and at least 1.5× normal volume, or within 2% of the 50-day average, or above the 50-day average | P: the base's pivot. The two 50-day ways in only while the 50-day is rising. When one is already true, "Buy if above $X" at today's price |
| Review every 30 days | |
| Stop watching if below $L on the close | L: the 52-week low |

| On a holding | How the level is picked | From |
|---|---|---|
| Sell if below $S | S: under the last base's low or swing low, at most 25% under the buy, at least the playbook's ATR distance under it | Proposal |
| Review 60 days after the buy | The business checkpoint | Fill |
| Add if above 7% from our entry | The second half | Fill |
| Review every 30 days | The watch's clock | Kept |

The first buy is half of full size. The playbook has no take-profit: it trims only at valuation extremes, and no measure reads a valuation.

*Can't be written:*

- The quality tests and the named invalidation (guidance cut twice, a margin break). These are read by the account's and analyst's reviews.
- The second half on a held 50-day pullback: it would already be true on a 50-day buy.

## The other six (no analyst uses these today)

- **Momentum-leader flag** (`MOMENTUM_FLAG`):
  - *Watch:* Buy if above $F on the close and at least 1.5× normal volume (F: the flag's high) · Review every 7 days · Stop watching if below $L on the close (L: the flag's low).
  - *Holding:* Sell if below $S (S: the buy day's low, at most one ADR under the buy) · Review 5 sessions after the buy.
- **Mean-reversion bounce, RSI-2** (`RSI2_BOUNCE`):
  - *Watch:* Buy if above the 200-day average and below RSI 10 (2-day RSI) · Stop watching if below the 200-day average.
  - *Holding:* Sell if below $S (S: the flush's low) · Sell if below the 200-day average · Sell if above RSI 65 (2-day RSI) · Review 5 sessions after the buy.
  - *Can't be written:* "buy the close", since RSI reads the morning's numbers, and a 5-day average.
- **52-week-high momentum** (`RS_52W_HIGH`), a screen: a wake on a watch, "Review if within 5% of the 52-week high and at least 0 points ahead of the S&P (3 months)", then the breakout's, flag's or pullback's lines.
- **Insider cluster buying** (`INSIDER_CLUSTER`), a screen: a wake on a watch, "Review if at least 3 insiders buying in the last 30 days", then the breakout's or pullback's lines. Its "Sell if below $S" sits at the lowest insider purchase price or 12% under the buy, whichever is higher.
- **Estimate-revision momentum** (`ESTIMATE_REVISION`) and **sector rotation** (`SECTOR_ROTATION`), screens: no lines of their own. We have no estimate history, and no measure reads a group's rank.

## What 9.5 changes in code

- **(a) `place_trade`** takes the sell price from the playbook's rule on today's chart. Today it reads the stock's "Sell if below" trigger (`planOfRow`).
- **(b) The fill** removes the Stop watching lines instead of keeping them as the sale. It also writes the approved upper price with the playbook's action ("Trim 50% if above"); today a new one lands as "Review if above" (`ops.ts`, the level op).
- **(c) One function** computes each playbook's sell levels from `lib/market-data/price-structure.ts`. (a) uses it, and so does (d) for the one holding line that needs a chart price (the episodic pivot's gap-day middle).
- **(d) `setup-exits.ts`** writes the "From: Fill" rows above:
  - It adds the breakout's one-risk review, the pre-catalyst date sale, the pullback's 50-day sale, the episodic pivot's middle-of-the-gap review, and the Compounder's add.
  - It drops its move-from-entry trim, which the proposal's take-profit replaces.
  - It drops the "beat the market sold" review, since the account's beat review already covers every report.

## Checked against recent trades

These lines were replayed on real daily prices against the last five sales, three passed stocks and five watched ones:

- **A sell line at the swing low matters.** One pre-catalyst holding sold at its swing low three days before a 20% gap down; it is about 40% under the buy today.
- **A falling 50-day isn't a pullback.** "Within 2% of the 50-day" on a falling average would have bought a watched stock that is down more than 40% since.
- **A reclaim written once goes stale.** Moved weekly to the 20-day high, one pre-catalyst watch would have bought its run-up, about 12% higher today.

## Questions for the owner

1. **The take-profit for the breakout, PEAD and the pullback:** the prior high above the buy, else twice the risk above the buy? The prose asks for the prior high, and some stocks have none above them. *Recommended:* yes.
2. **The pre-catalyst exit: "Sell 7 days before the event date"?** It asks every day until sold. The prose sells one to two weeks before the decision. At 7 days, the analyst's 10-day review comes first and can remove it to hold through. *Recommended:* 7 days.
