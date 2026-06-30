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
| `TRAILING_STOP` | Retrace `trailPct`% from peak (dormant — not offered in the UI) | `trailPct` |
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

## 3. The firing matrix — WHICH predicate fires on WHICH path

This is the part that's easy to get wrong. There are three evaluation paths, all
sharing the pure `evaluateTrigger` in `triggers/evaluate.ts`:

| Predicate | Cron (5-min, market hours) | Signal (`app/signal.routed`) | Daily-run inline |
|---|:--:|:--:|:--:|
| `PRICE_ABOVE` / `PRICE_BELOW` | ✅ | — | ✅ |
| **`PRICE_MOVE_PCT` `window:"1D"`** (the % alerts) | ✅ **fires** | — | ⚠️ only if candles supplied |
| `PRICE_MOVE_PCT` `5D` / `30D` | ❌ (no candles) | — | ✅ |
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

## 4. Fire modes — TACTICAL vs DIRECT

Set per-trigger (`fireMode`, default `TACTICAL`):

- **`TACTICAL`** ("Trigger Tactical Run") — fires `app/thesis.trigger.fired` →
  a focused GPT-5.5 **tactical run** validates and decides.
- **`DIRECT`** ("Automatically Exit") — **EXIT-only**, deterministic price /
  movement / trailing predicates (`isDirectEligiblePredicate`). The tactical-run
  consumer **short-circuits past the agent** and calls `closeOpenPosition`
  directly. Saves the GPT cost on mechanical exits.

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
(`defaultCooldownDaysForPredicate`: EARNINGS_* 7, FILING/PRICE_* 1, TIME_ELAPSED
~80% of window, …). **`cooldownDays: 0` is reserved for terminal `EXIT`
triggers only** — `0` on any other action causes a 5-min evaluator infinite loop
the instant the predicate latches true, so the write path overwrites it with the
per-kind default (`applyTriggerCooldownDefaults`).

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

## Key files

- `lib/agent/triggers/types.ts` — predicate union + `Trigger` type + `isDirectEligiblePredicate`
- `lib/agent/triggers/schema.ts` — the one Zod gate
- `lib/agent/triggers/evaluate.ts` — pure evaluator (incl. the 1D daily-move path)
- `lib/agent/triggers/defaults.ts` — horizon templates + cooldown defaults
- `lib/inngest/functions/trigger-evaluator.ts` — signal + cron paths
- `lib/inngest/functions/tactical-run.ts` — consumer (TACTICAL agent / DIRECT close)
- `lib/actions/thesis-edit.ts` — add / edit / delete / fire-mode write paths
- `components/agent/sheets/ThesisTriggersSection.tsx` — the trigger UI
