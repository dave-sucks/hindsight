# Levels as triggers — the build plan

> **Parent spec:** `LEVELS_AS_TRIGGERS.md` (the diagnosis).
> **This file:** what we're actually building, decided with the principal
> 2026-08-24. Linear DAV-195, project "Levels Are Triggers".
> **Downstream:** DAV-209 / `WATCHLIST_STATES.md` depends on L5. Read
> "What the watchlist work needs from this" at the bottom.

---

## The model

A thesis holds soft opinion. A trigger says **if X happens, do Y** — buy,
sell, add, trim, or wake me up to reconsider. The agent acts when one fires.

There is no such thing as a stop, a target, or an entry price. There is a
**price level, a side, and an action**:

- "sell if it drops to $256" — price level, downside, EXIT
- "buy at $47" — price level, ENTER
- "$60 — probably take profit, maybe raise the target" — price level, upside, REVIEW

`Thesis.stopLoss` / `targetPrice` / `entryPrice` are the pre-trigger app still
sitting in the database. Every bug in this area is the app trying to keep two
stories straight.

---

## The eight things, and what happens to each

| # | Thing | Verdict |
|---|---|---|
| 1 | `Thesis.triggers` | **The system.** Everything else becomes a read of it |
| 2 | `Thesis.stopLoss` / `targetPrice` / `entryPrice` | **Computed cache.** One function owns them; nothing else may write them; a write that leaves them disagreeing with the triggers is refused |
| 3 | `Position.stopLoss` / `targetPrice` | **Dropped.** Written in 3 places, read by one line of the digest email. The price monitor stopped reading them when exits moved to triggers |
| 4 | `Thesis.nextReviewAt` + `horizon-policy.ts` | **Both die as authored things.** A review date is a trigger: *review every N days*, counted from the last actual review. Cascades like everything else. `nextReviewAt` survives only as a computed display number |
| 5 | `Thesis.maxHoldDays` | **Dropped, column and all.** It minted one "review after N days" trigger at birth and was never read again. If an analyst wants that, it authors the trigger |
| 6 | `winner-signal.ts` / RUNNING_WINNER | **Deleted, not converted.** The account already carries *review if up 10% from entry*, which fires first in every realistic case. Replaced by putting the gain number on the roster row so the agent can see movement itself |
| 7 | `ladder-health.ts` / UNPROTECTED_GAIN | **Kept.** Not a level — a check *on* the triggers ("you're up 22%, your floor locks in 4%"). Different job. Render it visually distinct |
| 8 | `Thesis.revalidationTriggers` | **Dropped.** The first attempt at triggers, from before the real one. Zero readers outside generated Prisma |

### On the calculated flags

The *purpose* was right: a stock up 200% on day 2 of a 30-day review cycle must
not be invisible. The *implementation* was a hardcoded morning calculation per
scenario. That's now covered by two things that already exist:

- **Account-level triggers** — "if anything is up X%, flag it" is one rule at
  the account, inherited by every thesis. This is the general answer, and it
  replaces the per-scenario flags.
- **The roster row the agent reads** already carries the live price next to the
  plan numbers. Adding gain % and 5-day move makes "something crazy happened
  here" visible without any flag at all.

The agent is supposed to decide what's interesting. It needs good numbers in
front of it, not a growing list of pre-computed opinions.

---

## Price Targets — how it keeps working

This is a real product surface (the card, the chart lines, the roster row) and
it does not lose anything. It stops reading columns and starts reading triggers.

### The canonical levels

Derived from the **resolved** trigger list (account → analyst → thesis, most
specific wins). Shown for LONG; inverted for SHORT.

| Card slot | Read from | Notes |
|---|---|---|
| **Entry** | the `ENTER` trigger's price | While WATCHING this is the plan. Once HOLDING it's what we actually paid (position avg cost) — a fact, not a plan |
| **Floor** | `EXIT` + price-below | The sell-at that protects. This is the one the protective ratchet guards |
| **Target** | `EXIT` or `REVIEW` + price-above | EXIT = sell here. REVIEW = reconsider here (raise the target, trim, or hold) |

**Why exactly one per slot is guaranteed:** the trigger system already keeps
one trigger per (condition-shape, action) pair, and ENTER collapses
above/below into a single pair. After resolution there is at most one Entry,
one Floor, one Target-EXIT and one Target-REVIEW. If both target kinds exist,
the card's Target slot shows the further one (the destination) and the chart
draws both.

Levels beyond the canonical set — a warning REVIEW below the floor, a second
trim level — draw as extra chart lines and don't take a card slot.

### The chart

Draws **every** price-level trigger as a line labelled with what it does.
That's strictly better than today, which draws three numbers, two of which
currently fire nothing.

### Editing

