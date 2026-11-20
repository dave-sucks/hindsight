# The expert review: ledger

The running record of the review in `docs/PRINCIPLES.md` §8. Every unit is reviewed in the details by a fresh session taking both perspectives (§1), one unit at a time. Start one with `/expert-review` (the next unit marked **Next**) or `/expert-review <unit>`.

**How to use this file**
- Read it whole before a unit. "Changed shared things" says what earlier units changed that yours may quote.
- When a unit finishes, update its row (status, PR), add anything later units must know to "Changed shared things", and mark the next unit **Next**.
- A unit that finds something wrong outside its own scope writes one line under "Structure questions" or "Found, not yet assigned", and doesn't fix it.
- Status values: **Next**, Building, In review (PR open), Done, Bulk (reviewed inside a bulk unit), Deleted.

---

## Unit 0: usage, before anything else

| Unit | What | Status | PR |
|---|---|---|---|
| 0 | Count what production used over the last 30 days: calls per tool, how often each context item is sent and its size, how often each situation and each playbook occurs, and how often each trigger rule fires. Then sort every part below into: delete, bulk, or its own unit. No model calls; counts come from the database and market data. Write the counts and the sorting into this file. | **Next** | |

---

## Layer 1: the rulebook, or what we trade on

| Unit | What | Status | PR |
|---|---|---|---|
| 1.1 | The rules for everything: the account's and each analyst's standing rules. Earnings (set), a big day on volume (not set; first count how often 5%, 7% and 10% moves on 2× volume happened on the book in 12 weeks, leaving out report days, then choose per analyst), and news that wakes a look. | | |
| 1.2 | The measures a rule can use (`lib/agent/triggers/condition/measures/`): are the measures traders actually use there (volume against normal, gap, distance from the 52-week high, relative strength, an average's slope), named the way traders say them? | | |
| 1.3 | Playbook: Base breakout | | |
| 1.4 | Playbook: Pullback to a rising average (MA_PULLBACK) | | |
| 1.5 | Playbook: Compounder accumulation | | |
| 1.6 | Playbook: Drift after earnings (PEAD) | | |
| 1.7 | Playbook: Episodic pivot | | |
| 1.8 | Playbook: Before an event (PRE_CATALYST) | | |
| 1.9 | The other playbooks in `playbook-templates.ts` (momentum flag, insider cluster, estimate revision, sector rotation): keep, merge or delete, by usage | | |
| 1.10 | The book and the market: position count, size in one stock and one sector, cash, and what the market is doing (sizing in `lib/agent/position-sizing.ts`, the Portfolio Manager) | | |

For each playbook unit, review all of it: what the watch waits for, the buy, the add, the trim, the floor, the sale rules, the review clock, the stop-watching line, and its sizing, against how traders in that style do it, with counts on the book.

## Layer 2: the screen, or what we look at

| Unit | What | Status | PR |
|---|---|---|---|
| 2.1 | The watchlist row: the columns a trader pins (as on Robinhood Legend or thinkorswim), their names, units, format and order, and how a quiet stock is sorted | | |
| 2.2 | The holding row: what we paid, the gain, the share of the account, days held, distance to the floor | | |
| 2.3 | The market block: the market numbers, the morning digest, and what the market is doing | | |
| 2.4 | One stock in full (`get_stock_data` and the stock's data block) | | |
| 2.5 | The rest of the context catalog (`lib/agent/context/`, 19 items): merge to about 10 (roadmap E.13) | | |

## Layer 3: reactions

| Unit | What | Status | PR |
|---|---|---|---|
| 3.1 | How a skill is written and attached (the design is the owner's first: roadmap E.8) | | |
| 3.2–3.9 | One per situation in `lib/agent/situations.ts`: a sale or trim, a buy, an add, a review, a floor to fix, a note to answer, just sold, promoted to live | | |

## Layer 4: actions

| Unit | What | Status | PR |
|---|---|---|---|
| 4.1 | The trade tools: `place_trade`, `add`, `sell` | | |
| 4.2 | `edit_triggers` | | |
| 4.3 | The note and status tools: `write_note`, `set_conviction`, `set_catalyst_date`, `stop_watching`, `watch_again`, `pass_on_stock`, `watch_stock` | | |
| 4.4 | The read tools (roadmap E.10): bulk or delete by usage | | |

## Layer 5: jobs

| Unit | What | Status | PR |
|---|---|---|---|
| 5.1 | `rules.md` and `research-rules.md` (shared) | | |
| 5.2 | The chat | | |
| 5.3 | The morning run | | |
| 5.4 | The trigger run | | |
| 5.5 | The Writer and the Holding refresh | | |
| 5.6 | After the buy, and the post-trade write-up | | |
| 5.7 | The Portfolio Manager | | |
| 5.8 | The Market Reviewer and the evening digest | | |
| 5.9 | Discovery | | |

---

## Changed shared things

What a finished unit changed that later units quote. Newest first.

- (none yet)

## Structure questions

Things a unit thought were wrong in the structure, for the lead and the owner. One line each, with the unit that found it.

- (none yet)

## Found, not yet assigned

Found before the review started, from the watch rewrite of Nov 19. Each belongs to a unit above.

- **1.8, before an event:** the playbook ends the watch 21 days before the event date, while the Writer wanted a look after the decision (CORT, Nov 19).
- **1.5, compounder accumulation:** "Stop watching if below the 200-day average" was true on BWXT, ETN and NOW. The Writer took it off on BWXT and ETN because the business was strong. Is a 200-day break the right end of a compounder watch?
- **1.1 and 1.3, price stops written long ago:** MSFT left the watchlist on an old "Stop watching if below $504.95" written months before. Should a price stop on a watch be re-priced from the chart at each review?
- **2.4, one stock in full:** a refresh rewrites the claim but not the research sections. MA's catalysts still listed October's report as upcoming after its Nov 19 refresh.
- **9.3 on the roadmap, a passed buy chased up:** WST's buy was moved up four days in a row after passes.
- **Yardstick (roadmap E.11):** a chat case is scored on its first step only, so a chat that reads a date first and would then write the plan counts as a miss.
