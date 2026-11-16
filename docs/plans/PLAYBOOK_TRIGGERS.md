# Playbook triggers (roadmap 9.0)

**Status: a draft for the owner to approve. Nothing here is built; roadmap 9.5 builds it.**

**The rule.** Every trigger on a stock was written by the owner, by an agent, or by a playbook template listed in Settings → Playbook. What fires is exactly what is saved. Nothing changes a trigger's meaning or timing when it is checked. Where code does that today, this spec deletes it.

## How it works

1. **The levels don't change.** Account → Analyst → Stock: an analyst's trigger overrides the account's of the same kind, and a stock's overrides both. Same kind means the same measure, direction, variable and action, whatever the number.
2. **A playbook is chosen per thesis.** The Writer picks it from the analyst's list. It's saved on the thesis and shown there. A playbook is a set of templates, listed in Settings → Playbook. They write ordinary stock triggers, exactly as if you added them by hand. Changing a playbook later doesn't change stocks already written.
3. **On a watch there are three kinds of trigger:** Buy if, Review if, and Stop watching if. Stop watching is its own stored action: it ends the watch and never sells. When it mints the thesis, the Writer fills the watch templates' prices from the chart.
4. **The buy proposal.** The trigger run fills the holding's sell prices from the playbook's templates: "Sell if below $S", plus the take-profit if the playbook has one. Each price comes with its reason. `place_trade` takes them, and the size is the risk for the trade ÷ (buy − S). You see them on the proposal and change them in Edit & Approve. An agent's buy needs the stock's playbook; a stock with none is a pass, or gets a playbook first. Your own Trade ticket is unchanged.
5. **At the fill**, the buy lines, Stop watching lines and buying-window reviews come off. The approved sell lines go on, along with the playbook's holding templates exactly as Settings → Playbook lists them. If the stock already has a line of the same kind, the fill leaves it, and the Activity line names the template it didn't write. A template with a fixed number is written as listed at the fill. Any number that depends on the chart or the buy is filled by the run in the proposal.
6. **After a sale back to watch**, the Sell lines come off and the watch templates go on again.

**Writing the lines.**

- Every price is read from the chart (the `chart.` fields of `get_stock_data`), never a round number. The Street's average target can at most be a "Review if above".
- A line on something that moves uses its variable ("the 50-day average"), and dates count from the stock's event date.
- A template is the playbook's own rule; each playbook's review clock is its own, and on its stocks it replaces the account's 7-day one.
- Buys, adds, trims and sales are Send to Agent. Reviews are Flag for Review unless marked. Auto is never set.
- Session counts are saved as calendar days.

**What every stock already inherits** (live, 2026-11-16):

- **The account:** Review every 7 days (holdings) · Review within 5 days before earnings · Review if earnings beat or miss · Review if it files something material with the SEC · Add if above 7% from yesterday's close (holdings) · Sell if below 6% from the high since we bought (holdings).
- **Catalyst Event PM:** Review 10 days before the event date · Review 30 days after it · Review if it files an 8-K 8.01 or 7.01.
- **PEAD Specialist:** Review if above 10% from our entry · Review if below 12% from it.
- **Secular Compounder:** Review if below 15% from the high since we bought · Review if below the 200-day average · Review if above or below 15% from our entry.

## The six playbooks the analysts use

In the holding tables, "Proposal" means the trigger run fills the price when it proposes the buy. "Template" means the fill writes the line as listed. "Kept" means a watch line that stays through the fill.

### Pre-catalyst run-up (`PRE_CATALYST`): Catalyst Event PM

The stock needs its event date on the thesis.

| On a watch | How the level is picked |
|---|---|
| Review 70 days before the event date | While parked: the buying window opens. The run that answers it writes the lines below and removes this one, which is the same kind as the analyst's 10-day review |
| Buy if above $P on the close, at least 1.5× normal volume, and below $C | P: the base's pivot plus 0.1–0.3%; C: 5% past P. Only when the stock passes the breakout's checks |
| Buy if within 2% of the 50-day average | Only while the 50-day is rising and the stock's pullbacks held it |
| Buy if above $H on the close | H: the 20-day high, above today's price (the reclaim) |
| Review every 7 days | Moves H to the latest 20-day high |
| Stop watching if below $L on the close | L: the last swing low |
| Stop watching 21 days before the event date | The window closed with no buy |

| On a holding | How the level is picked | From |
|---|---|---|
| Sell if below $S | S: the last swing low that day, at least 1 ATR under the buy | Proposal |
| Sell 7 days before the event date | The run-up sells before the decision (question 2) | Template |
| Trim 50% if above $H, only if the analyst believes it | H: the prior high | Proposal |
| Review every 7 days | | Kept |

