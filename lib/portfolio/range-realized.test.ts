/**
 * The real LIVE sales, at the times they actually closed.
 *
 * The times are the point of this file. The header used to measure its split
 * on a second clock (`now − N days`) while the number above it was measured
 * over the window the chart drew — so how late in the day a sale happened
 * decided whether it was double-counted the next morning.
 */
import { realizedSince } from "./range-realized";

// Read from Position (status CLOSED, environment LIVE) on 2026-10-05.
const LIVE_SALES = [
  { ticker: "ABT", closedAt: "2026-10-02T13:40:00.000Z", pnl: -709.25 },
  { ticker: "IOT", closedAt: "2026-09-25T14:02:00.000Z", pnl: -116.08 },
  { ticker: "FIVE", closedAt: "2026-09-25T14:01:00.000Z", pnl: -674.76 },
  { ticker: "SMMT", closedAt: "2026-09-21T15:18:00.000Z", pnl: 1157.94 },
  { ticker: "SRRK", closedAt: "2026-09-14T19:50:00.000Z", pnl: -192.51 },
  { ticker: "PBH", closedAt: "2026-09-11T13:43:00.000Z", pnl: -802.18 },
  // Older than any window under test.
  { ticker: "OLD", closedAt: "2026-06-01T15:00:00.000Z", pnl: 5_000 },
];

describe("realizedSince", () => {
  // THE REGRESSION, with only the sales that existed that day. On 2026-09-15
  // the 1D window was that session, opening at 13:30Z. The old split asked a
  // second clock for `now − 24h`, which at 09:35 ET was 2026-09-14T13:35Z —
  // before SRRK's 19:50Z close the day BEFORE. So the header read
  // "−$192.51 sold" inside a total that covered only the 15th, and `held`,
  // the remainder, absorbed +$192.51 that nobody earned.
  const SALES_TO_0915 = LIVE_SALES.filter((s) => s.closedAt < "2026-09-15");

  it("a sale the day before is not inside today's session", () => {
    expect(realizedSince(SALES_TO_0915, "2026-09-15T13:30:00.000Z")).toBe(0);
    // What the `now − 24h` clock included instead:
    const shipped = SALES_TO_0915.filter(
      (s) => new Date(s.closedAt).getTime() >= Date.parse("2026-09-14T13:35:00.000Z"),
    );
    expect(shipped.map((s) => s.ticker)).toEqual(["SRRK"]);
  });

  it("a sale after the window opens is inside it", () => {
    expect(realizedSince(SALES_TO_0915, "2026-09-14T13:30:00.000Z")).toBeCloseTo(-192.51, 2);
  });

  // The window's baseline is the value AT its first point, so a sale at that
  // exact instant is already in the baseline and must not be counted again.
  it("excludes a sale at the window's own first point", () => {
    expect(realizedSince(SALES_TO_0915, "2026-09-14T19:50:00.000Z")).toBe(0);
    expect(realizedSince(LIVE_SALES, "2026-09-14T19:50:00.000Z")).toBeCloseTo(-342.15, 2);
  });

  it("a daily window excludes its own first day", () => {
    expect(realizedSince(LIVE_SALES, "2026-09-25")).toBeCloseTo(-709.25, 2);
    expect(realizedSince(LIVE_SALES, "2026-09-24")).toBeCloseTo(
      -116.08 - 674.76 - 709.25,
      2,
    );
  });

  it("is the month the live book actually booked", () => {
    expect(realizedSince(LIVE_SALES, "2026-09-09")).toBeCloseTo(-1336.84, 2);
  });

  // The realized CURVE only has a point on days when something closed, so
  // "last minus first inside the window" uses the earliest in-window sale as
  // its baseline and drops it. PBH is that sale.
  it("counts the earliest sale in the window, which a curve delta drops", () => {
    const month = realizedSince(LIVE_SALES, "2026-09-09");
    expect(month - -802.18).toBeCloseTo(-534.66, 2); // what the curve delta gave
    expect(month).not.toBeCloseTo(-534.66, 2);
  });

  // A month of losses still contains a win; the number is the net, not a mood.
  it("nets wins against losses", () => {
    expect(realizedSince(LIVE_SALES, "2026-09-20")).toBeCloseTo(
      1157.94 - 116.08 - 674.76 - 709.25,
      2,
    );
  });

  it("a window reaching back a year holds every sale in it", () => {
    expect(realizedSince(LIVE_SALES, "2025-10-05")).toBeCloseTo(3663.16, 2);
  });

  it("no sales in the window is zero, not absent", () => {
    expect(realizedSince(LIVE_SALES, "2026-10-05T13:30:00.000Z")).toBe(0);
    expect(realizedSince([], "2026-01-01")).toBe(0);
  });

  it("no window at all is zero, not NaN", () => {
    expect(realizedSince(LIVE_SALES, null)).toBe(0);
    expect(realizedSince(LIVE_SALES, undefined)).toBe(0);
  });

  it("ignores a trade with no close date, no P&L, or an unparseable date", () => {
    expect(
      realizedSince(
        [
          { closedAt: null, pnl: 999 },
          { closedAt: "2026-10-04T15:00:00.000Z", pnl: null },
          { closedAt: "not a date", pnl: 999 },
        ],
        "2026-09-09",
      ),
    ).toBe(0);
  });
});
