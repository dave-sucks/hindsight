# Setups

**Every playbook, with its rules.** The 12 kinds of trade an analyst can take: what must be true first, the triggers each writes, and when it has failed.

This file is built from `SETUPS` in `lib/agent/knowledge/setups.ts`; don't edit it by hand. These are the defaults: an account sees each playbook's triggers in Settings → Playbook (`lib/agent/knowledge/playbooks.ts`; the seed is `playbook-templates.ts`), and can change its sell distance numbers there (`setup-overrides.ts`). A `{name}` in a trigger is a chart level the run fills when it writes the line. How an analyst picks its setups is [Analysts](../concepts/analysts.md); how the Writer uses one is [the Writer](../agents/writer.md).

A buy pattern carries its own buy condition. A screen only finds stocks; its buy comes from one of the buy patterns it names.

## Base breakout (VCP / cup-with-handle / flat base)

`BASE_BREAKOUT` · playbook D1 · a buy pattern · horizons: trade, target, compounder

A Stage 2 stock consolidates for 4–8+ weeks in a tightening range under a clear ceiling, then breaks out on heavy volume — sellers are exhausted and institutions are buying with size.

**Before it applies:**

- Trend Template passes (chart.trendTemplate — price above a rising 150/200-day, 50-day above both, within 25% of the 52-week high, 30%+ off the low, beating SPY)
- A base of 20+ sessions (chart.base), 15–25% deep at most, the last contraction tighter than the base (≤ 5–8%)
- Volume drying up into the pivot
- Earnings at least 10 days away
- A risk-on market: breakouts fail most in a cautious one (playbook Part C)

**A buy is confirmed by:**

- A close above the pivot, not an intraday poke (intraday crosses fail about half the time)
- Volume ≥ 1.5× average on the breakout day
- No more than 5% past the pivot

**Triggers on a watch:**

- Buy if above {pivot} · only on the close and at least 1.5× normal volume and below {pivotChase}. The base's pivot plus 0.1–0.3%, and at most 5% past it.
- Review every 7 days. The base can extend and its pivot move.
- Stop watching if below {baseLow} · only on the close. The base's low.

**Triggers with the buy:**

- Sell if below {sellPrice}. Under the last contraction's low, or the base's low if within 8% of the buy. At least 1 ATR under the buy, never more than 8%.
- Trim 50% if above {priorHigh}. The prior high above the buy, else twice the risk above the buy.
- Review if above {riskPct} from our entry. One risk: (the buy price − the sell price) ÷ the buy price. Once it is up one risk, the run raises the sell price to the buy price.

**Triggers at the fill:**

- Review every 7 days. The watch's clock, kept on the holding.
- Review 28 days after the buy. 20 sessions. No progress in 10–20 sessions is a failed breakout.

**When it's failing:**

- Closes back below the pivot within days, on volume
- Breakout-day volume below average
- A breakout into earnings week

## Momentum-leader flag

`MOMENTUM_FLAG` · playbook D2 · a buy pattern · horizons: trade

A leader that already ran pulls back in an orderly way and surfs its rising short averages; the next leg starts when the range expands upward. No seat runs this today (DAV-245 ruling 3).

**Before it applies:**

- Already moved 30–100%+ in 1–3 months (top 1–2% by 1/3/6-month return)
- Average daily range (chart.adr20Pct) ≥ 3–5%
- Orderly pullback: higher lows, tightening range, riding the rising 10/20-day
- Dollar volume enough to fill the seat's size

**A buy is confirmed by:**

- Range expands upward out of the flag
- Volume ≥ 1.5× the 20-day average volume on the day it clears
- Price above the 10- and 20-day

**Triggers on a watch:**

- Buy if above {flagHigh} · only on the close and at least 1.5× normal volume. The flag's high.
- Review every 7 days. Re-checks the flag.
- Stop watching if below {flagLow} · only on the close. The flag's low.

**Triggers with the buy:**

- Sell if below {sellPrice}. The buy day's low, at most one ADR under the buy.

**Triggers at the fill:**

- Review every 7 days. The watch's clock, kept on the holding.
- Review 7 days after the buy. 5 sessions.

