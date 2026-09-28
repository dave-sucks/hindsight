# State of the cycle — 2026-09-28

Written so a fresh session, or Dave walking the app end to end, starts from
facts. Every number is from the rows of the account that trades
(`34f5c589…`, davembixler@gmail.com), read on 2026-09-28. Main is the commit
after the revert of #723.

## Read this first: four traps in the data

1. **Two accounts.** `Account` has two rows. Only davembixler@gmail.com has
   analysts and positions. The 09-26 audit read both as one and reported
   rules that are not on the trading account.
2. **Timestamps.** Columns are `timestamp without time zone` holding UTC.
   node-pg reads them as local time, so everything prints four hours late
   unless the type parser is set. Morning runs are at 08:00 ET.
3. **The prompt a run gets** is built in `lib/agent/system-prompt.ts`.
   `system-prompt-template.ts` is only the preview on the workflow page.
4. **"The run wrote nothing"** is never true because a diff is empty. Read
   `rationale`. ABT's "empty" rows each held a full written answer.

## The cycle, stage by stage

| Stage | What is supposed to happen | What the rows show (30 days) | Standing |
|---|---|---|---|
| Discovery | Dave runs it by hand, per analyst | Chats on 09-24, 09-26, 09-27 | By design |
| Writing a thesis | The writer researches and saves a priced plan | 09-24: 1 of 5 saved. After the 09-25 fix the re-sent ones saved; five writers completed 09-27/28 | Fixed; few data points |
| On watch | A stock has a buy price, waits on a date, or is on soft watch | 27 with a direction: 16 have a buy, 7 wait on a date, 4 have neither. 3 more are soft watches with no direction | 10 of the 16 buys were put on by Dave's chats |
| Morning review | Mon/Wed/Fri 08:00 ET; answers what fired | 09-28: 3 of 3 completed; 4 refusals, all fixed in the same run | Working |
| Buy price hit | The analyst wakes, confirms, proposes the buy | 30 hits → 7 proposals | **Not working** — see below |
| Approval | Dave approves or declines; proposals expire in about a day | 7 proposals: 5 approved, 2 expired (MIRM, LUXE) | Working |
| Holding | Sell rules come from the analyst and the account | 6 held. 5 carry old copied rules that override the analyst's | In progress (the builder) |
| Sale proposals | A protective sale is proposed every day its line is broken | 50 proposed: 7 filled, 20 declined, 23 expired | Working. A declined sale has come back as a question since 09-27 |
| After a sale | The next run looks once: watch again, or let go | 7 sales, 7 accounted for. FIVE let go and IOT re-watched on 09-28 | Working |
| Seeing it | Activity shows what happened | Trades and proposals show. A blocked action shows only until the run fixes it (minutes). An analyst passing on a buy never shows | **Not working** |

## Buy price hit → proposal

Thirty times in 30 days a buy price was hit and an analyst woke up.

| What happened | Count |
|---|---|
| Proposed, approved, bought | 5 (NVDA, SMMT, ASML, FIVE, IOT) |
| Proposed, nobody clicked, expired | 2 (MIRM, LUXE) |
| The analyst tried to buy and a rule stopped it | 15 |
| The analyst looked and chose not to buy | 8 |

The 15: score under the analyst's minimum 6, analyst had no room 5, size
under the smallest trade 2, size over the largest trade 2.

- **Size (4)** cannot happen since 09-25: the app sizes every buy.
- **No room (5)** were all the Secular Compounder. It holds 4, its settings
  allow 6, and **its own instructions say "My book is 3-4 names, each a real
  commitment."** It will keep turning buys down until that line changes.
- **Score (6)**: a stock can sit on watch with a buy price its score will
  never let through. Today: VST (5/10 against 7). COGT has a buy trigger and
  no direction at all, so its buy would be refused too.
- **Chose not to buy (8)**: CRM twice, MIRM twice, MSFT, HPE, GEV, DOCU.
  DOCU (09-28, 09:30) is the clearest: a dip-buy fires when the price
  touches the level, the analyst wants to see the day close strong first,
  and at the open there is no close. A buy written that way is passed every
  time it fires.

