/**
 * The six LIVE sales in the 30 days to 2026-10-05, as stored.
 *
 * The header showed the range's total beside ALL-TIME unrealized — two
 * different clocks — so a month that booked $1,336.84 of losses sat next to
 * "+$5,203.85 unrealized" and read as a contradiction.
 */
import { realizedInWindow } from "./range-realized";

const LIVE_SALES = [
  { ticker: "ABT", closedAt: "2026-10-02T15:00:00.000Z", pnl: -709.25 },
  { ticker: "IOT", closedAt: "2026-09-25T15:00:00.000Z", pnl: -116.08 },
  { ticker: "FIVE", closedAt: "2026-09-25T15:00:00.000Z", pnl: -674.76 },
  { ticker: "SMMT", closedAt: "2026-09-21T15:00:00.000Z", pnl: 1157.94 },
  { ticker: "SRRK", closedAt: "2026-09-14T15:00:00.000Z", pnl: -192.51 },
  { ticker: "PBH", closedAt: "2026-09-11T15:00:00.000Z", pnl: -802.18 },
  // Older than any window under test.
  { ticker: "OLD", closedAt: "2026-06-01T15:00:00.000Z", pnl: 5_000 },
];
const NOW = new Date("2026-10-05T12:00:00.000Z").getTime();
const DAY = 86_400_000;

describe("realizedInWindow", () => {
  it("is the month the live book actually booked", () => {
    expect(realizedInWindow(LIVE_SALES, NOW - 30 * DAY)).toBeCloseTo(-1336.84, 2);
  });

  // The realized CURVE only has a point on days when something closed, so
  // "last minus first inside the window" uses the earliest in-window sale as
  // its baseline and drops it. PBH is that sale.
  it("counts the earliest sale in the window, which a curve delta drops", () => {
    const month = realizedInWindow(LIVE_SALES, NOW - 30 * DAY);
    const withoutEarliest = month - -802.18; // what the curve-delta method gave
    expect(withoutEarliest).toBeCloseTo(-534.66, 2);
    expect(month).not.toBeCloseTo(-534.66, 2);
  });

  // A month of losses still contains a win; the number is the net, not a mood.
  it("nets wins against losses", () => {
    expect(realizedInWindow(LIVE_SALES, NOW - 15 * DAY)).toBeCloseTo(
      -709.25 - 116.08 - 674.76 + 1157.94,
      2,
    );
  });

  it("a week holds only that week's sale", () => {
    expect(realizedInWindow(LIVE_SALES, NOW - 7 * DAY)).toBeCloseTo(-709.25, 2);
  });

  it("excludes a sale older than the window", () => {
    expect(realizedInWindow(LIVE_SALES, NOW - 365 * DAY)).toBeCloseTo(3663.16, 2);
  });

  it("no sales in the window is zero, not absent", () => {
    expect(realizedInWindow(LIVE_SALES, NOW - 1 * DAY)).toBe(0);
    expect(realizedInWindow([], NOW)).toBe(0);
  });

  it("ignores a trade with no close date or no P&L", () => {
    expect(
      realizedInWindow(
        [{ closedAt: null, pnl: 999 }, { closedAt: "2026-10-04T15:00:00.000Z", pnl: null }],
        NOW - 30 * DAY,
      ),
    ).toBe(0);
  });
});