**When it's failing:**

- No follow-through in 3–5 days
- Closes back inside the flag

## Episodic pivot / earnings gap

`EPISODIC_PIVOT` · playbook D3 · a buy pattern · horizons: trade, target

A neglected stock reprices on unexpected news with volume many times average; institutions need weeks to build positions, so real gaps start multi-month moves. Breakaway earnings gaps fill within a month under 30% of the time.

**Before it applies:**

- Neglected before the news: flat or down for 3–6 months, not already up 30%+ in 3 months
- Gap ≥ 8% at the open on a real catalyst (blow-out earnings, approval, contract)
- Volume ≥ 3× average (ideally 10×)
- Growth numbers mid-double-digit or better; liquidity floor met

**A buy is confirmed by:**

- The gap holds (day 2 closes above the gap-day midpoint)
- Volume stays heavy

**Triggers on a watch:**

- Review if at least 8% gap up and at least 3× normal volume. The run reads the news and writes the triggers below.
- Buy if above {gapDayHigh} · only on the close. The gap day's high; on a day-2 hold above the gap day's middle, today's price.
- Review if below {gapDayMid} · only on the close. The gap day's middle.
- Review every 7 days. Moves the levels to the finished gap day.
- Stop watching if below {gapDayLow} · only on the close. The gap day's low.

**Triggers with the buy:**

- Sell if below {sellPrice}. The gap day's low, at least 1 ATR under the buy.
- Review if below {gapDayMid} · only on the close. The gap day's middle, on the holding.

**Triggers at the fill:**

- Review every 7 days. The watch's clock, kept on the holding.
- Review 7 days after the buy. 5 sessions. After 3–5 sessions of progress, the run takes a partial.

**When it's failing:**

- The gap fills
- Closes below the gap-day midpoint
- Volume fades on day 2

## Post-earnings drift

`PEAD` · playbook D4 · a buy pattern · horizons: target, trade

A clean beat-and-raise the market under-reacts to drifts for weeks. This is the setup where the condition is already true on the day the plan is written.

**Before it applies:**

- Reported in the last 1–3 sessions
- EPS surprise ≥ 5% and a revenue beat; guidance raised
- Reaction-day volume ≥ 2× the 20-day average
- The gap held — closed in the upper half of the day's range
- Not already 10%+ past the gap
- Never a beat the market sold: a beat that gaps down is a fade signal, not a buy

**A buy is confirmed by:**

- Gap held
- Surprise and guidance confirmed from the release or transcript

**Triggers on a watch:**

- Buy if above {price} · only on the close. Today's price, written on days 1–3 after a report with EPS 5%+ over, a revenue beat, guidance raised and reaction volume 2×+; not already 10% past the gap, never a beat the stock fell on.
- Review every 7 days. The first one after day 3 re-writes the stock on the pullback playbook or lets it go.
- Stop watching if below {gapDayLow} · only on the close. The gap day's low.

**Triggers with the buy:**

- Sell if below {sellPrice}. The gap day's low or 8% under the buy, whichever is higher; at least 1 ATR under the buy.
- Trim 50% if above {priorHigh}. The prior high above the buy, else twice the risk above the buy.

**Triggers at the fill:**

- Review every 7 days. The watch's clock, kept on the holding.
- Review 60 days after the buy. Hold 30–60 days.

**When it's failing:**

- The gap-day low breaks
- A beat with flat or vague guidance
- Revisions don't follow in the 1–10 days after the print

## Pullback to a rising moving average

`MA_PULLBACK` · playbook D5 · a buy pattern · horizons: target, compounder, catalyst

Buying a confirmed uptrend at a discount with a natural stop — the moving average is where institutions re-buy. MSFT touched its 50-day repeatedly on the way from $418 to $497.

**Before it applies:**

- Trend Template passes (chart.trendTemplate — price above a rising 150/200-day, 50-day above both, within 25% of the 52-week high, 30%+ off the low, beating SPY)
- Relative strength vs SPY positive over 3 months (chart.relativeStrength.vsSpy.m3 > 0)
- The pullback comes on below-average volume (healthy), not above (distribution)

