# Hindsight — Triggers

> **The reference for the trigger system.** What a trigger is, which predicates
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

- **predicate** — the machine-checkable condition (`lib/agent/triggers/types.ts`).
- **action** — what firing means: `ENTER | EXIT | REVIEW | ADD | TRIM | MOVE_STOP`.
- **rationale** — prose the agent reads when it acts.
- **cooldownDays** — don't re-fire within N days (see §6).
- **fireMode** — `TACTICAL` (default) or `DIRECT` (see §4).

Validation is one Zod gate (`triggers/schema.ts`) used by **every** writer — the
agent (`record_thesis`/`update_thesis`), the UI add/edit, and the reject dialog.
An invalid trigger is dropped at evaluation, so the gate rejects it up front.

## 2. Predicate catalog

| Kind | Means | Value |
|---|---|---|
| `PRICE_ABOVE` / `PRICE_BELOW` | Last quote crosses a fixed level ("Target Price"). `basis: "close"` = the day must **close** past it — the 5-minute passes skip it and the close pass (16:20–16:34 ET) reads the day's consolidated close. | `level` ($), `basis?: intraday\|close` |
| `PRICE_MOVE_PCT` | % move ("Movement Amount"): `1D` vs the prior close off the quote; `5D` / `20D` vs the close that many sessions back, off the snapshot | `pct`, `direction: UP\|DOWN`, `window: 1D\|5D\|20D` |
| `GAIN_FROM_ENTRY` | **Cumulative** % vs the open position's `avgCost` — not the single-day move. `UP` fires at gain ≥ `pct` (the +10% checkpoint milestone); `DOWN` fires at gain ≤ −`pct` (the −12% loser-attention drawdown). LONG: `(price−avg)/avg`; SHORT inverts (a gain is a price DROP). **HOLDING-only** — no open position in context ⇒ evaluates false. | `pct`, `direction: UP\|DOWN` |
| `TRAILING_FROM_HIGH` | Give-back % off the position's tracked peak (`Position.peakPrice` — high-water for LONG, low-water for SHORT, maintained by the price monitor). The mechanical gain ratchet: the floor follows the high with **zero agent memory**. LONG fires when price ≤ `peak × (1 − pct/100)`; SHORT mirrors off the low. **HOLDING-only.** | `pct` |
| `VS_SMA` | Price above / below a moving average (snapshot) | `period: 20\|50\|150\|200`, `direction` |
| `NEAR_SMA` | Price within `withinPct`% of a moving average — the pullback arm | `period`, `withinPct` |
| `VOLUME_RATIO` | Today's volume so far ÷ the 20-session average. No projection — true only once the volume is really there; read at the close it is the day's ratio | `min` (×) |
| `NEW_HIGH` | Price above the prior 20 sessions' / 52 weeks' high | `window: 20D\|52W` |
| `PCT_FROM_52W_HIGH` | Price within `max`% of the 52-week high | `max` (%) |
| `RS_VS_SPY` | Return over the window minus SPY's, percentage points, as of the last close | `window: 1M\|3M\|6M`, `min` |
| `GAP_UP` | Opened ≥ `minPct`% over the prior close on ≥ `minVolRatio`× volume — today, or within `withinDays` sessions | `minPct`, `minVolRatio`, `withinDays?` |
| `RSI` | RSI over the snapshot's closes with the live price as today's | `period?: 2\|14`, `threshold`, `direction` |
| `INSIDER_CLUSTER` | At least `minBuyers` distinct insiders bought on the open market (Form 4 code P; grants and exercises excluded) within `days`. Read from the snapshot's `insiderBuys` (Finnhub, refreshed 06:30 ET). The fire's audit row names the buyers. Cooldown 30. (DAV-252) | `minBuyers` (1–10), `days` (1–90) |
| `EARNINGS_BEAT` / `EARNINGS_MISS` | Earnings surprise — reported EPS vs estimate, read off the Finnhub calendar on the cron (one firm-wide call per pass; `triggers/earnings.ts`). Fires at the first open after the report, once per report (3-day lookback inside the 7-day cooldown). The audit row carries the figures. | `minSurprisePct?` |
| `EARNINGS_WITHIN` | The heads-up **before** a report: "this stock reports within N days." Same calendar call, 14-day lookahead. Fires once per approaching report (30-day cooldown). The audit row carries the date, bell, and estimates. | `days` (1–14) |
| `EARNINGS_SINCE` | The window **after** a report: "reported between min and max days ago" (0 = the report day). The post-report drift entry window, once the reaction is known. Same calendar, 5-day lookback. Fires once per report (30-day cooldown). | `min`, `max` (0–5) |
| `REVIEW_CADENCE` | N days since the last actual review (`lastReviewedAt`) | `days` |
| `AND` / `OR` | Composite | `predicates[]` |

