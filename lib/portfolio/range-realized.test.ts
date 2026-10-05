/**
 * Built from the six sales on the live book in the 30 days to 2026-10-05.
 * The header showed the range's total beside ALL-TIME unrealized — two clocks
 * — so a month that booked $1,336.84 of losses sat next to "+$5,203.85
 * unrealized" and read as a contradiction.
 */
import { realizedInWindow } from "./range-realized";

const SALES = [
  { ticker: "PBH", closedAt: "2026-09-11T15:00:00.000Z", pnl: -802.18 },
  { ticker: "SRRK", closedAt: "2026-09-14T15:00:00.000Z", pnl: -192.51 },
  { ticker: "FIVE", closedAt: "2026-09-25T15:00:00.000Z", pnl: -674.76 },
  { ticker: "IOT", closedAt: "2026-09-25T15:00:00.000Z", pnl: -116.08 },
  { ticker: "ABT", closedAt: "2026-10-02T15:00:00.000Z", pnl: -709.25 },
  { ticker: "OLD", closedAt: "2026-06-01T15:00:00.000Z", pnl: 5_000 },
];
const NOW = new Date("2026-10-05T12:00:00.000Z").getTime();
const DAY = 86_400_000;

describe("realizedInWindow", () => {
  it("counts the EARLIEST sale in the window — the one a curve delta drops", () => {
    const month = realizedInWindow(SALES, NOW - 30 * DAY);
    // All five of the recent sales, PBH included.
    expect(month).toBeCloseTo(-802.18 - 192.51 - 674.76 - 116.08 - 709.25, 2);
    // The curve-delta method used PBH as its baseline and reported this.
    expect(month).not.toBeCloseTo(-534.66, 2);
  });

  it("excludes a sale older than the window", () => {
    expect(realizedInWindow(SALES, NOW - 30 * DAY)).toBeLessThan(0);
    expect(realizedInWindow(SALES, NOW - 365 * DAY)).toBeCloseTo(2_505.22, 2);
  });

  it("a week holds only that week's sale", () => {
    expect(realizedInWindow(SALES, NOW - 7 * DAY)).toBeCloseTo(-709.25, 2);
  });

  it("no sales in the window is zero, not absent", () => {
    expect(realizedInWindow(SALES, NOW - 1 * DAY)).toBe(0);
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
