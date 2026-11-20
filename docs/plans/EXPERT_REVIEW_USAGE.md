# The expert review: usage (unit 0)

What production used over the 30 days to Nov 19, 2026, counted from the database with no model calls, and how that sorts every unit in `EXPERT_REVIEW_LEDGER.md` into **delete**, **bulk** or **its own unit** (`docs/PRINCIPLES.md` §8). Only the owner's account is counted; the second account in the database is a test account and fired nothing. Where a 12-week count adds something, it is given beside the 30-day one.

**Read this first.** Most of the 30 days ran on the old build. The one-job action tools merged Nov 19, the context catalog Nov 18, and the eight situations Nov 15. So:
- A tool that is new this week has its old tool's calls, mapped field by field (`update_thesis`'s note fields → `write_note`, its trigger fields → `edit_triggers`, and so on). Mapped counts are marked "via".
- A context item's sends are the runs of each agent that ticks it on its record today, times the 30-day run count of that agent. Its size is the median from the requests saved since Nov 18 (characters; about 4 to a token).
- A situation code that was merged on Nov 15 is counted under the code it became.

## The runs behind every count

| Agent | Runs in 30 days | Days it ran | Average input tokens per run |
|---|---|---|---|
| Trigger run | 125, and 39 post-trade write-ups after an Auto sale (164 runs in all) | 22 | 83k |
| The Writer and the Holding refresh | 64 (23 new watches, 41 refreshes) | 11 | 108k |
| Morning run | 50 | 17 | 573k |
| Chat | 16 conversations, 57 messages from the owner | 11 | 609k per conversation |
| Portfolio digest | 10 | 7 | 1k |
| Market Reviewer | 7 | 6 | 32k |
| Portfolio Manager | 3 | 2 | 42k |
| Discovery (off) | 2 | 1 | 116k |
| After the buy (new Nov 19) | 1 | 1 | 35k |

The trigger runs by the action that woke them: a sale 86, a buy 14, a review 16, an add 9. The 39 write-ups all followed an Auto sale.

---

## 1. Calls per tool

