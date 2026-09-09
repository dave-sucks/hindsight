/**
 * review-clock.test.ts — the review clock as a value the UI reads and writes
 * (DAV-225).
 *
 * The clock is a REVIEW_CADENCE trigger, not a column, so every surface that
 * shows or edits one goes through these helpers. They are what keep the icon
 * on the row, the picker in the sheet and the agent's own reader agreeing on
 * whether a name is on a schedule.
 */

import {
  reviewClockDays,
  reviewClockLabel,
} from "@/lib/agent/triggers/review-clock";
import {
  editableTriggerField,
  withEditedValue,
} from "@/lib/agent/triggers/editable";
import type { TriggerPredicate } from "@/lib/agent/triggers/types";

const clock = (days: number) => ({
  id: `c-${days}`,
  predicate: { kind: "REVIEW_CADENCE", days },
  action: "REVIEW",
  rationale: "clock",
});

const priceRung = {
  id: "p1",
  predicate: { kind: "PRICE_ABOVE", level: 186 },
  action: "ENTER",
  rationale: "buy the break",
};

describe("reviewClockDays — is this name on a schedule?", () => {
  it("reads the days off a clock rung", () => {
    expect(reviewClockDays([priceRung, clock(7)])).toBe(7);
  });

  it("a ladder with no clock is on no schedule", () => {
    expect(reviewClockDays([priceRung])).toBeNull();
  });

  it("no triggers at all is on no schedule, not an error", () => {
    expect(reviewClockDays([])).toBeNull();
  });

  it("a non-array column (null, legacy junk) reads as no schedule", () => {
    expect(reviewClockDays(null)).toBeNull();
    expect(reviewClockDays({ nope: true })).toBeNull();
  });

  it("a malformed rung doesn't take the whole ladder down", () => {
    // Legacy rows carry junk; a read surface must still answer the question.
    expect(reviewClockDays([null, { predicate: null }, clock(30)])).toBe(30);
  });

  it("labels read the same everywhere", () => {
    expect(reviewClockLabel(1)).toBe("Every day");
    expect(reviewClockLabel(7)).toBe("Every week");
    expect(reviewClockLabel(4)).toBe("Every 4 days");
    expect(reviewClockLabel(null)).toBe("No schedule");
  });

  it("a zero or negative day count is not a schedule", () => {
    expect(reviewClockDays([clock(0)])).toBeNull();
    expect(reviewClockDays([clock(-1)])).toBeNull();
  });
});

describe("the clock is editable like any other trigger", () => {
  const p: TriggerPredicate = { kind: "REVIEW_CADENCE", days: 7 };

  it("exposes its days, so the existing trigger popover can edit it", () => {
    expect(editableTriggerField(p)?.value).toBe(7);
  });

  it("writes a new cadence back, and the readers see it", () => {
    const next = withEditedValue(p, 3);
    expect(next).toEqual({ kind: "REVIEW_CADENCE", days: 3 });
    expect(reviewClockDays([{ ...clock(7), predicate: next }])).toBe(3);
  });
});