The UI mints **Target Price** (`PRICE_ABOVE`/`PRICE_BELOW`, intraday or at
the close), **Movement Amount** (`PRICE_MOVE_PCT`, today / 5 / 20 sessions),
the held-only **Gain / Trail** pair, the **Agent Watch** clock
(`REVIEW_CADENCE`), the **Earnings** heads-up (`EARNINGS_WITHIN`), and
**Chart** (every chart kind above). The rest come from horizon defaults
(`triggers/defaults.ts`) or the agent.

**The chart kinds read the daily indicator snapshot** (DAV-247):
`lib/inngest/functions/indicator-snapshot.ts` runs at 06:30 ET, computes the
chart for every ticker on the book with `lib/market-data/price-structure.ts`
(a year of SIP daily bars) and stores numbers — moving averages, 20-day /
52-week highs, the 20-day volume average, the last 60 closes, RS vs SPY, the
last 10 sessions' gaps — in `TickerIndicators`. The evaluator reads the
newest row next to the live quote; a snapshot older than 5 days is ignored
(logged). No snapshot ⇒ the chart kinds read false. `VOLUME_RATIO` and
`GAP_UP` also read today's consolidated volume (one batched Alpaca call, ~16
minutes delayed — Finnhub quotes carry no volume).

**`fireOnMatch`** (a field on the trigger, ENTER only): the rung fires on its
first check where the condition is true, even if it was already true at the
prior close. It is the buy-now rung — an ENTER otherwise waits for the
crossing, which a level the price is already past never produces on a flat or
down day. After the first fire it is an ordinary ENTER.

**Deleted 2026-09-11 (DAV-247):** `SIGNAL_TYPE`, `GUIDANCE_CHANGE`, `FILING`.
They needed the signal router, which has been off since 2026-05-31, and could
never fire. A migration stripped them from every stored ladder (207 rungs
removed, 1 rewritten, 119 theses). When the Signals project returns, its kinds
are added fresh against a source that exists.

