# Price Level Semantics — fixing the targetPrice / stopLoss state overload

> **What this is:** plan to fix the long-tracked `targetPrice` overload (P1-3, formerly P1-23) by splitting the single column into two state-specific fields, and to clarify the `stopLoss` semantic with status-aware labeling. The overload was deferred during CONVICTION_EXPRESSION v4 and the user re-raised it explicitly after merge.
>
> **Status:** design ready, not yet implemented. Single PR shippable.
>
> **Closes:** `docs/GAPS.md` P1-3 + the principal's recurring concern raised during the v4 conviction work.
>
> **Owner:** principal. **Audience:** the session implementing this.

---

## TL;DR

**The gap.** One column (`targetPrice`) means two opposite things based on `status`:

| Status | What `targetPrice` is | What action it fires |
|---|---|---|
| WATCHING / PROMOTED | "Buy-in breakout level" — the level price has to cross to enter | `PRICE_ABOVE(targetPrice) → ENTER` |
| ACTIVE | "Take-profit goal" — the level we'd sell at | `PRICE_ABOVE(targetPrice) → EXIT` (or REVIEW) |

Same field. Opposite actions. The code's own comment in `lib/agent/triggers/defaults.ts:338-359` flags it: *"PRICE_ABOVE(target) as ENTER is structurally wrong — target is where you'd take profit AFTER the catalyst plays out, not where you'd enter."*

`stopLoss` has a softer version of the same problem:

| Status | What `stopLoss` is | What action it fires |
|---|---|---|
| WATCHING | "Support level / lose-interest level" | `PRICE_BELOW(stopLoss) → REVIEW` ("better entry, or thesis weakening?") |
| ACTIVE | "Hard stop" — the actual stop-loss order level | `PRICE_BELOW(stopLoss) → EXIT` |

The action diverges (REVIEW vs EXIT) but the level's conceptual role is consistent ("downside trip wire"). Less broken than `targetPrice`, but still worth labeling clearly per status.

**The fix.** Split + relabel:

| Change | Field | Notes |
|---|---|---|
| **SPLIT** `targetPrice` | → `breakoutPrice` | WATCHING/PROMOTED — the level the writer wants to enter ABOVE |
| | → `takeProfitPrice` | ACTIVE — the upside goal we'd sell at |
| **KEEP** `entryPrice` | (unchanged) | Current-price reference at the moment the thesis was written; used in shape validation |
| **KEEP** `stopLoss` | (unchanged) | The level itself stays single-field; only labels + prompts change per status |
| **DROP** `targetPrice` | (after soak period, eventually) | Schema deprecation in a follow-up |

Plus prompt + UI updates so labels read correctly per status (WATCHING: "Buy if breaks $X" + "Stop watching if drops to $Y"; ACTIVE: "Take profit at $X" + "Stop loss $Y").

**Effort:** ~1.5 days. Single PR end-to-end. Backwards-compat during migration period (both old + new fields exist; code reads new first, falls back to `targetPrice`).

---

## 1. Why this matters

**Production evidence from GAPS_LEGACY P1-23 (2026-05-25):** MDB thesis on the daily run — agent left triggers untouched on refresh, default was `PRICE_ABOVE($385) → ENTER` where $385 was the writer's take-profit target. Result: a trigger that would literally buy at the take-profit level.

**Today's mitigation (per GAPS.md 2026-05-26 audit):** The V2 thesis-writer overrides every default trigger explicitly — 0 of 8 live theses hit the broken default in production. The writer prompt at `lib/agent/run-thesis-writer.ts:334-374` ("CHOOSING THE ENTER TRIGGER — match the SETUP INTENT, not the default target-price level") is doing the load-bearing work.

**Why fix it anyway:**
1. Writer-as-shield is prompt-layer mitigation of a tool-layer bug. If a thesis ever lands without writer involvement (legacy rows, future code paths, accidental schema-default fallback), the bug bites.
2. The UI cannot label `targetPrice` correctly without conditional logic — every renderer has to check `status` and pick a label.
3. Sheet readers (human or agent) have to mentally re-interpret the same field by status. This violates the same "structured field that means what it says" principle the conviction work was built on.
4. New consumers (the resolver in `lib/agent/resolved-thesis.ts`, the actionability classifier, future trade-plan rendering) keep inheriting the overload. Each new feature adds another place the ambiguity lives.

