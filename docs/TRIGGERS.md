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
| `PRICE_ABOVE` / `PRICE_BELOW` | Last quote crosses a fixed level ("Target Price") | `level` ($) |
| `PRICE_MOVE_PCT` | Daily % move vs prior close ("Movement Amount") | `pct`, `direction: UP\|DOWN`, `window` |
| `GAIN_FROM_ENTRY` | **Cumulative** % vs the open position's `avgCost` — not the single-day move. `UP` fires at gain ≥ `pct` (the +10% checkpoint milestone); `DOWN` fires at gain ≤ −`pct` (the −12% loser-attention drawdown). LONG: `(price−avg)/avg`; SHORT inverts (a gain is a price DROP). **HOLDING-only** — no open position in context ⇒ evaluates false. | `pct`, `direction: UP\|DOWN` |
| `TRAILING_FROM_HIGH` | Give-back % off the position's tracked peak (`Position.peakPrice` — high-water for LONG, low-water for SHORT, maintained by the price monitor). The mechanical gain ratchet: the floor follows the high with **zero agent memory**. LONG fires when price ≤ `peak × (1 − pct/100)`; SHORT mirrors off the low. **HOLDING-only.** | `pct` |
| `VS_SMA` | Price vs 50/200-day SMA | `period`, `direction` |
| `RSI` | RSI vs threshold (**stubbed — never fires**) | `threshold`, `direction` |
| `SIGNAL_TYPE` | A routed signal of a given type/sentiment/urgency | `signalType`, `sentiment?`, `minUrgency?` |
| `EARNINGS_BEAT` / `EARNINGS_MISS` | Earnings surprise | `minSurprisePct?` |
| `GUIDANCE_CHANGE` | Guidance revision | `direction` |
| `FILING` | SEC form filed | `formType` |
| `TIME_ELAPSED` | N days since position-open (HELD) / thesis-create (WATCHING) | `days` |
| `REVIEW_DATE_HIT` | `nextReviewAt` reached | — |
| `AND` / `OR` | Composite | `predicates[]` |

The two the UI mints are **Target Price** (`PRICE_ABOVE`/`PRICE_BELOW`) and
**Movement Amount** (`PRICE_MOVE_PCT`). The rest come from horizon defaults
(`triggers/defaults.ts`) or the agent.

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
| **`PRICE_MOVE_PCT` `window:"1D"`** (the % alerts) | ✅ **fires** | — | ⚠️ only if candles supplied |
| `PRICE_MOVE_PCT` `5D` / `30D` | ❌ (no candles) | — | ✅ |
| **`GAIN_FROM_ENTRY`** (HOLDING-only) | ✅ **fires** | — | ✅ |
| **`TRAILING_FROM_HIGH`** (HOLDING-only) | ✅ **fires** | — | ✅ |
| `VS_SMA` | ❌ (no SMA) | — | ✅ |
| `RSI` | ❌ stub | ❌ stub | ❌ stub |
| `EARNINGS_*` / `GUIDANCE_CHANGE` / `FILING` / `SIGNAL_TYPE` | — | ✅ | — |
| `TIME_ELAPSED` / `REVIEW_DATE_HIT` | ✅ | — | ✅ |

**The Movement-Amount nuance (read this):** a **daily** (`1D`) `PRICE_MOVE_PCT`
fires on the cron because the evaluator reads the quote's own daily % change
(`latestQuote.changePct` — Finnhub `dp`, with a prev-close `(c−pc)/pc` fallback
for thin names; `trigger-evaluator.ts`). It does **not** need candles. The
multi-day windows (`5D`/`30D`) and `VS_SMA` **do** need candles the cron doesn't
fetch, so they only evaluate on the daily-run inline path. `RSI` is a stub
everywhere. **The UI only mints `1D`**, so every % alert you set from the UI
fires on the cron.

> Historical note: before the Movement-Amount work, ALL `PRICE_MOVE_PCT`
> returned false on the cron. The `1D`-via-`changePct` path is what connected
> the daily % alerts. If you see a claim that "the cron can't read
> `PRICE_MOVE_PCT`," it's describing the pre-fix code or the 5D/30D case.

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

**REVIEW-batching:** a `REVIEW` fire means "re-evaluate," not "act now" — it
converts to a trade rarely, so (except BREAKING-urgency signals) it writes the
`TRIGGER_FIRED` audit row and defers to the next daily run instead of spawning a
tactical run. `ENTER`/`EXIT` always spawn (or DIRECT-close).

