# Expert review, unit 1.5: Compounder accumulation

The playbook `COMPOUNDER_ACCUMULATION` and the Secular Compounder's seed rule, reviewed from both perspectives (`docs/PRINCIPLES.md` §1, §8). This file holds the changes this PR makes. What makes a stock a compounder is a separate proposal, and nothing here changes the quality test.

## What changed

**The watch.** "Stop watching if below the 200-day average" is deleted. A close under the 200-day says the trend turned, not that the business broke. A quality investor (Terry Smith) never strikes a business off for its price, and Weinstein stops buying under a falling 30-week average while he keeps watching. A business leaves the list at a look, when it breaks.

**The buys.** Each of the three also needs the stock above its 200-day average, read during the day, with no close setting: above the base's high on heavy volume, within 2% of the 50-day, or above the 50-day. "The 50-day average rising" moves from the pullback's reason to *Confirm a buy by*, since no measure reads an average's slope yet (unit 1.2).

**The floor.** At most 15% under the buy (was 25%), priced from `{swingLow}`, at least the playbook's ATR distance under it (2 ATR on the owner's account). The cap also holds on a floor the run names (`sale.maxPctOn`). When the ATR minimum is itself past 15%, no floor keeps both rules, and the buy is refused once (`noLegalFloor`). On Nov 20 that was MU (20.8%) and GEV (15.5%).

**The second half.** The dollars of the holding's filled first buy (`addSize: "SAME_AS_FIRST"`, `secondHalfSize`), halved in a cautious market or into a binary event, never over the largest trade, up to the most in one stock. A holding with a filled add, and every other playbook, keeps half a risk-sized buy.

**The seed.** `COMPOUNDER_RULES` is the owner's live rule and nothing else: "Sell if below 15% from the high since we bought and above 1% from our entry", Send to Agent. It shares the account trail's slot, so it replaces that trail on this analyst's stocks. A re-seed of the owner's analyst adds nothing, and his note still reaches a run.

**Kept.** The 30-day clock, the 60-day business checkpoint, the +7% add, no trim, no chase limit, the quality screen and the failure signs.

## Replay, Nov 20 (the drop) and Nov 23 (the rally)

Through the real trigger check, every five minutes and on the close pass, on each stock's 5-minute bars and that morning's indicator snapshot. Each day starts fresh, as if the playbook's watch triggers were written the evening before. The four holdings are also run as watches, to show what the playbook's lines would do. No model and no production row.

| | Nov 20 | Nov 23 |
|---|---|---|
| Old line drops the watch on the close | BWXT, ETN, CEG, GEV, MU, PLTR | BWXT, ETN, CEG, GEV, MU |
| New playbook drops | none | none |
| Buys that fire, old and new alike | ACN, V and WST at 9:35; WST's pullback at 10:25 | ACN, V and WST at 9:35 |
| Buys the 200-day condition blocks | none | none |
| The live give-back on the four holdings | silent: all are under their buy | silent: all are under their buy |

Every stock under its 200-day was also more than 2% under its 50-day on both days, so the old buys were silent there too. The 200-day condition matters on a bounce back to a 50-day that sits under the 200-day, which neither day produced. On seven of the ten charts there was no base, so the breakout buy isn't written.

## For later units

- **1.2:** an average's slope, and "from our entry" in a trigger's sentence should read "from our buy".
- **3.5:** "a floor to fix" uses one 6-point gap for every style, so a compounder with a 15% give-back is flagged every morning once it is up 8%.
- **1.3, 1.4, 1.6, 1.8:** the account's 6% Stop when buying replaces every playbook floor wider than 6% at the approval.