---

## 2. Today's state — the full picture

### Where `targetPrice` is read

```
lib/agent/triggers/defaults.ts:
  295-310   watchingEntryTrigger  →  PRICE_ABOVE(targetPrice) ENTER   (WATCHING)
  338-359   catalystDefaults      →  partial fix (EARNINGS_BEAT instead) for CATALYST + <7d
  ...       activeExitTriggers    →  PRICE_ABOVE(targetPrice) EXIT    (ACTIVE)

lib/agent/tools/place-trade.ts:
  on success → writes targetPrice on the (now ACTIVE) thesis row

lib/agent/tools/record-thesis.ts:
  Zod arg target_price → persisted to Thesis.targetPrice

lib/agent/tools/update-thesis.ts:
  Zod arg target_price → patched on existing thesis

lib/agent/tools/get-theses.ts:
  selected + returned to agent in every response

app/api/theses/[id]/triggers/route.ts:
  selected + returned to UI

lib/agent/thesis-sheet-state.ts:
  inline in the pre-fetched sheet-state path

lib/agent/resolved-thesis.ts:
  NOT directly — reads entryPrice + parsedTriggers, not targetPrice as a level

components/agent/sheets/ThesisSheet.tsx:
  PriceTargetsBlock renders entry/target/stop gauge
  TradeStructureBlock omits target (lives in the gauge above)

components/domain/ThesisCard / TradeCard:
  show target as a price label
```

### Where `stopLoss` is read

Same producers, similar consumers. Used by:
- `defaults.ts:watchingSupportReview` → `PRICE_BELOW(stopLoss) → REVIEW` (WATCHING + LONG)
- `defaults.ts:heldExitTrigger` → `PRICE_BELOW(stopLoss) → EXIT` (ACTIVE)
- Multiple horizon-specific exit-trigger families (`heldTradeDefaults`, `heldCatalystDefaults`, etc.) all reading the same level

### Today's writer prompt (the shield)

`lib/agent/run-thesis-writer.ts:334-374` walks the writer through "CHOOSING THE ENTER TRIGGER" with explicit advice not to default to `PRICE_ABOVE(targetPrice)`. The 2026-05-26 audit confirms it works — but it's prompt-layer enforcement of a schema-layer ambiguity. Per `docs/PRINCIPLES.md`, invariants belong in Layer-1 (tool gates) or Layer-2 (tool result shape), not Layer-3 (prompt).

---

## 3. The proposal — schema split + label clarification

### 3.1 Schema change

```prisma
model Thesis {
  // ── Existing — kept ────────────────────────────────────────────────
  entryPrice  Float?  // Current-price reference at write time. Used in
                      // shape validation (LONG: target > entry > stop).
  stopLoss    Float?  // Single field; semantic per status is documented
                      // in prompts + UI labels (see §3.3, §3.4).

  // ── Existing — DEPRECATED, dropped after soak ─────────────────────
  // targetPrice was overloaded — meant "buy-in breakout" on WATCHING
  // and "take-profit" on ACTIVE. Split into the two fields below.
  // During the migration window, this column still exists and is
  // populated by legacy code paths; the resolver + UI read the new
  // fields first and fall back to targetPrice when null.
  targetPrice Float?  // @deprecated — read breakoutPrice or takeProfitPrice

  // ── NEW — the split ───────────────────────────────────────────────
  /// The breakout level. Set on LONG/SHORT WATCHING and PROMOTED.
  /// The default ENTER trigger fires when price crosses this level
  /// (`PRICE_ABOVE` for LONG, `PRICE_BELOW` for SHORT). Null when the
  /// writer wants "buy at market" semantics — no ENTER trigger required,
  /// daily-run reads entryPrice ≈ current as the buy-now signal.
  breakoutPrice    Float?

  /// The take-profit goal. Set when the thesis goes ACTIVE (via
  /// `place_trade`, which writes it from the trade arguments) or at
  /// write time if the writer wants to capture upside intent on a
  /// WATCHING row. Drives the ACTIVE-state exit triggers (PRICE_ABOVE
  /// for LONG, PRICE_BELOW for SHORT, action=EXIT or REVIEW per
  /// horizon).
  takeProfitPrice  Float?
}
```

Both new fields nullable. Coexistence with `targetPrice` is intentional during the migration window.

### 3.2 Layer-1 changes

