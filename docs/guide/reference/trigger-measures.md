# Trigger measures

**Every condition a trigger can watch, with the shape it's saved in.** The twelve measures, grouped by the five types of the Add trigger menu.

This file is built from `MEASURES` in `lib/agent/triggers/condition/catalog.ts` and the examples in `lib/docs/trigger-examples.ts`; don't edit it by hand. What a trigger is and when one fires is [Triggers](../concepts/triggers.md).

## The shape

A trigger is an action and a condition. A condition is one shape everywhere (the form, the save, the agents' tools): `{ watch, is?, value?, variable?, settings? }`, or `{ match: "all" | "any", conditions: [...] }` for two or more. `watch` names the measure below; the rest are that measure's own fields. Anything else in a trigger list reads as a removed condition.

Actions are `ENTER` (buy), `ADD`, `TRIM`, `EXIT` (sell) and `REVIEW`. Every trigger reads as one sentence, from `describe.ts`.

## Price

A level, a line on the chart, or a move from somewhere that matters. Read against the live price every five minutes while the market is open. A level marked only on the close waits for the 4:20 PM pass and the day's closing price, and a floor on a stock you only watch always does. The move from our entry and the give-back from the high read the position itself: its average cost and the highest price since the buy.

### Price

`watch: "price"` · is: `below` / `above` · value: more than $0 · actions: buy, add, trim, sell, review · reads: the live quote

**Variables** (stands in for the number):

- `prev_close`: Yesterday's close
- `close_5d`: Close 5 days ago
- `close_20d`: Close 20 days ago
- `entry`: Our entry (only once we own the stock)
- `peak`: High since we bought (only once we own the stock)
- `sma20`: 20-day average
- `sma50`: 50-day average
- `sma150`: 150-day average
- `sma200`: 200-day average
- `high20`: 20-day high
- `low20`: 20-day low
- `high52`: 52-week high
- `low52`: 52-week low

**Settings:**

- `close`: When it is checked, default false

**Rest period for a plain condition, when none is set:** 1 day.

**Examples:**

- "Sell if below $40.80". The floor. Under the breakout shelf, and above the rising 20-day.

  ```json
  {"action":"EXIT","predicate":{"watch":"price","is":"below","value":40.8}}
  ```

- "Review if below the 200-day average". A long-term holding losing its 200-day is worth a look. A state, so it asks at most weekly.

  ```json
  {"action":"REVIEW","predicate":{"watch":"price","is":"below","variable":"sma200"}}
  ```

### Move

`watch: "move"` · is: `below` / `near` / `above` · value: more than 0% and under 100% · actions: buy, add, trim, sell, review · reads: the live quote

**Variables** (the number is measured from it):

- `prev_close`: Yesterday's close
- `close_5d`: Close 5 days ago
- `close_20d`: Close 20 days ago
- `entry`: Our entry (only once we own the stock)
- `peak`: High since we bought (only once we own the stock)
- `sma20`: 20-day average
- `sma50`: 50-day average
- `sma150`: 150-day average
- `sma200`: 200-day average
- `high20`: 20-day high
- `low20`: 20-day low
- `high52`: 52-week high
- `low52`: 52-week low

**Rest period for a plain condition, when none is set:** 1 day.

**Examples:**

- "Buy if within 2% of the 20-day average". Buy the pullback, not the spike: the setup is true near a rising average.

  ```json
  {"action":"ENTER","predicate":{"watch":"move","is":"near","value":2,"variable":"sma20"}}
  ```

- "Sell if below 12% from the high since we bought". A trail. Its line follows the highest price since the buy and never comes down.

  ```json
  {"action":"EXIT","predicate":{"watch":"move","is":"below","value":12,"variable":"peak"}}
  ```

- "Trim if above 15.6% from our entry". Take a partial at twice the risk.

  ```json
  {"action":"TRIM","predicate":{"watch":"move","is":"above","value":15.6,"variable":"entry"}}
  ```

- "Add if above 7% from yesterday's close". A big up day on a holding asks whether to press it.

  ```json
  {"action":"ADD","predicate":{"watch":"move","is":"above","value":7,"variable":"prev_close"}}
  ```

## Indicator

The chart's own numbers: volume, RSI, strength against the S&P, gaps. Read from the chart numbers computed at 6:30 AM each trading day: moving averages, highs and lows, RSI, strength against the S&P, recent gaps. They sit next to the live price on every pass. Volume and gaps also read today's volume so far, so a volume trigger is true only once the volume is really there.

### Volume

`watch: "volume"` · value: more than 0× and up to 50× · actions: buy, add, trim, sell, review · reads: snapshot, volume

**Rest period for a plain condition, when none is set:** 1 day.

**Examples:**

- "Review if at least 2× normal volume". Twice the normal volume means someone knows something. Look before it moves.

  ```json
  {"action":"REVIEW","predicate":{"watch":"volume","value":2}}
  ```

### RSI

`watch: "rsi"` · is: `below` / `above` · value: from 0 to 100 · actions: buy, add, trim, sell, review · reads: snapshot

**Settings:**

- `period`: RSI length, default 14

**Rest period for a plain condition, when none is set:** 1 day.

**Examples:**

- "Buy if below RSI 30". An oversold dip in a stock whose trend is still up.

  ```json
  {"action":"ENTER","predicate":{"watch":"rsi","is":"below","value":30}}
  ```

### vs. S&P

`watch: "strength"` · value: from -100 to 500 points · actions: buy, add, trim, sell, review · reads: snapshot

**Settings:**

- `window`: Measured over, default 3M

**Rest period for a plain condition, when none is set:** 7 days.

**Examples:**

- "Review if at least 5 points ahead of the S&P". Leading the market by 5 points over three months: a leader worth a closer look.

  ```json
  {"action":"REVIEW","predicate":{"watch":"strength","value":5,"settings":{"window":"3M"}}}
  ```

### Gap up

`watch: "gap"` · value: more than 0% and up to 100% · actions: buy, add, trim, sell, review · reads: snapshot, volume

**Settings:**

- `volume`: from 0× to 50×, default 3
- `withinDays`: a whole number from 1 to 10 sessions, default 1

**Rest period for a plain condition, when none is set:** 3 days.

**Examples:**

- "Buy if at least 8% gap up". An 8% gap on three times the volume, held for three days: an episodic pivot.

  ```json
  {"action":"ENTER","predicate":{"watch":"gap","value":8,"settings":{"volume":3,"withinDays":3}}}
  ```

## Earnings

Before a report, after a report, and what the report said. Read from the earnings calendar on every pass, one call for the whole book. A heads-up fires before the report date. A beat or a miss fires at the first open after the report, once per report, with the figures in its Activity line.

### Report date

`watch: "report"` · is: `before` / `after` · value: a whole number from 1 to 14 days · actions: review · reads: earnings

**Settings:**

- `fromDay`: a whole number from 0 to 5, default 0

**Rest period for a plain condition, when none is set:** 30 days.

**Examples:**

- "Review if within 3 days before earnings". Three days out: decide whether to hold through the print.

  ```json
  {"action":"REVIEW","predicate":{"watch":"report","is":"before","value":3}}
  ```

- "Review if within 5 days after earnings". The days right after the print, when the drift starts and the call gets read.

  ```json
  {"action":"REVIEW","predicate":{"watch":"report","is":"after","value":5}}
  ```

### Result

`watch: "surprise"` · is: `miss` / `beat` · value: 0% or more · actions: review · reads: earnings

**Rest period for a plain condition, when none is set:** 7 days.

**Examples:**

- "Review if earnings miss 5% or more". A real miss. Check whether the belief still holds.

  ```json
  {"action":"REVIEW","predicate":{"watch":"surprise","is":"miss","value":5}}
  ```

## Filing

What the company tells the SEC, and what its insiders buy. Read live from SEC EDGAR, once per pass for every stock with a filing trigger, looking back four days. Each filing fires once; filings cluster, so there's no rest period. Insider buying counts open-market purchases from Form 4s, refreshed every morning.

### SEC filing

`watch: "filing"` · no number · actions: review · reads: filings

**Variables** (stands in for the number):

- `tier:MATERIAL`: Anything material
- `tier:RED`: A red flag
- `item:1.01`: Major agreement signed (8-K 1.01)
- `item:1.02`: Major agreement ended (8-K 1.02)
- `item:1.03`: Bankruptcy or receivership (8-K 1.03)
- `item:1.04`: Mine safety shutdown (8-K 1.04)
- `item:1.05`: Cybersecurity incident (8-K 1.05)
- `item:2.01`: Acquisition or sale completed (8-K 2.01)
- `item:2.03`: New debt (8-K 2.03)
- `item:2.04`: Debt accelerated (8-K 2.04)
- `item:2.05`: Restructuring or layoffs (8-K 2.05)
- `item:2.06`: Asset write-down (8-K 2.06)
- `item:3.01`: Delisting notice (8-K 3.01)
- `item:3.02`: Shares sold privately (8-K 3.02)
- `item:3.03`: Shareholder rights changed (8-K 3.03)
- `item:4.01`: Auditor change (8-K 4.01)
- `item:4.02`: Past financials can't be relied on (8-K 4.02)
- `item:5.01`: Change in control (8-K 5.01)
- `item:5.02`: Officer or director leaving or joining (8-K 5.02)
- `item:5.03`: Bylaws or fiscal year changed (8-K 5.03)
- `item:5.04`: Benefit-plan trading halted (8-K 5.04)
- `item:5.05`: Ethics code changed (8-K 5.05)
- `item:5.06`: Shell company status changed (8-K 5.06)
- `item:5.07`: Shareholder vote (8-K 5.07)
- `item:5.08`: Director nominations (8-K 5.08)
- `item:7.01`: Press release (8-K 7.01)
- `item:8.01`: Other events (8-K 8.01)
- `form:NT 10-K`: Late annual report (NT 10-K)
- `form:NT 10-Q`: Late quarterly report (NT 10-Q)
- `form:SCHEDULE 13D`: Activist stake (5%+) (SCHEDULE 13D)
- `form:424B5`: Shares or bonds offered (424B5)
- `form:S-3`: Registration to sell shares or bonds (S-3)

**Rest period for a plain condition, when none is set:** none.

**Examples:**

- "Review if it files something material with the SEC". Anything material: a deal, a departure, a guidance change.

  ```json
  {"action":"REVIEW","predicate":{"watch":"filing","variable":"tier:MATERIAL"}}
  ```

- "Review if it files a red-flag filing with the SEC". A red flag: a restatement, an auditor change, a going-concern note.

  ```json
  {"action":"REVIEW","predicate":{"watch":"filing","variable":"tier:RED"}}
  ```

- "Review if it files an 8-K 8.01 (other events)". Other events, where companies announce FDA dates and trial results.

  ```json
  {"action":"REVIEW","predicate":{"watch":"filing","variable":"item:8.01"}}
  ```

### Insider buying

`watch: "insiders"` · value: a whole number from 1 to 10 insiders · actions: review · reads: snapshot

**Settings:**

- `days`: Look-back, a whole number from 1 to 90 days, default 30

**Rest period for a plain condition, when none is set:** 30 days.

**Examples:**

- "Review if at least 3 insiders buying · in the last 90 days". Three insiders buying with their own money is a signal worth reading.

  ```json
  {"action":"REVIEW","predicate":{"watch":"insiders","value":3,"settings":{"days":90}}}
  ```

## Schedule

Clocks, not conditions: look again, or leave on time. A clock counts calendar days. Every N days counts from the last real review, so a stock someone just looked at waits its full interval. After the buy and around the event date count from the dates on the position and the thesis.

### Repeat

`watch: "repeat"` · value: a whole number from 1 to 365 days · actions: review · a clock, stands alone

**Rest period for a plain condition, when none is set:** none.

**Examples:**

- "Review every 30 days". The review clock: re-underwrite a quiet holding once a month.

  ```json
  {"action":"REVIEW","predicate":{"watch":"repeat","value":30}}
  ```

### From a date

`watch: "from_date"` · is: `after` / `before` · value: a whole number from 1 to 365 days · actions: trim, sell, review · a clock, stands alone

**Variables** (the number is measured from it):

- `buy`: The buy
- `event`: The event date

**Rest period for a plain condition, when none is set:** none.

**Examples:**

- "Sell 60 days after the buy". The setup's time limit: out before the next report if it hasn't worked.

  ```json
  {"action":"EXIT","predicate":{"watch":"from_date","is":"after","value":60,"variable":"buy"}}
  ```

- "Review 10 days before the event date". Ten days before the FDA decision: size up, hold, or step aside.

  ```json
  {"action":"REVIEW","predicate":{"watch":"from_date","is":"before","value":10,"variable":"event"}}
  ```