## 6. Cooldown

`cooldownDays` rate-limits re-fires. Omit it → a per-kind default
(`defaultCooldownDaysForPredicate`: EARNINGS_*/GUIDANCE 7, FILING/SIGNAL/PRICE_*
1, `GAIN_FROM_ENTRY` 7 — the milestone latches, so 7d stops a same-week re-fire
if the acting agent forgets to re-arm the next checkpoint; `TRAILING_FROM_HIGH`
1, TIME_ELAPSED ~80% of window, …). **`cooldownDays: 0` is reserved for terminal
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
- **Cap:** 200 unique tickers per tick.

## 8. Editing surfaces

All write through the same audited helpers in `lib/actions/thesis-edit.ts` +
`/api/theses/[id]/triggers`:

- **Add** — `applyTriggerAdd` (UI "Add trigger": Target Price | Movement Amount).
- **Edit value / fire mode** — `applyTriggerValueEdit` / `applyTriggerFireModeChange`.
- **Delete** — `applyTriggerDelete`.
- **Reject dialog** — embeds the editor (`editableOnly`: price/% triggers only)
  so you can retune the stop/target or add a % alert while rejecting a proposal.
- **Agent** — `record_thesis` / `update_thesis`, auto-merged with horizon
  defaults.

Canonical price stop/target edits mirror onto `Thesis.stopLoss`/`targetPrice` +
the open `Position` so the chart, run-summary, and evaluator never drift.

### The `update_thesis.triggers` wholesale-replace footgun

`update_thesis(triggers: [...])` **replaces the entire trigger set wholesale** —
it does NOT merge with the existing rungs (unlike `record_thesis`, which merges
with horizon defaults). Pass `[]` and every rung is cleared. So **resend every
rung you want to keep** on any edit — a rung you omit is dropped, silently
taking its protection with it. The single most common way to strip a holding's
gain-protection ladder is to `update_thesis` with a partial `triggers` array.

Two server-managed fields survive the replacement, keyed by trigger **id**
(`update-thesis.ts:1181-1213`):

- **`lastFiredAt`** — the cooldown stamp the agent never sees. Preserved from
  the prior rung **only when you resend the same `id`.** Drop the id (or mint a
  fresh rung) and the firing memory resets → the predicate re-fires on the next
  tick. Edit in place = same id; net-new = fresh id.
- **`cooldownDays`** — agent-authored rungs often omit it;
  `applyTriggerCooldownDefaults` backfills the per-kind default so the cooldown
  gate is never a silent no-op (and rewrites a `0` on any non-EXIT action, §6).

There is **no `source`/provenance field yet** — a `DEFAULT | ANALYST_RULE |
AGENT | PRINCIPAL` stamp is a convergence gap tracked in
`docs/plans/TRIGGER_MODEL.md` §5. Until it lands, a wholesale replace also
loses the "who set this rung" distinction, so re-authoring is the only record.

## Key files

- `lib/agent/triggers/types.ts` — predicate union (incl. `GAIN_FROM_ENTRY` + `TRAILING_FROM_HIGH`) + `Trigger` type + `isDirectEligiblePredicate` / `DIRECT_ELIGIBLE_PREDICATE_KINDS` + `protectiveExitCloseReason`
- `lib/agent/triggers/enforce-close-reason.ts` — the sale-label rule: a close from a protective fire stores STOP/TARGET, auto-corrected with an audit note (DAV-192)
- `lib/agent/triggers/schema.ts` — the one Zod gate
- `lib/agent/triggers/evaluate.ts` — pure evaluator (incl. the 1D daily-move path + the HOLDING-only gain/trail paths)
- `lib/agent/triggers/defaults.ts` — horizon templates + `standingProtectionTriggers()` (the +10%/8%/−12% minimums) + `scaleInOn*` (±7% rungs) + cooldown defaults
- `lib/inngest/functions/trigger-evaluator.ts` — signal + cron paths
- `lib/inngest/functions/tactical-run.ts` — consumer (TACTICAL agent / DIRECT close)
- `lib/actions/thesis-edit.ts` — add / edit / delete / fire-mode write paths
- `components/agent/sheets/ThesisTriggersSection.tsx` — the trigger UI
