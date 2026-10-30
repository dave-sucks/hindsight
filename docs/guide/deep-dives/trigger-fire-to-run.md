# From a trigger fire to a run

**Every five minutes the whole book is checked, and what a fire wakes depends on what it is.** A buy, add, trim or sale wakes an analyst. A review waits for morning. A plan on a stock we don't own is taken down with no one woken.

This page follows a [trigger](../concepts/triggers.md) from the price check to the [trigger run](../agents/trigger-runs.md) it starts.

## The five-minute pass

While the market is open, the check loads every stock an active analyst holds or watches, and every stock a paused analyst still holds, with its rules resolved from the thesis, the analyst and the account. It prices up to 200 stocks in one call and reads what the rules need: the chart numbers written at 6:30 AM (a stock added since gets its numbers on the spot), today's volume, the earnings calendar and new filings. Each trigger is checked in its own catch: one that can't be read is logged and skipped, and the rest are still checked.

At 4:20 PM a close pass runs for the rules that wait for the closing price, with the day's closing bar as the price. A floor on a stock we only watch is one of them: it reacts to a close, never an intraday dip.

## Does it fire

`shouldFire` answers, in this order:

1. **Does the condition hold?** If not, nothing else matters.
2. **A buy or an add on a stale quote** never fires. In market hours, a price older than 15 minutes isn't today's price; at the open, the last close was once served as "now". A sale or a review still fires on a stale quote, because missing a stop is worse.
3. **A buy fires on its crossing:** true now, false at the prior close. A buy written after that close is measured from the price it was written at, so a level set on a down day isn't dead on arrival.
4. **Is it resting?** A cooldown holds back a trigger that fired recently. When it ends, anything but a buy that still holds fires again: an add, a trim, a sale or a review. That's how a declined sale returns. The hard stop a new plan starts with has no rest at all, so it asks again at the next check if a run holds.

The check has first claim on prices. Every other caller is refused a quote once a vendor's per-minute allowance falls to a reserve, so a busy page can't leave stops unpriced.

## Where a fire goes

Where it goes is the trigger's On fire, the same three choices on every trigger:

- **Send to Agent** (unset, every action but a review): an `app/thesis.trigger.fired` event starts a trigger run.
- **Flag for Review** (unset, a review): written to Activity and left for the next [morning run](../agents/morning-runs.md). A red filing on a stock we hold starts a run the same day. A sale or buy flagged for the morning asks at most once a day.
- **Auto** (only ever chosen): no agent decides. The trigger run makes the trade the agent would have: a sale closes the position, a trim sells its share, a buy or an add is sized and checked by the buy's own rules and paid from cash. It goes to the [approval](../concepts/approvals.md) gate like any other trade. Then the same run reads the stock and writes the trade up, with no trade tools, in the "auto trade made" [situation](../concepts/situations.md). Its note replaces the trade's one plain line, so the card and the email carry the analyst's words; the email waits for it. A refused trade is written up too. An Auto buy, add or trim then comes off the stock (used once); an Auto-sell stays. With nothing to trade (a buy on a stock we hold), the agent is asked instead.
- **A paused analyst's stock:** only the sales on a stock it still holds are checked. Each one that fires comes to you as a sale and never wakes the analyst: an Auto-sell goes through your approval switch as usual; Send to Agent or Flag for Review was asking for judgment, so it always waits for your approval.
- **A stock we only watch,** when its floor breaks on a close or its target is reached first: the plan comes down on the spot. The buy, floor and target are removed and a line is left for the next morning run. No run starts and nothing is proposed.

## One run per question

Several rules stop one move from waking the desk twice:

- **Together:** a stop and a trail firing in one pass fold into one run, which sees both. Each still gets its own Activity line. Buys, adds and reviews never fold.
- **A sale already waiting:** if a sale of the position is waiting for you or already sent, the check skips the fire and doesn't start its cooldown, so it asks again on the first check after that proposal expires: every day, not every other day. A proposal past its 24 hours counts as gone even before it is marked expired. A sale you declined in the last four hours also starts nothing; that fire does start its cooldown.
- **A buy already waiting,** or checked in the last four hours by a completed run, starts nothing.
- **A buy that slipped back:** if the run passed because the price had fallen back under the level, without trying to buy, the buy stays armed and can fire again that day, up to three times.

