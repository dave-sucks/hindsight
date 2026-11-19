# Hindsight — Triggers

> **The reference for the trigger system.** What a trigger is, which conditions
> fire on which path, the fire modes, and how a fire flows to a trade. Read this
> before touching `lib/agent/triggers/*`, the trigger-evaluator, or the trigger UI.
>
> Source of truth for mechanics. The thesis lifecycle that triggers hang off of
> is in [`THESIS_ARCHITECTURE.md`](./THESIS_ARCHITECTURE.md); the user-facing
> narrative is the guide's [Triggers](guide/concepts/triggers.md) doc (`/docs/triggers`).

---

## 1. What a trigger is

Each thesis carries a `triggers[]` JSONB array. A trigger is a tuple:

```ts
{ id, predicate, action, rationale, lastFiredAt?, falseAtCloseAt?, fireMode, trimPct? }
```

- **predicate** — the condition, in one shape (`lib/agent/triggers/condition/types.ts`):
  `{ watch, is?, value?, variable?, settings? }` for one condition, or
  `{ match: "all", conditions }` for two or more that must all hold (one level,
  no group inside a group). "Either one" is two triggers.
- **action** — what firing means: `ENTER | EXIT | REVIEW | ADD | TRIM | STOP_WATCHING`.
  A sale (`EXIT`, "Sell if") is only on a stock we hold; `STOP_WATCHING`
  ("Stop watching if") only on one we don't, and on the stock itself, never
  an account or analyst rule. The other is refused with the fix, never
  converted (`actionProblem` in `condition/actions.ts`); a ladder reads a sale
  only on a holding and a Stop watching line only on a watch (`resolveLadder`).
  A trigger on our position (a move from our buy price or the high since we
  bought, or a date count from the buy: `readsThePosition` in
  `condition/rules.ts`) is refused at the save on a stock we don't hold, with
  `POSITION_ON_A_WATCH`: it comes with the buy, or at the fill. A stored one is
  left as it is. An analyst or account rule on our position doesn't apply to a
  stock we don't own: `resolveLadder` leaves it off a watch's list, as it does
  a sale, an add and a trim.
  An action means the same thing whatever the stock's state.
- **rationale** — prose the agent reads when it acts.
- **lastFiredAt / falseAtCloseAt** — its fire state, written by the trigger check: when it last fired, and when a market close last found it false after that (see §6). There are no waits.
- **fireMode** — on fire: `DO_IT` (Auto), `ASK_NOW` (Send to Agent) or
  `NEXT_MORNING` (Flag for Review) (see §4). Every stored trigger names one.
- **trimPct** — a trim's size: the % of the position it sells, in every mode (50 when unset). The sentence says it ("Trim 30% if above $150"); Auto sells it, and a trigger run woken by the trim passes it to `manage_position` as the default `close_pct` (`ToolContext.firedTrim`).

The condition is the form's own fields: `watch` is the measure (the tab),
`is` the direction (the button group), `value` the number typed, `variable`
what it is measured from or what stands in for it (the `{x}` button), and
`settings` the measure's options. The pill, the popover, the dialog, the
agents' tools and the trigger check all read this one shape.

The agents spell it the way the form's input works. A price's one input is
`value`: a dollar number or a line (`sma50`, `low20`). A filing's `value` is
which filing. `variable` is only what a % move or a day count is measured
from. So a model can't send a price and a line together. A field the measure
doesn't take is dropped, the same as a setting it doesn't take, and the schema
maps the result onto the stored shape. The condition is defined once per tool.

**One catalog entry per measure, no switches** (`lib/agent/triggers/condition/catalog.ts`
and `condition/measures/*`). Each entry carries everything about its measure:
its words, its number, its variables and settings, the actions it allows,
the label a protective sale on it closes with,
what the check must load for it, whether it is a typed price
level, and how the check reads it (`condition/read.ts`). Adding a measure is one
entry; nothing else switches on it.

**Storage holds the same shape.** Every writer writes it; the rows written
before the cutover were rewritten by its backfill. Anything else stored in a
trigger list (one condition type removed in August, kept on retired theses)
reads as "a removed condition" and is never checked.

Validation is one Zod gate (`triggers/schema.ts`) used by **every** writer — the
agent (`record_thesis`/`update_thesis`), the UI add/edit, and the reject dialog.
A condition is legal when its measure says so: `fits` (a button it has, a
variable it reads with that button, a number where it needs one) and `valid`
(every number in range) on the catalog entry, read for a whole trigger by
`whenValid` (`condition/valid.ts`). An invalid trigger is dropped at
evaluation, so the gate rejects it up front, with the list of measures.

