/**
 * Protective-level ratchet — the one-way rule for safety lines on held
 * stocks, as code instead of prose.
 *
 * The 2026-08-16 standing ruling (docs/plans/FIX_ROADMAP.md → "Standing
 * ruling"): an analyst may RAISE/tighten a protective level; it may never
 * lower, widen, or delete one, and never downgrade one from firing
 * automatically (DIRECT) to asking an analyst first (TACTICAL). Lowering a
 * line is the principal's manual act — thesis sheet or reject dialog.
 *
 * Why this exists as a hard gate and not an instruction: on 2026-08-18 an
 * analyst that had raised MU's sell-if-below floor to $948 at 8:02 AM
 * lowered the same floor to $814 at 10:55 — below what we paid for the
 * stock — while two MU sell proposals from the $948 breach sat awaiting
 * approval. The analyst had been told the rule and broke it anyway
 * (DAV-185, run review 2026-08-18). Rules about what an agent may write
 * belong in the tool layer, not the prompt layer.
 *
 * What counts as protective here: an EXIT rung whose close reason resolves
 * to STOP (`protectiveExitCloseReason` in ./types) — the hard floors, the
 * trailing give-back rungs, the gain locks, the adverse daily-move exits.
 * Profit targets (TARGET-classified exits) and REVIEW rungs are not gated;
 * neither are judgment rungs (earnings, signals, composites).
 *
 * The comparison runs on the EFFECTIVE ladder — thesis rungs resolved over
 * the inherited analyst/account/default rungs — on both sides, so it catches
 * the sneaky version of lowering: removing a thesis override so a weaker
 * inherited value shows through.
 *
 * Pure module — no DB, no context. Run per trigger op by
 * lib/agent/triggers/ops.ts for agent edits only; the principal's edits
 * (the trigger popover, lib/actions/level-triggers.ts) deliberately do NOT
 * run this gate.
 */

import { triggerSlot } from "./condition/slot";
import { loosens, sentenceOf, shapeOf } from "./condition";
import { protectiveExitCloseReason } from "./types";
import type { Trigger } from "./types";
import type { When } from "@/lib/agent/triggers/condition";

export type RatchetViolation = {
  bucket: string;
  reason: "REMOVED" | "LOWERED" | "FIREMODE_DEMOTED";
  /** The protective rung that was in force before the update. */
  before: Trigger;
  /** The rung now occupying the bucket, when one survives. */
  after?: Trigger;
};

/**
 * The `before` side reads Thesis.triggers RAW from the DB (the tool casts,
 * it doesn't re-validate), and legacy rows can be malformed — that's why
 * parseTriggersResilient exists. A rung this gate can't classify must not
 * crash the gate (which would block every update on that thesis); it just
 * isn't protected by it.
 */
function isWellFormed(t: Trigger | null | undefined): t is Trigger {
  return (
    !!t &&
    typeof t === "object" &&
    typeof t.action === "string" &&
    shapeOf(t.predicate) != null
  );
}

/**
 * First-claim-wins bucket resolution, thesis rungs over inherited — the
 * same precedence resolveLadder applies, without the presentation fields.
 */
function effectiveByBucket(
  thesis: Trigger[],
  inherited: Trigger[],
): Map<string, Trigger> {
  const out = new Map<string, Trigger>();
  for (const t of [...thesis, ...inherited]) {
    if (!isWellFormed(t)) continue;
    const bucket = triggerSlot(t);
    if (!out.has(bucket)) out.set(bucket, t);
  }
  return out;
}

function isProtectiveStop(t: Trigger, direction: string | null): boolean {
  return (
    t.action === "EXIT" &&
    protectiveExitCloseReason(t.predicate, direction) === "STOP"
  );
}

/**
 * Does `next` protect LESS than `prev`? Same bucket ⇒ the same rule at a new
 * value (triggerSlot only merges different rules for a buy, which is never a
 * STOP). A floor moved away from the price, a wider give-back or drawdown,
 * waiting for the close, arming later or a wider range multiple each protect
 * less; the catalog says which (./condition/rules `loosens`).
 */
function weakens(prev: When, next: When): boolean {
  const a = shapeOf(prev);
  const b = shapeOf(next);
  return a != null && b != null && loosens(a, b);
}

/**
 * Every way the proposed trigger list weakens the protection that is
 * currently in force on a held stock. Empty array = the edit is legal.
 *
 * `before`/`after` are the THESIS-stored rungs before and after one op;
 * `inherited` is the resolved analyst/account/default ladder, identical on
 * both sides.
 */
export function protectiveRatchetViolations(args: {
  direction: string | null;
  before: Trigger[];
  after: Trigger[];
  inherited: Trigger[];
}): RatchetViolation[] {
  const beforeEff = effectiveByBucket(args.before, args.inherited);
  const afterEff = effectiveByBucket(args.after, args.inherited);
  const out: RatchetViolation[] = [];

  for (const [bucket, prev] of beforeEff) {
    if (!isProtectiveStop(prev, args.direction)) continue;
    const next = afterEff.get(bucket);
    if (!next) {
      out.push({ bucket, reason: "REMOVED", before: prev });
      continue;
    }
    if (weakens(prev.predicate, next.predicate)) {
      out.push({ bucket, reason: "LOWERED", before: prev, after: next });
      continue;
    }
    if (
      (prev.fireMode ?? "TACTICAL") === "DIRECT" &&
      (next.fireMode ?? "TACTICAL") !== "DIRECT"
    ) {
      out.push({ bucket, reason: "FIREMODE_DEMOTED", before: prev, after: next });
    }
  }
  return out;
}

/**
 * The one-way rule for a SCALAR stop number on a held stock (DAV-201).
 * Used by manage_position's stop-writing actions; update_thesis applies the
 * same rule inline to its stop_loss column (DAV-185). Weakening =
 * lowering the stop on a LONG, raising it on a SHORT, or clearing it.
 * Today the position's stop number is display/context only — nothing sells
 * off it — but the Levels work makes these numbers fire for real, and the
 * gate must exist before that lands or the MU 2026-08-18 violation returns
 * through the side door.
 */
export function stopMoveWeakensProtection(args: {
  direction: string | null;
  oldStop: number | null;
  newStop: number | null;
}): boolean {
  const { direction, oldStop, newStop } = args;
  if (oldStop == null) return false; // adding protection where none existed
  if (newStop == null) return true; // clearing the stop = deleting protection
  const isLong = direction !== "SHORT";
  return isLong ? newStop < oldStop : newStop > oldStop;
}

/** Plain-language name for a protective rung, for refusal messages: "Sell if below $65". */
export function describeProtectiveRung(t: Trigger): string {
  return sentenceOf(t);
}

/** One refusal line per violation, in product language. */
export function describeRatchetViolation(v: RatchetViolation): string {
  const rung = describeProtectiveRung(v.before);
  switch (v.reason) {
    case "REMOVED":
      return `"${rung}" — your new trigger list removes this protection entirely.`;
    case "LOWERED": {
      const to = v.after ? describeProtectiveRung(v.after) : "a weaker level";
      return `"${rung}" → "${to}" — that weakens the protection on a stock we own.`;
    }
    case "FIREMODE_DEMOTED":
      return `"${rung}" currently sells automatically when it fires; your edit changes it to ask for judgment first. That is a downgrade in protection.`;
  }
}
