# Setups

**Every setup in the playbook, with its rules.** The 12 kinds of trade an analyst can take: what must be true first, where the buy, the floor and the target go, and when it has failed.

This file is built from `SETUPS` in `lib/agent/knowledge/setups.ts`; don't edit it by hand. These are the defaults: an account can change a setup's numbers in Settings → Playbook (`lib/agent/knowledge/setup-overrides.ts`). How an analyst picks its setups is [Analysts](../concepts/analysts.md); how the Writer uses one is [the Writer](../agents/writer.md).

A buy pattern carries its own buy condition. A screen only finds stocks; its buy comes from one of the buy patterns it names. Every plan needs a reward of at least twice its risk.

## Base breakout (VCP / cup-with-handle / flat base)

`BASE_BREAKOUT` · playbook D1 · a buy pattern · horizons: trade, target, compounder

A Stage 2 stock consolidates for 4–8+ weeks in a tightening range under a clear ceiling, then breaks out on heavy volume — sellers are exhausted and institutions are buying with size.

**Before it applies:**

- Trend Template passes (chart.trendTemplate — price above a rising 150/200-day, 50-day above both, within 25% of the 52-week high, 30%+ off the low, beating SPY)
- A base of 20+ sessions (chart.base), 15–25% deep at most, the last contraction tighter than the base (≤ 5–8%)
- Volume drying up into the pivot
- Earnings at least 10 days away
- A risk-on market: breakouts fail most in a cautious one (playbook Part C)

**Buy:** Close above the pivot on 1.5× volume, not more than 5% past it.

**Floor:** Under the last contraction's low, or the base low if that is within 8%. At least 1 ATR from entry. If structure needs a wider stop, the position is smaller — the stop is not wider.

**Target:** Measured move (base depth added to the pivot) or the next prior high, whichever two methods agree on. ≥ 2R; 3R is the design (7–8% stop, 20–25% target).

**Trail:**

- trade: Stop to breakeven at +1R; close under the 21-day EMA.

**Time limit:** No progress in 10–20 sessions = a failed breakout; exit or re-set. If it gains 20% within 3 weeks of the breakout, hold at least 8 weeks (O'Neil's 8-week rule) instead of selling the partial.

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

**Buy:** Close above the flag high on volume.

**Floor:** The entry day's low, never wider than one ADR. If the structure forces a wider stop, the position is smaller.

**Target:** No fixed target: sell a third to a half after 3–5 days of progress, stop to breakeven, trail the rest.

**Trail:**

- trade: Close under the 10-day (aggressive) or 20-day (patient).

**Time limit:** If it hasn't moved in 3–5 sessions, it's wrong; exit.

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

**Buy:** A close above the gap-day high, or a day-2 hold above the gap-day midpoint.

**Floor:** The gap-day low. A close below the gap's midpoint is an early warning; a filled gap is invalidation.

**Target:** Partial at 3–5 days of progress; the trail decides the rest.

**Trail:**

- trade: Close under the 10- or 20-day.

**Time limit:** Partial at 3–5 sessions; the trail decides the rest.

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

**Buy:** Days 1–3 after the print, above the gap-day low — usually already true, so the entry is set at the current price. After day 3 the drift entry is gone; a name still worth owning in an uptrend is written on the pullback setup (MA_PULLBACK).

**Floor:** The gap-day low or −8% from entry, whichever is tighter — but not inside 1 ATR.

**Target:** The prior high or a measured move; partial at 2R.

**Trail:**

- trade: Close under the 20-day.

**Time limit:** Hold 30–60 days; the bulk of the drift is inside ~20 sessions. Out before the next print.

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

**Buy:** Within 2% of the rising 20- or 50-day. The buy level is the average itself; the tactical run confirms the touch held (a close above the prior day's high). This is the entry for a stock that never dips 10%.

**Floor:** Under the pullback's swing low once it has printed; until then, 1 ATR under the average being bought (the 20-day for a 20-day pullback). At least 1 ATR from entry. A close below the 50-day on volume invalidates.

**Target:** The prior high first (a partial), then the measured move.

**Trail:**

- catalyst: The structural stop until the event.

**Time limit:** 10 sessions to reclaim the prior high, else review.

**When it's failing:**

- Closes below the 50-day on heavy volume
- The pullback comes on rising volume

## Mean-reversion bounce in an uptrend (RSI-2)

`RSI2_BOUNCE` · playbook D6 · a buy pattern · horizons: trade

A stock above its 200-day that flushes hard for a few days tends to snap back within a week. Not a primary seat — a scale-in rule for a held compounder.

**Before it applies:**

- Price above the 200-day
- A sharp 2–5 day flush

**Buy:** Above the 200-day with RSI(2) under 10; buy the close.

**Floor:** No fixed stop in the original; time and the 200-day are the stops.

**Target:** Exit on a close above the 5-day average or RSI(2) > 65. Small average gains, 65–75% win rate — the 2R floor does not describe this pattern.

**Trail:**

- trade: Close above the 5-day average or RSI(2) > 65.

**Time limit:** Snaps back within 1–5 sessions or it's out.

**When it's failing:**

- Closes below the 200-day

## 52-week-high / relative-strength momentum

`RS_52W_HIGH` · playbook D7 · a screen · horizons: trade, target, compounder

Stocks near their 52-week high and ahead of the market keep outperforming for up to 12 months (George & Hwang). A ranking, not a trigger.

**Before it applies:**

- Within 5% of the 52-week high (chart.range.pctBelow52wHigh ≤ 5)
- Beating SPY over 3–12 months; momentum is negative under 1 month — the window matters

**Buy:** A screen: it says which names; D1/D2/D5 say when. As a condition: within 5% of the 52-week high and ahead of the S&P over 3 months.
 Entry through `BASE_BREAKOUT`, `MOMENTUM_FLAG`, `MA_PULLBACK`.

**Floor:** From the entry setup used.

**Target:** From the entry setup used.

**Time limit:** From the entry setup used.

**When it's failing:**

- Relative strength rolls over

## Pre-catalyst run-up (PDUFA and dated binaries)

`PRE_CATALYST` · playbook D8 · a buy pattern · horizons: catalyst · risk × 0.5

A dated decision. Trade the run-up (buy 6–8 weeks before, sell 1–2 before, never holding the coin flip) or hold through at a size that survives a −60% gap.

**Before it applies:**

- A dated event 21–70 days out (Thesis.catalystDate) — the analyst's own event-date review already wakes the run before the date; do NOT write a copy of it on the thesis, a trigger on the thesis overrides the analyst's and freezes its number
- A positive advisory-committee vote if one happened
- Cash runway past the decision
- Sub-$1B single-asset names: supplemental approvals and label expansions only

**Buy:** Inside the window (21–70 days out) this setup always carries a buy level — the first of these the chart offers. 1) A D1 base breakout or a D5 pullback, when the stock actually qualifies. 2) Otherwise a RECLAIM: a close above the highest high of the last 20 sessions. No Trend Template — that is the point; a stock drifting into its decision will not pass one. The stop goes under the most recent swing low. Size is already half (the binary multiplier) with the gap-loss cap, which is the risk control — D8's "size is the stop". Target the prior high or the measured move, and the 2:1 floor applies as everywhere; if no level clears 2:1, park the row with the date it will be priced again rather than writing a level you do not believe. More than 70 days out, do not guess a level: park it with the date the window opens and the review that wakes it then.
 Entry through `BASE_BREAKOUT`, `MA_PULLBACK`.

