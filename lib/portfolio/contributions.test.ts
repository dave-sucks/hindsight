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
  alignFundingToEquity,
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

// Real-account regression: Alpaca dated the $40k CSD on 2026-05-21 but the
// portfolio-history equity didn't reflect it until 2026-05-22 (settlement lag).
// The un-aligned math produced equity(48k) − contributed(88k) = −$40k on 05-21,
// a single outlier that wrecked the chart's auto-scale. (Mirrors the live data
// pulled 2026-06-18: deposits 05-14 $8k, 05-15 $40k, 05-21 $40k.)
const LAG_EVENTS: FundingEvent[] = [
  { date: "2026-05-14", amount: 8_000 },
  { date: "2026-05-15", amount: 40_000 },
  { date: "2026-05-21", amount: 40_000 }, // CSD transaction date
];
const LAG_EQUITY = [
  { date: "2026-05-19", equity: 48_000 },
  { date: "2026-05-20", equity: 48_000 },
  { date: "2026-05-21", equity: 48_000 }, // deposit not settled yet
  { date: "2026-05-22", equity: 88_000 }, // $40k lands here
  { date: "2026-05-30", equity: 88_529.32 },
  { date: "2026-06-18", equity: 90_319.37 },
];

describe("alignFundingToEquity", () => {
  it("snaps a lagged deposit forward to the equity settlement date", () => {
    const aligned = alignFundingToEquity(LAG_EQUITY, LAG_EVENTS);
    const may21 = aligned.find((e) => e.amount === 40_000 && e.date === "2026-05-22");
    expect(may21).toBeTruthy(); // 05-21 CSD snapped to 05-22
  });

  it("leaves an already-settled-same-day deposit on its own date", () => {
    // LIVE_EQUITY steps up on the deposit's own date (05-21) — no shift.
    const aligned = alignFundingToEquity(LIVE_EQUITY, LIVE_EVENTS);
    expect(aligned.find((e) => e.amount === 80_000)!.date).toBe("2026-05-21");
  });

  it("leaves withdrawals and the empty case untouched", () => {
    const withdrawal: FundingEvent[] = [{ date: "2026-05-21", amount: -5_000 }];
    expect(alignFundingToEquity(LAG_EQUITY, withdrawal)).toEqual(withdrawal);
    expect(alignFundingToEquity(LAG_EQUITY, [])).toEqual([]);
    expect(alignFundingToEquity([], LAG_EVENTS)).toEqual(LAG_EVENTS);
  });

  it("does not change the net contributed total (timing only)", () => {
    const aligned = alignFundingToEquity(LAG_EQUITY, LAG_EVENTS);
    expect(netContributedTotal(aligned)).toBe(netContributedTotal(LAG_EVENTS));
  });
});

describe("depositAdjustedPnlCurve — settlement-lag artifact", () => {
  const curve = depositAdjustedPnlCurve(LAG_EQUITY, LAG_EVENTS);

  it("produces NO −$40k spike on the deposit's transaction date", () => {
    const may21 = curve.find((p) => p.date === "2026-05-21")!.value;
    expect(may21).toBeCloseTo(0, 2); // was −40,000 before the fix
  });

  it("keeps the whole curve in the true trading-P&L band (no huge outlier)", () => {
    const values = curve.map((p) => p.value);
    expect(Math.min(...values)).toBeGreaterThan(-1_000);
    expect(Math.max(...values)).toBeLessThan(3_000);
  });

  it("still reports correct lifetime P&L at the end (equity − $88k)", () => {
    expect(curve[curve.length - 1].value).toBeCloseTo(2_319.37, 2);
  });
});