## The high the trails use

A trail measures the give-back from the highest price since the buy (the lowest, for a short). Every five-minute check raises that mark before it reads any trigger: from the live price, and for a stock held since before today's open, from the day's high so far, so a spike between two checks still counts. A price that isn't live moves nothing. The 4:20 PM close pass raises it once more from the finished day's bar, so a high in the last minutes of the day counts too. A mark is never lowered.

<details>
<summary>Technical details</summary>

#### The pass
`lib/inngest/functions/trigger-evaluator.ts`: cron `*/5 9-16` weekdays ET, then `isMarketOpen()` for the intraday session or `isClosePassTick` (16:20–16:34) for the close. Prices from `getLiveQuotes` in `lib/market-data/live-quote.ts` with `caller: "trigger-check"`, capped at 200 tickers. Chart numbers from `TickerIndicators` through `ensureIndicatorSnapshots`; filings from `fetchBookFilings`; earnings from `fetchEarningsWindow`. `evaluateThesisTriggers` wraps each `shouldFire` in its own try/catch.

#### Fire rules
`shouldFire` in `lib/agent/triggers/evaluate.ts`. Reasons: `no-match`, `stale-quote` (ENTER and ADD only), `no-crossing`, `cooldown`. Baseline from `crossingBaseline` in `lib/agent/triggers/written-price.ts`. Cooldown from `effectiveCooldownDays` in `lib/agent/triggers/defaults.ts`.

#### Stale quotes and budget
`STALE_QUOTE_MS` (15 minutes) and `staleForTrading` in `lib/market-data/quote-age.ts`. `RESERVED_SHARE` in `lib/market-data/quote-budget.ts`: 20% of Alpaca's limit and 75% of Finnhub's are held back from every caller but the trigger check.

#### Routing
`effectiveTriggerAction` and `watchedFloorOnClose` in `lib/agent/triggers/types.ts`. DEMOTE runs `demoteThesisPlan` in `lib/agent/triggers/demote.ts`. Reviews write a `TRIGGER_FIRED` row; `filingNeedsSameDayLook` in `lib/market-data/sec-events.ts`. Which fires wait for the morning and which trade with no agent is `waitsForMorning` and `doItTrade` in `lib/agent/triggers/fire-mode.ts`. An Auto-sell is the `direct-close` step in `lib/inngest/functions/tactical-run.ts` and calls `closeOpenPosition`; a paused analyst's sale takes the same step with `propose: true` unless it is Auto (`pausedAnalystTriggers` and `PAUSED_SALE_NOTE` in `lib/agent/triggers/paused.ts`); a trim, buy or add is the `do-it` step, which calls the trade tool with `doItCall` and then `useOnce`. Either way the run then writes the trade up (`autoTrade` in `lib/agent/system-prompts/intraday-tactical.ts`, no tools in `NOT_IN_A_WRITEUP`), and `putNoteOnOrder` in `lib/proposals/auto-writeup.ts` puts its note on the order before the run reads finished; `proposal-pending-email` waits for `app/proposal.note.written`.

#### Folding and snoozes
`collapseProtectiveFires` in `lib/agent/triggers/co-fire.ts` (EXIT and TRIM only). A sale under way is `saleUnderWay` in `lib/proposals/position-lock.ts` (PENDING, or AWAITING_APPROVAL and not past `expiresAt`); the evaluator drops a sale fire on such a position before `stampLastFiredAt`. In `tactical-run.ts`, the backstop: `check-queued-close` and `EXIT_RECHECK_SNOOZE_MS` (four hours, rejected sales only); `check-queued-buy`; `check-recent-enter-run`.

#### Re-arm
`decideBuyRearm` and `rearmBuyAfterPass` in `lib/agent/triggers/rearm.ts`, `MAX_REARMS_PER_DAY` = 3, stored as `rearmedAt` in `Thesis.triggerState`.

#### Peak
`raiseWaterMarks` in `lib/trading/water-mark.ts`, called by the intraday pass before the check: writes `Position.peakPrice` / `peakAt` (and the trough) when a fresh quote moves them. The day's high is the quote's own Alpaca daily bar, regular hours only. On the close pass, `raiseMarksFromDayBars` reads `getTodaySessionBars` for every open position bought before that day's open.
</details>