The buy is half the normal risk, and a 50% gap may cost at most 0.5% of the account. To hold through the event, the run answering the analyst's 10-day review removes the date sale and says why.

*Can't be written:* "the run-up stalls" and "a peer's decision reads across", which the 7-day review judges. "Never the day before the event."

### Base breakout (`BASE_BREAKOUT`): Catalyst Event PM, Secular Compounder

| On a watch | How the level is picked |
|---|---|
| Buy if above $P on the close, at least 1.5× normal volume, and below $C | P: the base's pivot plus 0.1–0.3%; C: 5% past P |
| Review every 7 days | The base can extend and its pivot move |
| Stop watching if below $L on the close | L: the base's low |

| On a holding | How the level is picked | From |
|---|---|---|
| Sell if below $S | S: under the last contraction's low, or the base's low if within 8% of the buy. At least 1 ATR under the buy, never more than 8% | Proposal |
| Trim 50% if above $H | H: the prior high above the buy, else twice (buy − S) above the buy (question 1) | Proposal |
| Review 20 sessions after the buy | No progress in 10–20 sessions is a failed breakout | Template |
| Review if above N% from our entry | N: (buy − S) ÷ buy. Once it is up one risk, the run raises "Sell if below" to the buy price | Proposal |
| Review every 7 days | | Kept |

*Can't be written:*

- The Trend Template: the run answering the buy checks `chart.trendTemplate`.
- Volume drying up into the pivot.
- "Earnings at least 10 days away".
- A close under the 21-day EMA.
- The 8-week rule.

### Pullback to a rising average (`MA_PULLBACK`): all three analysts

| On a watch | How the level is picked |
|---|---|
| Buy if within 2% of the 50-day average (or the 20-day) | The average the stock's pullbacks held, only while it is rising |
| Review every 7 days | Re-checks that the average is still rising |
| Stop watching if below the 50-day average and at least 1.5× normal volume | "A close below the 50-day on volume ends the setup." It reads during the day: "only on the close" exists only for a typed price |

| On a holding | How the level is picked | From |
|---|---|---|
| Sell if below $S | S: the pullback's swing low, or 1 ATR under the average bought if that is higher; at least 1 ATR under the buy | Proposal |
| Sell if below the 50-day average and at least 1.5× normal volume | The setup is over | Template |
| Trim 50% if above $H | H: the prior high the pullback came from (question 1) | Proposal |
| Review 10 sessions after the buy | Ten sessions to reclaim the prior high | Template |
| Review every 7 days | | Kept |

*Can't be written:* the reversal (a close above the prior day's high), which the run answering the buy checks, and below-average volume on the pullback.

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
| Review 60 days after the buy | Hold 30–60 days | Template |
| Review every 7 days | | Kept |

*Can't be written:*

- A wake on the session after the report.
- "The gap held."
- "Out before the next print" as a sale, because an earnings condition only takes a review.
- Estimate revisions.

### Episodic pivot (`EPISODIC_PIVOT`): PEAD Specialist

| On a watch | How the level is picked |
|---|---|
| Review if at least 8% gap up and at least 3× normal volume | Send to Agent: the run reads the news and writes the lines below |
| Buy if above $H on the close | H: the gap day's high; on a day-2 hold above the gap day's middle, today's price |
| Review if below $M on the close | M: the gap day's middle. Send to Agent |
| Review every 7 days | Moves the levels to the finished gap day |
| Stop watching if below $L on the close | L: the gap day's low |

| On a holding | How the level is picked | From |
|---|---|---|
| Sell if below $L | L: the gap day's low, at least 1 ATR under the buy | Proposal |
| Review if below $M on the close | | Kept |
| Review 5 sessions after the buy | After 3–5 sessions of progress, the run takes a partial | Template |
| Review every 7 days | | Kept |

*Can't be written:* "neglected before the news", which is research, and a 10-day average.

### Compounder accumulation (`COMPOUNDER_ACCUMULATION`): Secular Compounder

| On a watch | How the level is picked |
|---|---|
| Buy if above $P on the close and at least 1.5× normal volume, or within 2% of the 50-day average, or above the 50-day average | P: the base's pivot; the two 50-day ways in only while the 50-day is rising. When one is already true, "Buy if above $X" at today's price |
| Review every 30 days | |
| Stop watching if below $L on the close | L: the 52-week low |

| On a holding | How the level is picked | From |
|---|---|---|
| Sell if below $S | S: under the last base's low or swing low, at most 25% under the buy, at least the playbook's ATR distance under it | Proposal |
| Review 60 days after the buy | The business checkpoint | Template |
| Add if above 7% from our entry | The second half | Template |
| Review every 30 days | | Kept |

The first buy is half of full size. There is no take-profit: the playbook trims only at valuation extremes, and no measure reads a valuation.

