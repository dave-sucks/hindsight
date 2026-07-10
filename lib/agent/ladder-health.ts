/**
 * ladder-health.ts — pure "does this holding's trigger ladder still reflect
 * its gain?" math (Game Plan PR-B — docs/plans/THESIS_GAME_PLAN.md §6 row B).
 *
 * The motivating failure is the IONS autopsy (§1 of the plan): bought $73.83
 * with a $65 floor set on day one, ran +17% over a month, got three
 * consecutive "Reviewed — no changes" daily reviews, then crashed −24% in one
 * day and fired the day-one floor at $64.80 — a LOSS on a trade that was up
 * 17%. Every pipeline piece worked; what failed is that no level was ever
 * re-earned. This module computes, per HOLDING thesis, the compact
 * ladder-health block the agent consumes without deriving:
 *
 *   - gain % from entry (position avgCost vs current price, direction-aware)
 *   - what the floor locks in — the tightest protective EXIT rung expressed
 *     as a % vs entry ("floor locks +5.2%" / "floor is −12% BELOW entry")
 *   - whether a trail (TRAILING_FROM_HIGH EXIT) exists
 *   - the nearest forward rung + its distance from the current price
 *   - days since the ladder was last edited (caller supplies the timestamp)
 *   - the UNPROTECTED_GAIN flag: gain meaningfully above what the floor locks
 *
 * Shared by needs-action.ts (the UNPROTECTED_GAIN attention flag) and
 * resolved-thesis.ts (surfacing the block on every HOLDING row in
 * get_theses), exactly the way winner-signal.ts is shared for
 * RUNNING_WINNER. No I/O — pure + unit-tested.
 *
 * What counts as PROTECTION (a floor):
 *   An EXIT-action rung that deterministically fires on the losing side of
 *   the current price:
 *     - PRICE_BELOW level      (LONG)  / PRICE_ABOVE level      (SHORT)
 *     - TRAILING_FROM_HIGH pct — floor = peak × (1 ∓ pct/100), where peak is
 *       the water-mark-corrected Position.peakPrice (see below)
 *     - GAIN_FROM_ENTRY DOWN pct — floor = avgCost × (1 ∓ pct/100); the plan
 *       names only the first two, but a drawdown-from-entry EXIT locks a
 *       floor by the same semantics, so it counts
 *   TRIM / MOVE_STOP / REVIEW rungs do NOT count — a partial trim or a
 *   proposal-to-move-the-stop doesn't lock the gain. Predicates nested in an
 *   OR count (any branch fires alone); predicates inside an AND don't (the
 *   level alone doesn't guarantee the exit).
 *
 * Trail floor peak source: Position.peakPrice is maintained hourly by the
 * price monitor, so it can lag the live quote. The trail's enforceable floor
 * only ever ratchets toward the live price, so we use the water-mark-corrected
 * value — LONG: max(peakPrice, currentPrice); SHORT: min(peakPrice,
 * currentPrice) — falling back to currentPrice when peakPrice is null.
 *
 * SHORT positions are fully handled: gain math inverts (avgCost vs price),
 * the protective side flips (PRICE_ABOVE), and the trail uses the low-water
 * mark — mirroring lib/agent/triggers/evaluate.ts and winner-signal.ts.
 */

import type { Trigger, TriggerPredicate } from "@/lib/agent/triggers/types";

// ─── Tunable constants (mirrors RUNNING_WINNER_* in winner-signal.ts) ────────

/**
 * Minimum unrealized gain before the UNPROTECTED_GAIN flag can fire. Below
 * this, an entry-side stop below entry is normal risk management, not an
 * unprotected winner. 8 matches RUNNING_WINNER_MIN_GAIN_PCT — the same "this
 * is a winner worth acting on" floor. Tunable; calibrate from run reviews.
 */
export const UNPROTECTED_GAIN_MIN_GAIN_PCT = 8;

/**
 * Minimum gap between the current gain and what the floor locks in before
 * the position is flagged unprotected. 6 ≈ "you're giving back more than a
 * normal trail width if the floor fires." A +10% winner with a floor locking
 * +5% (gap 5) is acceptably laddered; a +17% winner with a floor at −12%
 * (gap 29 — the IONS shape) is flagged every morning until the floor is
 * raised. A missing floor is treated as −infinity, so any gain ≥ the MIN
 * threshold with no protective EXIT rung always flags. Tunable.
 */
