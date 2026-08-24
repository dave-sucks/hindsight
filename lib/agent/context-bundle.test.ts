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

import { floorPctOf, formatMoneyContextBlock } from "./context-bundle";

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
