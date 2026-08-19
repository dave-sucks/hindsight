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
