/**
 * thesis-review-cadence.test.ts — coverage for computeNextReviewAt.
 *
 * Pure function; no DB. Validates the horizon → days mapping that both
 * record_thesis (mint-time default) and update_thesis (auto-refresh on
 * every touch) call. Same import-less jest pattern as evaluate.test.ts /
 * thesis-shape.test.ts.
 */

import { computeNextReviewAt } from "./thesis-review-cadence";

const NOW = new Date("2026-05-08T13:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

describe("computeNextReviewAt", () => {
  it("CATALYST: 1 day forward", () => {
    expect(computeNextReviewAt("CATALYST", NOW)).toEqual(
      new Date(NOW.getTime() + 1 * DAY_MS),
    );
  });

  it("TRADE: 1 day forward", () => {
    expect(computeNextReviewAt("TRADE", NOW)).toEqual(
      new Date(NOW.getTime() + 1 * DAY_MS),
    );
  });

  it("TARGET: 7 days forward", () => {
    expect(computeNextReviewAt("TARGET", NOW)).toEqual(
      new Date(NOW.getTime() + 7 * DAY_MS),
    );
  });

  it("COMPOUNDER: 30 days forward", () => {
    expect(computeNextReviewAt("COMPOUNDER", NOW)).toEqual(
      new Date(NOW.getTime() + 30 * DAY_MS),
    );
  });

  it("null horizon returns null", () => {
    expect(computeNextReviewAt(null, NOW)).toBeNull();
  });

  it("undefined horizon returns null", () => {
    expect(computeNextReviewAt(undefined, NOW)).toBeNull();
  });

  it("empty string horizon returns null", () => {
    expect(computeNextReviewAt("", NOW)).toBeNull();
  });

  it("unknown horizon returns null (legacy/typo defense)", () => {
    expect(computeNextReviewAt("WHATEVER", NOW)).toBeNull();
  });

  it("does not mutate the passed-in `now`", () => {
    const before = NOW.getTime();
    computeNextReviewAt("CATALYST", NOW);
    expect(NOW.getTime()).toBe(before);
  });
});
