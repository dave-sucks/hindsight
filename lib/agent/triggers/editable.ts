/**
 * Which numeric value (if any) a trigger predicate exposes for direct
 * principal editing, and how to write it back. Shared by the trigger popover
 * (renders the label + input) and the trigger-edit write path (applies the
 * new value) so the two never drift.
 *
 * Editable set: the PRICE levels (take-profit / stop the principal drags),
 * the PRICE_MOVE_PCT percent, and the REVIEW_CADENCE days (the review clock)
 * — all strictly-positive values, which keeps the write-path's `value > 0`
 * guard exactly right (a $0 price, a 0% move and a 0-day clock are all
 * invalid). The chart kinds expose their one positive number too (the
 * distance to an average, the volume multiple, the gap size, the RSI
 * level). Earnings surprise %, relative strength (where 0 and negatives
 * are legal), the averages' period and composites render read-only.
 */

import type { TriggerPredicate } from "./types";

export interface EditableTriggerField {
  /** Short label shown above the input ("Price"). */
  label: string;
  value: number | null;
  prefix?: string; // "$"
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
}

export function editableTriggerField(
  p: TriggerPredicate,
): EditableTriggerField | null {
  switch (p.kind) {
    case "PRICE_ABOVE":
    case "PRICE_BELOW":
      return { label: "Price", value: p.level, prefix: "$", min: 0, step: 0.01 };
    case "PRICE_MOVE_PCT":
      // The "Movement Amount" alert — daily % move (direction is fixed; only
      // the magnitude is editable here, mirroring the price-level edit).
      return { label: "Move %", value: p.pct, suffix: "%", min: 0, step: 0.5 };
    case "GAIN_FROM_ENTRY":
      return { label: "Gain %", value: p.pct, suffix: "%", min: 0, step: 0.5 };
    case "TRAILING_FROM_HIGH":
      return { label: "Trail %", value: p.pct, suffix: "%", min: 1, step: 0.5 };
    case "REVIEW_CADENCE":
      // Agent Watch — days between the agent's reviews. Editable here so it
      // lives in the same popover as every other trigger (DAV-225).
      return {
        label: "Review every",
        value: p.days,
        suffix: "days",
        min: 1,
        step: 1,
      };
    case "EARNINGS_WITHIN":
      // The earnings heads-up — how many days before the report to wake.
      return { label: "Days before", value: p.days, suffix: "days", min: 1, max: 14, step: 1 };
    case "NEAR_SMA":
      return { label: "Within", value: p.withinPct, suffix: "%", min: 0, max: 10, step: 0.5 };
    case "VOLUME_RATIO":
      return { label: "Volume", value: p.min, suffix: "×", min: 0, max: 50, step: 0.1 };
    case "PCT_FROM_52W_HIGH":
      return { label: "Within", value: p.max, suffix: "%", min: 0, max: 100, step: 0.5 };
    case "GAP_UP":
      return { label: "Gap", value: p.minPct, suffix: "%", min: 0, max: 100, step: 0.5 };
    case "RSI":
      return { label: "RSI", value: p.threshold, min: 0, max: 100, step: 1 };
    case "INSIDER_CLUSTER":
      return { label: "Buyers", value: p.minBuyers, suffix: "insiders", min: 1, max: 10, step: 1 };
    default:
      return null;
  }
}

/** Return a copy of the predicate with its editable value replaced. No-op for non-editable kinds. */
export function withEditedValue(
  p: TriggerPredicate,
  value: number,
): TriggerPredicate {
  switch (p.kind) {
    case "PRICE_ABOVE":
    case "PRICE_BELOW":
      return { ...p, level: value };
    case "PRICE_MOVE_PCT":
    case "GAIN_FROM_ENTRY":
    case "TRAILING_FROM_HIGH":
      return { ...p, pct: value };
    case "REVIEW_CADENCE":
    case "EARNINGS_WITHIN":
      return { ...p, days: value };
    case "NEAR_SMA":
      return { ...p, withinPct: value };
    case "VOLUME_RATIO":
      return { ...p, min: value };
    case "PCT_FROM_52W_HIGH":
      return { ...p, max: value };
    case "GAP_UP":
      return { ...p, minPct: value };
    case "RSI":
      return { ...p, threshold: value };
    case "INSIDER_CLUSTER":
      return { ...p, minBuyers: Math.round(value) };
    default:
      return p;
  }
}
