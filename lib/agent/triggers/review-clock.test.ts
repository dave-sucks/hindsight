/**
 * review-clock.test.ts — reading the clock off a thesis (DAV-225).
 *
 * The clock is a REVIEW_CADENCE trigger, so the icon on the row, the sheet
 * and the "send to research" gate all ask the same question of the same
 * helper rather than each parsing the JSON their own way.
 */

import {
  reviewClockDays,
  reviewClockLabel,
} from "@/lib/agent/triggers/review-clock";

const clock = (days: number) => ({
  predicate: { kind: "REVIEW_CADENCE", days },
  action: "REVIEW",
});
const priceRung = {
  predicate: { kind: "PRICE_ABOVE", level: 186 },
  action: "ENTER",
};

describe("reviewClockDays — is this name on a schedule?", () => {
  it("reads the days off a clock rung", () => {
    expect(reviewClockDays([priceRung, clock(7)])).toBe(7);
  });

  it("a ladder with no clock, or none at all, is on no schedule", () => {
    expect(reviewClockDays([priceRung])).toBeNull();
    expect(reviewClockDays([])).toBeNull();
  });

  it("a non-array column reads as no schedule, not an error", () => {
    expect(reviewClockDays(null)).toBeNull();
    expect(reviewClockDays({ nope: true })).toBeNull();
  });

  it("a malformed rung doesn't take the whole ladder down", () => {
    // Legacy rows carry junk; a read surface must still answer.
    expect(reviewClockDays([null, { predicate: null }, clock(30)])).toBe(30);
  });

  it("a zero or negative day count is not a schedule", () => {
    expect(reviewClockDays([clock(0)])).toBeNull();
    expect(reviewClockDays([clock(-1)])).toBeNull();
  });
});

describe("reviewClockLabel — the same words on every surface", () => {
  it("names the common schedules and falls back to days", () => {
    expect(reviewClockLabel(1)).toBe("Every day");
    expect(reviewClockLabel(7)).toBe("Every week");
    expect(reviewClockLabel(30)).toBe("Every month");
    expect(reviewClockLabel(4)).toBe("Every 4 days");
    expect(reviewClockLabel(null)).toBe("No schedule");
  });
});