**`record_thesis` Zod schema:**
```ts
// Add new fields. Keep target_price as a deprecated alias.
breakout_price:   z.number().optional().describe("Level above which we'd enter (WATCHING). Replaces target_price for the entry-trigger role."),
take_profit_price: z.number().optional().describe("Take-profit goal (used on ACTIVE). Replaces target_price for the exit-trigger role."),
target_price:     z.number().optional().describe("[DEPRECATED] Use breakout_price (WATCHING) or take_profit_price (ACTIVE). For now, target_price is auto-mapped: WATCHING/PROMOTED → breakout_price; ACTIVE → take_profit_price."),
```

In `execute()`, auto-map deprecated `target_price` based on derived status:
```ts
const effectiveBreakout = args.breakout_price ?? (isWatching ? args.target_price : null);
const effectiveTakeProfit = args.take_profit_price ?? (isActive ? args.target_price : null);
```

**`update_thesis` Zod schema:** same three fields (all optional patches), same auto-mapping logic. Add a gate: if `target_price` is patched but the thesis is ACTIVE and the writer ALSO patched `breakout_price`, reject — clarify which level you meant.

**Shape gate (`lib/agent/thesis-shape.ts`):** update LONG check from `targetPrice > entryPrice > stopLoss` to:
- WATCHING: `breakoutPrice > entryPrice > stopLoss` (LONG breakout above current, stop below)
- ACTIVE: `takeProfitPrice > entryPrice > stopLoss` (LONG take-profit above entry, stop below)

When the row has `targetPrice` but neither new field, fall back to the legacy check.

### 3.3 Trigger defaults rewrite

**`lib/agent/triggers/defaults.ts:watchingEntryTrigger`** — read `breakoutPrice` instead of `targetPrice`:

```ts
function watchingEntryTrigger(thesis, direction, cooldownDays) {
  const level = thesis.breakoutPrice ?? thesis.targetPrice;  // fallback during migration
  if (level == null) return null;
  if (direction === "LONG") {
    return {
      id: createId(),
      predicate: { kind: "PRICE_ABOVE", level },
      action: "ENTER",
      rationale: `Entry trigger — breakout above $${level}.`,
      cooldownDays,
    };
  }
  // SHORT mirror...
}
```

**Active-state exit triggers** — read `takeProfitPrice`:

```ts
function activeTakeProfitTrigger(thesis, direction) {
  const level = thesis.takeProfitPrice ?? thesis.targetPrice;  // fallback
  if (level == null) return null;
  if (direction === "LONG") {
    return {
      id: createId(),
      predicate: { kind: "PRICE_ABOVE", level },
      action: "REVIEW",   // or EXIT — per horizon policy
      rationale: `Take-profit level reached at $${level}. Review for exit.`,
      cooldownDays: 0,
    };
  }
  // ...
}
```

Each default-trigger family that today reads `targetPrice` becomes either breakout (WATCHING) or take-profit (ACTIVE) per its semantic. Code comment at line 338-359 (the one that already flagged the structural bug) can be deleted.

### 3.4 stopLoss — label clarification (no schema change)

Keep `stopLoss` as a single column. Its level meaning is consistent across states ("downside trip wire") but the ACTION differs:

| Status | Trigger | Action | UI label |
|---|---|---|---|
| WATCHING | `PRICE_BELOW(stopLoss)` | REVIEW | "Stop watching if drops to $Y" |
| ACTIVE | `PRICE_BELOW(stopLoss)` | EXIT | "Stop loss $Y" |

This is a prompt + UI fix, not a schema fix:
- Writer prompt teaches: "stopLoss is the level where a WATCHING setup is broken / an ACTIVE position is exited. Same level; different actions per state."
- Sheet renderer + ThesisCard: label per status as in the table above.

### 3.5 `place_trade` — update both fields

