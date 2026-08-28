# Session handoff — 2026-08-28

Consolidating four parallel sessions. Read this before touching anything.

## Where the system actually stands

Three live analysts: PEAD (3/6 slots), Catalyst (2/5), Compounder (3/4). Eight of fifteen
position slots filled.

**The core loop works — verify this yourself before believing anyone who says otherwise.**
Last 9 days of morning runs: every run completed, 69 thesis edits, 25 with real field changes
(entry prices re-priced, stops moved, triggers rewritten, TXN and RARE retired). PEAD made
**+$3,607 in 21 days**. The app mints theses, reviews them on cadence, fires triggers, and
closes positions on stops. That is not broken and was never broken.

## What shipped from this session (all merged)

- **#559 — the seat's context follows the analyst, not the mode name.** `getMoneyContext` was
  imported by two files, so a chat pinned to an analyst got the fence and the watchlist but no
  equity, no positions, no history. Now money + book attach wherever an analyst resolves.
  Past holds ship as *candidates* with our realized P&L. `get_stock_data` returns per-ticker
  prior coverage automatically (account-wide, labelled by seat). Also fixed: the
  researched-before-thesis gate resetting between chat turns, and a missing duplicate guard on
  PASS writes — together those wrote 20 PASS rows for 13 tickers on 08-25.
- **#562 — the scoped chat prompt was missing the market-cap fence.** It listed every other
  dimension. An agent proposed dispatching IRD ($335M against a $1B–$20B fence) and wrote
  "micro-cap" as a positive. Nothing downstream checks cap: `record_thesis` has no gate.
- **#566 — the ENTER rung reads the level instead of assuming breakout.** Every LONG watch got
  `PRICE_ABOVE(entryPrice)` regardless of intent. A pullback level was true on arrival and
  nagged daily (NOW set $130 against a $132.51 tape); a breakout level waited. Now the side
  follows where the analyst put the level. Deliberately not a setting — the 08-16 ruling.

**One database change:** deleted 20 PASS rows + audit rows from run `cmt8512eh` (the 08-25
Catalyst triage). They were graded blind, 7 were duplicates, and several were out-of-fence junk.

## What shipped from the other sessions

- **#553 / #554 / #556 — levels are triggers.** Every price on a thesis now does something.
  44 levels armed across 25 theses. Deleted RUNNING_WINNER, `maxHoldDays`,
  `revalidationTriggers`, two contradicting cadence tables.
- **#563 — `nextReviewAt` was called derived and derived by nothing.** #556 removed the code
  that advanced the review date and left five readers. Every thesis read as overdue forever.
  Fixed, plus a backfill of 27 theses.
- **#561 — deleted the duplicate review cron.** **#564 (DAV-220)** — one way to sell a whole
  position. **#560** — fill-time buy-price stamp. **#555 / #557** — docs.

**Still open:** #567 (DAV-210 status-transition table), #565 (DAV-219 gate telemetry),
#558 (DAV-216 + DAV-209 W2, soft watch).

## Outstanding — and most of it does not matter

13 Linear tickets were created in 5 days while 17 PRs merged. That is sessions promoting every
observation into a work item. **Two things actually matter:**

1. **DAV-212 — Compounder holds $23,844 across three live positions against a $10,000 cap that
   was never cut.** Flagged urgent 08-24, still Backlog. Real money.
2. **DAV-221 — delete `Thesis.nextReviewAt`.** The cached copy is the only reason review timing
   can drift, and it caused the 08-27 bug. Last step of work that is otherwise done.

**Lower, real, not urgent:** Compounder carries 12 watchers for 1 free slot with GD/GEV/VST/ETN
last *researched* mid-June — and the review-clock backfill reset their clocks, so nothing flags
them (looking ≠ researching; staleness must key on `researchUpdatedAt`). Watchlist stops are
wide (IONS risks 34%, MIRM 22%, SMMT 20%) — analyst-authored, now live. ServiceNow sits above
its entry trigger and has not proposed; unexplained, unchased. PASS records carry no catalyst
date, which blocks measuring the $1B floor decision.

**Open question for the principal:** the $1B market-cap floor has never prevented a loss on this
book — IONS and MLTX were both inside it — while excluding names like IRD. Nobody has data on
sub-$1B because the seat has never traded one.

## The first thing to check

**Tomorrow's morning runs.** #566 changed how entry levels are interpreted. The test: does a
watchlist name get re-leveled with a sensible side, and does anything propose a buy? Zero buys
were proposed from 08-24 to 08-28. If it re-levels and still doesn't propose, there's a second
cause behind the first — go find it.

## Standing rules — all four sessions broke at least one

- **Pending and expiring approval-queue proposals are the app WORKING.** Never report them as
  findings. DAV-213 was already Canceled for this reason and a session still re-raised it.
- **New gates require answering "what INPUT was missing?" first.** Every real bug this week was a
  missing input, not a missing fence. PRs state net line delta (DAV-210 is the deletion ledger).
- **Plain language.** Product terms only — stocks, analysts, runs, triggers, theses.
- **Verify against the database.** Do not take another session's claims at face value, including
  the ones in this file.
- **The recurring bug shape, five times this week:** change one side of a relationship, write a
  comment describing the side you didn't build, check only the half you were looking at.
  Entry prices, watchlist floors, the held book, the review date, the mint path. Extend
  `lib/agent/triggers/lifecycle.test.ts` — it walks a stock end to end and it is the only thing
  that caught one of these first.