**A buy is confirmed by:**

- The reversal: a close above the prior day's high after touching the average — the tactical run checks this on the fire
- The pullback came on below-average volume

**Triggers on a watch:**

- Buy if within 2% of the 50-day average. The average the stock's pullbacks held (or the 20-day), only while it is rising.
- Review every 7 days. Re-checks that the average is still rising.
- Stop watching if below the 50-day average and at least 1.5× normal volume. A close below the 50-day on volume ends the pullback. It reads during the day.

**Triggers with the buy:**

- Sell if below {sellPrice}. The pullback's swing low, or 1 ATR under the average bought if that is higher; at least 1 ATR under the buy.
- Trim 50% if above {priorHigh}. The prior high the pullback came from.

**Triggers at the fill:**

- Review every 7 days. The watch's clock, kept on the holding.
- Sell if below the 50-day average and at least 1.5× normal volume. The pullback is over.
- Review 14 days after the buy. 10 sessions to reclaim the prior high.

**When it's failing:**

- Closes below the 50-day on heavy volume
- The pullback comes on rising volume

## Mean-reversion bounce in an uptrend (RSI-2)

`RSI2_BOUNCE` · playbook D6 · a buy pattern · horizons: trade

A stock above its 200-day that flushes hard for a few days tends to snap back within a week. Not a primary seat — a scale-in rule for a held compounder.

**Before it applies:**

- Price above the 200-day
- A sharp 2–5 day flush

**A buy is confirmed by:**

- Buy the close

**Triggers on a watch:**

- Buy if above the 200-day average and below RSI 10 · 2-day rsi. A flush in an uptrend.
- Review every 7 days. Re-checks the uptrend.
- Stop watching if below the 200-day average. It reads during the day.

**Triggers with the buy:**

- Sell if below {sellPrice}. The flush's low.

**Triggers at the fill:**

- Review every 7 days. The watch's clock, kept on the holding.
- Sell if below the 200-day average. The uptrend is over.
- Sell if above RSI 65 · 2-day rsi. The bounce is done.
- Review 7 days after the buy. 5 sessions.

**When it's failing:**

- Closes below the 200-day

## 52-week-high / relative-strength momentum

`RS_52W_HIGH` · playbook D7 · a screen · horizons: trade, target, compounder

Stocks near their 52-week high and ahead of the market keep outperforming for up to 12 months (George & Hwang). A ranking, not a trigger.

**Before it applies:**

- Within 5% of the 52-week high (chart.range.pctBelow52wHigh ≤ 5)
- Beating SPY over 3–12 months; momentum is negative under 1 month — the window matters

Entered through `BASE_BREAKOUT`, `MOMENTUM_FLAG`, `MA_PULLBACK`.

**Triggers on a watch:**

- Review if within 5% of the 52-week high and at least 0 points ahead of the S&P. A screen: the run writes the breakout's, flag's or pullback's triggers.

**When it's failing:**

- Relative strength rolls over

## Pre-catalyst run-up (PDUFA and dated binaries)

`PRE_CATALYST` · playbook D8 · a buy pattern · horizons: catalyst · risk × 0.5

A dated decision. Trade the run-up (buy 6–8 weeks before, sell 1–2 before, never holding the coin flip) or hold through at a size that survives a −60% gap.

**Before it applies:**

- A dated event 21–70 days out (Thesis.catalystDate)
- A positive advisory-committee vote if one happened
- Cash runway past the decision
- Sub-$1B single-asset names: supplemental approvals and label expansions only

Entered through `BASE_BREAKOUT`, `MA_PULLBACK`.

**A buy is confirmed by:**

- Never the day before the event
- Never inside the last 21 days before the date — by then the run-up either happened or did not
- A falling chart is never bought at the market: the level sits ABOVE the current price and the run-up has to start before we are in it
- No Trend Template: a stock drifting into its decision will not pass one

**Triggers on a watch:**