## 2. The measures

| Measure (`watch`) | Means | Number · variable · settings |
|---|---|---|
| `price` | The price against a typed level ("buy above $183"), or against a line from the chart: a moving average, the 20-day or 52-week high or low, a recent close, our entry, the high since we bought, or (from below only, since 2026-11-04) Wall Street's average, high or low 12-month target off the newest `StreetConsensus` row within 14 days — never a floor against the Street, and no row reads false. `settings.close` = the day must **close** past it (a typed price or an average: "Stop watching if below the 200-day average · only on the close") — the 5-minute passes skip it and the close pass (16:20–16:34 ET) reads the day's consolidated close. A typed level is the only **plan level** (buy, floor, target). Below or above a moving average is a state (§6). | `value` ($) **or** `variable`; `settings.close` |
| `move` | A % distance from something. From yesterday's close (`prev_close`): today's move off the quote. From the close 5 or 20 sessions back: off the snapshot. **From our entry** (`entry`): the cumulative % vs the open position's `avgCost` — not the day's move; LONG `(price−avg)/avg`, SHORT inverts. **From the high since we bought** (`peak`): the give-back off `Position.peakPrice` (high-water for LONG, low-water for SHORT, kept by the five-minute check from the live price and, for a position held since before the open, the session's high) — the trail. **Near** (`is: "near"`) an average or the 52-week high: within that %. Entry and peak are **HOLDING-only**: no open position in context ⇒ false. | `value` (%), `variable` required |
| `volume` | Today's volume so far ÷ the 20-session average. No projection — true only once the volume is really there; read at the close it is the day's ratio. | `value` (×) |
| `rsi` | RSI over the snapshot's closes with the live price as today's. | `value`; `settings.period` 14 or 2 |
| `strength` | Return over the window minus the S&P's, percentage points, as of the last close. A state (§6). | `value`; `settings.window` 1M / 3M / 6M |
| `gap` | Opened ≥ `value`% over the prior close, whatever the volume — today, or the snapshot's latest session. Fires once per gap. | `value` (%) |
| `report` | **Before** a report: "reports within N days" (the heads-up; 14-day lookahead). **After** one: "reported up to N days ago", counting from the report day (0) — the post-report drift window. Off the Finnhub calendar on the cron (`triggers/earnings.ts`), one firm-wide call per pass. A heads-up fires once per report (the report dates it fired for are remembered); the audit row carries the date, bell and estimates. | `value` (days) |
| `surprise` | Earnings beat or miss — reported EPS vs estimate, same calendar call. Fires at the first open after the report, once per report (3-day lookback). The audit row carries the figures. 0 = any amount. | `value` (% or more) |
| `filing` | The company filed something with the SEC. Keyed on the 8-K item or the form, never "a 10-Q was filed": `tier:MATERIAL` / `tier:RED` ("at least" — material matches serious too), `item:8.01`, `form:S-3`. Several events are several triggers, one each. Read live off EDGAR — one search per pass for every name carrying a filing trigger, 4-day lookback. **One fire per filing** (the filing IDs are remembered on the trigger, or in `triggerState` for an inherited rule); whatever its fired state, because filings cluster. A serious filing on a HOLDING spawns a tactical run the same day; everything else goes to the next daily review. The tier table is `lib/market-data/sec-events.ts`. | `variable` |
| `insiders` | At least N distinct insiders bought on the open market (Form 4 code P; grants and exercises excluded) within 30 or 90 days. Read from the snapshot's `insiderBuys` (Finnhub, refreshed 06:30 ET). The fire's audit row names the buyers. | `value`; `settings.days` |
| `repeat` | The review clock: N days since the last actual review (`lastReviewedAt`), repeating: it fires when due, and the review it asks for starts the next period (that day's close finds it false). | `value` (days) |
| `from_date` | N days after the buy (false until held — the playbook's time limits: "sell 20 days after the buy if still held"), or N days before or after the thesis's own `catalystDate` (the FDA decision, the deal close) — read off the thesis, never typed into the trigger. After the buy, or after the event, it stays true, so it fires once; before the event it is a window, and a close past the event makes it ready for the next one. Inside an "and", a count before the event is a window on the other condition (`window` on the entry): it may join one, reads "within N days before the event date", and lets the trigger buy ("Buy if within 2% of the 50-day average and within 70 days before the event date", the pre-catalyst buys). Alone it can't buy. | `value` (days), `variable` buy / event |

**A trail is one number.** Its line is the give-back % off the tracked high,
computed in ONE function, `lib/agent/triggers/trail.ts` → `trailFireLevel`,
which the evaluator, the floor-health block and the sheet's and trade page's
levels all call. The arming gain (`startOnceUpPct`), the range widening
(`widenAtr`), the big-winner switch on the move from our entry
(`fastWinnerPct` / `fastWinnerDays`), a gap's volume and look-back (`volume`,
`withinDays`) and "after earnings" starting later (`fromDay`) were deleted
2026-10: every setting a
trigger carries is a visible field in the trigger form, or it doesn't exist.
A stored trigger still carrying one of those keys reads without it
(`declaredOnly` in `condition/catalog.ts`).

**A day count is always calendar days.** A playbook's short time limits are
said in sessions ("no progress in 10–20 sessions is a failed breakout"); its
fill template stores them as calendar days, written as listed (5 sessions = 7
days, 10 = 14, 20 = 28; `lib/agent/knowledge/playbook-templates.ts`), so what
fires is what Settings → Playbook shows. Nothing converts a count at the fill.

**Two conditions.** The dialog takes a second condition and posts
`{ match: "all", conditions: [a, b] }` — "earnings beat and down 3% on the day
→ review", the way the playbook writes it. A schedule can't be one of the two
(it is a clock, not a condition). The popover edits either condition's number:
the edit carries `part`, the condition's place, through `ops.ts` on a stock and
the level actions on an account or analyst rule. Agents write `all` of up to
eight conditions, one level deep. There is no "or": either of two conditions
is two triggers (the 2026-11-21 migration split the three stored "or" triggers:
ACN's buy into three buys, the Catalyst Event PM's filing review into two, and
a retired BMRN review).

**How a trigger reads.** Everywhere — the pill, Activity, the agents' prompts,
the tactical kickoff — a trigger is one sentence from `condition/describe.ts`:
"Sell if below $150", "Review every 30 days", "Buy if within 2% of the 20-day
average", "Stop watching if below $132 · only on the close". The words come
from the action alone, never from whether we own the stock. There is no
second vocabulary.

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
| Account | 6% off the high since we bought | EXIT — asks the analyst |
| Account | up 7% in a day | ADD |
| Account | every 7 days | REVIEW |
| Account | reports earnings within 3 days | REVIEW |
| Account | within 1 day after earnings | REVIEW — asks the analyst; a stock's own after-earnings review replaces it |
| Account | a material filing | REVIEW |
| PEAD Specialist | up 10% from entry · down 12% from entry | REVIEW |
| Catalyst Event PM | 10 days before the event date | REVIEW |
| Catalyst Event PM | 30 days after the event date | REVIEW |
| Catalyst Event PM | an 8-K under item 8.01 | REVIEW |
| Catalyst Event PM | an 8-K under item 7.01 | REVIEW |
| Secular Compounder | 15% off the high | REVIEW |
| Secular Compounder | below the 200-day | REVIEW — once, again after a close back above (§6) |
| Secular Compounder | up 15% from entry · down 15% from entry | REVIEW |

Two things the table used to say that the rows do not:

- Nothing adds on a down day. The Secular Compounder's "down 7% in a day →
  add" and the analysts' own sales (PEAD's 12% and the Compounder's 25% off
  the high) were removed from the starter rules on 2026-10-27; the account's
  6% off the high governs every holding.
- The Catalyst Event PM has no "down 10% → review". Its reviews are tied to the
  event date; the thesis carries the stop.

The table is a snapshot. The Triggers tabs are the source: Settings → Triggers
for the account, each analyst's Triggers tab for the rest.

**Target is a REVIEW checkpoint, not an auto-exit — except on the TRADE
horizon.** For TARGET/COMPOUNDER/CATALYST holds, "above the target" is a
REVIEW rung ("target hit — close, or trail higher with confidence intact"), so
a winner isn't blindly dumped at the first number. Only the TRADE horizon maps
it to a terminal EXIT (the trade plan is executed; close). The hard stop
("sell if below the stop", asks once a day) is universal across horizons.

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
`peakPrice` is the water mark each intraday pass raises before it checks
anything (`lib/trading/water-mark.ts`): from the live price, and for a position
held since before today's open from the session's high off the same Alpaca
snapshot (regular hours only), so a spike between two passes counts. Only a
fresh quote moves it. The trail floor ratchets up with the high automatically,
so a give-back fires the EXIT with no memory required of any prior review.

**One trigger the check can't read never stops the pass.** The check runs each
trigger inside its own catch: an error is logged loudly with the trigger's id,
the stock and the thesis (`CHECK FAILED on …`), that trigger is skipped this
pass, and every other trigger on that stock and the rest of the book is still
checked.

## 4. On fire — three choices, two on a sale or trim

One field, `fireMode`, the same for every action, condition and author
(`lib/agent/triggers/fire-mode.ts`). The stored values are never shown; the
names are:

| `fireMode` | The name | On fire |
|---|---|---|
| **`DO_IT`** | Auto-sell / Auto-buy / Auto-add / Auto-trim | The trade, with no agent deciding; the same trigger run then writes it up with no trade tools, and its note becomes the trade's reason (`lib/proposals/auto-writeup.ts`). A sale closes the position (`closeOpenPosition`); a trim sells its `trimPct` (default 50) through `manage_position`; a buy goes through `place_trade` on a watched stock, an add through `manage_position` on a held one. Not offered on a review. |
| **`ASK_NOW`** | Send to Agent | `app/thesis.trigger.fired` → a trigger run (the tactical run) starts now and decides. |
| **`NEXT_MORNING`** | Flag for Review | The `TRIGGER_FIRED` row is written and no run starts; the next morning run answers it. Not offered on a sale or a trim: a sale that waits until tomorrow morning isn't a stop. |

**One default.** Unset (a template, an agent that names none), a review is
Flag for Review and everything else is Send to Agent. Auto is only ever chosen:
the seat rules' trails for a new analyst and the stop set when buying are Auto
on purpose. The write paths stamp the mode (`applyTriggerDefaults`), so every
stored trigger names one; the migration `20261022130000_on_fire_every_trigger`
wrote each existing trigger with the mode it already behaved as. A value a read
doesn't know is read as the default (Send to Agent for a sale).

**Never Flag for Review on a sale or a trim** (`fireModeProblem`, run by every
write path, for every author): "A sale can't wait for the morning. Choose
Auto-sell or Send to Agent." (a trim: "Choose Send to Agent."). None was stored
when this shipped (2026-11-14), so nothing was migrated.

**Who may set Auto** (`fireModeProblem`, run by every write path):

- Never on a review: "A review asks the agent, so it can't be Auto."
- On a buy, an add or a trim, only the owner: the thesis sheet, or his chat
  acting on his word. The morning run, the writer and the trigger run are
  refused by id (`ownersWord` on `applyTriggerOps`; `record_thesis` refuses the
  mint). An agent may still move the level of the owner's Auto trigger, and may
  make a sale Auto (it only speeds up protection).
- On an account or analyst rule, only on a sale: a standing Auto buy, add or
  trim would fire on every stock under it. None is stored (2026-10-22).

**A trade a trigger leads to uses it up**, like a filled order, in every mode.
When a trim fills, the stock's trim triggers behind it come off through
`applyTriggerOps` (actor SYSTEM) with one Activity line, "Its order filled, so it
came off: Trim 30% if above $150" (`takeOffFilled`, `lib/agent/triggers/filled.ts`,
on every trim or add fill; an add's add triggers). Behind it: the ones its
proposal named (`Order.triggerIds`), and any of the stock's own of that action
that fired and haven't been found false at a close since (a trim the morning run
or chat made). Never another action: a trim answering a floor's fire leaves the
floor. A buy's fill already takes off the buy triggers, and a sale closes the
position. The row is locked (`FOR UPDATE`) before the list is read, as in the
close pass's stamp. Only the stock's own triggers come off: an analyst or
account rule stays, and is ready again after a close finds it false. A declined,
expired or withdrawn proposal uses nothing up: the trigger has fired, and fires
again only after a close finds it false.