*Can't be written:* the quality tests and the named invalidation, which the account's and analyst's reviews read, and the second half on a held 50-day pullback.

## The other six (no analyst uses these today)

- **Momentum-leader flag** (`MOMENTUM_FLAG`):
  - *Watch:* Buy if above $F on the close and at least 1.5× normal volume (F: the flag's high) · Review every 7 days · Stop watching if below $L on the close (L: the flag's low).
  - *Holding:* Sell if below $S (S: the buy day's low, at most one ADR under the buy) · Review 5 sessions after the buy · Review every 7 days.
- **Mean-reversion bounce, RSI-2** (`RSI2_BOUNCE`):
  - *Watch:* Buy if above the 200-day average and below RSI 10 (2-day RSI) · Review every 7 days · Stop watching if below the 200-day average (it reads during the day).
  - *Holding:* Sell if below $S (S: the flush's low) · Sell if below the 200-day average · Sell if above RSI 65 (2-day RSI) · Review 5 sessions after the buy · Review every 7 days.
- **52-week-high momentum** (`RS_52W_HIGH`), a screen: a watch wake, "Review if within 5% of the 52-week high and at least 0 points ahead of the S&P (3 months)", then the breakout's, flag's or pullback's lines.
- **Insider cluster buying** (`INSIDER_CLUSTER`), a screen: a watch wake, "Review if at least 3 insiders buying in the last 30 days", then the breakout's or pullback's lines. Its "Sell if below $S" sits at the lowest insider purchase price, or 12% under the buy if that is higher.
- **Estimate-revision momentum** (`ESTIMATE_REVISION`) and **sector rotation** (`SECTOR_ROTATION`), screens: no lines of their own.

## 9.5, as PRs (smallest first)

1. **No hidden timing, no status-based meaning.**
   - Delete `watchedFloorOnClose` (`types.ts`, the trigger evaluator, `live-evaluate.ts`, `TriggerPill.tsx`). A Stop watching line saves its own "only on the close" setting, the same setting any typed price has, and the pill and the dialog show it.
   - Stop watching becomes its own stored action. Delete the "sells" label switch in `describe.ts`, the evaluator's sale-on-a-watch branch (`stop-watching.ts`), and the schema's DEMOTE → EXIT mapping. A "Sell if" line exists only on a holding.
   - One data update, so nothing fires differently: the 8 watch sale lines on the live account get the Stop watching action and their "only on the close" setting, and the one stored DEMOTE becomes Stop watching.
2. **No clock nobody chose.**
   - Delete `defaultTriggersForHorizon` and `CADENCE_DAYS_BY_HORIZON`, with the two places that fall back to them (the shown review date in `defaults.ts`, and `watchlist.actions.ts`).
   - The Writer writes the playbook's watch templates.
   - Settings → Playbook lists every template exactly as it will be written, and the thesis shows its playbook.
3. **The buy and the fill.**
   - `place_trade` takes the sell prices the trigger run filled from the templates, and the breakout's one-risk review, each with its reason. The proposal and Edit & Approve show them.
   - The fill removes Stop watching lines and buying-window reviews. It writes a take-profit as the template's "Trim 50% if above"; today a new upper price lands as a review.
   - The fill writes the holding templates. `setup-exits.ts` gains the date sale, the 50-day sale and the add. It loses its move-from-entry trim and the "beat the market sold" review, which the account's beat review already covers.
   - A sale back to watch removes the Sell lines and writes the watch templates.
4. **Question 3, if yes:** delete "stop when buying" (`lib/trading/auto-stop.ts`, its settings, and the sizing that reads it).

## Checked against recent trades

These lines were replayed on real daily prices against the last five sales, three passed stocks and five watched ones:

- **A sell line at the swing low matters.** One pre-catalyst holding sold at its swing low three days before a 20% gap down; it is about 40% under the buy today.
- **A falling 50-day isn't a pullback.** "Within 2% of the 50-day" on a falling average would have bought a watched stock that is down more than 40% since.
- **A reclaim written once goes stale.** Moved weekly to the 20-day high, one pre-catalyst watch would have bought its run-up, about 12% higher today.

## Questions for the owner

1. **The take-profit for the breakout, PEAD and the pullback:** the prior high above the buy, else twice the risk above the buy? *Recommended:* yes.
2. **The pre-catalyst exit: "Sell 7 days before the event date"?** At 7 days, the analyst's 10-day review comes first and can remove it to hold through. *Recommended:* 7 days.
3. **Delete "stop when buying"?** Every buy now brings a "Sell if below" that you approve on the proposal. "Stop when buying" is the rule that rewrites it at the fill: it sets a 6% Auto-sell and turns the stock's own line into a review. *Recommended:* yes.
