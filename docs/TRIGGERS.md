# Hindsight — Triggers

> **The reference for the trigger system.** What a trigger is, which conditions
> fire on which path, the fire modes, and how a fire flows to a trade. Read this
> before touching `lib/agent/triggers/*`, the trigger-evaluator, or the trigger UI.
>
> Source of truth for mechanics. The thesis lifecycle that triggers hang off of
> is in [`THESIS_ARCHITECTURE.md`](./THESIS_ARCHITECTURE.md); the user-facing
> narrative is `/agent-workflow` (`app/(root)/agent-workflow/content/triggers.md`).

---

## 1. What a trigger is

Each thesis carries a `triggers[]` JSONB array. A trigger is a tuple:

```ts
{ id, predicate, action, rationale, cooldownDays?, lastFiredAt?, fireMode? }
```

- **predicate** — the condition, in one shape (`lib/agent/triggers/condition/types.ts`):
  `{ watch, is?, value?, variable?, settings? }` for one condition, or
  `{ match: "all" | "any", conditions }` for two or more.
- **action** — what firing means: `ENTER | EXIT | REVIEW | ADD | TRIM | MOVE_STOP`.
- **rationale** — prose the agent reads when it acts.
- **cooldownDays** — don't re-fire within N days (see §6).
- **fireMode** — `TACTICAL` (default) or `DIRECT` (see §4).

The condition is the form's own fields: `watch` is the measure (the tab),
`is` the direction (the button group), `value` the number typed, `variable`
what it is measured from or what stands in for it (the `{x}` button), and
`settings` the measure's options. The pill, the popover, the dialog, the
agents' tools and the trigger check all read this one shape.

**One catalog entry per measure, no switches** (`lib/agent/triggers/condition/catalog.ts`
and `condition/measures/*`). Each entry carries everything about its measure:
its words, its number, its variables and settings, the actions it allows,
whether a sale on it may propose directly and with what close reason, its
default cooldown, what the check must load for it, whether it is a typed price
level, and how the check reads it (`condition/read.ts`). Adding a measure is one
entry; nothing else switches on it.

**Storage holds the same shape.** `lib/prisma.ts` turns every `triggers`
write on a thesis, an analyst or the account into it, and every read, so
the app only ever holds conditions. `prismaRaw` skips the conversion and is
for the backfill (`scripts/backfill-trigger-shape.ts`) and its down script
only. A condition an old trigger kind stored is translated by
`condition/legacy.ts`; the translator is the one place the old kinds are
named, and a removed kind (the old review-date trigger) is kept verbatim and
reads as "a removed condition".

Validation is one Zod gate (`triggers/schema.ts`) used by **every** writer — the
agent (`record_thesis`/`update_thesis`), the UI add/edit, and the reject dialog.
A condition is legal when it means something the check can read, with the same
ranges as before. An invalid trigger is dropped at evaluation, so the gate
rejects it up front. A model that still sends an old kind has it translated
and logged, never refused.

## 2. The measures

