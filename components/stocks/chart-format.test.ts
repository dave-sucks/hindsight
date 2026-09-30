/**
 * The chart label formatters must be total — recharts passes whatever it has
 * in transient tooltip frames, including numeric indexes, and a thrown label
 * takes down the whole page behind the app error boundary (the 2026-08-19
 * "e.includes is not a function" crash on a trade page's first 1W click).
 */

import {
  formatDateLabel,
  formatDateTimeLabel,
  formatTimeLabel,
} from "./chart-format";

describe("formatDateLabel", () => {
  it("formats plain daily dates", () => {
    expect(formatDateLabel("2026-08-19")).toBe("Aug 19");
  });

  it("formats full ISO hourly timestamps", () => {
    expect(formatDateLabel("2026-08-19T14:00:00Z")).toMatch(/Aug 1[89]/);
  });

  it("returns empty (not a crash) for a numeric tick — the 1W crash shape", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(formatDateLabel(4)).toBe("");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns empty for null / undefined / objects", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(formatDateLabel(null)).toBe("");
    expect(formatDateLabel(undefined)).toBe("");
    expect(formatDateLabel({})).toBe("");
    warn.mockRestore();
  });

  it("returns empty for unparseable strings instead of NaN dates", () => {
    expect(formatDateLabel("not-a-date")).toBe("");
  });
});

describe("formatDateTimeLabel / formatTimeLabel", () => {
  it("format valid ISO timestamps", () => {
    expect(formatDateTimeLabel("2026-08-19T14:00:00Z")).toMatch(/Aug 19/);
    expect(formatTimeLabel("2026-08-19T14:00:00Z")).toMatch(/AM|PM/);
  });

  it("return empty for unparseable input instead of 'Invalid Date'", () => {
    expect(formatDateTimeLabel("nope")).toBe("");
    expect(formatTimeLabel("nope")).toBe("");
  });
});

import { formatRangeChange, rangeChange, splitOffset } from "./chart-format";

describe("rangeChange — what a range's readout says", () => {
  it("1D: DOCU 2026-09-30 measured from yesterday's close $66.98 — the header's day change, not the 7:00 AM point", () => {
    const closes = [66.98, 67.09, 68.42, 67.15];
    expect(rangeChange(closes, 66.98)).toEqual({ dollars: 67.15 - 66.98, pct: ((67.15 - 66.98) / 66.98) * 100 });
    expect(formatRangeChange(rangeChange(closes, 66.98)!)).toBe("+$0.17 (+0.25%)");
  });

  it("1W / 1M: the last visible point against the first — DOCU's month, $64.00 to $67.15", () => {
    const c = rangeChange([64, 66.5, 72.79, 67.15], null)!;
    expect(formatRangeChange(c)).toBe("+$3.15 (+4.92%)");
  });

  it("a fall reads with a minus, and nothing to measure against is null, never a zero", () => {
    expect(formatRangeChange(rangeChange([69.49, 67.15], null)!)).toBe("−$2.34 (−3.37%)");
    expect(rangeChange([], 66.98)).toBeNull();
    expect(rangeChange([0, 67.15], null)).toBeNull();
    // A missing prior close falls back to the first point rather than $0.
    expect(rangeChange([66.98, 67.15], 0)!.dollars).toBeCloseTo(0.17);
  });
});

describe("splitOffset — where the green/red split sits on the plot band", () => {
  it("is the price scale's own fraction from the top: baseline halfway up the scale is 0.5", () => {
    expect(splitOffset(60, 70, 65)).toBe(0.5);
    expect(splitOffset(60, 70, 68)).toBeCloseTo(0.2);
  });
  it("a baseline outside the visible scale pins to an edge, so a gap day is all one color", () => {
    expect(splitOffset(60, 70, 80)).toBe(0.001);
    expect(splitOffset(60, 70, 50)).toBe(0.999);
    expect(splitOffset(65, 65, 65)).toBe(0.001);
  });
});