**Auto is the trade the agent would have made, minus the agent.** The
trigger run calls the same tool its agent would (`doItCall`,
`lib/agent/triggers/do-it.ts`), so the trade is sized and gated exactly as an
agent's: a buy needs a floor and a target on the plan, the analyst's
minimum score, a free position slot, and is sized by `sizeByRisk` off the
floor; an add is half a buy's risk inside the analyst's most in one stock. A
buy or an add is also paid from cash, never margin, as the Trade button's is
(`cashShortfall`, `lib/trading/manual-order-rules.ts`). A buy never fires on a
stale price (`shouldFire`), and the fired price is the entry. A refused
trade writes a `GateRejection` row, which is the one Activity line the
attempt feed shows ("Buy blocked: You have $1,000.00 in cash…"). With
nothing to trade (a sale on a stock we don't own, a buy on one we do) the
agent is asked instead.

A protective EXIT closes with a deterministic STOP/TARGET reason
(`closeReason` on the measure; `protectiveCloseReason`) — trail and gain-lock
give-backs tag STOP — so the P1-28 unapproved-exit cooldown exempts them, and a
rejected protective exit fires again after a close back on the other side. An Auto-sell on
any other condition (RSI, an average, volume, a gap, days from a date) closes as
TARGET when the condition is a rise for a long (a fall for a short), else STOP,
so a profit-take goes back on watch (`autoSellCloseReason`; which way a
condition goes is `rises` on its measure; volume and a date go neither way).

**A sale from a protective fire always carries the STOP/TARGET label** (DAV-192).
The close tool — `close_position`, the only whole-position exit since DAV-220 — runs the
model's chosen `reason` through `enforceCloseReason`
(`lib/agent/triggers/enforce-close-reason.ts`). When the run was woken by a
protective/price EXIT trigger, the stored `Position.closeReason` /
`Order.closeReason` is that trigger's STOP/TARGET tag, whatever the model
called it. With no trigger fired, the sale is the agent's or the owner's: a
STOP or TARGET it declared is stored `MANUAL`, since only a fired trigger
makes a sale a stop or a target (the price against a level no longer
decides it, 2026-11-16). The sale is **auto-corrected, never refused** — a mismatch writes a
plain-English note into the tool's reply and the run's event (`label_note`,
`declared_reason`), never onto the sale's reason, which is the analyst's words. This matters
because the label is what several rules read: the held-through-floor context in
`get_theses` counts only `closeReason=STOP` declines, and `shouldRecycleToWatching`
reads it to decide whether a sold name stays on the re-entry radar. In July,
protective closes tagged `MANUAL` went invisible to both.

`THESIS_INVALIDATED` stays honest on its own axis rather than competing for the
label: the stored reason becomes STOP/TARGET, and the invalidation is preserved
in the audit note **and** by forcing `belief_survived = false` — keyed off what
the agent *declared*, so a corrected label can never route a structurally-broken
name back to the watchlist.

**Every mode still goes through the approval gate.** `closeOpenPosition` and
the trade tools ask the account's approval switch for that side **before** any
Alpaca submit. With the switch on, Auto **proposes** the trade (you
approve/reject) — it does **not** auto-trade. Auto saves the *agent* cost,
never the *approval* step. The dialog says "Waits for your approval." under On
fire when the switch for that side is on.

**Only the owner slows a protective sale.** On a held stock an agent may not
move a protective sale from Auto-sell to Send to Agent (`FIRE_MODE_SPEED`,
`ratchet.ts`), the same as it may not lower the line.

## 5. From fire to trade (the pipeline)

```
predicate matches
  → stamp lastFiredAt + write ThesisUpdate(TRIGGER_FIRED)
  → NEXT_MORNING (no red filing on a held stock)? stop: the morning run answers it
  → else emit app/thesis.trigger.fired
      → tactical-run consumer
          → DO_IT sale?            closeOpenPosition ──────────────┐
          → DO_IT trim/buy/add?    manage_position / place_trade ──┤
          → else                   GPT-5.5 agent ──────────────────┤→ approval switch
                                               └→ approvals on → PROPOSAL
                                                  approvals off → execute
```

**Triggers work like orders (2026-11-17).** A trigger fires when it becomes
true: one already true when it is written, or when its condition or action is
changed, fires at the next check. After it fires it does not fire again until a
market close (the 16:20 ET pass) finds its condition false; then it is ready,
and the next check it holds fires it. No five-minute check makes it ready, so a
stock wobbling around the line all day fires it once. A buy, a review, a sale, a
trim, an add: the same rule. "Buy if above $35" written with the stock at $40
fires on the next check, because it is true; a buy at or near today's price is
how you buy now. A buy or add never fires on a stale quote; a filing fires once
per filing and a heads-up once per report, whatever the fired state. Two buys on
one stock true on the same pass fold into one trigger run, as a sale and a trim
do (`lib/agent/triggers/co-fire.ts`). The daily run's `TRIGGER_MATCHING_NOW`
asks the check's question ("true now, and ready") of a buy, an add or a review.
A sale or trim is listed when it has fired and no close has found it false since
(the close pass read it with every input; the morning read has no position or
chart numbers, so it can't re-read a trail or an average), or, never fired, when
it reads true now. So a sale that fired stays on the morning list
(PROTECTIVE_SALE) every day, declined or not, until a new sale price is set or a
close goes back past it. A declined sale holds nothing back: a trigger that fires
after it gets its run. A buy or add fire is held back unstamped while a buy or
add waits on the stock (proposed or sent), as a sale's is; the run's
`buy-already-queued` skip is a backstop. On the close, a trigger is read (to make
it ready, or to withdraw its card) only with every input it reads in hand,
yesterday's close included for the day's move.

Deleted 2026-11-17: the crossing (a buy or a review fired only when its
condition was false at the prior close, DAV-229), the written price a buy
written after the close was measured from, the buy re-arm after a run passed
on a wobble (DAV-343), the P1-37 snooze, the read-time floors on the wait, and
the waits themselves (`cooldownDays`). The migration
`20261121000000_trigger_fire_state_and_or_split` strips the stored waits and
splits every "or" into separate triggers; it writes no fire state.

**A proposal a fire leads to (a buy, add, trim or sale) has no 24 hours** (the
owner's ruling 2026-11-13): it carries the triggers it answers
(`Order.triggerIds`) and no `expiresAt`, waits while they hold (the check skips
the stock's sale fires meanwhile), and the 16:20 ET close pass withdraws it
(`WITHDRAWN`, with `withdrawnReason`) when none holds on the close, read with
`evaluateTrigger` (`lib/proposals/trigger-proposals.ts`). A proposal no trigger
made still lapses after 24 hours.

**Reviews wait for the morning by default:** a `REVIEW` fire means
"re-evaluate," not "act now" — it converts to a trade rarely, so unset it is
`NEXT_MORNING`: the `TRIGGER_FIRED` audit row, and the next morning run. A
review set to Send to Agent starts a trigger run, which answers it with the
review's situation guidance (each one costs a trigger run, about 6–18 cents;
it fires once until a close finds it false). A red filing on a stock we hold is looked at the
same day whatever is set (`filingNeedsSameDayLook`).

## 6. Fired, and ready again

A trigger's fire state is two times, written by the trigger check and nothing
else: `lastFiredAt`, when it last fired, and `falseAtCloseAt`, when a market
close last found its condition false. It has fired, and waits, while
`lastFiredAt` is later than `falseAtCloseAt` (`firedSinceFalseClose`,
`condition/describe.ts`). On the stock's own triggers they are inline; for an
analyst or account rule they are the stock's, in `Thesis.triggerState`
(`firedAt`, `falseAtCloseAt`), because the rule is shared.

The close pass reads every fired trigger with what it reads in hand (its
indicators, Street targets, earnings, filings and position): an input that
didn't load is not a false, and the trigger waits for the next close. A change
to a trigger's condition or action clears both times (`freshFire` in `ops.ts`; on
an inherited rule, every stock's `triggerState` entry for it). A change to its
mode or its note keeps them. The pill and the card say it: "Fired Nov 18 ·
fires again after a close back above $150" (`firesAgainWords`).

How each measure reads:

- **A price, an average, a high or low, RSI, a move, the move from our entry,
  the trail, volume:** fires on the check it becomes true, again after a close
  on the other side. A day's move or volume is that day's, so a day that closes
  past the line keeps it fired; the next day's close, read on its own move or
  volume, usually makes it ready.
- **Strength vs the S&P, insiders:** read off the morning's snapshot, so the
  close pass reads the prior close's; ready one close later than a price.
- **A gap:** once per gap; ready two closes after it (the next morning's
  snapshot still carries it).
- **A report, before:** once per report; **after:** once per report (true for
  its N days, ready at the close after). **A surprise:** once per report (its
  3-day lookback).
- **A filing:** once per filing, whatever its fired state.
- **The review clock:** fires when due; the review it asks for starts the next
  period. Unanswered it stays on the morning list (REVIEW_DUE), not fired again.
- **Days after the buy, days after the event:** true from then on, so once.
  **Days before the event:** a window, once per event.

## 7. Cadence + market hours

The trigger-evaluator cron is scheduled **every 5 minutes, `9-16` ET, Mon–Fri**,
but the price path only **evaluates during the regular session**:

- **Market-hours gate:** the cron's first tick is 9:00 ET (30 min before the
  open), the last spans past 16:00, and the `Mon–Fri` schedule doesn't skip
  holidays — all of which would evaluate price predicates against thin/erratic
  pre/after-market quotes (a daily-% trigger firing on a pre-market print). So
  the cron path gates on `isMarketOpen()` (regular session 9:30–16:00 ET,
  holiday-aware) and no-ops outside it.
- **The close pass:** the ticks from 16:20 to 16:34 ET on a trading day are
  not skipped: they evaluate only rungs with a price level read on the close (`settings.close`),
  with today's consolidated close (Alpaca SIP daily bar) as the price. A name
  with no bar for today is skipped rather than evaluated on a guess. Its fire
  state makes the three ticks fire a rung at most once. The close pass also
  reads every trigger that has fired and marks it ready (`falseAtCloseAt`)
  when its condition is false on the close (§6).
- **A trigger fires on the timing it saved.** A Stop watching line on a
  typed price is written "only on the close" (`settings.close`, the same
  setting any typed price has; the Writer writes it that way), so a watch
  ends on a close below the line, never an intraday touch (DAV-337, TRV
  2026-09-29: opened under its line, back above it that morning). The pill
  and the dialog show the setting saved; nothing changes it at check time.
  One saved intraday fires intraday, because that is what it says.
- **Cap:** 200 unique tickers per tick.

## 8. Editing surfaces

Once a thesis exists, its triggers change **one at a time**, through one
function — `applyTriggerOps` in `lib/agent/triggers/ops.ts` (DAV-242):

- **UI** — `lib/actions/thesis-edit.ts` + `/api/theses/[id]/triggers`:
  `applyTriggerAdd`, `applyTriggerReplace` (the dialog's Save: condition,
  action and On fire in one write), `applyTriggerDelete` — each is one op. The reject dialog embeds the same
  editor (`editableOnly`: price/% triggers only).
- **Agent** — `update_thesis(add_triggers | edit_triggers | remove_trigger_ids)`,
  the only way a trigger changes; there are no level fields (2026-11-16: a stock
  has triggers and nothing else). `record_thesis` takes a whole `triggers`
  list — a mint is a new list by definition — and adds nothing to a watch (a
  held mint gets its horizon's review clock).
- **A buy fill** removes every buy, every Stop watching trigger and every
  trigger marked `playbook: "WATCH"` (an edited one keeps its mark), writes
  "Sell if below $X" at the order's approved sell price (`Position.stopLoss`:
  the analyst's `sell_if_below` on `place_trade`, with its `sell_reason` as
  the trigger's note; a price you set in Edit & Approve or on the Trade
  ticket is yours), the playbook's triggers that come with the buy (each
  number from the chart then and the buy, `withTheBuyTriggers`; a trim's
  size as the playbook lists it), and the
  playbook's fill triggers where the stock has none of that kind
  (`armHeldLadderOnFill`). A trigger that comes with the buy where you wrote
  one of the same kind is not written: yours stays, and the fill's Activity
  line names the one not written; one the save refuses gets its line too. A
  watch's trigger never becomes the sale. Never a rewrite: the analyst's
  other triggers and reviews survive the fill, and nothing is stamped from
  the fill price. An Auto-buy names no
  sale, so it writes none: the holding sells by its analyst's and the
  account's rules. The one automatic floor is **stop when buying** (`lib/trading/auto-stop.ts`), a
  setting on the account (Settings → Triggers) that an analyst may override
  (its Triggers tab). On, a new long holding gets two lines. The **sale
  floor** is always the buy price less the setting's % (0.5–50, default 8) —
  the price at approval, moved to the price paid when the fill lands:
  "Sell if below $X", DO_IT, stamped as the owner's — added, or the floor
  there moved to it in place. A floor an analyst or a template set tighter
  than that is kept as the **review line** above it: "Review if below $Y",
  ASK_NOW, with the floor's own note; with a review already in that slot the
  higher price is kept, never two. A tighter floor the owner set is left
  exactly as it is, and a stop typed on the Trade ticket is the owner's
  (`approveProposal(…, { tradeTicket: true })` → `stopIsOwners`). With the
  setting on, a buy (and an add) is sized off the
  wider of the stock's floor and the setting's line (`sizingStop`,
  `lib/agent/position-sizing.ts`), so a loss at the sale floor stays inside
  the risk per trade. An add to a holding never moves the lines.
- **A sale back to watch** (a profit-take, or a sale whose agent said the
  belief survived): the triggers that need a position come off (a sale, a
  trim, an add, and any measured from the buy: our entry, the high since we
  bought, days after the buy); the rest stay as written, yours and the
  holding's review clock included, and nothing is written; the CLOSED
  Activity row names each one that came off (`closeThesisForPosition`).
- **Stop watching:** a STOP_WATCHING line on a stock we only watch, fired on
  its saved timing (§7), retires the thesis as dropped with one Activity line
  and withdraws a buy waiting for approval; its triggers are left as they
  were. On a promoted row the fire is written down for the morning run.
  There is no plan to set down.

Rules run per op on the resulting list; a refused op is returned by id with
the reason and the rest of the call lands (`data.trigger_ops` on the tool):

- One trigger per bucket, one per plan slot: adding a second buy trigger,
  target, floor or review cadence **edits the one that is there**.
- An edited trigger keeps its id. A change to its condition or action starts it
  fresh (its fire state cleared, so a true one fires at the next check); a
  change to its mode or note keeps it.
- An edit names the trigger's `value` in its own unit (a price, a %, a count
  of days) and, if it changes, its `variable`. An agent's value edit needs a
  `rationale` — the sentence moves with the number (the principal's edits get
  the number substituted). A model that still sends the old `level` / `pct` /
  `days` has it read as the value, and the edit is refused when the trigger
  holds a different kind of number, as before.
