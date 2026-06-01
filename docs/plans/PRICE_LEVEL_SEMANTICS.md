# Price Level Semantics — fixing the targetPrice/ENTER-trigger overload

> **What this is:** the actual fix for the long-tracked `targetPrice` overload (GAPS P1-3, formerly P1-23). Deferred during CONVICTION_EXPRESSION v4; principal re-raised it after merge.
>
> **Status:** SHIPPED 2026-05-31. Single PR, ~30-minute change.
>
> **Closes:** `docs/GAPS.md` P1-3.

---

## TL;DR

**The bug was one line of code, not a schema problem.**

```ts
// lib/agent/triggers/defaults.ts:295-310  -- BEFORE
function watchingEntryTrigger(thesis, direction, cooldownDays) {
  if (thesis.targetPrice == null) return null;   // ← reads wrong field
  if (direction === "LONG") {
    return {
      predicate: { kind: "PRICE_ABOVE", level: thesis.targetPrice },  // ← wrong
      action: "ENTER",
      ...
    };
  }
}
```

The default ENTER trigger on WATCHING theses read `targetPrice` (the take-profit level). When the thesis later went ACTIVE, the SAME `targetPrice` was the take-profit. So the ENTER trigger would fire at the same level the EXIT trigger would fire — buying at the level you'd sell at. Production evidence: MDB 2026-05-25, default was `PRICE_ABOVE($385) → ENTER` where $385 was the take-profit.

The schema was always correct: `entryPrice` and `targetPrice` are separate columns with separate meanings. The bug was the trigger code wiring the wrong column to the ENTER action.

**The fix:**

```ts
// lib/agent/triggers/defaults.ts:295-310  -- AFTER
function watchingEntryTrigger(thesis, direction, cooldownDays) {
  if (thesis.entryPrice == null) return null;   // ← reads correct field
  if (direction === "LONG") {
    return {
      predicate: { kind: "PRICE_ABOVE", level: thesis.entryPrice },   // ← correct
      ...
    };
  }
}
```

Plus:
- Writer prompt updated to teach `entry_price = where you'd buy in` (was ambiguously "current quote from the research").
- Old "CHOOSING THE ENTER TRIGGER" warning block simplified — its main job was steering writers away from the broken default; now the default is correct so the warning is mostly obsolete.
- `PriceTargetsBlock` gauge updated to consistently show `Stop · Entry · Current · Target` across every status (was `Stop · Entry · Target` with no live current).

**No schema changes. No migration. No new columns.**

---

## Three consistent fields, consistent meaning everywhere

| Field | Single meaning across all statuses |
|---|---|
| `entryPrice` | Where you'd buy in (WATCHING) / where you bought (ACTIVE — set by `place_trade` fill). The default ENTER trigger fires when price crosses this level. |
| `targetPrice` | Where you'd take profit. Same field, same meaning, whether watching or holding. Always "the upside goal." |
| `stopLoss` | Where the thesis breaks. WATCHING fires REVIEW ("setup broken — abandon the watch"); ACTIVE fires EXIT ("stop-loss order"). Same level; different actions per state — handled by the trigger family, not the field name. |

`entryPrice` is direction-neutral by design:
- LONG: `PRICE_ABOVE(entryPrice) → ENTER` (breakout up)
- SHORT: `PRICE_BELOW(entryPrice) → ENTER` (breakdown down)

The trigger predicate's `kind` varies (ABOVE / BELOW); the field stays the same.

UI gauge always shows: `Stop $X — Entry $Y — Current $Z — Target $W`. Same labels, same fields, every status. No status-conditional logic.

---

## What we considered + rejected

### Option A (rejected): split `targetPrice` into two columns

Original GAPS P1-3 + GAPS_LEGACY P1-23 proposal: split `targetPrice` → `breakoutPrice` (WATCHING entry-trigger level) + `takeProfitPrice` (ACTIVE take-profit). Migration, backfill, ~1.5 days of work touching every consumer (Zod schemas, default triggers, place_trade, UI renderers, type definitions across multiple files).