A set/edit control on the card (and on the stock chart) writes the trigger, not
a column. This is a new entry point onto the write path the trigger popover
already uses — `applyTriggerValueEdit` for changing one, `applyTriggerAdd` for
minting one that doesn't exist yet. No new mechanism.

### Why the columns stay as a cache

~15 readers — digest email, prompts, roster rows, trade page, chart,
plan-sanity, ladder-health. Making each of them resolve the full cascade means
two extra queries in places that today read one number. So the columns stay,
with a hard invariant: **one function computes them, nothing else writes them,
and a write that leaves them disagreeing with the triggers is refused.** That
makes them a cache rather than a second source of truth. Deleting them
entirely is a mechanical follow-up if we want it later.

---

## Tickets, in order

| # | Ticket | What | Rough delta |
|---|---|---|---|
| **L1** | Level ⇄ trigger core | One pure module: resolved triggers → {entry, floor, target}, and the inverse (set a level → the trigger that expresses it). Tests. No callers yet | +250 |
| **L2** | Price Targets reads triggers | Card, chart lines, roster row, and the set/edit control. The visible product win; independent of the write-path work | +150 / −80 |
| **L3** | Derive-on-write | `update_thesis` / `record_thesis` / `place_trade` / `manage_position` stop writing level columns. A level change writes the trigger and recomputes the cache in the same transaction. Layer-1 assertion refuses a disagreeing write | +200 / −250 |
| **L4** | Floors and targets actually fire | Canonical floor is EXIT, canonical target is REVIEW. Also: multi-day price-move triggers (5D/30D) currently never fire on the cron because it doesn't fetch candles — same decorative-trigger bug, fixed here | +120 |
| **L5** | DEMOTE | New action, chosen at fire time from the thesis's state. A floor or target hit on something we don't own can't be a sell — it means the plan broke, or the move happened without us. Both clear the priced plan and keep watching. **DAV-209 depends on this** | +150 |
| **L6** | ⛔ **BACKFILL — STOP, needs the principal** | Mint triggers from the stop/target numbers already on live positions. This arms floors that are inert today and changes behaviour on the next 5-minute tick. The exact list gets approved before it runs | — |
| **L7** | Reviews become a cadence trigger | Delete `REVIEW_DATE_HIT`, the `next_review_at` argument, both auto-bump blocks in `update_thesis`, and `horizon-policy`'s cadence math (becomes four numbers on the account). `nextReviewAt` becomes cache | +150 / −350 |
| **L8** | Delete the duplicates | RUNNING_WINNER + `winner-signal.ts` + its tests; the `maxHoldDays`, `Position.stopLoss`/`targetPrice`, and `revalidationTriggers` columns; `scripts/dedupe-review-date-hit-triggers.ts`. Add gain % and 5-day move to the roster row | +60 / −600 |

**Order:** L1 → (L2 ∥ L3) → L4 → L5 → **L6 stop** → L7 → L8.

L4 before L6 because the backfill is what arms these on existing rows — the
firing code has to exist first. L8 last because RUNNING_WINNER can't be deleted
until targets actually fire.

Net across the whole project: roughly **−700 lines**.

---

## Rules that don't move

- **A trigger is a standing order** (ruling 2026-08-16). It fires every day its
  condition holds; a decline means "did nothing." Agents may tighten a
  protective level, never loosen or remove one. No agent-side auto-retuning.
- **Sale labelling** keys off the condition kind (`protectiveExitCloseReason`).
  New canonical levels must preserve the mapping or the cooldown exemption
  misfires.
- **`update_thesis.triggers` replaces the whole list.** A cache recomputed from
  a replaced list must not lose a level the agent didn't resend — pairs with
  `dropRedundantInherited`.
- **Don't rebuild entry direction (buy-the-dip vs buy-confirmation) as a
  setting.** Removed 2026-08-16, see `ENTRY_TRIGGER_SEMANTICS.md`. It's an
  account/analyst-level ENTER trigger.
- **Correction to the parent spec:** it lists `Position.stopLoss`/`targetPrice`
  under "Don't break — read by the price monitor." That is out of date. The
  price monitor only tracks the running high-water mark now; those columns are
  read by one line of the digest email. They're being dropped.

---

## What the watchlist work needs from this (DAV-209)

- **DEMOTE is real (L5)** — an action meaning "clear the priced plan, keep
  watching." Demotion is exactly that: the ENTER and EXIT triggers go, the
  cached columns recompute to null.
- **"Active watch" is derived, not a field.** An item is actively watched iff
  it carries an ENTER trigger with a price. Don't add a status column for it.
- **A large soft-watch pool is safe.** Review cadence is a trigger whose action
  is REVIEW, and REVIEW triggers never spawn a tactical run — they log and the
  next daily run picks them up in batch. That is what makes the May 2026
  tactical-run explosion structurally impossible rather than policy-prevented,
  and it cannot be relaxed.
- **Never write a level column.** Write the trigger; the column recomputes.