export const UNPROTECTED_GAIN_GAP_PCT = 6;

// ─── Public types ─────────────────────────────────────────────────────────────

export interface LadderFloor {
  triggerId: string;
  /** Predicate kind supplying the floor. */
  kind: "PRICE_BELOW" | "PRICE_ABOVE" | "TRAILING_FROM_HIGH" | "GAIN_FROM_ENTRY";
  /** Price at which the protective EXIT fires. */
  price: number;
  /**
   * % gain vs avgCost locked in if the floor fires. Negative = the floor
   * sits BELOW entry (firing it turns the winner into a loss — the IONS
   * shape).
   */
  flooredGainPct: number;
  /** True when this floor is a TRAILING_FROM_HIGH rung. */
  isTrail: boolean;
  /** Compact human description, e.g. "stop $65.00" or "trail 8% off $86.24 → $79.34". */
  label: string;
}

export interface LadderRung {
  triggerId: string;
  action: string;
  /** Price at which the rung fires. */
  price: number;
  /**
   * Signed % move from the current price to the rung's fire price
   * (positive = above current, negative = below).
   */
  distancePct: number;
  /** Compact predicate description, e.g. "price > $455". */
  label: string;
}

export interface LadderHealth {
  /** Unrealized gain % from entry, direction-aware (positive = winning). */
  gainPct: number;
  /** The tightest protective EXIT rung. Null = NO floor (unbounded downside). */
  floor: LadderFloor | null;
  /** floor?.flooredGainPct surfaced flat for the agent. Null = no floor. */
  flooredGainPct: number | null;
  /** True when a TRAILING_FROM_HIGH EXIT rung exists (mechanical ratchet on). */
  hasTrail: boolean;
  /** The nearest not-yet-matching price rung (any action), by |distance|. */
  nearestRung: LadderRung | null;
  /**
   * Whole days since the trigger ladder was last edited (CREATED or a
   * ladder-touching UPDATED audit row — see isLadderEditUpdate). Null when
   * the caller couldn't cheaply resolve it.
   */
  daysSinceLadderEdit: number | null;
  /** gainPct − flooredGainPct. Null when there is no floor (gap is unbounded). */
  unprotectedGapPct: number | null;
  /**
   * THE IONS DETECTOR: gain ≥ UNPROTECTED_GAIN_MIN_GAIN_PCT AND the floor
   * locks in ≥ UNPROTECTED_GAIN_GAP_PCT less than the current gain (missing
   * floor = −infinity → always flags once gain clears the MIN threshold).
   */
  isUnprotectedGain: boolean;
  /** One-line agent-readable rollup of everything above. */
  summary: string;
}

// ─── Rung extraction ──────────────────────────────────────────────────────────

interface ExtractedRung {
  kind: LadderFloor["kind"];
  /** Direction of price travel that makes the predicate fire. */
  firesWhen: "RISES" | "FALLS";
  price: number;
  isTrail: boolean;
  label: string;
}

const fmtUsd = (x: number) => `$${x.toFixed(2)}`;
const fmtPct = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;

/**
 * Flatten a predicate into the fixed price levels at which it fires.
 * Recurses into OR (any branch fires alone); skips AND (a level inside an
 * AND doesn't fire by itself, so it neither protects nor counts as a rung).
 * Non-price predicates (signals, RSI, SMA, time) and PRICE_MOVE_PCT (level
 * is relative to a prior close we don't have here) yield nothing.
 */
