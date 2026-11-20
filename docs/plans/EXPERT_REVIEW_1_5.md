# Expert review, unit 1.5: Compounder accumulation

The playbook `COMPOUNDER_ACCUMULATION` and the Secular Compounder's rules, reviewed from both perspectives (`docs/PRINCIPLES.md` §1, §8). The proposal page was settled with the owner on Nov 20, 2026; this file is its text.

The market figures are five years of daily bars (Alpaca, consolidated tape, split-adjusted, Nov 2021 to Nov 2026) for ten well-known quality businesses, not our book. A fall counts when the day's low reaches that % under the running high, and counts again only after a new high.

| Stock | 6% off the high | 10% | 15% | 25% | Close crosses under the 200-day | 5-year return |
|---|---|---|---|---|---|---|
| MSFT | 9 | 5 | 4 | 3 | 18 | +51% |
| V | 11 | 6 | 4 | 1 | 21 | +108% |
| MA | 12 | 8 | 4 | 1 | 10 | +90% |
| COST | 9 | 7 | 4 | 1 | 25 | +116% |
| SPGI | 5 | 4 | 3 | 2 | 21 | +6% |
| ADP | 7 | 5 | 5 | 2 | 11 | +42% |
| ROP | 7 | 4 | 2 | 2 | 15 | −4% |
| ISRG | 9 | 3 | 2 | 2 | 14 | +17% |
| AAPL | 14 | 8 | 6 | 2 | 8 | +123% |
| WM | 12 | 10 | 5 | 0 | 22 | +58% |

A 6% sale would have sold each of these businesses about twice a year; a 15% sale about once a year or less. A close under the 200-day came 2–5 times a year.

---

## The playbook

A compounder is a great business held for years: high returns on its capital, steady margins, plenty of cash. The aim is 10–15% a year for several years, so it is run differently from a trade.

1. **The watchlist.** A business stays on the list while the business stays good. A falling price doesn't take it off; a cut forecast, broken margins or the reason we liked it turning out false does. A look once a month, and before and after each report.
2. **The buy, the first half.** Only while the stock is above its 200-day average, on the first of: a close above a base's high on heavy volume; a pullback to a rising 50-day; a close back above the 50-day.
3. **The add, the second half.** Up 7% from the buy, the same dollars as the first.
4. **The sale, two ways.** The floor under the last low the stock held, at most 15% under the buy, raised under each higher low. The give-back: 15% off the high since we bought, which on this analyst's stocks replaces the account's 6% trail.
5. **Looks, not sales.** A close below the 200-day; each report; the monthly look; up 15% from the buy.

---

## What changed

### The watch

- **"Stop watching if below the 200-day average · only on the close": deleted.** A close under the 200-day says the trend turned, not that the business broke. The analyst's own rule called the same close a review, so two triggers on one stock disagreed (§2), and the Writer took the line off BWXT and ETN by hand on Nov 19. A quality investor (Terry Smith) never strikes a business off for its price; Weinstein stops buying under a falling 30-week average and keeps watching. Stocks that already carry a stored copy keep it until the Writer or the owner removes it.
- **Every buy waits for the stock above its 200-day average.** The breakout (Weinstein's Stage 2, Minervini's trend template), the pullback to the 50-day (O'Neil's first and second pullbacks), and the reclaim of the 50-day, which now reads on the close.
- **The pullback's "only while the 50-day is rising" is no longer the trigger's reason,** because no measure reads an average's slope and the Writer read the reason as enforced ("dormant by design" on FTNT). "The 50-day average rising" is in *Confirm a buy by*, for the run answering the fire, until unit 1.2 decides on a slope measure.
- **The reclaim's "Already true when written means buy the first half now" is gone.** A reason says what the trigger waits for; a line true when saved is already named to the Writer (`true-now.ts`).
- **Words:** *Confirm a buy by* drops "volume matters less than for a trade" (W1's 1.5× is right, after O'Neil). The summary says two halves, a long uptrend and the two sales. The clock's reason is "A monthly look at the business between reports."

### The holding

- **The floor: at most 15% under the buy** (was 25%), priced from `{swingLow}` with the owner's 2 ATR minimum. A floor deeper than 15% could never sell before the give-back does, since the high since we bought is never under the buy. The cap now also holds on a floor the run names (`saleRuleProblem` reads `sale.maxPctOn`, a TRADE unless a playbook names its horizon; the compounder names COMPOUNDER).
- **The add buys the first buy's dollars** (`addSize: "SAME_AS_FIRST"`, `sameAsFirstAddNotional`), up to the most in one stock. Every other playbook keeps half a risk-sized buy (O'Neil's pyramid). The add skill already raises the floor under the bigger position and refuses to average into the company's own weakness.

### The Secular Compounder's rules (the seed for a new compounder seat)

- **"Sell if below 15% from the high since we bought", Auto-sell.** It replaces the old 15% review. It sits in the account trail's slot (`triggerSlot`), so on this analyst's stocks it takes the 6% trail's place; every other analyst keeps the account's trail. §2 lets an analyst rule sell by itself.
- **"Review if below the 200-day average · only on the close"**: "A close below the 200-day average: the long trend may be turning."
- **"Review if above 15% from our buy"**: "a look at whether the price is getting ahead of the business." The second half is the playbook's add at +7%, so the old words named a second place for it.
- **"Review if below 15% from our buy": deleted.** The floor or the give-back always sells first.

The owner's own analyst keeps its stored rules until he edits them on its Triggers tab.

### The owner's settings (not code)

- **Stop when buying off on the Secular Compounder.** The account's 6% applies to every analyst without its own value. At each buy's approval it moves the floor up to 6% under the buy as an Auto-sell and keeps the playbook's floor only as a review (`autoStopOps`). The account keeps its 6%.
- **The Secular Compounder's rules**, as above.

### Kept

The monthly clock and the account's report looks; the 60-day business checkpoint; the +7% add, used up when it fills; no trim; the quality screen and the failure signs; no chase limit; risk per trade 1%.

---

## For later units

- **1.2:** an average's slope, so the pullback can say "a rising 50-day" in code; a live "last swing low" line if the floor should follow the lows by itself (today an analyst raises it at a look); "from our entry" in a trigger's sentence should read "from our buy".
- **3.5:** "a floor to fix" flags a holding whose protection sits more than 6 points under its gain. The 15% give-back always sits at least 15 points under, so every compounder up 8% or more is flagged every morning. The gap should come from the playbook.
- **1.3, 1.4, 1.6, 1.8:** the account's 6% Stop when buying replaces every playbook floor wider than 6% at the approval.
- **5.5:** MU, PLTR, GEV and CEG sit on this playbook; a memory maker's cycle is not the steady return on capital the quality screen describes.