When `place_trade` flips WATCHING → ACTIVE, it currently writes `entryPrice / targetPrice / stopLoss` from the trade arguments. Update to write `entryPrice / takeProfitPrice / stopLoss` (the new take-profit field on the now-ACTIVE row). `breakoutPrice` is left null on ACTIVE rows by convention (it's a WATCHING-only field).

```ts
await tx.thesis.update({
  data: {
    status: "ACTIVE",
    entryPrice: args.entry_price,
    takeProfitPrice: args.take_profit_price ?? args.target_price,  // accept either
    targetPrice: args.take_profit_price ?? args.target_price,       // legacy write — drop in PR 2
    stopLoss: args.stop_loss,
    // breakoutPrice intentionally NOT cleared — preserves the writer's
    // original breakout intent for audit purposes.
  },
});
```

### 3.6 Resolver (`lib/agent/resolved-thesis.ts`)

The actionability decision tree currently checks "no ENTER trigger AND entryPrice within ±1% of current → ENTER_NOW." This stays the same — the resolver reads `parsedTriggers`, not `targetPrice` directly.

But the `triggerDetail` string surfaced to the UI ("PRICE_ABOVE 92.5 (cur 90.30, -2.4%)") should ideally read the breakout level. After this change the trigger predicate's `level` field IS the breakout (because `watchingEntryTrigger` now reads `breakoutPrice`), so the formatter already says the right thing.

No resolver code changes needed beyond the field-name updates in the tool selects.

### 3.7 UI changes

**ThesisSheet — PriceTargetsBlock + the gauge:**

Today the gauge shows `entry` / `target` / `stop` with a current-price marker. Update labels per status:

| Status | Gauge labels |
|---|---|
| WATCHING / PROMOTED | "Stop watching $Y" — "Entry ref $E" — "Breakout buy $X" |
| ACTIVE | "Stop loss $Y" — "Entry $E" — "Take profit $X" |
| CLOSED | "Stop loss $Y" — "Entry $E" — "Take profit $X" (same as ACTIVE) |

The underlying gauge component takes three numbers — only the labels change.

**ThesisCard (carousel/list view):**

Show one summary line per status:
- WATCHING: `Buy if breaks $X · Stop watch $Y`
- ACTIVE: `Target $X · Stop $Y` (+ live P&L)

**Read-theses table:**

Two columns instead of one — `Buy at` (breakout for WATCHING, blank for ACTIVE) and `Target` (take-profit for ACTIVE, blank for WATCHING). Or keep one column with dynamic header per row. Open question — see §11.

### 3.8 Writer system prompt updates

`lib/agent/run-thesis-writer.ts` step 3 (the "Make the decision" block) currently teaches:
- `entry_price`: current quote from the research
- `target_price`: real chart level (breakout / consolidation high / analyst-target convergence) — REQUIRED for LONG/SHORT
- `stop_loss`: real chart level — REQUIRED for LONG/SHORT

Replace `target_price` with two fields:
- `breakout_price`: the chart level above which the setup confirms entry. REQUIRED on WATCHING mints. For "buy now" theses (per the v4 buy-now pattern), leave null and rely on no-ENTER-trigger + entry_price ≈ current.
- `take_profit_price`: the upside goal. Optional on WATCHING mints (you can pre-write the take-profit intent); REQUIRED when promoting to ACTIVE via place_trade.

Update the "CHOOSING THE ENTER TRIGGER" block (lines 334-374) to drop the "don't default to PRICE_ABOVE(targetPrice)" warning — the default now reads `breakoutPrice` which is exactly that level by intent.

### 3.9 Daily-run + tactical prompt updates

`lib/agent/system-prompt.ts` (V2 daily-run): minimal changes — the prompt reads `needsAction` and `resolved.actionability`, not raw `targetPrice`. Any inline mentions of "target_price" should be updated to clarify state-per-field.

Tactical prompt (`lib/agent/system-prompts/intraday-tactical.ts`): same — minimal.

---

## 4. Migration

### 4.1 Schema migration

```sql
-- Conviction Expression v4 — price level split (P1-3 / formerly P1-23)
-- See docs/plans/PRICE_LEVEL_SEMANTICS.md

ALTER TABLE "Thesis" ADD COLUMN IF NOT EXISTS "breakoutPrice"   DOUBLE PRECISION;
ALTER TABLE "Thesis" ADD COLUMN IF NOT EXISTS "takeProfitPrice" DOUBLE PRECISION;
```

Two nullable columns. `targetPrice` stays for now.

### 4.2 Data backfill

```sql
-- Backfill the two new fields from existing targetPrice values.
-- WATCHING + PROMOTED rows → breakoutPrice (the entry intent)
-- ACTIVE + CLOSED rows → takeProfitPrice (the exit intent)
-- INVALIDATED + ARCHIVED rows can go either way; defaulting to take-profit
-- since most invalidated rows died in ACTIVE state.

UPDATE "Thesis"
SET "breakoutPrice" = "targetPrice"
WHERE "targetPrice" IS NOT NULL
  AND status IN ('WATCHING', 'PROMOTED');

UPDATE "Thesis"
SET "takeProfitPrice" = "targetPrice"
WHERE "targetPrice" IS NOT NULL
  AND status IN ('ACTIVE', 'CLOSED', 'INVALIDATED', 'ARCHIVED');
```

### 4.3 `targetPrice` deprecation timeline

- **This PR:** add columns, backfill, code reads new fields first with `targetPrice` fallback. Writer + place_trade write both old + new (write-through).
- **Soak (~2 weeks):** verify no rows land with mismatched values (`targetPrice != breakoutPrice` on WATCHING, or `targetPrice != takeProfitPrice` on ACTIVE). Verify the resolver, gauge, card renderers all read the new fields correctly.
- **Cleanup PR (separate):** drop the `targetPrice` write-throughs, drop the column from the schema, drop the fallback reads. Single migration: `ALTER TABLE "Thesis" DROP COLUMN "targetPrice"`.

---

## 5. Effort estimate

**Single PR, ~1.5 days end-to-end.**

| Day | Work |
|---|---|
| 0.5 | Schema migration (2 nullable columns) + backfill SQL · Prisma generate · type updates in tool result shapes (TriggersResponse, thesis-sheet-state) |
| 0.5 | `record_thesis` + `update_thesis` Zod schema updates + auto-mapping logic + shape gate update · `place_trade` writes both fields · default-trigger families read new fields with fallback |
| 0.25 | Writer system prompt rewrite (step 3 + the CHOOSING THE ENTER TRIGGER block) · daily-run prompt sweep for `target_price` references |
| 0.25 | UI: ThesisSheet PriceTargetsBlock labels-per-status · ThesisCard summary line per status · read-theses table column rename or split |
| 0.25 | Tests: backfill round-trip, default trigger family with breakoutPrice, place_trade writes takeProfitPrice, sheet renderer per status |

No new tools. No new triggers. No new lifecycle states.

---

## 6. What's NOT changing

- **`entryPrice`** stays — it's the current-price reference, not in the overload.
- **`stopLoss`** stays as a single column — semantics differ by action (REVIEW vs EXIT) but the level's role is consistent. Status-aware labels in UI + prompts handle the disambiguation.
- **Existing trigger schema + predicates** — `PRICE_ABOVE` / `PRICE_BELOW` predicates still take a `level` number. Only what's WRITTEN to `level` changes (breakout vs take-profit per status).
- **`triggers` JSONB shape** — unchanged. Cron evaluator + resolver + tactical-run all keep reading the same predicate shape.
- **The conviction v4 fields** — `conviction`, `convictionRationale`, `variantView`, `targetSizePct`. Untouched.
- **Bull/base/bear scenario targets** — a separate enhancement. This PR addresses the overload only; multi-scenario targets (a `targetPrice: { bull, base, bear }` shape) is a follow-up if needed.

---

## 7. Counterpoints I considered

**Counterpoint 1: just keep `targetPrice` and document the dual meaning better.** That's what the writer prompt does today (the "CHOOSING THE ENTER TRIGGER" block). It works — 0/8 production theses hit the broken default. But it's prompt-layer enforcement of a schema invariant. The first time a non-writer code path mints a thesis (legacy, future, accidental fallback), the bug bites. And every new reader (the v4 resolver, the actionability classifier, the future trade-plan view) inherits the ambiguity. The schema split is the durable fix per the three-layer principle.

**Counterpoint 2: rename `targetPrice` to `entryPrice` for WATCHING and add a separate `exitPrice`.** Considered. Rejected because `entryPrice` already exists as the current-price reference at write time, which is a different concept from "breakout entry level." Reusing the name would cause its own confusion.

**Counterpoint 3: collapse to a generic `levels: { entry, breakout, takeProfit, stop }` JSON.** Possible. Loses queryability (can't `WHERE breakoutPrice > 100` in SQL easily). The three top-level columns are cheap; the JSON wrapper isn't an upgrade.

**Counterpoint 4: split `stopLoss` too into `stopWatching` + `stopLoss`.** Considered. Rejected because the level itself plays the same role in both states (downside trip wire) — only the ACTION differs (REVIEW vs EXIT) and that comes from the default-trigger family, not the level. A WATCHING thesis that goes ACTIVE preserves the same stop level naturally; splitting would force the writer or `place_trade` to copy the value across, which is busywork without semantic gain.

---

## 8. Open questions for principal

1. **Field names.** `breakoutPrice` + `takeProfitPrice` is one option. Alternatives:
   - `entryAbovePrice` + `targetPrice` (rename only what fires ENTER; keep targetPrice meaning take-profit)
   - `entryTriggerPrice` + `takeProfitPrice` (matches the original GAPS_LEGACY P1-23 proposal verbatim)
   - `buyBreakoutPrice` + `sellTargetPrice` (most explicit, also most verbose)

   Current proposal: `breakoutPrice` + `takeProfitPrice`. Shorter, matches typical trading vocabulary.

2. **Read-theses table column shape.** Two columns (`Buy at` + `Target`, with blanks per status) or one dynamic column (renders `Buy at $X` for WATCHING, `Target $X` for ACTIVE)? Two columns is more searchable but adds visual weight. One dynamic is denser.

3. **Should we surface the writer's intended take-profit even on WATCHING?** A writer might want to mint a WATCHING thesis with both `breakoutPrice` (entry trigger) AND `takeProfitPrice` (intended take-profit if it triggers). Today the writer can only set one `targetPrice`. With both fields, this becomes possible — but does the UI render both on a WATCHING sheet? Current proposal: yes, show both when populated; the gauge can show entry/breakout/stop with takeProfit as a faded marker above.

4. **Migration aggressiveness.** Backfill is unambiguous for WATCHING/PROMOTED + ACTIVE/CLOSED (per status). For INVALIDATED/ARCHIVED rows (historical, mixed origins), we default to `takeProfitPrice` since most died in ACTIVE state. Alternative: leave both new fields null on terminal rows; nobody reads them. Current proposal: backfill anyway for consistency; harmless.

5. **Drop-`targetPrice` timing.** Two-week soak proposed. Tighter (one week) if no mismatches show up in production; looser (one month) if any oddities surface. Open.

---

## 9. See also

### Hindsight internal
- [`docs/GAPS.md`](../GAPS.md) **P1-3** — the long-tracked entry this closes
- [`docs/GAPS_LEGACY.md`](../GAPS_LEGACY.md) **P1-23** — the original full discussion with production evidence (MDB 2026-05-25) and the 2026-05-26 first-live-analyst audit
- [`docs/plans/CONVICTION_EXPRESSION.md`](./CONVICTION_EXPRESSION.md) §13 — where this was explicitly deferred
- [`docs/THESIS_ARCHITECTURE.md`](../THESIS_ARCHITECTURE.md) §8 (Fields) — where the new field semantics get documented after this lands
- [`docs/PRINCIPLES.md`](../PRINCIPLES.md) — three-layer principle. This is a Layer-1 (schema) fix for what's currently a Layer-3 (writer prompt) workaround.

### Code touchpoints
- `prisma/schema.prisma` — `Thesis` model
- `lib/agent/triggers/defaults.ts:295-310` (`watchingEntryTrigger`), :338-359 (`catalystDefaults` with the "structurally wrong" comment), the active-state exit-trigger families
- `lib/agent/tools/record-thesis.ts` — Zod arg + persistence
- `lib/agent/tools/update-thesis.ts` — Zod arg + patch + shape gate
- `lib/agent/tools/place-trade.ts` — writes both fields on auto-promote
- `lib/agent/tools/get-theses.ts` — select + return shape
- `app/api/theses/[id]/triggers/route.ts` — select + response
- `lib/agent/thesis-sheet-state.ts` — pre-fetched sheet state
- `lib/agent/resolved-thesis.ts` — no logic change; type updates
- `lib/agent/thesis-shape.ts` — shape gate update
- `lib/agent/run-thesis-writer.ts:334-374` — writer prompt step 3 + entry-trigger block
- `components/agent/sheets/ThesisSheet.tsx` — PriceTargetsBlock labels
- `components/agent/sheets/ThesisTriggersSection.tsx` — TriggersResponse type
- `components/domain/ThesisCard.tsx`, `TradeCard.tsx` — summary line per status
- `app/(root)/runs/[id]/...`, watchlist views, read-theses table — column rename or split
