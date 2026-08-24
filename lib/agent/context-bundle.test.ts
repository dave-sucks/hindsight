/**
 * context-bundle.test.ts — the pure halves of System 1's money context
 * (THREE_SYSTEMS.md Move 1). The fetch half is deliberately thin (creds →
 * equity, fail-open) and covered by the writer/discovery paths using it.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/actions/api-keys.actions", () => ({
  resolveAlpacaCredentials: jest.fn(),
}));
jest.mock("@/lib/alpaca", () => ({ getAccount: jest.fn() }));

import {
  floorPctOf,
  formatMoneyContextBlock,
  formatNameHistoryBlock,
  isHousekeepingClose,
} from "./context-bundle";

describe("floorPctOf", () => {
  it("rounds UP to one decimal — the percent that clears the floor", () => {
    // $7,000 floor at $125k equity = 5.6% exactly
    expect(floorPctOf({ equityUSD: 125_000, floorDollars: 7000 })).toBe(5.6);
    // $7,000 at $124k = 5.645…% → 5.7 (rounding down would under-clear)
    expect(floorPctOf({ equityUSD: 124_000, floorDollars: 7000 })).toBe(5.7);
  });

  it("returns null when either input is unavailable", () => {
    expect(floorPctOf({ equityUSD: null, floorDollars: 7000 })).toBeNull();
    expect(floorPctOf({ equityUSD: 125_000, floorDollars: 0 })).toBeNull();
    expect(floorPctOf({ equityUSD: 0, floorDollars: 7000 })).toBeNull();
  });
});

describe("formatMoneyContextBlock", () => {
  it("states equity, the band, the floor percent, and the PASS rule", () => {
    const block = formatMoneyContextBlock({
      equityUSD: 125_000,
      floorDollars: 7000,
      ceilingDollars: 14_000,
      floorPct: 5.6,
    });
    expect(block).toContain("$125,000");
    expect(block).toContain("$7,000 floor to $14,000 ceiling");
    expect(block).toContain("5.6% of the book");
    expect(block).toContain("PASS");
  });

  it("degrades honestly when equity is unavailable", () => {
    const block = formatMoneyContextBlock({
      equityUSD: null,
      floorDollars: 7000,
      ceilingDollars: 14_000,
      floorPct: null,
    });
    expect(block).toContain("equity unavailable");
    expect(block).not.toContain("% of the book");
    expect(block).toContain("$7,000 floor");
  });

  it("returns empty when the seat has no band at all", () => {
    expect(
      formatMoneyContextBlock({
        equityUSD: 125_000,
        floorDollars: 0,
        ceilingDollars: null,
        floorPct: null,
      }),
    ).toBe("");
  });

  it("handles ceiling-only seats (no floor configured)", () => {
    const block = formatMoneyContextBlock({
      equityUSD: null,
      floorDollars: 0,
      ceilingDollars: 5000,
      floorPct: null,
    });
    expect(block).toContain("ceiling: $5,000");
    expect(block).toContain("no floor configured");
  });
});

describe("formatNameHistoryBlock", () => {
  const base = { ticker: "PLTR", lastExit: null, priorVerdicts: [], timesHeld: 0 };

  it("is empty when the analyst has no past on the name", () => {
    expect(formatNameHistoryBlock(base)).toBe("");
  });

  it("leads with the sale, with price and reason", () => {
    const block = formatNameHistoryBlock({
      ...base,
      lastExit: { exitPrice: 66.53, daysAgo: 3, closeReason: "STOP" },
      timesHeld: 1,
    });
    expect(block).toContain("SOLD it 3 days ago at $66.53");
    expect(block).toContain("STOP");
    expect(block).toContain("what is DIFFERENT now");
  });

  it("lists prior passes with the analyst's own words", () => {
    const block = formatNameHistoryBlock({
      ...base,
      priorVerdicts: [
        { verdict: "PASSED", daysAgo: 21, reason: "valuation ahead of fundamentals" },
      ],
    });
    expect(block).toContain("PASSED 21d ago");
    expect(block).toContain("valuation ahead of fundamentals");
  });

  it("does not print the same sale twice (lastExit + verdict list)", () => {
    const block = formatNameHistoryBlock({
      ...base,
      lastExit: { exitPrice: 100, daysAgo: 5, closeReason: "STOP" },
      priorVerdicts: [
        { verdict: "SOLD", daysAgo: 5, reason: "stopped out" },
        { verdict: "PASSED", daysAgo: 40, reason: "too early" },
      ],
      timesHeld: 1,
    });
    expect(block.match(/5d ago|5 days ago/g)?.length).toBe(1);
    expect(block).toContain("PASSED 40d ago");
  });

  it("uses singular day wording for a one-day-old exit", () => {
    const block = formatNameHistoryBlock({
      ...base,
      lastExit: { exitPrice: null, daysAgo: 1, closeReason: null },
    });
    expect(block).toContain("1 day ago");
    expect(block).not.toContain("1 days ago");
  });
});


describe("isHousekeepingClose — bulk repairs are not trading decisions", () => {
  it("catches the two live-book cleanup markers (99 of ~140 SOLD rows)", () => {
    expect(
      isHousekeepingClose("orphan-cleanup-2026-05-06: not held, not on watchlist"),
    ).toBe(true);
    expect(
      isHousekeepingClose("cleanup-2026-05-07: PASS-decorative or LONG/SHORT-without"),
    ).toBe(true);
  });

  it("leaves real exits alone", () => {
    expect(isHousekeepingClose("STOP")).toBe(false);
    expect(isHousekeepingClose("MANUAL — Closing ahead of NVIDIA earnings.")).toBe(false);
    expect(isHousekeepingClose(null)).toBe(false);
    expect(isHousekeepingClose("")).toBe(false);
  });

  it("does not match a real reason that merely mentions cleanup", () => {
    expect(
      isHousekeepingClose("Selling into the balance-sheet cleanup announced today"),
    ).toBe(false);
  });
});
