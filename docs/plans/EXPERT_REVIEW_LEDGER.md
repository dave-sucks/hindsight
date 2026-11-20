# The expert review: ledger

The running record of the review in `docs/PRINCIPLES.md` §8. One lead session (`/expert-review`) runs it. For each unit, one at a time, the lead starts a fresh session (`/expert-review-unit <unit>`) that reviews the unit in the details, taking both perspectives (§1).

**How to use this file**
- Every session reads it whole before starting. "Changed shared things" says what earlier units changed that a later unit may quote.
- Only the lead edits it. When a unit finishes, the lead updates the unit's row (status, PR), adds anything later units must know to "Changed shared things", and marks the next unit **Next**.
- A unit that finds something wrong outside its own scope reports it to the lead, who writes one line under "Structure questions" or "Found, not yet assigned". Nobody fixes it outside its unit.
- Status values: **Next**, Building, In review (PR open), Done, Bulk (reviewed inside a bulk unit), Deleted.
- Depth comes from unit 0's counts (`docs/plans/EXPERT_REVIEW_USAGE.md`): **own** (a unit of its own), **bulk** (reviewed with others in one unit), **delete?** (unused: the unit asks whether a trader in that style needs it; a deletion needs a trader's reason, never the count alone).

---

## Unit 0: usage, before anything else

