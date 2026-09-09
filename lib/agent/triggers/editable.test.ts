/**
 * editable.test.ts — which trigger values the principal can edit in place.
 *
 * The popover renders from `editableTriggerField` and the write path applies
 * `withEditedValue`, so the two must agree on every kind or an edit silently
 * no-ops.
 */

import {
  editableTriggerField,
  withEditedValue,
} from "@/lib/agent/triggers/editable";

describe("the review clock is editable like any other trigger (DAV-225)", () => {
  const clock = { kind: "REVIEW_CADENCE" as const, days: 7 };

  it("exposes its days, with the named schedules as presets", () => {
    const f = editableTriggerField(clock);
    expect(f?.value).toBe(7);
    expect(f?.min).toBe(1);
    expect(f?.presets).toEqual([1, 7, 30]);
  });

  it("writes a new cadence back onto the predicate", () => {
    expect(withEditedValue(clock, 30)).toEqual({
      kind: "REVIEW_CADENCE",
      days: 30,
    });
  });

  it("leaves the kinds that were already editable alone", () => {
    const stop = { kind: "PRICE_BELOW" as const, level: 180 };
    expect(editableTriggerField(stop)?.value).toBe(180);
    expect(withEditedValue(stop, 170)).toEqual({
      kind: "PRICE_BELOW",
      level: 170,
    });
  });

  it("a read-only kind stays read-only", () => {
    expect(editableTriggerField({ kind: "EARNINGS_BEAT" })).toBeNull();
  });
});
