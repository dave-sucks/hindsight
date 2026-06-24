/**
 * Which numeric value (if any) a trigger predicate exposes for direct
 * principal editing, and how to write it back. Shared by the trigger popover
 * (renders the label + input) and the trigger-edit write path (applies the
 * new value) so the two never drift.
 *
 * v1 scope: only the PRICE level triggers (the take-profit / stop levels the
 * principal actually wants to drag) are editable. Every other predicate —
 * earnings surprise %, RSI, time-elapsed days, SMA, signal, filing, review-date,
 * composites — renders read-only in the popover. Keeping the editable set to
 * positive price levels also keeps the write-path's `value > 0` guard exactly
 * right (a $0 price is invalid; a 0% min-surprise would not be). Broadening to
 * the other value-bearing predicates is a deliberate follow-up.
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
    default:
      return p;
  }
}
