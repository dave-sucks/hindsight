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
 * the inherited analyst/account/default rungs — on both sides. That keeps
 * two legal moves legal:
 *   - resending an inherited protective rung verbatim (dropRedundantInherited
 *     drops the copy; the inherited rung still covers the bucket), and
 *   - omitting inherited rungs entirely (the agent can't delete what isn't
 *     stored on the thesis).
 * And it catches the sneaky version of lowering: deleting a thesis override
 * so a weaker inherited value shows through.
 *
 * Pure module — no DB, no context. Wired into update_thesis; the principal's
 * UI write paths (lib/actions/thesis-edit.ts, lib/actions/level-triggers.ts)
 * deliberately do NOT run this gate.
 */

import { triggerBucket } from "./bucket";
import { protectiveExitCloseReason } from "./types";
import type { Trigger, TriggerPredicate } from "./types";

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
    !!t.predicate &&
    typeof t.predicate === "object" &&
    typeof t.predicate.kind === "string"
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
    const bucket = triggerBucket(t);
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
 * Does `next` protect LESS than `prev`? Same bucket ⇒ same predicate kind
 * (triggerBucket only collapses kinds for ENTER rungs, which are never
 * STOP-classified), so a kind mismatch is defensively treated as unchanged.
 *
 * Direction is implicit in the STOP classification: PRICE_BELOW is only a
 * STOP on LONG (lower level = weaker floor), PRICE_ABOVE only on SHORT
 * (higher level = weaker ceiling). The percentage kinds all weaken when the
 * band widens — a bigger drop, give-back, or move required before firing.
 */
function weakens(prev: TriggerPredicate, next: TriggerPredicate): boolean {
  if (prev.kind !== next.kind) return false;
  switch (prev.kind) {
    case "PRICE_BELOW":
      return (next as { level: number }).level < prev.level;
    case "PRICE_ABOVE":
      return (next as { level: number }).level > prev.level;
    case "PRICE_MOVE_PCT":
    case "GAIN_FROM_ENTRY":
    case "TRAILING_FROM_HIGH":
      return (next as { pct: number }).pct > prev.pct;
    default:
      return false;
  }
}

/**
 * Every way the proposed trigger replacement weakens the protection that
 * is currently in force on a held stock. Empty array = the edit is legal.
 *
 * `before`/`after` are the THESIS-stored rungs (after = the processed
 * wholesale-replace payload, post dropRedundantInherited); `inherited` is
 * the resolved analyst/account/default ladder, identical on both sides.
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

/** Plain-language name for a protective rung, for refusal messages. */
export function describeProtectiveRung(t: Trigger): string {
  const p = t.predicate;
  switch (p.kind) {
    case "PRICE_BELOW":
      return `sell if the price drops below $${p.level}`;
    case "PRICE_ABOVE":
      return `sell (cover) if the price rises above $${p.level}`;
    case "TRAILING_FROM_HIGH":
      return `sell if the stock gives back ${p.pct}% from its high`;
    case "GAIN_FROM_ENTRY":
      return p.direction === "DOWN"
        ? `sell if the stock is down ${p.pct}% from what we paid`
        : `sell to lock in the gain once up ${p.pct}%`;
    case "PRICE_MOVE_PCT":
      return `sell on a ${p.pct}% ${p.direction === "DOWN" ? "drop" : "spike"} in a ${p.window} window`;
    default:
      return `the ${p.kind} sell rule`;
  }
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