A full plan was drafted (this doc's previous version, ~440 lines). The plan was correct but **over-engineered.** The bug never required a schema change — it required fixing one function that read the wrong column. The schema already had a perfectly-named `entryPrice` column for the entry level; the trigger code just wasn't using it.

### Option B (rejected): keep the warning prompt + writer-as-shield

The pre-fix mitigation was a long warning block in `run-thesis-writer.ts:334-374` ("CHOOSING THE ENTER TRIGGER — match the SETUP INTENT, not the default target-price level"). It worked — 0/8 live theses hit the broken default in the 2026-05-26 audit. But:

- Prompt-layer enforcement of a schema invariant violates the three-layer principle (`docs/PRINCIPLES.md`)
- New code paths (legacy seeds, future bulk imports, accidental fallback) get no protection
- The principal raised it again immediately after the conviction merge, indicating the workaround wasn't durable

### Option C (chosen): fix the one-line bug

The actual root cause: `watchingEntryTrigger` should have been reading `entryPrice` from day one. The change is one identifier swap. No new fields, no migration, no breaking change to any reader. Existing theses have their triggers already baked in (default triggers are attached at thesis-creation time); only newly-minted theses get the corrected default.

---

## Forward-compat note

The fix only affects NEW WATCHING theses (those created after this lands). Existing theses keep whatever triggers they already have, which means:

- If an existing WATCHING thesis had the broken `PRICE_ABOVE(targetPrice) → ENTER` baked in, it stays. The next time the agent reviews and updates triggers (via `update_thesis` patching `triggers[]`), the agent's fresh logic decides what to write — and the prompt now teaches the correct pattern.
- 0/8 live theses on the audit had the broken default (writer was overriding). So in practice no production rows need cleanup.
- A backfill script COULD rewrite the broken default on legacy rows, but the cost/benefit isn't there. Let the next review cycle clean it up naturally.

---

## Changed files

| File | Change |
|---|---|
| `lib/agent/triggers/defaults.ts` | `watchingEntryTrigger` reads `entryPrice` instead of `targetPrice`. Comment block updated to flag the historical bug. The `catalystSoon` comment that flagged "PRICE_ABOVE(target) as ENTER is structurally wrong" simplified — the default is no longer broken. |
| `lib/agent/run-thesis-writer.ts` | Writer prompt step 3: `entry_price` description updated from "current quote from the research" to "WHERE YOU'D BUY IN" — explicit that this drives the default ENTER trigger. Long warning block ("CHOOSING THE ENTER TRIGGER") simplified — most of it was workaround for the now-fixed bug. |
| `components/agent/sheets/ThesisSheet.tsx` | `PriceTargetsBlock` accepts `current` + `direction` props. Gauge consistently shows 4 markers + 4 labels (`Stop · Entry · Current · Target`). Call site passes `quote?.currentPrice` + thesis direction. |
| `docs/plans/PRICE_LEVEL_SEMANTICS.md` | This doc rewritten to reflect the minimal fix (was a 440-line schema-split plan). |
| `docs/GAPS.md` | P1-3 entry updated — DONE. |

---

## What stayed the same

- Schema (`Thesis.entryPrice`, `Thesis.targetPrice`, `Thesis.stopLoss`) — unchanged.
- All other tool gates (record_thesis, update_thesis, place_trade) — unchanged.
- Resolver (`lib/agent/resolved-thesis.ts`) — unchanged.
- All exit-trigger families (HELD CATALYST / TRADE / TARGET / COMPOUNDER) — unchanged.
- All status-related logic — unchanged.

---

## See also

- [`docs/GAPS.md`](../GAPS.md) — P1-3 (now DONE)
- [`docs/GAPS_LEGACY.md`](../GAPS_LEGACY.md) — P1-23 (the original entry with production evidence)
- [`docs/plans/CONVICTION_EXPRESSION.md`](./CONVICTION_EXPRESSION.md) — §13, where this was deferred
- [`docs/PRINCIPLES.md`](../PRINCIPLES.md) — three-layer principle. This is a Layer-1 (tool code) fix for what was previously a Layer-3 (writer prompt) workaround.
- [`docs/THESIS_ARCHITECTURE.md`](../THESIS_ARCHITECTURE.md) §8 (Fields) — update if any new info needs to land in the live reference.

---

## Postmortem note

Earlier session draft of this plan proposed a full schema split with migration, backfill, type updates across ~15 files, ~1.5 days of work. After walking through the actual bug with the principal, the answer turned out to be one identifier swap. The schema was correct; the trigger code was wrong. Lesson: when a field is "overloaded," check whether the right field already exists and the consumer is just reading the wrong one — that's cheaper than splitting columns.