Calls the model made (code's up-front reads, such as the morning run's first `get_theses` and the Writer's searches, are left out). 30 days, with 12 weeks where 30 days shows almost nothing.

| Tool | Calls, 30 days | Runs | Refused | Who calls it | Sort |
|---|---|---|---|---|---|
| `get_stock_data` | 382 | 219 | 0 | morning 192, trigger 159, chat 20, Discovery 11 | own (4.4) |
| `web_search` | 344 (+132 by code) | 205 | 0 | morning 183, trigger 154 | own (4.4) |
| `complete_run` | 232 | 209 | 21 | trigger 164, morning 68 | own (no unit yet, see questions) |
| `write_note` | 4, via `update_thesis` 211 | 121 | — | morning, trigger | own (4.3) |
| `edit_triggers` | 25, via `update_thesis` 176 | 125 | 1 | Writer 23, morning, trigger | own (4.2) |
| `submit_thesis` | 122 | 64 | 4 failed | the Writer | own (no unit yet, see questions) |
| `set_conviction` | via `update_thesis` 120 | 64 | — | morning, trigger | bulk in 4.3 |
| `get_theses` | 92 | 61 | 0 | morning 78, chat 10, PM 3 | own (2.1, 2.2 read it) |
| `get_sec_filings` | 66 | 31 | 0 | morning 59 | bulk in 4.4 |
| `get_earnings_data` | 65 | 30 | 0 | morning 62 | bulk in 4.4 |
| `record_run_summary` | 65 | 50 | 0 | morning | own (no unit yet, see questions) |
| `get_portfolio_context` | 51 | 50 | 0 | morning (once per run) | bulk in 4.4 |
| `sell` | via `close_position` 49 | 48 | — | trigger 43, morning 6 | own (4.1) |
| `dispatch_thesis_research` | 25 | 19 | 0 | chat 11, morning 9, Discovery 4 | bulk (no unit yet) |
| `wait_for_thesis_refresh` | 17 | 7 | 0 | morning 15 | bulk (no unit yet) |
| `place_trade` | 12 | 11 | 1 | trigger 10 | own (4.1) |
| `set_catalyst_date` | via `update_thesis` 10 | 10 | — | | bulk in 4.3 |
| `stop_watching` | via `update_thesis` 9 | | — | | bulk in 4.3 |
| `watch_again` | via `update_thesis` 6 | | — | | bulk in 4.3 |
| `run_screen` | 6 | 2 | 0 | Discovery | bulk (5.9) |
| `list_analysts` | 4 (7 in 12 weeks) | 4 | 0 | chat | bulk in 4.4 |
| `add` | via `manage_position` 3 | 3 | — | trigger | own (4.1, reaches a trade) |
| `get_market_context` | 3 (18 in 12 weeks) | 3 | 0 | morning | bulk in 4.4; the market numbers are now context on every run |
| `read_analyst_config` | 3 (7 in 12 weeks) | 2 | 0 | chat | bulk in 4.4 |
| `get_market_movers` | 3 | 2 | 0 | Discovery | bulk in 4.4 |
| `pass_on_stock` | via `update_thesis` 2 | | — | | bulk in 4.3 |
| `ask_question` | 2 | 2 | 0 | chat | bulk in 4.4 |
| `read_knowledge_library` | 1 | 1 | 0 | chat | bulk in 4.4 |
| `get_earnings_calendar` | 0 (4 in 12 weeks) | | | | bulk in 4.4 |
| `get_catalyst_calendar` | 0 (1 in 12 weeks) | | | on the trigger run, chat, builder and After the buy | bulk in 4.4 |
| `list_proposals` | 0 (1 in 12 weeks) | | | chat | bulk in 4.4 |
| `watch_stock` | 0 (new Nov 19) | | | chat | bulk in 4.3 |
| `list_runs`, `read_run`, `read_accuracy_reports`, `read_trade_results` | 0 in 12 weeks | | | on the chat's list | **delete** from the chat's list |
| `get_analyst_coverage`, `get_earnings_history`, `get_financials_deep`, `get_insider_activity`, `get_peers_with_metrics` | 0 in 12 weeks | | | registered in `lib/agent/tools/index.ts`, on no agent's list | **delete** |
| `read_database` | 0 (2 in 12 weeks) | | | registered, on no agent's list | **delete** |
| `manage_position` | 3 before Nov 19 | | | the file `lib/agent/tools/manage-position.ts` and its test kept, on no list; `add` replaced it | **delete** |

Not counted: the builder and editor chats (`suggest_config`, `ask_question`, `read_knowledge_library`) are not saved as runs, so their calls are not in the database.

Refusals in 30 days (`GateRejection`): `complete_run` 21 (the work list not answered), `update_thesis` 12 (10 on a sold or retired stock), `record_thesis` 10, the Writer failing 4, `place_trade` 1, `edit_triggers` 1.

---

## 2. How often each context item is sent, and its size

| Context item | Sends in 30 days | Who gets it | Median size (max) | Sort |
|---|---|---|---|---|
| `market_numbers` | 346 | every agent but the digest and Discovery | 1,068 (1,112) | own (2.3) |
| `the_analyst` | about 280, plus the chat when pinned | every agent about one analyst | 4,097 (6,227) | see questions: no unit owns it |
| `the_stock` | 229 | trigger run, write-up, Writer, After the buy | 12,495 (17,573) | own (2.4) |
| `portfolio` | 127 | morning, chat, digest, Reviewer, PM | 1,725 (3,515) | own (2.3) |
| `situations` | 125 | trigger run | 7,143 (10,377) | Layer 3 (it is the situations' text) |
| `the_book` | 119 | morning, chat, Reviewer, PM, Discovery | 14,506 (15,090) | own (2.1 and 2.2: it holds the rows) |
| `market_digest` | 110 | morning, chat, PM | 4,910 (5,244) | own (2.3) |
| `portfolio_digest` | 107 | morning, chat | 1,279 (1,971) | own (2.3) |
| `stock_data` | 65 | Writer, After the buy | 6,380 (7,048) | own (2.4) |
| `playbook_record` | 64 | Writer | 363 (430) | bulk (2.5) |
| `playbooks` | up to 64 | Writer (not the Holding refresh) | 4,427 (6,724) | Layer 1 (it is the playbooks' text) |
| `the_analysts` | 57 | chat | 625 | bulk (2.5) |
| `earnings_this_week` | 50 | morning | 527 | bulk (2.5) |
| `filings_this_week` | 50 | morning | 345 (361) | bulk (2.5) |
| `refused_calls` | 50 | morning | 1,504 | bulk (2.5) |
| `last_output` | 10 | Reviewer, PM | 2,931 (6,735) | bulk (2.5) |
| `the_playbook` | about 8 | trigger run, on a review of a watch | 1,505 (4,427) | bulk (2.5) |
| `earnings_calendar` | 2 | Discovery (off) | 2,310 | bulk (2.5) |
| `holding_triggers` | 1 (new Nov 19, every buy and add fill) | After the buy | 22 | bulk (2.5) |

By weight, three items carry most of what agents read: `the_stock` (229 × 12.5k), `the_book` (119 × 14.5k) and `situations` (125 × 7.1k). Nothing is unused; the two smallest counts belong to an agent that is off (Discovery) and one that started this week (After the buy).

The instructions each agent is sent, for Layer 5 (characters, today): the chat 33,893 (its own 28,101 + `rules.md` 5,792); the Writer 17,072 (`rules.md`, `research-rules.md` 5,120, its own 6,158); the Portfolio Manager 10,203; the trigger run 10,028; the morning run 8,868; the post-trade write-up 8,436; After the buy 7,075; the Market Reviewer 3,382; the digest 1,585. `rules.md` rides on seven agents.

---

## 3. How often each situation occurs

Two sources: the rows of the morning run's reads (`get_theses`, 94 reads in 30 days), and the trigger runs, whose situation follows from the action that woke them.

| Situation | Rows on a morning read | Trigger runs | Reaches a trade | Sort |
|---|---|---|---|---|
| A review (`REVIEW_DUE`) | 109 (96, plus 7 filing, 4 earnings and 2 quiet-watch rows merged into it Nov 15) | 16 | no | own (Layer 3) |
| A sale or trim (`PROTECTIVE_SALE`) | 35 | 86 (and 39 write-ups) | yes | own |
| A buy (`BUY_ARRIVES`) | 7 (5, plus 2 "buy blocked, analyst full") | 14 | yes | own |
| An add (`ADD_OR_WINNER`) | 6 | 9 | yes | own |
| A note to answer (`NOTE_TO_ANSWER`) | 26 (14, plus 12 "your word unanswered") | 0 | no | bulk |
| A floor to fix (`PROTECTION`) | 1 | 0 | no | bulk |
| Just sold (`SOLD_ONE_REVIEW`) | 2 | 0 | no | bulk |
| Promoted to live (`PROMOTED_AWAITING`) | 0 (the last promotion was Aug 12) | 0 | yes, when it happens | bulk; two analysts are still on paper, so it is not dead |

Deleted on Nov 15 and still in the 30 days: "plan problem" 337 rows and "stale research" 102 rows. They were the two biggest; nothing replaces them.

---

## 4. How often each playbook occurs

All twelve in `SETUP_IDS` (`lib/agent/knowledge/setups.ts`), plus stocks with none. "Archetypes" are the new-analyst seeds in `lib/agent/knowledge/strategy-archetypes.ts` that name the playbook; they are not live analysts.

| Playbook | The Writer chose it (30 days) | Live watches / holdings now | Positions opened in 12 weeks | On which analysts' lists | Sort |
|---|---|---|---|---|---|
| Pullback to a rising average (`MA_PULLBACK`) | 34 | 8 / 0 | 0 (2 closed, MU) | all five enabled | own (1.4) |
| Compounder accumulation | 24 | 7 / 4 | 5 (7 closed) | Secular Compounder | own (1.5) |
| Before an event (`PRE_CATALYST`) | 24 | 7 / 0 | 1 (4 closed) | Catalyst Event PM, Mergers and Index Events | own (1.8) |
| Drift after earnings (`PEAD`) | 8 | 0 / 0 | 1 (FIVE) | PEAD Specialist | own (1.6) |
| Base breakout | 3 | 3 / 0 | 1 (AAPL) | three analysts | own (1.3): rare, but it reached a trade |
| Episodic pivot | 1 | 1 / 0 | 0 | PEAD Specialist | bulk with 1.9 |
| Momentum flag | 0 | 0 | 0 | none | **delete** (1.9) |
| Insider cluster | 0 | 0 | 0 | none | **delete** (1.9) |
| Estimate revision | 0 (no triggers in its template) | 0 | 0 | none | **delete** (1.9) |
| Sector rotation | 0 (no triggers in its template) | 0 | 0 | Quality Leaders; the Sector Rotation archetype | **delete** (1.9), after the owner takes it off Quality Leaders |
| Near the 52-week high (`RS_52W_HIGH`) | 0 (0 in 12 weeks) | 0 (no stock has ever been saved with it) | 0 | Quality Leaders (paper, 1 live stock); the Relative Strength Momentum and Sector Rotation archetypes | **delete** (1.9), after the owner takes it off Quality Leaders |
| Oversold bounce (`RSI2_BOUNCE`) | 0 (0 in 12 weeks) | 0 (no stock has ever been saved with it) | 0 | none; the Oversold Bounce archetype | **delete** (1.9) |
| No playbook (`NONE`, or none set) | 25 on the old save | 20 / 3 | **9 of 17** | — | see questions |

`RS_52W_HIGH`'s template is one trigger, a REVIEW within 5% of the 52-week high and ahead of the S&P over 3 months, which its own reason calls a screen. `docs/PRINCIPLES.md` §2 says a rule that finds new stocks is a scan for Discovery, not a trigger. `RSI2_BOUNCE`'s seven triggers are the only place the `rsi` measure is used; deleting it leaves `rsi` with no user, which 1.2 should weigh. A PR that deletes these six playbooks also takes them off the archetypes: momentum flag and near the 52-week high (Relative Strength Momentum), oversold bounce (Oversold Bounce), sector rotation and near the 52-week high (Sector Rotation), insider cluster (Insider Cluster Buying). Quality Leaders would then have one playbook, `MA_PULLBACK`.

---

## 5. How often each trigger rule fires

The rules every stock inherits, 30 days and 12 weeks.

| Rule | Where | On fire | Fires, 30 days | 12 weeks | Stocks | Reaches a trade | Sort |
|---|---|---|---|---|---|---|---|
| Sell if below 6% from the high since we bought | account | Send to Agent | 98 | 98 | 10 | yes | own (1.1) |
| Review if below the 200-day average | Secular Compounder | Flag for Review | 46 | 153 | 16 | no | own (1.5, compounder) |
| Review if it files something material | account | Flag for Review | 16 | 30 | 13 | no | own (1.1) |
| Review if below 15% from the high since we bought | Secular Compounder | Flag for Review | 14 | 18 | 5 | no | 1.5 |
| Review if reports within 5 days | account | Flag for Review | 9 | 16 | 9 | no | own (1.1) |
| Review if below 15% from our entry | Secular Compounder | Flag for Review | 8 | 8 | 4 | no | 1.5 |
| Review 10 days before the event date | Catalyst Event PM | Flag for Review | 4 | 5 | 3 | no | 1.8 |
| Review if within 1 day after earnings | account | Send to Agent | 2 | 2 | 2 | no | 1.1 |
| Review if below 12% from our entry | PEAD Specialist | Flag for Review | 2 | 2 | 1 | no | 1.6 |
| Review if above 15% from our entry | Secular Compounder | Flag for Review | 1 | 1 | 1 | no | 1.5 |
| Review if it files an 8-K 7.01 | Catalyst Event PM | Flag for Review | 1 | 1 | 1 | no | 1.8 |
| Review if above 10% from our entry | PEAD Specialist | Flag for Review | 0 | 2 | — | no | 1.6 |
| Review every 7 days | account | Flag for Review | 0 | 0 | — | — | 1.1: the review clock shows as the review situation (109 rows), not as a fire; check it is read that way, not deleted |
| Review 30 days after the event; an 8-K 8.01 | Catalyst Event PM | Flag for Review | 0 | 0 | — | — | bulk in 1.8 |
| All four rules | Mergers and Index Events (paper, 1 live stock) | Flag for Review | 0 | 0 | — | — | bulk in 1.8 |

The stocks' own triggers, 30 days (207 fires; 57 of them on triggers since removed):

| Kind of trigger | Fires | Stocks |
|---|---|---|
| Sell if below a price (and one trail once up) | 105 | 10 |
| Review if above or below a price | 44 | 10 |
| Buy (above or below a price, near an average) | 14 | 6 |
| Add on a day's move, up or down | 9 | 6 |
| Review on a report, a surprise or a filing | 19 | 11 |
| Review on a move from our entry or yesterday, a date, a clock, strength | 10 | 6 |
| Stop watching if below a price on the close | 4 | 4 |
| An old "plan set down" line | 2 | 2 |

The sales re-fired until Nov 17: 12 to 14 sale fires a day from Oct 28 to Nov 13, 1 a day since triggers work like orders. Of 91 sale proposals in 30 days, 80 expired unanswered, 4 filled, 3 were rejected and 4 still wait (135 of 181 expired in 12 weeks). The fire counts above are mostly the old behaviour; units 1.1 and 3.x should count again from Nov 17.

The measures a stored trigger uses today (181 triggers on live stocks and rules): a price against a level or an average 61, a clock (`repeat`) 32, a report before or after 32, a move near or from a line 27, a date from an event or the buy 26, volume 12 (all inside an "and"), a filing 8, a surprise 7. No stored trigger uses `rsi`, `strength`, `gap` or `insiders`, and only `strength` fired in 30 days (once, on a trigger since removed). Those four go to 1.2 as keep-or-delete questions; a trader in some style may want each, so they are not deleted on usage alone.

---

## 6. The sorting, unit by unit

| Unit | Sort | Behind it |
|---|---|---|
| 1.1 The rules for everything | own | the account's 6% trail fired 98 times on 10 holdings; the filing and report rules 27 times |
| 1.2 The measures | own | price and move reach every sale; four measures unused (above) |
| 1.3 Base breakout | own, short | 3 picks, 3 watches, 1 trade in 12 weeks |
| 1.4 Pullback to a rising average | own | the Writer's first choice (34), on every analyst's list |
| 1.5 Compounder accumulation | own | 4 of the 7 holdings; its 200-day rule fired 153 times in 12 weeks |
| 1.6 Drift after earnings | own | 8 picks, 1 trade |
| 1.7 Episodic pivot | bulk with 1.9 | 1 pick, no trade |
| 1.8 Before an event | own | 24 picks, 4 trades closed in 12 weeks |
| 1.9 The other playbooks | delete six | momentum flag, insider cluster, estimate revision, sector rotation, near the 52-week high (`RS_52W_HIGH`), oversold bounce (`RSI2_BOUNCE`): no Writer pick, no stock, no position |
| 1.10 The book and the market | own | every buy |
| 2.1 The watchlist row | own | in `the_book` (119 sends, 14.5k) and every `get_theses` (92) |
| 2.2 The holding row | own | the same reads; every sale decision starts from it |
| 2.3 The market block | own | `market_numbers` 346 sends, the digests 217 |
| 2.4 One stock in full | own | `the_stock` 229 sends at 12.5k, `get_stock_data` 382 calls |
| 2.5 The rest of the catalog | bulk | 11 items, each small or rare (above) |
| 3.1 How a skill is written | own (the owner's design first) | |
| 3.x A review | own | 109 rows and 16 runs |
| 3.x A sale or trim | own | 35 rows and 86 runs |
| 3.x A buy | own | 7 rows and 14 runs |
| 3.x An add | own | 6 rows and 9 runs |
| 3.x A note to answer, a floor to fix, just sold, promoted | bulk, one unit | 26, 1, 2 and 0 |
| 4.1 The trade tools | own | 49 sales, 12 buys, 3 adds |
| 4.2 `edit_triggers` | own | about 200 trigger edits |
| 4.3 The note and status tools | own for `write_note` (about 215), the six others in bulk inside it | |
| 4.4 The read tools | bulk, with deletions | 6 used daily; 10 to delete (above) |
| 5.1 `rules.md` and `research-rules.md` | own | on seven agents |
| 5.2 The chat | own | 57 messages, the largest instructions (33.9k) and the largest spend (609k tokens a conversation) |
| 5.3 The morning run | own | 50 runs, 573k tokens a run |
| 5.4 The trigger run | own | 125 runs, the most of any agent |
| 5.5 The Writer and the Holding refresh | own | 64 runs |
| 5.6 After the buy, and the post-trade write-up | own | 1 and 39 runs; every fill |
| 5.7 The Portfolio Manager | own, short | 3 runs |
| 5.8 The Market Reviewer and the evening digest | bulk, one unit | 7 and 10 runs, short texts, no tools |
| 5.9 Discovery | own, short | off; 2 runs; the owner means to turn it on |

**To delete** (each its own small PR, owner's call): the five registered tools on no list, `read_database`, `manage_position` (the file `lib/agent/tools/manage-position.ts` and its test `manage-position.add-sizing.test.ts`); `list_runs`, `read_run`, `read_accuracy_reports` and `read_trade_results` from the chat's list; the momentum flag, insider cluster, estimate revision, sector rotation, near the 52-week high and oversold bounce playbooks, and their names on the archetypes.

---

## Structure questions for the lead

- **No playbook is the biggest playbook.** 9 of the 17 positions opened in 12 weeks had none (`NONE` or unset), and 23 live stocks have none. Those stocks get their sell rules only from the analyst and the account. Which unit reviews a stock with no playbook: 1.1, or a playbook of its own?
- **The analyst's strategy text has no unit.** `the_analyst` (the analyst's `analystPrompt`) is sent on about 280 runs at about 4,000 characters, as many runs as `rules.md`, and no unit reviews it.
- **The bookkeeping tools have no unit.** `complete_run` (232 calls, 21 refusals), `record_run_summary` (65), `submit_thesis` (122), `dispatch_thesis_research` (25) and `wait_for_thesis_refresh` (17) are in no Layer 4 unit.
- **30 days is the old build.** The counts that decide depth hold (what is used daily is still used daily), but every unit that measures a rule's effect should count again from Nov 17 (triggers work like orders) or Nov 19 (the one-job tools).
- **Sale proposals mostly expired.** 80 of 91 in 30 days. That is the approval switch and the owner's attention, not an agent's text; it belongs to 1.1 (the trail's fire mode) or to the owner, not to a prompt.

## How these were counted

Read-only SQL on the production database (Nov 19, 2026, evening): `ResearchRun` (runs, parameters), `RunMessage` (each run's thread for tool calls; the saved requests for context parts and sizes), `ThesisUpdate` (`TRIGGER_FIRED` rows, joined by `triggerId` to the account's and analysts' rules and to the stocks' own triggers), `Order` and `Position` (trades), `Thesis` (`setupId`, status, stored triggers), `GateRejection` (refusals). A tool call counts when the model made it (its call id is the provider's); `update_thesis` and `close_position` calls were mapped onto today's tools by the fields each passed. Situations come from the `situations` arrays on the rows of each saved `get_theses` result.
