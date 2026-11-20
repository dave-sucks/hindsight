# Expert review, unit 1.1: the rules for everything

The account's rules (Settings → Triggers) and each analyst's rules (the analyst's Triggers tab), which every stock inherits, reviewed in the details from both perspectives (`docs/PRINCIPLES.md` §1, §8). Also, from the ledger: a big day on volume, news that wakes a look, the stocks with no playbook, the trail's fire mode, and the MSFT price stop.

Counts are from the production database and Alpaca's daily bars (consolidated tape) on Nov 19, 2026, with no model calls. "12 weeks" is Aug 27 to Nov 19. Fire counts before Nov 17 include the old re-fires, so each rule's effect is measured from Nov 17 (triggers work like orders), with 12-week counts beside it. "On the book" means between a stock's first thesis that wasn't a pass and its last close: 81 stocks, 2,952 stock-days. Report days are the session a report reached the market and the one after, from Finnhub's calendar.

No usage count decides here that anything should go. Every change below starts from what a trader in the style does and keeps; the counts only show whether the build matches.

---

## What the account carries today

| Rule | Action | On fire | Who wrote it | Fires, 12 weeks | Since Nov 17 |
|---|---|---|---|---|---|
| Sell if below 6% from the high since we bought | sale | Send to Agent | the owner | 98, on 10 holdings (first fire Oct 26) | 4: IOT, CEG, GEV (Nov 17), V (Nov 18) |
| Review every 7 days | review | Flag for Review | seed | 0 (a clock shows as the review situation, not as a fire) | 0 |
| Review if within 5 days before earnings | review | Flag for Review | seed, value changed to 5 by the owner | 16, on 16 stocks | 7 |
| Review if within 1 day after earnings | review | Send to Agent | the owner | 2 (first fire Nov 18) | 2: CPA, PANW |
| Review if it files something material with the SEC | review | Flag for Review | seed | 30, on 22 stocks | 5 |

The approval switch is on for every trade, Live and Paper. Stop when buying is on, at 6%.

Analysts: only three seats carry rules (Secular Compounder, PEAD Specialist, Catalyst Event PM, plus Mergers and Index Events, a copy of the catalyst seat's). None carries a sale. Their rules are reviewed with their playbooks in units 1.5, 1.6 and 1.8. Quality Leaders carries none. So for every holding, the account's trail is the only sale besides the stock's own floor.

---

## 1. The trail: "Sell if below 6% from the high since we bought"

**Before.** `{ watch: "move", is: "below", value: 6, variable: "peak" }`, sale, Send to Agent, on the account. Note: "below 6% from the high since we bought — standing rule set by the principal." (code's words, so no agent is shown it).

**After.** The value stays at 6%. Two owner questions (below): the fire mode, and the approval switch for sales. In this PR, a new account starts with the same rule (`accountStandingRules`, `lib/agent/triggers/defaults.ts`), Send to Agent as the owner has it, with the note "Protects the gain off the high since we bought."

**The trader.** A trailing sale is decided before it is needed, and it is carried out when hit. Minervini trails a stop up under a winner and never lets a good gain turn into a loss. O'Neil cuts every loss at 7–8% from the buy, with no exceptions, because the losses you hold are the ones that sink the account. Neither leaves the stop to a vote on the day it is hit. A compounder investor holds through 6% dips, but our "compounder" book is MU, NVDA, PLTR, GEV and CEG: high-beta names that fell 20–35% in five weeks.

**How often it mattered, 12 weeks.** Simulated on the daily bars of all 18 positions held in the 12 weeks (sold at the 6% line the first day the low crossed it, against the actual sale price or the Nov 19 close):

| Trail | Would have sold | Better than what happened | Worse | Dollars against what happened |
|---|---|---|---|---|
| 6% | 15 | 14 | 1 (MSFT, 0.9%) | +$11,170 |
| 8% | 15 | 11 | 4 | +$8,383 |
| 10% | 11 | 8 | 3 | +$8,085 |
| 15% | 7 | 6 | 1 | +$5,890 |

The 12 weeks were one market: a sharp drop from late October (the S&P 500 down 4.4% on Nov 5). A trail tight enough to sell normal noise in a rising market costs money there; that is not tested here. The book's names move 3–5% on an ordinary day, so a trail measured in each stock's own normal range (the average true range, as traders set it) would fit them better than one percentage for all. That is a measure, unit 1.2's question.

**Since Nov 17 the trail fired 4 times, and no sale went through on any of them:**
- CEG, $276.51: the analyst held ("a stock problem, not a break in the reason we own it"). Nov 19 close $252.03: −8.9%, −$1,248 on 51 shares.
- GEV, $782.06: the analyst held. Close $756.28: −3.3%, −$232.
- IOT, $40.42: the analyst agreed. The proposal has waited since Nov 17. Close $38.40: −5.0%, −$606.
- V, $415.63: the analyst didn't back the sale. Its own floor sold it the next day at $405.14: −2.5%, −$283.

That is about $2,400 in three days against selling when it fired. On CEG and GEV the analysts were reading the Secular Compounder's own rule, "Down 15% from its high. A question, not a sale". At 6% the account sells; at 15% the analyst asks. §2 of the standard calls two triggers on one stock that disagree a bug in the rules. Unit 1.5 owns the compounder's rule.

**The sale proposals.** 135 of 181 sale proposals in 12 weeks expired unanswered (80 of 91 in 30 days). Since Nov 17 a trigger's proposal waits while its trigger holds instead of expiring, but it still waits for a click. Four are waiting tonight: IOT, MU, NVDA and PLTR. Six of the seven holdings closed Nov 19 under their own "Sell if below" price, $9,637 under it in all:

| Holding | Its sale price | Nov 19 close | Under it |
|---|---|---|---|
| NVDA | $236.00 | $145.98 | $2,971 on 33 shares |
| GEV | $987.31 | $756.28 | $2,079 on 9 |
| CEG | $280.00 | $252.03 | $1,428 on 51 |
| IOT | $42.70 (Auto-sell) | $38.40 | $1,290 on 300 |
| MU | $804.00 (Auto-sell) | $690.44 | $1,249 on 11 |
| PLTR | $170.00 (Auto-sell) | $153.68 | $620 on 38 |

Auto-sell doesn't get past the approval switch: with it on, an Auto-sell is a proposal like any other (`doItCall` goes through the tool an agent would call). Measured from the first sale proposal of each holding's current slide to Nov 19, every one of the six kept falling: NVDA −36.7%, MU −26.1%, PLTR −21.9%, CEG −11.6%, IOT −10.7%, GEV −8.6%.

**Framework check.** The rule is in its one home (account rules, §2). An account rule may sell by itself (§2, "What may trade by itself"); only a buy, an add or a trim is the owner's alone. Its note is code's words, so no agent reads it (`writtenNote`). The owner's own reason, typed in Settings, would reach the agent at the fire. No instruction text changes.

**Owner questions.**
1. The trail's On fire: Send to Agent → Auto-sell? The trader's answer is yes: the sale was decided when the rule was written.
2. The approval switch for sales on Live: on → off? With it on, neither an Auto-sell nor the floor protects anything while no one answers. If it stays on, the six holdings above are the cost.

---

## 2. A big day on volume: two new rules

**Before.** None.

**After** (a new account's rules in this PR; for the owner's account, a question):
- "Review if above 7% from yesterday's close and at least 2× normal volume": `{ match: "all", conditions: [{ watch: "move", is: "above", value: 7, variable: "prev_close" }, { watch: "volume", value: 2 }] }`, Send to Agent. Note: "A big day up on heavy volume: something happened."
- The same with `is: "below"`. Note: "A big day down on heavy volume: something happened." What to check on such a day (the company's own news, or the whole market) is judgment for the skill for "something happened" (unit 3.3), not the trigger's reason.

"Either one" is two triggers, so up and down are two rules.

**The trader.** A stock that moves hard on heavy volume with no report has had news, whether or not we saw it. O'Neil reads a heavy-volume down day as institutions selling; Kullamägi's episodic pivots start with a big move on several times normal volume; an event-driven desk looks at any big move in a name it follows the same day. Each seat wants this look. The PEAD Specialist's names drift on news. The catalyst seat's move on news about the program. A compounder's heavy selling is the first sign the holders are leaving.

**How often, 12 weeks, outside report days, against the 20-day average volume (as the measure reads it):**

| Move from yesterday's close, on 2× volume | Days | Up / down | Stocks | No other trigger fired that day | On a day the S&P moved 1.5%+ |
|---|---|---|---|---|---|
| 5% | 58 | 18 / 40 | 41 | 33 | 20 |
| 7% | 41 | 10 / 31 | 35 | 21 | 16 |
| 10% | 21 | 9 / 12 | 21 | 13 | 6 |

By seat at 7%: PEAD Specialist 19 (11 with no other look), Secular Compounder 14 (6), Catalyst Event PM 7 (4), Quality Leaders 1. The split doesn't call for a different number per analyst, so this is one account rule.

7%, not 5% or 10%: 5% is an ordinary day for MU, NVDA or IOT, and 58 days is a look on most of them. 10% misses the company's own news on days the market barely moved: FTNT −7.3% (Nov 2, the S&P −0.5%), VRT −7.7% (Sep 14, −0.5%), AIR −7.2% (Sep 29, −0.2%), COGT −7.1% (Nov 11, +1.3%). Of the 21 days at 7% with no other look, 9 kept going the same way over the next five sessions.

Cost: about 21 trigger runs in 12 weeks (fewer than 2 a week) that nothing else would have started; on the other 20 days a run started anyway, and a co-fire joins it.

Send to Agent, not Flag for Review: a big day down on a holding can't wait for the next morning run, which is Monday, Wednesday and Friday on this account.

**Framework check.** Two account rules in the catalog's own shape. No new measure, no new concept. For unit 1.2: the volume ratio is today's volume so far over the average of 20 whole days (`volumeRatio`, `lib/market-data/indicator-snapshot.ts`), so during the day it reads low, and the rule fires late in the session or on the 4:20 PM pass. Traders read relative volume against the same time of day.

**News that wakes a look.** With news routing paused, the account's news wakes are the filing rule and, after this, the big-day pair: a hard move on heavy volume is the price showing that news came out. A headline with a flat price has no measure. That belongs to the Market Reviewer's notes (§2) and the signals lane, not to a rule.

---

## 3. The up-7% add comes out of a new account's rules

**Before.** `accountSeedTriggers` gave a new account "Add if above 7% from yesterday's close", sent to the agent.

**After.** Gone from the seed. The big day up (above) is its replacement: a look, not an add. The owner's account already has no such rule.

**The trader.** O'Neil adds as a stock works up from a sound buy point, a few percent above it, and never after it is extended. Minervini adds at the next low-risk entry, a tight spot or a pullback to the 10-day average, not on a one-day spike. A 7% day is as often a climax or a news reaction as it is strength. An add belongs to the playbook, on the stock's own trigger, where the playbook knows what a low-risk add looks like.

**Framework check.** The old note stays on `templateNotes` so rows that carry it still read as code's. Nothing an agent is sent changes for the owner's account.

---

## 4. "Review if within 5 days before earnings"

**Before.** Value 5 on the owner's row, note "Reports within 3 days — decide before the print…". The seed for a new account: 3 days.

**After.** The seed says 5 days, with the note "A look before the report, while there is still time to size for the gap." On the owner's row, only the note is wrong. Owner: fix it in Settings, or leave it, since no agent reads it.

**The trader.** The decision before a report (hold through, cut to a size that can take the gap, or wait to buy until after) is made in the week before it. 5 days, not 3, because a Flag for Review waits for the next morning run: on a Monday, Wednesday and Friday schedule, a report on a Tuesday morning is seen at 3 days only after the fact.

**How often.** 16 fires in 12 weeks on 16 stocks, one per report. 7 since Nov 17.

---

## 5. "Review if within 1 day after earnings"

**Before.** The owner's row: Send to Agent. The seed: Flag for Review (unset), with the note "Reported — re-underwrite…".

**After.** The seed is set to Send to Agent, with the note "A look the day after the report, while the market is still deciding what it means." This matches the owner's row.

**The trader.** The drift after a report (Bernard and Thomas, 1989) is decided in its first days: a gap that holds on the first day is the PEAD buy, and a beat the stock sells on is the first warning. Waiting for the next morning run can cost two of those days.

**How often.** 33 reports by stocks on the book in 12 weeks. No account rule fired after a report before Nov 18; from Nov 18 the owner's rule fired on CPA and PANW (NVDA's own trigger took its slot). 5 reports since Nov 17: LUXE (Nov 17) got its look from its own miss trigger, and NVDA, CPA and PANW from the after-report rules. ESTC reports after the close tonight.

---

## 6. "Review if it files something material with the SEC": kept as it is

The material tier is an 8-K under 5.02 (an officer leaving or arriving), 1.01 or 1.02 (a major agreement signed or ended), 2.01 (a deal closed), 2.05 or 2.06 (restructuring costs, an impairment) or 3.02 (unregistered shares sold), and a 13D, S-3 or 424B5 (an activist, an offering) (`MATERIAL_ITEMS`, `lib/market-data/sec-events.ts`). An event-driven desk reads exactly these. Results (2.02) aren't in it, so it doesn't fire twice with the earnings rules. Flag for Review is right for a watch, and a red filing on a holding is looked at the same day whatever is set. 30 fires on 22 stocks in 12 weeks, 5 since Nov 17. No change.

## 7. "Review every 7 days": kept as it is

It is the review clock for a stock with no clock of its own: 21 of the 47 watches and 2 of the 7 holdings (NVDA, IOT) use it today. It never shows as a fire, by design: a due clock is the review situation (109 rows in 30 days), read through `resolvedCadenceDays`. A weekly look at the whole book is how a desk works (O'Neil's weekend review). A playbook's own clock replaces it. No change.

---

## 8. The stocks with no playbook

**What is true.** 9 of the 17 positions opened in 12 weeks had no playbook (unit 0). 3 of the 7 holdings have none today: IOT, NVDA and PANW. 21 of the 47 watches have none, and none of those 21 has a buy trigger. PANW was bought on Nov 19 from a watch the owner's chat made on Nov 18 with no playbook; After the buy then had no holding triggers to put on. On the closed trades, the seven with no playbook made −$865 together and the four with one made +$1,660 (too few to prove anything).

A stock with no playbook gets its sale only from its own floor and the account's trail, and its looks only from the account's rules. It has no add, trim or time limit, and no stop-watching line priced from a chart.

**The trader.** No buy without a named setup. O'Neil buys a base at its buy point; Minervini buys a contraction at its pivot. The setup is what gives the stop, the add and the sale. A trade nobody can name has no plan for getting out except the one bolted on afterwards.

**Where it would live.** A refusal in `place_trade` (unit 4.1), with the next legal move: "This stock has no playbook. Send it to the Writer to name one, then buy." Not a rule and not instruction text.

**Owner question.** 3. Should a stock be bought with no playbook at all? The trader's answer is no, including from the chat: your idea gets a playbook before the order, because the playbook supplies its sale rules.

---

## 9. The MSFT price stop

The ledger says MSFT left the watchlist on an old "Stop watching if below $504.95" written months before. The rows say otherwise. It was written on Nov 13 at $523.00, when the morning run put MSFT back on watch after its sale and moved its sale stop from $524.57 to $504.95. The Nov 16 change turned a watch's stop into a Stop watching line, and it fired on the Nov 19 close at $498.30. It was six days old and 3.5% under the price, and MSFT closed under it.

**Should a price stop on a watch be re-priced from the chart at each review?** No. A Stop watching line marks where the setup is wrong; a line that follows the price down at every review never fires. What MSFT lacked was a playbook: its line was a leftover sale stop, where a playbook's would have been priced from the chart (`{swingLow}`, the 200-day) when the watch was written or rewritten. That is item 8. For unit 1.3: nothing.

---

## What this PR changes

| File | Change |
|---|---|
| `lib/agent/triggers/defaults.ts` | `accountStandingRules`: the 6% trail (Send to Agent) and the two big-day looks, in place of the up-7% add. The add's note stays on `templateNotes`. |
| `lib/agent/triggers/seed-account.ts` | A new account's rules: before a report 3 → 5 days, the look after a report sent to the agent, both notes rewritten. `unseededAccountFallback` keeps the same ids on every read: a fresh id per read made a fallback rule fire on every check, which the trail would have done every five minutes. |
| `lib/inngest/functions/sale-asks-daily.replay.test.ts` | Its account is seeded with no rules, so the case stays about the floor alone. |
| tests | `defaults.test.ts`, `seed-account.test.ts`, `load-levels.test.ts` say the new set. |
| `docs/guide/concepts/triggers.md`, `docs/TRIGGERS.md` | The account's rules as they are, and a new account's. |

Each new note says only what its trigger protects or waits for, in the voice of a trader writing on their own plan (§4). What to do when it fires is the fire mode's job, or a skill's (unit 3.x), never the note's.

Nothing changes on the owner's account. Nothing an agent is sent changes, so there is nothing to score. Every change to the owner's rules is a question above, for Settings → Triggers.

## For later units

- **1.2, the measures:** an average-true-range trail, and volume read against the same time of day. Both are above.
- **1.5, compounder:** "Down 15% from its high. A question, not a sale" sits under the account's 6% sale, and the analysts used it to hold CEG and GEV on Nov 17.
- **4.1, the trade tools:** the refusal for a buy with no playbook (item 8), if the owner says yes.
- **4.2 / 5.6, `edit_triggers` and After the buy:** on Nov 19 After the buy put "Add if below $406.88 · only on the close" on PANW at $361. That add was true when written, which the rules say can't be written. The owner removed it.
