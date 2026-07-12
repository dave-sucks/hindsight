/**
 * defaults-preview — server-side derivation of the "Analyst Trigger
 * Defaults" read-only card (GAPS P1-33; docs/plans/TRIGGER_LIFECYCLE.md §1).
 *
 * The card makes authority layers 1 (code constants) + 3 (horizon
 * templates) visible in the analyst settings panel BEFORE they're
 * configurable (that's PR-E). The principal's ask, verbatim: "showing
 * them as 'Analyst Trigger Defaults' in the analyst settings panel EVEN
 * THOUGH they're not configurable yet, to at least make sure it's clear
 * to me what exists and where it would be configurable later."
 *
 * NOTHING here re-declares a rung. Every pill and every note is derived
 * by calling defaultTriggersForHorizon() and reading the actual template
 * output, formatted with the shared format.ts helpers — so the display
 * can never drift from the code that stamps triggers onto theses. Change
 * PROTECT_TRAIL_PCT in defaults.ts and this card updates on the next
 * render.
 *
 * SERVER-ONLY: defaults.ts pulls node:crypto. Client components may only
 * `import type` from this module.
 */

import {
  defaultTriggersForHorizon,
  triggerBucket,
  type Horizon,
  type ThesisShape,
} from "./defaults";
import { actionGroupLabel, predicateSentence } from "./format";
import type { Trigger, TriggerAction } from "./types";

// ── View types (plain strings — serializable across the RSC boundary) ──

export interface DefaultRungView {
  /** predicateSentence(predicate) — "Up 10% from entry". */
  sentence: string;
  /** The template's rationale prose — shown in the pill tooltip. */
  rationale: string;
}

export interface DefaultRungGroupView {
  /** actionGroupLabel(action) — "Add if" / "Review if" / "Exit if". */
  group: string;
  rungs: DefaultRungView[];
}

export interface HorizonNoteView {
  horizon: Horizon;
  /** One derived sentence summarizing this horizon's held-side template. */
  note: string;
}

export interface TriggerDefaultsView {
  /** The standing %-rung family every HELD thesis carries, grouped by action. */
  everyHolding: DefaultRungGroupView[];
  /** One line per horizon, derived from the actual template output. */
  horizonNotes: HorizonNoteView[];
  /** Watching-side contrast line; null if the templates stop matching it. */
  watchingNote: string | null;
}

// ── Derivation ──────────────────────────────────────────────────────────

const HORIZONS: readonly Horizon[] = [
  "CATALYST",
  "TRADE",
  "TARGET",
  "COMPOUNDER",
];

/** Same action ordering the thesis sheet's TriggerGroups renders in. */
const ACTION_ORDER: readonly TriggerAction[] = [
  "ENTER",
  "ADD",
  "REVIEW",
  "MOVE_STOP",
  "TRIM",
  "EXIT",
];

/**
 * Representative thesis shape. Prices are present so the level-bearing
 * rungs (hard stop, target) appear in the template output and the
 * per-horizon behavior can be read off what the template actually emits.
 * The card never displays these numbers — level-bearing rungs are only
 * summarized level-agnostically in the horizon notes.
 */
const REPRESENTATIVE: ThesisShape = {
  entryPrice: 100,
  targetPrice: 120,
  stopLoss: 90,
  direction: "LONG",
};

/**
 * The "standing family": rungs whose thresholds are code constants
 * (layer 1), not per-thesis levels — the protection minimums
 * (GAIN_FROM_ENTRY / TRAILING_FROM_HIGH) and the ±% scale-in rungs
 * (PRICE_MOVE_PCT → ADD). These are the pills the card shows verbatim.
 */
function isStandingFamily(t: Trigger): boolean {
  const k = t.predicate.kind;
  if (k === "GAIN_FROM_ENTRY" || k === "TRAILING_FROM_HIGH") return true;
  return k === "PRICE_MOVE_PCT" && t.action === "ADD";
}

/**
 * One-line summary of a horizon's held-side template, built from rung
 * presence in the ACTUAL output (not hardcoded per horizon) so template
 * changes show up here without anyone remembering this card exists.
 */