- Review 70 days before the event date. While parked: the buying window opens. The run that answers it writes the buy triggers and removes this one.
- Buy if above {pivot} · only on the close and at least 1.5× normal volume and below {pivotChase}. The base's pivot plus 0.1–0.3%, and at most 5% past it. Only when the stock passes the breakout's checks.
- Buy if within 2% of the 50-day average. Only while the 50-day is rising and the stock's pullbacks held it.
- Buy if above {high20} · only on the close. The 20-day high, above today's price (the reclaim).
- Review every 7 days. Moves the reclaim to the latest 20-day high.
- Stop watching if below {swingLow} · only on the close. The last swing low.
- Stop watching 21 days before the event date. The window closed with no buy.

**Triggers with the buy:**

- Sell if below {sellPrice}. The last swing low that day, at least 1 ATR under the buy.
- Trim 50% if above {priorHigh}. The prior high. Only if the analyst believes it.

**Triggers at the fill:**

- Review every 7 days. The watch's clock, kept on the holding.
- Sell 7 days before the event date. The run-up sells before the decision. To hold through the event, the run answering the 10-day review removes this line and says why.

**When it's failing:**

- Run-up stalls inside the window
- Negative read-across from a peer's decision

## Insider cluster buying

`INSIDER_CLUSTER` · playbook D9 · a screen · horizons: target, compounder

Three or more insiders buying within a month predicts positive returns over 6–12 months — roughly double a single buy.

**Before it applies:**

- 3+ insiders buying on the open market within 30 days, ideally including independent directors
- Stronger in small and mid caps

Entered through `BASE_BREAKOUT`, `MA_PULLBACK`.

**Triggers on a watch:**

- Review if at least 3 insiders buying. A screen: the run writes the breakout's or pullback's triggers.

**Triggers with the buy:**

- Sell if below {sellPrice}. The lowest insider purchase price, or 12% under the buy if that is higher.

**When it's failing:**

- Insiders sell into the rally

## Estimate-revision momentum

`ESTIMATE_REVISION` · playbook D10 · a screen · horizons: target

Rising estimates extend post-earnings drift; the Zacks Rank in one line.

**Before it applies:**

- Consensus EPS estimates rose in the last 30 days, especially right after a print
- Cite a revision only from a source you actually read: no data we hold has the revision number

Entered through `PEAD`, `MA_PULLBACK`.

**When it's failing:**

- Revisions turn down

## Compounder accumulation

`COMPOUNDER_ACCUMULATION` · playbook D11 · a buy pattern · horizons: compounder

A business bought at conviction size and held through volatility, entered on confirmation rather than hope, sold only when the story breaks.

**Before it applies:**

- Quality: ROIC > 20% for years, high stable gross margin for its industry, FCF margin ≥ 15%, high reinvestment at high returns, aligned management
- A business that will be structurally more valuable in 3–5 years

Entered through `BASE_BREAKOUT`, `MA_PULLBACK`.

**A buy is confirmed by:**

- Thesis intact; volume matters less than for a trade
- A stock at new highs on a working thesis is working, not extended

**Triggers on a watch:**

- Buy if above {pivot} · only on the close and at least 1.5× normal volume or within 2% of the 50-day average or above the 50-day average. The base's pivot; the two 50-day ways in only while the 50-day is rising. When one is already true, the buy is at today's price.
- Review every 30 days. The compounder's own clock.
- Stop watching if below {low52} · only on the close. The 52-week low.

**Triggers with the buy:**

- Sell if below {sellPrice}. Under the last base's low or swing low, at most 25% under the buy, at least the playbook's ATR distance under it.

**Triggers at the fill:**

- Review every 30 days. The watch's clock, kept on the holding.
- Review 60 days after the buy. The business checkpoint.
- Add if above 7% from our entry. The second half.

**When it's failing:**

- The named invalidation happens
- Guidance cut
- Margin break

## Sector and theme rotation

`SECTOR_ROTATION` · playbook D12 · a screen · horizons: target, trade

Stocks move in groups and leadership rotates; three longs in one group are one bet.

**Before it applies:**

- The stock's group is Leading or Improving by relative strength vs SPY and its slope
- Buy the leader in a leading group; skip the best chart in a lagging group

Entered through `BASE_BREAKOUT`, `MA_PULLBACK`.

**When it's failing:**

- The group turns Lagging — a review for every name in it