Only one buy price has been hit since the 09-25 fixes (DOCU). The rate
after the fixes is not known.

## Who changes buy prices

| Who | Put a buy on | Took a buy off |
|---|---|---|
| Dave's chat | 9 | 0 |
| Morning runs | 4 | 8 |
| Trigger runs | 0 | 1 |
| Writers | 2 | 4 |

Counted from `ThesisUpdate.fieldChanges.triggerOps`. Of the 13 removals, 3
were stocks waiting on a date (MIRM, PRAX twice).

**This is a decision, not a bug, and it is Dave's.** When a plan stops
fitting, an analyst can take the plan off and wait, or leave a buy standing
at the level where it would fit again. The runs do the first. Dave's chat
instruction on 09-27 asked for the second. Putting a stock on soft watch on
purpose is a legitimate outcome and is part of the design (2026-09-08).

What the runs do that is neither: they take the plan off and keep the stock
on its review schedule, so it is reviewed again and again with nothing to
buy. A soft watch has no formal review and a trigger that would bring it
back.

#723 (09-28) refused the removal outright. It was merged without Dave's
word, contradicted the soft-watch design, and was reverted the same day
(#724). Nothing from it is live.

## Known and verified, not yet fixed

| What | Evidence |
|---|---|
| A blocked or passed buy is invisible in Activity | Feed reads open refusals only; every refusal since 09-25 closed within its run |
| Dip-buys fire when the analyst cannot confirm them | DOCU 09-28 09:30 |
| The Compounder's instructions cap it at 3–4 names | Its `analystPrompt`; holds 4 of 6 |
| HPE's floor is $3.00 under its buy; HPE moves about $3.50 a day | Thesis row, indicator snapshot |
| The chat was refused 11 times on 09-27 before its edits landed | GD and VST, five each, same message. Cause unknown: the refusal ledger stores the message, not the call |
| Two flags give opposite orders inside the last 21 days before an event | No buy: "price it". A buy: "take it off". No stock is in that state today; AGIO reaches it about 10-11 |
| Five holdings carry copied rules | ABT, ASML, WST, CEG, NVDA. NVDA still has "down 7% in a day → add", which the PEAD analyst should never have |
| Earnings heads-up is 3 days; runs are Mon/Wed/Fri | A Tuesday print can be missed. Not changed |

## What is live since 09-25

- The writer's save repairs a fixable field instead of losing the research.
- Agents do not size trades; the app does, inside the analyst's limits.
- A refused call is retried in the run and carried to the next.
- A sale Dave declines comes back as the next run's question.
- A watched stock with no buy is flagged to the run, unless it waits on a date.
- A buy into a dated event is half size; after the event, full size.
- A review on "below the 200-day" asks weekly, not daily, and the run is
  told how many times it has already been asked.
- A held stock's review is told to go down its invalidation conditions.

## Walking it end to end

What to look at, in order, and what right looks like.

1. **Discovery chat** on one analyst. Right: it names candidates, dispatches
   writers, and when asked whether they landed it answers per stock,
   including failures with the writer's reason.
2. **The new thesis.** Right: a direction, a setup, a score at or above the
   analyst's minimum, and either a buy price with a floor and a target
   paying 2:1, or a stated date it is waiting for.
3. **The first morning review.** Right: the stock is either untouched
   (nothing fired) or has one Activity line saying what changed and why.
4. **A buy price hit.** Right: a proposal reaches Dave with the size and the
   arithmetic. Today a pass or a block leaves no trace in the feed; look at
   the run itself on `/runs`.
5. **A holding.** Right: its sell rules are the analyst's current ones
   (the analyst's Triggers tab), plus its own floor and target.
6. **A declined sale.** Right: the next run either moves the floor within
   15% of the declined line or proposes the sale again.
7. **A sale.** Right: the next run looks once and either puts it back on
   watch or lets it go, in one line.

## The 09-26 audit

Twelve tickets. Five described something that was not there (the account's
down-7% add, its duplicate rules, the missing binary halving, the SRRK
label fixed ten days earlier, sold stocks dropping out of review) and two
more were partly wrong. They are closed with the evidence on each ticket.
Do not re-file them.