| Unit | What | Status | PR |
|---|---|---|---|
| 0 | Count what production used over the last 30 days: calls per tool, how often each context item is sent and its size, how often each situation and each playbook occurs, and how often each trigger rule fires. Then sort every part below into: delete, bulk, or its own unit. No model calls; counts come from the database and market data. The counts are in `docs/plans/EXPERT_REVIEW_USAGE.md`; the sorting is carried into the Depth column below. | In review | [#1070](https://github.com/dave-sucks/hindsight/pull/1070) |

---

## Layer 1: the rulebook, or what we trade on

| Unit | What | Depth | Status | PR |
|---|---|---|---|---|
| 1.1 | The rules for everything: the account's and each analyst's standing rules. Earnings (set), a big day on volume (not set; first count how often 5%, 7% and 10% moves on 2× volume happened on the book in 12 weeks, leaving out report days, then choose per analyst), and news that wakes a look. Also the stocks with no playbook (9 of 17 positions in 12 weeks; the owner, Nov 19): their rules are these rules, and should a stock be bought with no playbook at all? Also the trail's fire mode, since 80 of 91 sale proposals expired. | own: the account's 6% trail fired 98 times on 10 holdings; the filing and report rules 27 times | In review | [#1073](https://github.com/dave-sucks/hindsight/pull/1073) |
| 1.2 | The measures a rule can use (`lib/agent/triggers/condition/measures/`): are the measures traders actually use there (volume against normal, gap, distance from the 52-week high, relative strength, an average's slope), named the way traders say them? | own: no stored trigger uses `rsi`, `strength`, `gap` or `insiders` (keep-or-delete questions, not deletions on usage alone). From 1.1: a trail measured in the stock's own average true range, and volume read against the same time of day (today it is volume so far over 20 whole days, so a 2× test reads low until late in the session). | **Next** | |
| 1.3 | Playbook: Base breakout | own, short: 3 picks, 1 trade in 12 weeks | | |
| 1.4 | Playbook: Pullback to a rising average (MA_PULLBACK) | own: the Writer's first choice (34 in 30 days) | | |
| 1.5 | Playbook: Compounder accumulation | own: 4 of 7 holdings; its 200-day rule fired 153 times in 12 weeks | | |
| 1.6 | Playbook: Drift after earnings (PEAD) | own: 8 picks, 1 trade | | |
| 1.7 | Playbook: Episodic pivot | bulk, inside 1.9: 1 pick, no trade | | |
| 1.8 | Playbook: Before an event (PRE_CATALYST) | own: 24 picks, 4 trades closed in 12 weeks | | |
| 1.9 | The other playbooks in `playbook-templates.ts`: momentum flag, insider cluster, estimate revision, sector rotation, near the 52-week high (`RS_52W_HIGH`), oversold bounce (`RSI2_BOUNCE`), plus episodic pivot in bulk | delete? (bulk): no Writer pick, no stock, no position in 12 weeks. Keep, merge or delete each one by what a trader in that style does, never by the count. A deletion also takes its name off the archetypes, and sector rotation and `RS_52W_HIGH` are on Quality Leaders' list, so taking them off is the owner's change. | | |
| 1.10 | The book and the market: position count, size in one stock and one sector, cash, and what the market is doing (sizing in `lib/agent/position-sizing.ts`, the Portfolio Manager) | own: every buy | | |

For each playbook unit, review all of it: what the watch waits for, the buy, the add, the trim, the floor, the sale rules, the review clock, the stop-watching line, and its sizing, against how traders in that style do it, with counts on the book.

## Layer 2: the screen, or what we look at

| Unit | What | Depth | Status | PR |
|---|---|---|---|---|
| 2.1 | The watchlist row: the columns a trader pins (as on Robinhood Legend or thinkorswim), their names, units, format and order, and how a quiet stock is sorted | own: `the_book` 119 sends at 14.5k characters, `get_theses` 92 calls | | |
| 2.2 | The holding row: what we paid, the gain, the share of the account, days held, distance to the floor | own: the same reads; every sale decision starts from it | | |
| 2.3 | The market block: the market numbers, the morning digest, and what the market is doing | own: `market_numbers` 346 sends, the two digests 217 | | |
| 2.4 | One stock in full (`get_stock_data` and the stock's data block) | own: `the_stock` 229 sends at 12.5k, `get_stock_data` 382 calls | | |
| 2.5 | The rest of the context catalog (`lib/agent/context/`, 19 items): merge to about 10 (roadmap E.13) | bulk: 11 items, each small or rare | | |

## Layer 3: reactions

| Unit | What | Depth | Status | PR |
|---|---|---|---|---|
| 3.1 | How a skill is written and attached (the design is the owner's first: roadmap E.8) | own | | |
| 3.2 | A trigger written in advance fired: a sale or trim, a buy, an add (today `PROTECTIVE_SALE`, `BUY_ARRIVES`, `ADD_OR_WINNER`) | own: 109 trigger runs in 30 days (86 sales, 14 buys, 9 adds) | | |
| 3.3 | Something happened: a report, a filing, news or an unusual day | own: the filing and report rules fired 27 times; news and a big day have no rule yet (1.1) | | |
| 3.4 | Time to look again (today `REVIEW_DUE`) | own: 109 rows, 16 runs | | |
| 3.5 | What code finds with no trigger: a floor to fix, just sold, promoted to live | bulk: 1, 2 and 0 rows. Promoted stays, since two analysts are still on paper. | | |

Layer 3 follows the owner's Nov 19 design (roadmap E.8): three kinds of situation, one short skill each, with a holding part and a watch part. "A note to answer" is deleted in that design, so it has no unit. The units review the skills once E.8 builds them.

## Layer 4: actions

| Unit | What | Depth | Status | PR |
|---|---|---|---|---|
| 4.1 | The trade tools: `place_trade`, `add`, `sell` | own: 49 sales, 12 buys, 3 adds | | |
| 4.2 | `edit_triggers` | own: about 200 trigger edits | | |
| 4.3 | The note and status tools: `write_note`, `set_conviction`, `set_catalyst_date`, `stop_watching`, `watch_again`, `pass_on_stock`, `watch_stock` | own for `write_note` (about 215 calls); the other six in bulk inside it | | |
| 4.4 | The read tools (roadmap E.10): bulk or delete by usage | bulk, delete? for the unused: the five registered tools on no list, `read_database`, `manage_position` (file and test), and `list_runs`, `read_run`, `read_accuracy_reports`, `read_trade_results` off the chat's list | | |
| 4.5 | The bookkeeping tools: `complete_run`, `record_run_summary`, `submit_thesis`, `dispatch_thesis_research`, `wait_for_thesis_refresh` (added by the owner, Nov 19) | own: `complete_run` 232 calls, 21 refusals; `submit_thesis` 122 | | |

## Layer 5: jobs

| Unit | What | Depth | Status | PR |
|---|---|---|---|---|
| 5.1 | `rules.md` and `research-rules.md` (shared) | own: `rules.md` rides on seven agents | | |
| 5.1b | Each analyst's strategy text (`analystPrompt`, the `the_analyst` context item; added by the owner, Nov 19) | own: about 280 sends at about 4,000 characters, as often as `rules.md` | | |
| 5.2 | The chat | own: 57 owner messages; the largest instructions (33.9k characters) | | |
| 5.3 | The morning run | own: 50 runs, 573k input tokens a run | | |
| 5.4 | The trigger run | own: 125 runs, the most of any agent | | |
| 5.5 | The Writer and the Holding refresh | own: 64 runs | | |
| 5.6 | After the buy, and the post-trade write-up | own: 1 and 39 runs; every fill | | |
| 5.7 | The Portfolio Manager | own, short: 3 runs | | |
| 5.8 | The Market Reviewer and the evening digest | bulk: 7 and 10 runs, short texts, no tools | | |
| 5.9 | Discovery | own, short: off, 2 runs | | |

---

## Changed shared things

What a finished unit changed that later units quote. Newest first.

- **Unit 1.1 (#1073):** a new account's rules are the reviewed set (`accountSeedTriggers`): the 6% trail off the high (Send to Agent), a look on a big day up and on a big day down (7% from yesterday's close on at least 2× the 20-day average volume, Send to Agent), a look in the 5 days before a report (Flag for Review) and the day after (Send to Agent), the material-filing look and the 7-day clock. The up-7% add is gone from the seed: an add is a playbook's trigger on the stock. The owner's account is unchanged by the PR. A trigger's reason says only what it protects or waits for, never what to do when it fires. That is the fire mode's job or a skill's (3.x). Write-up: `docs/plans/EXPERT_REVIEW_1_1.md`.
- **Unit 1.1, the review's calls on the owner's account,** made in Settings → Triggers and his to refuse: the trail's On fire becomes Auto-sell (approvals stay on, so it is a proposal at the fire with no agent deciding first), and the two big-day looks are added. Not yet applied.
- **Unit 0 (#1070):** `docs/plans/EXPERT_REVIEW_USAGE.md` holds the 30-day counts for every tool, context item, situation, playbook and inherited rule, with each item's size. Quote it for any "how often" before counting again. Most of those 30 days ran on the old build, so any unit that measures a rule's effect counts again from Nov 17 (triggers work like orders) or Nov 19 (the one-job tools). Fire counts before Nov 17 include the old re-fires: 12 to 14 sale fires a day, 1 a day since.

## Structure questions

Things a unit thought were wrong in the structure, for the lead and the owner. One line each, with the unit that found it.

- **Unit 0: stocks with no playbook.** 9 of the 17 positions opened in 12 weeks had none, and 23 live stocks have none; they get their sell rules only from the analyst and the account. The owner (Nov 19): reviewed inside 1.1.
- **Unit 0: the analyst's strategy text has no unit.** `the_analyst` (`analystPrompt`) is sent on about 280 runs at about 4,000 characters, as often as `rules.md`. The owner (Nov 19): a new unit, 5.1b.
- **Unit 0: the bookkeeping tools have no unit.** `complete_run` (232 calls, 21 refusals), `submit_thesis` (122), `record_run_summary` (65), `dispatch_thesis_research` (25), `wait_for_thesis_refresh` (17). The owner (Nov 19): a new unit, 4.5.
- **Unit 1.1: a buy with no playbook.** Should `place_trade` refuse it, the chat included, with "send it to the Writer to name one, then buy"? The owner's question (it changes what his chat can do). If yes, unit 4.1 builds the refusal.
- **Unit 1.1: two inherited rules disagree on a compounder.** The account sells at 6% off the high, and the Secular Compounder's rule says "Down 15% from its high. A question, not a sale". The analysts held CEG and GEV on that rule on Nov 17. §2 calls this a bug in the rules; unit 1.5 owns it.
- **Unit 0: sale proposals mostly expire.** 80 of 91 in 30 days (135 of 181 in 12 weeks). That is the approval switch and the owner's attention, not an agent's text. It went to 1.1, which kept approvals on (the owner's choice) and made the trail's Auto-sell its call.

## Found, not yet assigned

Found before the review started, from the watch rewrite of Nov 19. Each belongs to a unit above.

- **1.8, before an event:** the playbook ends the watch 21 days before the event date, while the Writer wanted a look after the decision (CORT, Nov 19).
- **1.5, compounder accumulation:** "Stop watching if below the 200-day average" was true on BWXT, ETN and NOW. The Writer took it off on BWXT and ETN because the business was strong. Is a 200-day break the right end of a compounder watch?
- ~~**1.1 and 1.3, price stops written long ago:**~~ Answered by 1.1: MSFT's line was written Nov 13, six days before it fired correctly on the close. A stop-watching line is not re-priced at each review, or it never fires. What MSFT lacked was a playbook (1.1's no-playbook question).
- **4.2 and 5.6, After the buy wrote a true add:** on Nov 19 it put "Add if below $406.88 · only on the close" on PANW at $361, already true when written. The owner removed it. (Found by 1.1.)
- **3.3, something happened:** what to check on a big day (the company's own news or the whole market) belongs in that skill, not in the big-day trigger's reason. (From 1.1.)
- **2.4, one stock in full:** a refresh rewrites the claim but not the research sections. MA's catalysts still listed October's report as upcoming after its Nov 19 refresh.
- **9.3 on the roadmap, a passed buy chased up:** WST's buy was moved up four days in a row after passes.
- **Yardstick (roadmap E.11):** a chat case is scored on its first step only, so a chat that reads a date first and would then write the plan counts as a miss.