**Floor:** Structural but advisory: gaps skip stops. Size is the stop.

**Target:** Run-up version: sell 1–2 weeks before the event (typically +20–40%). Hold-through version: exit at the event or T+30.

**Trail:**

- catalyst: The structural stop until the event; the event is the exit.

**Time limit:** The event, or T+30. A buy that has not filled with 21 days to go is set down — the run-up did not happen, which is this setup's own first failure sign.

**When it's failing:**

- Run-up stalls inside the window
- Negative read-across from a peer's decision

## Insider cluster buying

`INSIDER_CLUSTER` · playbook D9 · a screen · horizons: target, compounder

Three or more insiders buying within a month predicts positive returns over 6–12 months — roughly double a single buy.

**Before it applies:**

- 3+ insiders buying on the open market within 30 days, ideally including independent directors
- Stronger in small and mid caps

**Buy:** A screen and a conviction input; the entry is a D1 or D5 condition. As a wake: insider buying (at least 3 open-market buyers in 30 days) → REVIEW, with the buyers named on the fire.
 Entry through `BASE_BREAKOUT`, `MA_PULLBACK`.

**Floor:** Below the lowest insider purchase price or −12%, whichever is tighter.

**Target:** From the entry setup used; the effect runs 6–12 months.

**Time limit:** 6–12 months for the effect; the entry setup's clock for the trade.

**When it's failing:**

- Insiders sell into the rally

## Estimate-revision momentum

`ESTIMATE_REVISION` · playbook D10 · a screen · horizons: target

Rising estimates extend post-earnings drift; the Zacks Rank in one line.

**Before it applies:**

- Consensus EPS estimates rose in the last 30 days, especially right after a print

**Buy:** A screen and D4's third confirmation — but no plan we hold serves estimate history (Finnhub /stock/eps-estimate refuses; probed 2026-09-11), so there is no revision number to read and no trigger kind for it. Cite a revision only from a source you actually read.
 Entry through `PEAD`, `MA_PULLBACK`.

**Floor:** From the entry setup used.

**Target:** From the entry setup used.

**Time limit:** From the entry setup used.

**When it's failing:**

- Revisions turn down

## Compounder accumulation

`COMPOUNDER_ACCUMULATION` · playbook D11 · a buy pattern · horizons: compounder

A business bought at conviction size and held through volatility, entered on confirmation rather than hope, sold only when the story breaks.

**Before it applies:**

- Quality: ROIC > 20% for years, high stable gross margin for its industry, FCF margin ≥ 15%, high reinvestment at high returns, aligned management
- A business that will be structurally more valuable in 3–5 years

**Buy:** Whichever comes first: a base breakout, a reclaim of the 50-day, or a pullback that holds the 50-day. A stock at new highs on a working thesis is working, not extended; with no pullback in 30 days of uptrend, take the breakout. When one is already true, set the entry at the current price.
 Entry through `BASE_BREAKOUT`, `MA_PULLBACK`.

**Floor:** Thesis invalidation named in advance (guidance cut twice, margin break, capital-allocation failure). A close below the 200-day and a 15% give-back are reviews. The 25% catastrophe line off the high is the only automatic sale.

**Target:** A 3–5 year valuation case; trims only at valuation extremes.

**Time limit:** A 60-day business checkpoint (is what we said would happen starting to happen?) — a review, never a time stop.

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

**Buy:** A screen and a regime input. (A group-rank trigger kind is not in the plan yet.)
 Entry through `BASE_BREAKOUT`, `MA_PULLBACK`.

**Floor:** From the entry setup used.

**Target:** From the entry setup used.

**Time limit:** From the entry setup used.

**When it's failing:**

- The group turns Lagging — a review for every name in it