function extractPriceRungs(
  predicate: TriggerPredicate,
  ctx: { isLong: boolean; avgCost: number; peak: number },
): ExtractedRung[] {
  switch (predicate.kind) {
    case "PRICE_ABOVE":
      return [
        {
          kind: "PRICE_ABOVE",
          firesWhen: "RISES",
          price: predicate.level,
          isTrail: false,
          label: `price > ${fmtUsd(predicate.level)}`,
        },
      ];
    case "PRICE_BELOW":
      return [
        {
          kind: "PRICE_BELOW",
          firesWhen: "FALLS",
          price: predicate.level,
          isTrail: false,
          label: `price < ${fmtUsd(predicate.level)}`,
        },
      ];
    case "GAIN_FROM_ENTRY": {
      // UP fires when the position GAINS pct% (LONG: price rises; SHORT:
      // price falls). DOWN fires when it LOSES pct% (mirror). Either way the
      // fire level is avg×(1+pct/100) when firing needs a HIGHER price, and
      // avg×(1−pct/100) when it needs a LOWER one.
      const gainSide = predicate.direction === "UP";
      const priceRises = ctx.isLong === gainSide;
      const level = priceRises
        ? ctx.avgCost * (1 + predicate.pct / 100)
        : ctx.avgCost * (1 - predicate.pct / 100);
      return [
        {
          kind: "GAIN_FROM_ENTRY",
          firesWhen: priceRises ? "RISES" : "FALLS",
          price: level,
          isTrail: false,
          label: `${gainSide ? "up" : "down"} ${predicate.pct}% from entry`,
        },
      ];
    }
    case "TRAILING_FROM_HIGH": {
      // LONG: fires when price falls to peak×(1−pct/100); SHORT: rises to
      // peak×(1+pct/100) off the low-water mark.
      const price = ctx.isLong
        ? ctx.peak * (1 - predicate.pct / 100)
        : ctx.peak * (1 + predicate.pct / 100);
      return [
        {
          kind: "TRAILING_FROM_HIGH",
          firesWhen: ctx.isLong ? "FALLS" : "RISES",
          price,
          isTrail: true,
          label: `trail ${predicate.pct}% off ${fmtUsd(ctx.peak)} → ${fmtUsd(price)}`,
        },
      ];
    }
    case "OR":
      return predicate.predicates.flatMap((p) => extractPriceRungs(p, ctx));
    default:
      return [];
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute the ladder-health block for a held position. Returns null when the
 * inputs can't support the math (no valid avgCost or current price) — the
 * caller treats null as "no block to surface, no UNPROTECTED_GAIN flag"
 * (graceful degradation, same contract as computeWinnerSignal).
 */
export function computeLadderHealth(opts: {
  direction: string | null | undefined;
  avgCost: number | null | undefined;
  currentPrice: number | null | undefined;
  /** Position.peakPrice (high-water LONG / low-water SHORT); null → falls back to currentPrice. */
  peakPrice?: number | null;
  triggers: Trigger[];
  /** When the ladder was last edited; null → daysSinceLadderEdit omitted. */
  lastLadderEditAt?: Date | null;
  now: Date;
}): LadderHealth | null {
  const { direction, avgCost, currentPrice, peakPrice, triggers, lastLadderEditAt, now } =
    opts;
  if (avgCost == null || avgCost <= 0) return null;
  if (currentPrice == null || currentPrice <= 0) return null;

  const isLong = direction !== "SHORT";
  const gainPct = isLong
    ? ((currentPrice - avgCost) / avgCost) * 100
    : ((avgCost - currentPrice) / avgCost) * 100;

  // Water-mark-corrected peak (see header): the stored peak is hourly and can
  // lag; the enforceable trail floor only ratchets toward the live price.
  const rawPeak =
    peakPrice != null && peakPrice > 0 ? peakPrice : currentPrice;
  const peak = isLong
    ? Math.max(rawPeak, currentPrice)
    : Math.min(rawPeak, currentPrice);

  const ctx = { isLong, avgCost, peak };
  const protectiveSide: ExtractedRung["firesWhen"] = isLong ? "FALLS" : "RISES";

  // ── Floors: EXIT rungs on the protective side, tightest (max locked gain) wins
  let floor: LadderFloor | null = null;
  let hasTrail = false;
  for (const trigger of triggers) {
    if (trigger.action !== "EXIT") continue;
    for (const rung of extractPriceRungs(trigger.predicate, ctx)) {
      if (rung.firesWhen !== protectiveSide) continue; // take-profit side, not a floor
      if (rung.isTrail) hasTrail = true;
      const flooredGainPct = isLong
        ? ((rung.price - avgCost) / avgCost) * 100
        : ((avgCost - rung.price) / avgCost) * 100;
      if (floor == null || flooredGainPct > floor.flooredGainPct) {
        floor = {
          triggerId: trigger.id,
          kind: rung.kind,
          price: rung.price,
          flooredGainPct,
          isTrail: rung.isTrail,
          label: rung.label,
        };
      }
    }
  }

  // ── Nearest forward rung: any action, any side, not currently matching
  let nearestRung: LadderRung | null = null;
  for (const trigger of triggers) {
    for (const rung of extractPriceRungs(trigger.predicate, ctx)) {
      const forward =
        rung.firesWhen === "RISES"
          ? rung.price > currentPrice
          : rung.price < currentPrice;
      if (!forward) continue; // already matching (or exactly at) → not forward
      const distancePct = ((rung.price - currentPrice) / currentPrice) * 100;
      if (
        nearestRung == null ||
        Math.abs(distancePct) < Math.abs(nearestRung.distancePct)
      ) {
        nearestRung = {
          triggerId: trigger.id,
          action: trigger.action,
          price: rung.price,
          distancePct,
          label: rung.label,
        };
      }
    }
  }

  // ── Days since last ladder edit
  const daysSinceLadderEdit =
    lastLadderEditAt != null
      ? Math.max(
          0,
          Math.floor((now.getTime() - lastLadderEditAt.getTime()) / 86_400_000),
        )
      : null;

  // ── The IONS detector
  const flooredGainPct = floor?.flooredGainPct ?? null;
  const unprotectedGapPct =
    flooredGainPct != null ? gainPct - flooredGainPct : null;
  const isUnprotectedGain =
    gainPct >= UNPROTECTED_GAIN_MIN_GAIN_PCT &&
    // Missing floor = −infinity: always unprotected once the gain qualifies.
    (unprotectedGapPct == null || unprotectedGapPct >= UNPROTECTED_GAIN_GAP_PCT);

  // ── One-line rollup
  const parts: string[] = [
    `${fmtPct(gainPct)} from entry (${fmtUsd(avgCost)} → ${fmtUsd(currentPrice)})`,
    floor
      ? `floor locks ${fmtPct(floor.flooredGainPct)}${floor.flooredGainPct < 0 ? " (BELOW entry)" : ""} — ${floor.label}`
      : "NO FLOOR — no protective EXIT rung",
    hasTrail ? "trail on" : "no trail",
    nearestRung
      ? `next rung ${nearestRung.action} ${nearestRung.label} @ ${fmtUsd(nearestRung.price)} (${fmtPct(nearestRung.distancePct)} away)`
      : "no forward rungs",
  ];
  if (daysSinceLadderEdit != null) {
    parts.push(`ladder last edited ${daysSinceLadderEdit}d ago`);
  }
  if (isUnprotectedGain) {
    parts.push(
      `UNPROTECTED GAIN — up ${fmtPct(gainPct)} but the floor locks ${
        flooredGainPct != null ? fmtPct(flooredGainPct) : "NOTHING"
      }; raise the floor (or attest why not)`,
    );
  }

  return {
    gainPct,
    floor,
    flooredGainPct,
    hasTrail,
    nearestRung,
    daysSinceLadderEdit,
    unprotectedGapPct,
    isUnprotectedGain,
    summary: parts.join("; "),
  };
}

// ─── Ladder-edit detection (for the "days since last edit" scan) ─────────────

/**
 * fieldChanges keys that mark a ThesisUpdate row as a LADDER edit:
 *   - "triggers"  — the agent's update_thesis diffs the full trigger array
 *   - "fireMode"  — principal UI fire-mode change (thesis-edit.ts)
 *   - "stopLoss"  — principal UI stop-rung edits + agent stop moves sync here
 * Deliberately EXCLUDES "targetPrice" (a target move is a plan change, not
 * protection work) and "source" (stamped on every principal edit, ladder or
 * not). Principal UI edits that touch only a non-stop rung value write none
 * of these keys — the metric then errs toward "stale," which fails safe
 * (extra attention, never missed attention).
 */
const LADDER_EDIT_FIELD_KEYS = ["triggers", "fireMode", "stopLoss"] as const;

/**
 * Is this ThesisUpdate row a ladder edit? CREATED rows count (the ladder is
 * born with the thesis); UPDATED rows count when fieldChanges touches a
 * ladder key. TRIGGER_FIRED / REVIEWED / proposal rows never count — a fire
 * or a rubber-stamp review is exactly what this metric must NOT reset on.
 */
export function isLadderEditUpdate(type: string, fieldChanges: unknown): boolean {
  if (type === "CREATED") return true;
  if (type !== "UPDATED") return false;
  if (fieldChanges == null || typeof fieldChanges !== "object") return false;
  const fc = fieldChanges as Record<string, unknown>;
  return LADDER_EDIT_FIELD_KEYS.some((k) => fc[k] != null);
}
