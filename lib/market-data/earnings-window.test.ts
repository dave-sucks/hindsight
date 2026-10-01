/**
 * The next report's date, bell and both street estimates live on the
 * upcoming column's hover. The card only spends a line on them when the
 * report is nearly here — ISRG carried "Next report Oct 20 · after close ·
 * in 19 days" above the plot every day for nineteen days.
 */
import { earningsSoon } from "./earnings-window";

const now = new Date("2026-10-01T15:00:00Z");

describe("earningsSoon", () => {
  it("stays quiet while the report is far off", () => {
    expect(earningsSoon("2026-10-20", now)).toBe(false); // ISRG: 19 days
    expect(earningsSoon("2026-10-12", now)).toBe(false); // 11 days
  });

  it("speaks up inside the window, including today", () => {
    expect(earningsSoon("2026-10-11", now)).toBe(true); // the boundary
    expect(earningsSoon("2026-10-02", now)).toBe(true);
    expect(earningsSoon("2026-10-01", now)).toBe(true); // today
  });

  it("never announces a report that already happened", () => {
    expect(earningsSoon("2026-09-30", now)).toBe(false);
  });
});
