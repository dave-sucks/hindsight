/**
 * Which numeric value (if any) a trigger predicate exposes for direct
 * principal editing, and how to write it back. Shared by the trigger popover
 * (renders the label + input) and the trigger-edit write path (applies the
 * new value) so the two never drift.
 *
 * Editable set: the PRICE levels (take-profit / stop the principal drags) and
 * the TRAILING_STOP percent — all strictly-positive values, which keeps the
 * write-path's `value > 0` guard exactly right (a $0 price / 0% trail is
 * invalid). Every other predicate — earnings surprise %, RSI, time-elapsed
 * days, SMA, signal, filing, review-date, composites — renders read-only in
 * the popover. Broadening to those (where 0 can be valid) is a follow-up.
 */

import type { TriggerPredicate } from "./types";

export interface EditableTriggerField {
  /** Short label shown above the input ("Price"). */
  label: string;
  value: number | null;
  prefix?: string; // "$"
  suffix?: string;
  min?: number;
  step?: number;
}

export function editableTriggerField(
  p: TriggerPredicate,
): EditableTriggerField | null {
  switch (p.kind) {
    case "PRICE_ABOVE":
    case "PRICE_BELOW":
      return { label: "Price", value: p.level, prefix: "$", min: 0, step: 0.01 };
    case "TRAILING_STOP":
      return { label: "Trail %", value: p.trailPct, suffix: "%", min: 0, step: 0.5 };
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
    case "TRAILING_STOP":
      return { ...p, trailPct: value };
    default:
      return p;
  }
}