function horizonNote(rungs: Trigger[]): string {
  const has = (f: (t: Trigger) => boolean) => rungs.some(f);
  const phrases: string[] = [];

  // Target handling — the CATALYST/TRADE/TARGET/COMPOUNDER split the
  // principal asked about: TRADE auto-takes at target, TARGET reviews.
  if (has((t) => t.predicate.kind === "PRICE_ABOVE" && t.action === "EXIT")) {
    phrases.push("takes profit at target automatically");
  } else if (
    has((t) => t.predicate.kind === "PRICE_ABOVE" && t.action === "REVIEW")
  ) {
    phrases.push("reviews at target (close or trail higher)");
  }

  if (has((t) => t.predicate.kind === "PRICE_BELOW" && t.action === "EXIT")) {
    phrases.push("exits at the hard stop");
  }
  if (has((t) => t.predicate.kind === "PRICE_BELOW" && t.action === "REVIEW")) {
    phrases.push("reviews a sharp drop from entry");
  }

  const hasFiling = has(
    (t) =>
      t.predicate.kind === "FILING" ||
      ((t.predicate.kind === "OR" || t.predicate.kind === "AND") &&
        t.predicate.predicates.some((p) => p.kind === "FILING")),
  );
  const hasEarnings = has(
    (t) =>
      t.predicate.kind === "EARNINGS_BEAT" ||
      t.predicate.kind === "EARNINGS_MISS",
  );
  const hasGuidance = has((t) => t.predicate.kind === "GUIDANCE_CHANGE");
  const events = [
    hasEarnings ? "earnings surprises" : null,
    hasGuidance ? "guidance cuts" : null,
    hasFiling ? "filings" : null,
  ].filter((s): s is string => s != null);
  if (events.length > 0) phrases.push(`reviews ${events.join(", ")}`);

  const time = rungs.find((t) => t.predicate.kind === "TIME_ELAPSED");
  if (time && time.predicate.kind === "TIME_ELAPSED") {
    phrases.push(`${time.predicate.days}-day scheduled review`);
  }

  const hasPullbackAdd = has(
    (t) =>
      t.predicate.kind === "PRICE_MOVE_PCT" &&
      t.predicate.direction === "DOWN" &&
      t.action === "ADD",
  );
  if (!hasPullbackAdd) phrases.push("no pullback-add");

  const joined = phrases.join("; ");
  return joined.charAt(0).toUpperCase() + joined.slice(1) + ".";
}

/**
 * Watching-side contrast line, guarded by the actual WATCHING template
 * shape (ENTER present, no EXIT) so it disappears rather than lies if
 * the templates change.
 */
function buildWatchingNote(): string | null {
  const watching = defaultTriggersForHorizon(
    "TARGET",
    REPRESENTATIVE,
    "WATCHING",
  );
  const hasEnter = watching.some((t) => t.action === "ENTER");
  const hasExit = watching.some((t) => t.action === "EXIT");
  if (!hasEnter || hasExit) return null;
  return "Watchlist theses get a Buy-if trigger at the entry level plus event reviews instead — no exit or protection rungs until a position exists.";
}

/**
 * Build the full card payload. Pure (no DB, no analyst input — layer 2
 * per-analyst overrides don't exist yet; when PR-E lands, this takes the
 * analyst's standing rules and the card becomes a live preview).
 */
export function buildTriggerDefaultsView(): TriggerDefaultsView {
  const heldByHorizon = HORIZONS.map(
    (h) =>
      [h, defaultTriggersForHorizon(h, REPRESENTATIVE, "HELD")] as const,
  );

  // "Every holding carries" — union of the standing family across all
  // four HELD templates, deduped by the same (predicate, action) bucket
  // mergeTriggers uses.
  const seen = new Set<string>();
  const standing: Trigger[] = [];
  for (const [, rungs] of heldByHorizon) {
    for (const t of rungs) {
      if (!isStandingFamily(t)) continue;
      const key = triggerBucket(t);
      if (seen.has(key)) continue;
      seen.add(key);
      standing.push(t);
    }
  }

  const everyHolding: DefaultRungGroupView[] = ACTION_ORDER.map((action) => ({
    group: actionGroupLabel(action),
    rungs: standing
      .filter((t) => t.action === action)
      .map((t) => ({
        sentence: predicateSentence(t.predicate),
        rationale: t.rationale,
      })),
  })).filter((g) => g.rungs.length > 0);

  const horizonNotes: HorizonNoteView[] = heldByHorizon.map(
    ([horizon, rungs]) => ({ horizon, note: horizonNote(rungs) }),
  );

  return { everyHolding, horizonNotes, watchingNote: buildWatchingNote() };
}