`GAIN_FROM_ENTRY` + `TRAILING_FROM_HIGH` **are the gain-protection system**
(#477). They are the two predicates the standing protection minimums in §2a
are built on — the checkpoint / loser rungs are `GAIN_FROM_ENTRY`, the trail
ratchet is `TRAILING_FROM_HIGH`. Both are complements to `PRICE_MOVE_PCT`,
which only ever sees the single-day move: `GAIN_FROM_ENTRY` catches the quiet
cumulative winner/bleeder, and `TRAILING_FROM_HIGH` banks a run-up mechanically
(the IONS failure — see §2a and `docs/plans/THESIS_GAME_PLAN.md`).

## 2a. Standing protection minimums (the gain-protection ladder)

Every HOLDING auto-carries three always-on protection rungs, stamped by
`standingProtectionTriggers()` in `triggers/defaults.ts` and pushed into every
HELD horizon template (also re-seeded on the buy fill — `place-trade.ts`). They
exist so no holding can quietly run up, or bleed, without forcing a decision.
The motivating failure is IONS: bought $73.83, day-one floor at $65, ran +17%,
three rubber-stamp reviews, then crashed and fired the day-one floor for a LOSS
— no level was ever re-earned. These rungs make that impossible to do silently.

| Rung | Predicate | Action | Cooldown | What it does |
|---|---|---|---|---|
| Gain checkpoint | `GAIN_FROM_ENTRY` `UP` +10% | REVIEW → next morning | 7d (per-kind default) | Up 10% from entry → re-underwrite: raise the floor to lock the gain, arm the next milestone. |
| Trail ratchet | `TRAILING_FROM_HIGH` 8% | EXIT → tactical | 0 (re-fires) | Gave back 8% off the high → bank the gain instead of round-tripping it. Terminal EXIT, so `cooldownDays: 0` (same convention as the hard stop). |
| Loser attention | `GAIN_FROM_ENTRY` `DOWN` −12% | REVIEW → next morning | 7d | Down 12% from entry → decide hold-vs-cut deliberately, before the hard stop decides for us. |

Plus two **scale rungs** on the conviction horizons (also stamped by default):

| Rung | Predicate | Action | Cooldown | Horizons |
|---|---|---|---|---|
| Add on strength | `PRICE_MOVE_PCT` `1D` `UP` +7% | ADD → tactical | 3d | all HELD |
| Add on pullback | `PRICE_MOVE_PCT` `1D` `DOWN` −7% | ADD → tactical | 3d | COMPOUNDER/TARGET/CATALYST (not TRADE — momentum trades exit on weakness, they don't average down) |

The three constants (`PROTECT_CHECKPOINT_GAIN_PCT` 10, `PROTECT_TRAIL_PCT` 8,
`LOSER_ATTENTION_DRAWDOWN_PCT` 12) are principal-tunable in `defaults.ts`;
every future mint picks up a change, and existing theses keep the value they
were minted with (editable per-thesis in the trigger popover). Merge dedup is
per `(predicateKey, action)` bucket — an agent that authors its own +15% gain
checkpoint REVIEW replaces the +10% default rather than stacking a second, while
a custom `GAIN_FROM_ENTRY DOWN` rung leaves the UP default intact.

**Target is a REVIEW checkpoint, not an auto-exit — except on the TRADE
horizon.** For TARGET/COMPOUNDER/CATALYST holds, `PRICE_ABOVE(target)` is a
REVIEW rung ("target hit — close, or trail higher with confidence intact"), so
a winner isn't blindly dumped at the first number. Only the TRADE horizon maps
`PRICE_ABOVE(target)` to a terminal EXIT (the trade plan is executed; close).
The hard stop (`PRICE_BELOW(stop)` → EXIT, cd 0) is universal across horizons.

> **History — the trailing predicate came back, on purpose.** An earlier
> `TRAILING_STOP` predicate was **removed in #458**, which traded peak-trailing
> for the daily-% (`PRICE_MOVE_PCT`) move. `TRAILING_FROM_HIGH` (#477) is **not a
> revert of that decision** — it deliberately reinstates *cumulative* give-back
> protection **alongside** the daily-% predicate, not instead of it. The daily-%
> rung catches a violent single session; the trail catches a slow round-trip off
> the peak (the IONS case). Both live on the ladder now; they cover different
> failure shapes.

## 3. The firing matrix — WHICH predicate fires on WHICH path

This is the part that's easy to get wrong. There are three evaluation paths, all
sharing the pure `evaluateTrigger` in `triggers/evaluate.ts`:

| Predicate | Cron (5-min, market hours) | Signal (`app/signal.routed`) | Daily-run inline |
|---|:--:|:--:|:--:|
| `PRICE_ABOVE` / `PRICE_BELOW` | ✅ | — | ✅ |
| **`PRICE_MOVE_PCT` `window:"1D"`** (the % alerts) | ✅ **fires** | — | ⚠️ only if a daily change is supplied |
| `PRICE_MOVE_PCT` `5D` / `20D` | ✅ (snapshot) | — | ✅ (snapshot) |
| **`GAIN_FROM_ENTRY`** (HOLDING-only) | ✅ **fires** | — | ✅ |
| **`TRAILING_FROM_HIGH`** (HOLDING-only) | ✅ **fires** | — | ✅ |
| `VS_SMA` / `NEAR_SMA` / `NEW_HIGH` / `PCT_FROM_52W_HIGH` / `RS_VS_SPY` / `RSI` / `INSIDER_CLUSTER` | ✅ (snapshot) | — | ✅ (snapshot) |
| `VOLUME_RATIO` / `GAP_UP` | ✅ (snapshot + today's volume) | — | ❌ (no volume on that path) |
| `PRICE_ABOVE` / `PRICE_BELOW` `basis:"close"` | ✅ **close pass only** (16:20–16:34 ET) | — | ✅ (read as a plain level) |
| **`EARNINGS_BEAT` / `EARNINGS_MISS` / `EARNINGS_WITHIN` / `EARNINGS_SINCE`** | ✅ **fires** (calendar) | ✅ (beat/miss only, if a signal ever carries a surprise) | — |
| `REVIEW_CADENCE` | ✅ | — | ✅ |

**The Movement-Amount nuance (read this):** a **daily** (`1D`) `PRICE_MOVE_PCT`
fires on the cron because the evaluator reads the quote's own daily % change
(`latestQuote.changePct` — Finnhub `dp`, with a prev-close `(c−pc)/pc` fallback
for thin names; `trigger-evaluator.ts`). It does **not** need candles. The
multi-day windows (`5D`/`20D`) read the snapshot's closes.

> Historical note: before the Movement-Amount work, ALL `PRICE_MOVE_PCT`
> returned false on the cron. The `1D`-via-`changePct` path is what connected
> the daily % alerts. If you see a claim that "the cron can't read
> `PRICE_MOVE_PCT`," it's describing the pre-fix code. (`30D` was removed
> 2026-08-25; `5D` / `20D` came back with the snapshot in DAV-247.)

**The gain-protection nuance (read this):** `GAIN_FROM_ENTRY` and
`TRAILING_FROM_HIGH` fire on the 5-min cron because the cron supplies the open
position's economics (`avgCost` for gain-from-entry, `peakPrice` for
trail-from-high — both maintained per HOLDING) alongside the latest quote; no
candles needed. Both are **HOLDING-only**: with no open position in context
(WATCHING theses, or a caller that didn't join the position) they evaluate
false rather than throw. `peakPrice` is the price-monitor-maintained water mark
— the trail floor ratchets up with the high automatically, so a give-back fires
the EXIT with no memory required of any prior review.

## 4. Fire modes — TACTICAL vs DIRECT

Set per-trigger (`fireMode`, default `TACTICAL`):

- **`TACTICAL`** ("Trigger Tactical Run") — fires `app/thesis.trigger.fired` →
  a focused GPT-5.5 **tactical run** validates and decides.
- **`DIRECT`** ("Automatically Exit") — **EXIT action only**, on a deterministic
  predicate. The tactical-run consumer **short-circuits past the agent** and
  calls `closeOpenPosition` directly. Saves the GPT cost on mechanical exits.
  The DIRECT-eligible predicate set (`isDirectEligiblePredicate` /
  `DIRECT_ELIGIBLE_PREDICATE_KINDS` in `types.ts`) is:
  `PRICE_ABOVE`, `PRICE_BELOW`, `PRICE_MOVE_PCT`, **`GAIN_FROM_ENTRY`**, and
  **`TRAILING_FROM_HIGH`** — i.e. the gain-lock and trail-give-back ratchets are
  now DIRECT-eligible alongside the absolute price/daily-% kinds. Everything
  judgment-bearing (earnings, signals, RSI, time, composites) refuses DIRECT and
  falls back to TACTICAL. A protective price/gain EXIT closes with a
  deterministic STOP/TARGET reason (`protectiveExitCloseReason`) — trail and
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
false at the prior session's close (`latestQuote.prevClose`, Finnhub `pc`).
"Buy above $35" means buy when the price gets there — not "buy now and ask
every day it is higher", which is what the standing-order reading made of a
level the price was already past (TOST $35.15 against a $35.16 tape; PLTR,
16 buy fires in 30 days). The same predicate evaluated at the prior close
decides the crossing, so composites and `VS_SMA` get it for free; entries
that don't read the price (time, daily move) can't cross and keep firing on
match. A plan the price has left behind is `planSanity`'s job to surface to
the daily run, not the cron's job to propose. Read-side snapshots (the daily
run's `TRIGGER_MATCHING_NOW`, the resolver's `ENTER_FIRED`) carry no prior
close and keep level semantics — "is the condition true now" is the right
question for a snapshot.

**REVIEW-batching:** a `REVIEW` fire means "re-evaluate," not "act now" — it
converts to a trade rarely, so (except BREAKING-urgency signals) it writes the
`TRIGGER_FIRED` audit row and defers to the next daily run instead of spawning a
tactical run. `ENTER`/`EXIT` always spawn (or DIRECT-close).

## 6. Cooldown

`cooldownDays` rate-limits re-fires. Omit it → a per-kind default
(`defaultCooldownDaysForPredicate`: EARNINGS_BEAT/MISS 7, EARNINGS_WITHIN/SINCE
30, PRICE_* and the chart kinds 1, `GAP_UP` its `withinDays`, `GAIN_FROM_ENTRY` 7 — the milestone latches, so 7d stops a same-week re-fire
if the acting agent forgets to re-arm the next checkpoint; `TRAILING_FROM_HIGH`
1, REVIEW_CADENCE its own interval, …). **`cooldownDays: 0` is reserved for terminal
`EXIT` triggers only** — `0` on any other action causes a 5-min evaluator
infinite loop the instant the predicate latches true, so the write path
overwrites it with the per-kind default (`applyTriggerCooldownDefaults`). The
standing trail ratchet is stamped `cooldownDays: 0` at mint (terminal EXIT, same
as the hard stop).

## 7. Cadence + market hours

The trigger-evaluator cron is scheduled **every 5 minutes, `9-16` ET, Mon–Fri**,
but the price path only **evaluates during the regular session**:

- **Market-hours gate:** the cron's first tick is 9:00 ET (30 min before the
  open), the last spans past 16:00, and the `Mon–Fri` schedule doesn't skip
  holidays — all of which would evaluate price predicates against thin/erratic
  pre/after-market quotes (a daily-% trigger firing on a pre-market print). So
  the cron path gates on `isMarketOpen()` (regular session 9:30–16:00 ET,
  holiday-aware — the same guard `price-monitor` uses) and no-ops outside it.
  The **signal path is not gated** — news doesn't keep market hours.
- **The close pass:** the ticks from 16:20 to 16:34 ET on a trading day are
  not skipped: they evaluate only rungs with a `basis: "close"` price level,
  with today's consolidated close (Alpaca SIP daily bar) as the price. A name
  with no bar for today is skipped rather than evaluated on a guess. Cooldown
  makes the three ticks fire a rung at most once.
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

Rules run per op on the resulting list; a refused op is returned by id with
the reason and the rest of the call lands (`data.trigger_ops` on the tool):

- One trigger per bucket, one per plan slot: adding a second buy trigger,
  target, floor or review cadence **edits the one that is there**.
- An edited trigger keeps its id, so `lastFiredAt` and the cooldown carry.
- An agent's level / pct / days edit needs a `rationale` — the sentence moves
  with the number (the principal's edits get the number substituted).
- On a held stock an agent may only tighten a protective sell level (§ the
  ratchet, DAV-185); the principal is exempt.
- After all ops, ONE check on the derived plan: ordering everywhere, a buy
  trigger where a floor or target is armed, and — for an agent only — 2:1 on
  a plan we don't own. The principal is exempt from the ratio as from the
  ratchet; a stop above the buy price is refused for anyone.

The plan columns (`entryPrice` / `targetPrice` / `stopLoss`) are recomputed from
the resulting triggers and mirrored onto the open `Position`, so the chart,
run-summary, and evaluator never drift. The Activity feed shows the ops the
caller sent — "Entry $183 → $190", "Removed: sell below $110" — stored verbatim
on the row's `fieldChanges.triggerOps`.

## Key files

- `lib/agent/triggers/ops.ts` — the per-trigger write path (`applyTriggerOps` + `checkLadder`) every editor goes through once a thesis exists (§8)
- `lib/agent/triggers/types.ts` — predicate union (incl. `GAIN_FROM_ENTRY` + `TRAILING_FROM_HIGH`) + `Trigger` type + `isDirectEligiblePredicate` / `DIRECT_ELIGIBLE_PREDICATE_KINDS` + `protectiveExitCloseReason`
- `lib/agent/triggers/enforce-close-reason.ts` — the sale-label rule: a close from a protective fire stores STOP/TARGET, auto-corrected with an audit note (DAV-192)
- `lib/agent/triggers/schema.ts` — the one Zod gate
- `lib/agent/triggers/evaluate.ts` — pure evaluator (incl. the 1D daily-move path + the HOLDING-only gain/trail paths)
- `lib/agent/triggers/defaults.ts` — horizon templates + `standingProtectionTriggers()` (the +10%/8%/−12% minimums) + `scaleInOn*` (±7% rungs) + cooldown defaults
- `lib/inngest/functions/trigger-evaluator.ts` — signal + cron paths
- `lib/inngest/functions/tactical-run.ts` — consumer (TACTICAL agent / DIRECT close)
- `lib/actions/thesis-edit.ts` — add / edit / delete / fire-mode write paths
- `components/agent/sheets/ThesisTriggersSection.tsx` — the trigger UI