| Measure (`watch`) | Means | Number · variable · settings |
|---|---|---|
| `price` | The price against a typed level ("buy above $183"), or against a line from the chart: a moving average, the 20-day or 52-week high or low, a recent close, our entry, the high since we bought. `settings.close` = the day must **close** past it — the 5-minute passes skip it and the close pass (16:20–16:34 ET) reads the day's consolidated close. A typed level is the only **plan level** (buy, floor, target). Below or above a moving average is a state (§6). | `value` ($) **or** `variable`; `settings.close` |
| `move` | A % distance from something. From yesterday's close (`prev_close`): today's move off the quote. From the close 5 or 20 sessions back: off the snapshot. **From our entry** (`entry`): the cumulative % vs the open position's `avgCost` — not the day's move; LONG `(price−avg)/avg`, SHORT inverts. **From the high since we bought** (`peak`): the give-back off `Position.peakPrice` (high-water for LONG, low-water for SHORT, kept by the price monitor) — the trail. **Near** (`is: "near"`) an average or the 52-week high: within that %. Entry and peak are **HOLDING-only**: no open position in context ⇒ false. | `value` (%), `variable` required; entry: `fastWinnerPct` / `fastWinnerDays`; peak: `startOnceUpPct` / `widenAtr` |
| `volume` | Today's volume so far ÷ the 20-session average. No projection — true only once the volume is really there; read at the close it is the day's ratio. | `value` (×) |
| `rsi` | RSI over the snapshot's closes with the live price as today's. | `value`; `settings.period` 14 or 2 |
| `strength` | Return over the window minus the S&P's, percentage points, as of the last close. A state (§6). | `value`; `settings.window` 1M / 3M / 6M |
| `gap` | Opened ≥ `value`% over the prior close on ≥ `volume`× normal volume — today, or within `withinDays` sessions. | `value` (%); `volume`, `withinDays` |
| `report` | **Before** a report: "reports within N days" (the heads-up; 14-day lookahead). **After** one: "reported up to N days ago" (0 = the report day; `fromDay: 1` starts the day after) — the post-report drift window. Off the Finnhub calendar on the cron (`triggers/earnings.ts`), one firm-wide call per pass. Once per report (30-day cooldown); the audit row carries the date, bell and estimates. | `value` (days); `fromDay` |
| `surprise` | Earnings beat or miss — reported EPS vs estimate, same calendar call. Fires at the first open after the report, once per report (3-day lookback inside the 7-day cooldown). The audit row carries the figures. 0 = any amount. | `value` (% or more) |
| `filing` | The company filed something with the SEC. Keyed on the 8-K item or the form, never "a 10-Q was filed": `tier:MATERIAL` / `tier:RED` ("at least" — material matches serious too), `item:8.01`, `form:S-3`. Several events are "any of" one-event conditions. Read live off EDGAR — one search per pass for every name carrying a filing trigger, 4-day lookback. **One fire per filing** (the filing IDs are remembered on the trigger, or in `triggerState` for an inherited rule); no cooldown, because filings cluster. A serious filing on a HOLDING spawns a tactical run the same day; everything else goes to the next daily review. The tier table is `lib/market-data/sec-events.ts`. | `variable` |
| `insiders` | At least N distinct insiders bought on the open market (Form 4 code P; grants and exercises excluded) within 30 or 90 days. Read from the snapshot's `insiderBuys` (Finnhub, refreshed 06:30 ET). The fire's audit row names the buyers. Cooldown 30. | `value`; `settings.days` |
| `repeat` | The review clock: N days since the last actual review (`lastReviewedAt`), repeating. Cooldown is its own interval. | `value` (days) |
| `from_date` | N days after the buy (false until held — the playbook's time limits: "sell 20 days after the buy if still held"), or N days before or after the thesis's own `catalystDate` (the FDA decision, the deal close) — read off the thesis, never typed into the trigger. Cooldown defaults to N, so a review re-asks every N days once reached; an EXIT is the usual standing order. | `value` (days), `variable` buy / event |

**A big winner is not trimmed.** A sale or trim on the move from our entry
takes optional `fastWinnerPct` + `fastWinnerDays`: once the position's tracked
peak has run that far off the buy, *that fast*, the rung is off for good. The
playbook's rule is "+20% in ≤ 3 weeks — then hold", and both halves matter: the
size alone would switch the partial off for a six-month grind to the same gain,
which is an ordinary winner and exactly what the partial is for. A fill writes
both onto the partial sale for a trade or a target position, at 20% and 21
days. It reads `Position.peakPrice` and `Position.peakAt` — the same water mark
the trail reads, plus the clock the price monitor writes beside it — so the rule
needs no memory of its own. A missing `peakAt` means the run can't be shown to
be fast, so the partial stands. SMMT ran 30.5% in 13 days and loses its
partial; MU took 54 days to reach 15.5% and keeps it.

**A trail that widens with the stock.** The trail takes an optional
`widenAtr`: the give-back is the larger of its % and `widenAtr` × the stock's
ATR(14) from the daily snapshot (playbook E5). It only ever widens — a missing
snapshot falls back to the written percent. The line is computed in ONE
function, `lib/agent/triggers/trail.ts` → `trailFireLevel`, and every surface
that draws it passes the same ATR: the evaluator, the floor-health block the
agents read, and the thesis sheet's and trade page's levels. MU (ATR $50 on a
$1,035 peak) trails 14.5%; ABT (ATR $2.58) keeps its written 25%.
`startOnceUpPct`: the trail has no level until the position has once been up
that much from entry, so an unarmed trail is never drawn.

**A day count is always calendar days — the catalog is not.** A setup's short
time limits are written in sessions ("no progress in 10–20 sessions is a failed
breakout"); its 60-day checkpoints are calendar days. The conversion happens in
ONE place, `setupExitTriggers` in `lib/agent/triggers/setup-exits.ts`, at the
moment a fill writes the trigger, and it walks the real NYSE calendar via
`sessionsToCalendarDays` rather than multiplying by 7/5 — which is wrong by a
day around every holiday. The trigger's sentence names both units. ABT's 10
sessions from its 2026-09-11 buy is 14 calendar days; written straight through
it was 10, and the review asked "has it reclaimed the prior high?" on session five.

**Two conditions.** The dialog takes a second condition and posts
`{ match: "all", conditions: [a, b] }` — "earnings beat and down 3% on the day
→ review", the way the playbook writes it. A schedule can't be one of the two
(it is a clock, not a condition). The popover edits either condition's number:
the edit carries `part`, the condition's place, through `ops.ts` on a stock and
the level actions on an account or analyst rule. Agents write `all` / `any` of
any shape.

**How a trigger reads.** Everywhere — the pill, Activity, the agents' prompts,
the tactical kickoff — a trigger is one sentence from `condition/describe.ts`:
"Sell if below $150", "Review every 30 days", "Buy if within 2% of the 20-day
average", "Take the plan down if below $132" (a sale on a stock we don't own
sets the plan down). There is no second vocabulary.

**The chart measures read the daily indicator snapshot** (DAV-247):
`lib/inngest/functions/indicator-snapshot.ts` runs at 06:30 ET, computes the
chart for every ticker on the book with `lib/market-data/price-structure.ts`
(a year of SIP daily bars) and stores numbers — moving averages, 20-day /
52-week highs, the 20-day volume average, the last 60 closes, strength vs the
S&P, the last 10 sessions' gaps — in `TickerIndicators`. A condition says what
it needs (`reads` on its measure, `snapshot` on a variable or setting), and the
check loads only that. The evaluator reads the newest row next to the live
quote; a snapshot older than 5 days is ignored (logged). No snapshot ⇒ those
conditions read false. Volume and gap also read today's consolidated volume
(one batched Alpaca call, to the minute). The live quote itself is Alpaca's too —
the whole book in one call, Finnhub `/quote` behind it (`lib/market-data/live-quote.ts`).

**Deleted 2026-09-11 (DAV-247):** the signal-type, guidance-change and old
filing kinds. They needed the signal router, which has been off since
2026-05-31, and could never fire. A migration stripped them from every stored
ladder (207 rungs removed, 1 rewritten, 119 theses).

The move from our entry and the trail **are the gain-protection system**
(#477). The analysts' sell rules in §2a are built on them — the checkpoint /
loser rules are moves from entry, the trails are moves from the high. Both
complement the move from yesterday's close, which only ever sees the
single-day move: the move from entry catches the quiet cumulative
winner/bleeder, and the trail banks a run-up mechanically (the IONS failure —
see §2a and `docs/plans/THESIS_GAME_PLAN.md`).

## 2a. Standing sell rules live on each analyst

A holding inherits sell rules from its **analyst** (the analyst's Triggers
tab) and the **account** (Settings → Triggers), through the ordinary cascade:
thesis beats analyst beats account. A held thesis carries only what is its
own — the floor, the target, the catalyst exit, the review clock, the earnings
reviews. The buy fill does not stamp sell rules or scale-ins onto the thesis:
a thesis rung beats every rule above it, so a stamped copy froze one 8% sell
onto every holding (ASML/CEG/WST carried an automatic 8% sale their
compounder mandate forbids) and made the rules above powerless.

The motivating failure for sell rules at all is still IONS: bought $73.83,
day-one floor at $65, ran +17%, three rubber-stamp reviews, then crashed and
fired the day-one floor for a LOSS.

As stored on 2026-09-27, read from the rows of the account that trades
(`Account.triggers` and `AgentConfig.triggers`, filtered to the account the
enabled analysts belong to — the database holds a second, empty account whose
rows are not these):

| Level | Rule | Does |
|---|---|---|
| Account | up 7% in a day | ADD |
| Account | every 7 days | REVIEW |
| Account | reports earnings within 3 days | REVIEW |
| Account | earnings beat · earnings miss | REVIEW |
| Account | a material filing | REVIEW |
| PEAD Specialist | 12% off the high, **once up 10%** | EXIT |
| PEAD Specialist | up 10% from entry · down 12% from entry | REVIEW |
| Catalyst Event PM | 10 days before the event date | REVIEW |
| Catalyst Event PM | 30 days after the event date | REVIEW |
| Catalyst Event PM | an 8-K under item 8.01 or 7.01 | REVIEW |
| Secular Compounder | **25% off the high** | EXIT — the only automatic sale |
| Secular Compounder | 15% off the high | REVIEW |
| Secular Compounder | below the 200-day | REVIEW — once a week while it holds (§6) |
| Secular Compounder | up 15% from entry · down 15% from entry | REVIEW |
| Secular Compounder | down 7% in a day | ADD |

Three things the table used to say that the rows do not:

- The account has no "down 7% in a day → add". It moved to the Secular
  Compounder on 2026-09-18; trades never average down.
- The account has no trailing sale. Every automatic sale belongs to an analyst.
- The Catalyst Event PM has no "down 10% → review". Its reviews are tied to the
  event date; the thesis carries the stop.

The table is a snapshot. The Triggers tabs are the source: Settings → Triggers
for the account, each analyst's Triggers tab for the rest.

**Target is a REVIEW checkpoint, not an auto-exit — except on the TRADE
horizon.** For TARGET/COMPOUNDER/CATALYST holds, "above the target" is a
REVIEW rung ("target hit — close, or trail higher with confidence intact"), so
a winner isn't blindly dumped at the first number. Only the TRADE horizon maps
it to a terminal EXIT (the trade plan is executed; close). The hard stop
("sell if below the stop", cooldown 0) is universal across horizons.

> **History — the trail came back, on purpose.** An earlier trailing-stop
> kind was **removed in #458**, which traded peak-trailing for the daily-%
> move. The trail (#477) is **not a revert of that decision** — it deliberately
> reinstates *cumulative* give-back protection **alongside** the daily-%
> condition, not instead of it. The daily-%
> rung catches a violent single session; the trail catches a slow round-trip off
> the peak (the IONS case). Both live on the ladder now; they cover different
> failure shapes.

## 3. The firing matrix — WHICH condition fires on WHICH path

There are two evaluation paths, sharing the pure `shouldFire` in
`triggers/evaluate.ts` (which reads each measure through `condition/read.ts`):

| Condition | Cron (5-min, market hours) | Daily-run inline |
|---|:--:|:--:|
| `price` at a typed level | ✅ | ✅ |
| **`move` from yesterday's close** (the % alerts) | ✅ **fires** | ⚠️ only if a daily change is supplied |
| `move` from the close 5 / 20 sessions back | ✅ (snapshot) | ✅ (snapshot) |
| **`move` from our entry** (HOLDING-only) | ✅ **fires** | ✅ |
| **`move` from the high since we bought — the trail** (HOLDING-only) | ✅ **fires** | ✅ |
| `price` vs an average or a high · `move` near one · `strength` · `rsi` · `insiders` | ✅ (snapshot) | ✅ (snapshot) |
| `volume` · `gap` | ✅ (snapshot + today's volume) | ❌ (no volume on that path) |
| `price` with `settings.close` — and any floor on a stock we don't hold | ✅ **close pass only** (16:20–16:34 ET) | ✅ (read as a plain level) |
| **`report` · `surprise`** | ✅ **fires** (calendar) | — |
| **`filing`** | ✅ **fires** (EDGAR) | — |
| `repeat` · `from_date` | ✅ | ✅ |

**The daily-move nuance (read this):** a move from yesterday's close fires on
the cron because the evaluator reads the quote's own daily % change
(`latestQuote.changePct` — the price against the prior session's close;
`trigger-evaluator.ts`). It does **not** need candles. The moves from 5 or 20
sessions back read the snapshot's closes.

**The gain-protection nuance (read this):** the move from our entry and the
trail fire on the 5-min cron because the cron supplies the open position's
economics (`avgCost` for the move from entry, `peakPrice` for the trail — both
maintained per HOLDING) alongside the latest quote; no candles needed. Both are
**HOLDING-only**: with no open position in context (WATCHING theses, or a
caller that didn't join the position) they evaluate false rather than throw.
`peakPrice` is the price-monitor-maintained water mark — the trail floor
ratchets up with the high automatically, so a give-back fires the EXIT with no
memory required of any prior review.

**One trigger the check can't read never stops the pass.** The check runs each
trigger inside its own catch: an error is logged loudly with the trigger's id,
the stock and the thesis (`CHECK FAILED on …`), that trigger is skipped this
pass, and every other trigger on that stock and the rest of the book is still
checked.

## 4. Fire modes — TACTICAL vs DIRECT

Set per-trigger (`fireMode`, default `TACTICAL`):

- **`TACTICAL`** ("Trigger Tactical Run") — fires `app/thesis.trigger.fired` →
  a focused GPT-5.5 **tactical run** validates and decides.
- **`DIRECT`** ("Automatically Exit") — **EXIT action only**, on a deterministic
  predicate. The tactical-run consumer **short-circuits past the agent** and
  calls `closeOpenPosition` directly. Saves the GPT cost on mechanical exits.
  Which conditions may propose directly is on the catalog (`direct` on the
  measure and its variables; `isDirectEligible` in `condition/rules.ts`): a
  typed price level, and a move from a recent close, from our entry or from the
  high since we bought — i.e. the gain-lock and the trail alongside the
  absolute price and daily-% levels. Everything judgment-bearing (earnings,
  filings, RSI, time, two conditions) refuses DIRECT and falls back to
  TACTICAL. A protective EXIT closes with a deterministic STOP/TARGET reason
  (`closeReason` on the measure; `protectiveCloseReason`) — trail and
  gain-lock give-backs tag STOP — so the P1-28 unapproved-exit cooldown exempts
  them and a rejected protective exit re-fires when price re-crosses (#490).

**A sale from a protective fire always carries the STOP/TARGET label** (DAV-192).
The close tool — `close_position`, the only whole-position exit since DAV-220 — runs the
model's chosen `reason` through `enforceCloseReason`
(`lib/agent/triggers/enforce-close-reason.ts`). When the run was woken by a
protective/price EXIT trigger, the stored `Position.closeReason` /
`Order.closeReason` is that trigger's STOP/TARGET tag, whatever the model
called it. The sale is **auto-corrected, never refused** — a mismatch writes a
plain-English note onto the close's rationale (so it shows on the approval card
and in the run feed) naming what the agent originally declared. This matters
because the label is what several rules read: the held-through-floor context in
`get_theses` counts only `closeReason=STOP` declines, and `shouldRecycleToWatching`
reads it to decide whether a sold name stays on the re-entry radar. In July,
protective closes tagged `MANUAL` went invisible to both.

`THESIS_INVALIDATED` stays honest on its own axis rather than competing for the
label: the stored reason becomes STOP/TARGET, and the invalidation is preserved
in the audit note **and** by forcing `belief_survived = false` — keyed off what
the agent *declared*, so a corrected label can never route a structurally-broken
name back to the watchlist.

**Both modes still go through the approval gate.** `closeOpenPosition` (and the
agent's `close_position`/`place_trade`) call `maybeAwaitApproval` **before** any
Alpaca submit. With require-approval-sells ON, a DIRECT exit **proposes** the
close (you approve/reject) — it does **not** auto-sell. DIRECT saves the *agent*
cost, never the *approval* step. True auto-sell requires approvals OFF (a
separate account setting).

## 5. From fire to trade (the pipeline)

```
predicate matches
  → stamp lastFiredAt + write ThesisUpdate(TRIGGER_FIRED)
  → REVIEW (non-BREAKING)? defer to the next daily run (no tactical spawn)
  → else emit app/thesis.trigger.fired
      → tactical-run consumer
          → DIRECT EXIT?  closeOpenPosition  ─┐
          → else          GPT-5.5 agent ──────┤→ maybeAwaitApproval
                                               └→ approvals on → PROPOSAL
                                                  approvals off → execute
```

**Two fire semantics, keyed off the action (DAV-229, 2026-09-02).** A
protective or review rung is a **standing order** (principal ruling
2026-08-16): it fires every day its condition is true, and a declined or
expired proposal means "did nothing today", so it asks again tomorrow. An
**`ENTER` rung fires on the crossing**: the condition is true now and was
false at the prior session's close (`latestQuote.prevClose`).
"Buy above $35" means buy when the price gets there — not "buy now and ask
every day it is higher", which is what the standing-order reading made of a
level the price was already past (TOST $35.15 against a $35.16 tape; PLTR,
16 buy fires in 30 days). The same predicate evaluated at the prior close
decides the crossing, so two conditions and "above the 50-day" get it for free; entries
that don't read the price (time, daily move) can't cross and keep firing on
match. **A buy written after the prior close is measured from the price it
was written at** (`writtenPrice`/`writtenAt`, server-stamped by
`applyTriggerOps` and `record_thesis`; `lib/agent/triggers/written-price.ts`)
until the next close: otherwise "buy above $100.05" set at $100 on a day the
stock closed $103 yesterday is already true at that close and never fires that
day. There is no buy-now option — buying now is an entry price at or near the
current price, and this is what makes that work on a down day. A plan the price has left behind is `planSanity`'s job to surface to
the daily run, not the cron's job to propose. Read-side snapshots (the daily
run's `TRIGGER_MATCHING_NOW`, the resolver's `ENTER_FIRED`) carry no prior
close and keep level semantics — "is the condition true now" is the right
question for a snapshot.

**REVIEW-batching:** a `REVIEW` fire means "re-evaluate," not "act now" — it
converts to a trade rarely, so (except BREAKING-urgency signals) it writes the
`TRIGGER_FIRED` audit row and defers to the next daily run instead of spawning a
tactical run. `ENTER`/`EXIT` always spawn (or DIRECT-close).

## 6. Cooldown

`cooldownDays` rate-limits re-fires. Omit it → the measure's default
(`cooldownDays` on its catalog entry; `defaultCooldownDays` in
`condition/rules.ts`): a surprise 7, a report 30, insiders 30, a price level,
a move, volume and RSI 1, a gap its `withinDays`, the move from our entry 7 —
the milestone latches, so 7d stops a same-week re-fire if the acting agent
forgets to re-arm the next checkpoint; the trail 1, the review clock and a
date its own day count. **`cooldownDays: 0` is reserved for terminal `EXIT`
triggers only** — `0` on any other action causes a 5-min evaluator infinite
loop the instant the condition latches true, so the write path overwrites it
with the default (`applyTriggerCooldownDefaults`). The
standing trail ratchet is stamped `cooldownDays: 0` at mint (terminal EXIT, same
as the hard stop).

**A review on a state asks once a week, whatever is stored.** "Below the
200-day", "within X% of the 52-week high" and "beating SPY" describe where a
stock IS, for weeks at a time, not something that happens. A REVIEW on one of
them (or on two conditions made only of them) has a floor of 7 days
(`effectiveCooldownDays`; which conditions are states is `state` on the
catalog entry, the floor itself is `triggers/state-cooldown.ts`, and
the Triggers tab prints the number in force). ABT sat under its 200-day from
2026-09-15 to 09-25 and the Secular Compounder's review, stored at 1 day, fired
all nine trading days. Only a review slows down: a buy on the same condition
fires on its crossing, and a sale is a standing order that asks every day its
condition holds.

## 7. Cadence + market hours

The trigger-evaluator cron is scheduled **every 5 minutes, `9-16` ET, Mon–Fri**,
but the price path only **evaluates during the regular session**:

- **Market-hours gate:** the cron's first tick is 9:00 ET (30 min before the
  open), the last spans past 16:00, and the `Mon–Fri` schedule doesn't skip
  holidays — all of which would evaluate price predicates against thin/erratic
  pre/after-market quotes (a daily-% trigger firing on a pre-market print). So
  the cron path gates on `isMarketOpen()` (regular session 9:30–16:00 ET,
  holiday-aware — the same guard `price-monitor` uses) and no-ops outside it.
- **The close pass:** the ticks from 16:20 to 16:34 ET on a trading day are
  not skipped: they evaluate only rungs with a price level read on the close (`settings.close`),
  with today's consolidated close (Alpaca SIP daily bar) as the price. A name
  with no bar for today is skipped rather than evaluated on a guess. Cooldown
  makes the three ticks fire a rung at most once.
- **A watched stock's floor reads the close** (DAV-337). On a stock we don't
  hold, a sell trigger sets the plan down, and it does so only on a close
  below the floor — never an intraday touch (TRV 2026-09-29: opened under
  its floor, back above it that morning). `watchedFloorOnClose` in
  `lib/agent/triggers/types.ts` reads such a trigger's level on the close where
  triggers are read (the five-minute check, the morning run's snapshot, the
  thesis sheet); nothing is stored. A held stock's floor is a sale and
  keeps its own timing.
- **Cap:** 200 unique tickers per tick.

## 8. Editing surfaces

Once a thesis exists, its triggers change **one at a time**, through one
function — `applyTriggerOps` in `lib/agent/triggers/ops.ts` (DAV-242):

- **UI** — `lib/actions/thesis-edit.ts` + `/api/theses/[id]/triggers`:
  `applyTriggerAdd`, `applyTriggerValueEdit`, `applyTriggerFireModeChange`,
  `applyTriggerDelete` — each is one op. The reject dialog embeds the same
  editor (`editableOnly`: price/% triggers only).
- **Agent** — `update_thesis(add_triggers | edit_triggers | remove_trigger_ids)`;
  `entry_price` / `target_price` / `stop_loss` are the same op on the buy /
  target / floor trigger. `record_thesis` still takes a whole `triggers` list —
  a mint is a new list by definition — merged with the horizon defaults.
- **A buy fill** removes the buy trigger, sets the floor and target to the
  executed levels, and adds the held-side template triggers that are missing
  (`armHeldLadderOnFill`). Never a rewrite: the analyst's target and reviews
  survive the fill.
- **A plan set-down** (DEMOTE) removes the buy, floor and target triggers.
  An automatic one comes from the floor on the close pass (§7).

Rules run per op on the resulting list; a refused op is returned by id with
the reason and the rest of the call lands (`data.trigger_ops` on the tool):

- One trigger per bucket, one per plan slot: adding a second buy trigger,
  target, floor or review cadence **edits the one that is there**.
- An edited trigger keeps its id, so `lastFiredAt` and the cooldown carry.
- An edit names the trigger's `value` in its own unit (a price, a %, a count
  of days) and, if it changes, its `variable`. An agent's value edit needs a
  `rationale` — the sentence moves with the number (the principal's edits get
  the number substituted). A model that still sends the old `level` / `pct` /
  `days` has it read as the value, and the edit is refused when the trigger
  holds a different kind of number, as before.
- On a held stock an agent may only tighten a protective sell level (§ the
  ratchet, DAV-185); the principal is exempt.
- After all ops, ONE check on the derived plan: ordering everywhere, a buy
  trigger where a floor or target is armed, and — for an agent only — 2:1 on
  a plan we don't own. The principal is exempt from the ratio as from the
  ratchet; a stop above the buy price is refused for anyone.

The plan columns (`entryPrice` / `targetPrice` / `stopLoss`) are recomputed from
the resulting triggers and mirrored onto the open `Position`, so the chart,
run-summary, and evaluator never drift. The Activity feed shows the ops the
caller sent — "Entry $183 → $190", "Removed: Sell if below $110" — stored verbatim
on the row's `fieldChanges.triggerOps`.

## Key files

- `lib/agent/triggers/condition/` — the condition shape (`types.ts`), one catalog entry per measure (`catalog.ts`, `measures/*`), the variables (`variables.ts`), the rules that read the catalog (`rules.ts`), the check (`read.ts`), the words (`describe.ts`), the save check (`check.ts`), what a fire names (`facts.ts`, server-only), storage (`stored.ts`) and the translator from the old kinds (`legacy.ts`, `legacy-types.ts`, `legacy-schema.ts`) — the only place they are named
- `lib/prisma.ts` — every `triggers` write and read is turned into the shape; `prismaRaw` skips it (backfill and down script only)
- `lib/agent/triggers/ops.ts` — the per-trigger write path (`applyTriggerOps` + `checkLadder`) every editor goes through once a thesis exists (§8)
- `lib/agent/triggers/types.ts` — the `Trigger` type and `watchedFloorOnClose`
- `lib/agent/triggers/enforce-close-reason.ts` — the sale-label rule: a close from a protective fire stores STOP/TARGET, auto-corrected with an audit note (DAV-192)
- `lib/agent/triggers/schema.ts` — the one Zod gate, and the condition a model writes (the measures listed from the catalog)
- `lib/agent/triggers/evaluate.ts` — `shouldFire`: crossing, stale quote, cooldown, re-arm
- `lib/agent/triggers/defaults.ts` — horizon templates + `accountStandingRules()` (the account's add prompts) + cooldown defaults
- `lib/inngest/functions/trigger-evaluator.ts` — the cron and close passes, one catch per trigger
- `lib/inngest/functions/tactical-run.ts` — consumer (TACTICAL agent / DIRECT close)
- `lib/actions/thesis-edit.ts` — add / edit / delete / fire-mode write paths
- `components/agent/sheets/ThesisTriggersSection.tsx` — the trigger UI