- On a held stock an agent may only tighten a protective sell level (§ the
  ratchet, DAV-185); the principal is exempt.
- After all ops, ONE check on the derived plan: ordering everywhere, and a
  buy trigger where a floor or target is armed. A stop above the buy price is
  refused for anyone. There is no reward/risk (gone 2026-11-04, its ratio
  2026-11-16): the house sets no target of its own.

Nothing stores a level, and nothing sums the triggers into one: the agents
read each trigger as its sentence, and the chart draws one line per price
trigger labelled with its sentence (`priceLines`). The sale or upside trigger
an owner's edit moves is mirrored onto the open `Position` (the trade's own
sell price). The Activity feed shows the ops the
caller sent — "Entry $183 → $190", "Removed: Sell if below $110" — stored verbatim
on the row's `fieldChanges.triggerOps`.

## Key files

- `lib/agent/triggers/condition/` — the condition shape (`types.ts`), one catalog entry per measure (`catalog.ts`, `measures/*`), the variables (`variables.ts`), the rules that read the catalog (`rules.ts`), the check (`read.ts`), the words (`describe.ts`), the form's checks (`check.ts`), what the save accepts (`valid.ts`), what a fire names (`facts.ts`, server-only) and comparing stored conditions (`stored.ts`)
- `lib/agent/triggers/ops.ts` — the per-trigger write path (`applyTriggerOps` + `checkLadder`) every editor goes through once a thesis exists (§8)
- `lib/agent/triggers/types.ts` — the `Trigger` type
- `lib/agent/triggers/stop-watching.ts` — a STOP_WATCHING fire on a watch: the thesis retires as DROPPED
- `lib/agent/triggers/enforce-close-reason.ts` — the sale-label rule: a close from a protective fire stores STOP/TARGET, auto-corrected with an audit note (DAV-192)
- `lib/agent/triggers/schema.ts` — the one Zod gate, and the condition a model writes (the measures listed from the catalog)
- `lib/agent/triggers/evaluate.ts` — `shouldFire`: the condition, a stale quote, fired since a false close
- `lib/agent/triggers/defaults.ts` — horizon templates + `accountStandingRules()` (the account's add prompts)
- `lib/inngest/functions/trigger-evaluator.ts` — the cron and close passes, one catch per trigger
- `lib/agent/triggers/fire-mode.ts` — on fire: the three modes, their defaults, where a fire goes (`waitsForMorning`, `doItTrade`), the words
- `lib/agent/triggers/do-it.ts` — the trade tool call an Auto trigger makes
- `lib/agent/triggers/filled.ts` — a trigger whose trim or add filled comes off the stock
- `lib/inngest/functions/tactical-run.ts` — consumer (the agent, or an Auto trade)
- `lib/actions/thesis-edit.ts` — add / edit / delete / fire-mode write paths
- `components/agent/sheets/ThesisTriggersSection.tsx` — the trigger UI
