/**
 * contributions.test.ts — pins the deposit-stripping math that fixes the
 * homepage "+1015%" bug (a cash deposit being reported as an investment gain).
 *
 * The headline fixture mirrors the real live account: funded with ~$8k, a
 * ~$80k deposit lands mid-history, current equity $88,377.22. True lifetime
 * P&L must read ≈ +$377 (equity − $88k contributed), NOT +$81k.
 */

import {
  netContributedTotal,
  cumulativeContributions,
  contributedAsOf,
  depositAdjustedPnlCurve,
  type FundingEvent,
} from "./contributions";

// The real account's shape: two deposits ($8k seed, $80k top-up).
const LIVE_EVENTS: FundingEvent[] = [
  { date: "2026-05-10", amount: 8_000 },
  { date: "2026-05-21", amount: 80_000 },
];

// Daily equity from Alpaca — note the cliff at 05-21 when the $80k lands.
const LIVE_EQUITY = [
  { date: "2026-05-10", equity: 8_000 },
  { date: "2026-05-15", equity: 8_100 },
  { date: "2026-05-20", equity: 7_900 },
  { date: "2026-05-21", equity: 87_900 }, // 7,900 + 80,000 deposit
  { date: "2026-06-07", equity: 88_377.22 },
];

describe("netContributedTotal", () => {
  it("sums deposits minus withdrawals", () => {
    expect(netContributedTotal(LIVE_EVENTS)).toBe(88_000);
  });

  it("subtracts withdrawals (CSW arrives as a negative amount)", () => {
    const events: FundingEvent[] = [
      { date: "2026-01-01", amount: 50_000 },
      { date: "2026-03-01", amount: -10_000 },
    ];
    expect(netContributedTotal(events)).toBe(40_000);
  });

  it("is 0 for an unfunded account", () => {
    expect(netContributedTotal([])).toBe(0);
  });
});

describe("cumulativeContributions", () => {
  it("produces an ascending running total, one point per date", () => {
    expect(cumulativeContributions(LIVE_EVENTS)).toEqual([
      { date: "2026-05-10", cumulative: 8_000 },
      { date: "2026-05-21", cumulative: 88_000 },
    ]);
  });

  it("collapses same-day events before advancing the running total", () => {
    const events: FundingEvent[] = [
      { date: "2026-05-21", amount: 80_000 },
      { date: "2026-05-21", amount: 5_000 },
      { date: "2026-05-10", amount: 8_000 },
    ];
    expect(cumulativeContributions(events)).toEqual([
      { date: "2026-05-10", cumulative: 8_000 },
      { date: "2026-05-21", cumulative: 93_000 },
    ]);
  });
});

describe("contributedAsOf", () => {
  const points = cumulativeContributions(LIVE_EVENTS);

  it("is 0 before the first contribution", () => {
    expect(contributedAsOf(points, "2026-05-01")).toBe(0);
  });

  it("includes a contribution made on the exact date (inclusive)", () => {
    expect(contributedAsOf(points, "2026-05-10")).toBe(8_000);
  });

  it("holds the prior total between contributions", () => {
    expect(contributedAsOf(points, "2026-05-20")).toBe(8_000);
  });

  it("reflects the full total after the last contribution", () => {
    expect(contributedAsOf(points, "2026-06-07")).toBe(88_000);
  });
});

describe("depositAdjustedPnlCurve", () => {
  const curve = depositAdjustedPnlCurve(LIVE_EQUITY, LIVE_EVENTS);

  it("reports true lifetime P&L (~+$377), not the deposit (~+$81k)", () => {
    expect(curve[curve.length - 1].value).toBeCloseTo(377.22, 2);
  });

  it("does NOT cliff-jump across the deposit day", () => {
    const dayBefore = curve.find((p) => p.date === "2026-05-20")!.value;
    const depositDay = curve.find((p) => p.date === "2026-05-21")!.value;
    // Both are pure trading P&L (≈ −$100); the $80k transfer is invisible.
    expect(dayBefore).toBeCloseTo(-100, 2);
    expect(depositDay).toBeCloseTo(-100, 2);
    expect(Math.abs(depositDay - dayBefore)).toBeLessThan(1);
  });

  it("a range spanning the deposit shows trading P&L only, not the cash flow", () => {
    // 05-15 → 06-07 window. Naive equity delta = 88,377.22 − 8,100 = 80,277
    // (the bug). Deposit-adjusted delta = 377.22 − 100 = 277.22.
    const start = curve.find((p) => p.date === "2026-05-15")!.value;
    const end = curve[curve.length - 1].value;
    expect(end - start).toBeCloseTo(277.22, 2);
  });

  it("equals the raw equity curve when there are no funding events (paper)", () => {
    const noEvents = depositAdjustedPnlCurve(LIVE_EQUITY, []);
    expect(noEvents.map((p) => p.value)).toEqual(LIVE_EQUITY.map((p) => p.equity));
  });
});
