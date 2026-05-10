// Mock Prisma and closeTrade so we can test pure functions without DB
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/actions/closeTrade.actions", () => ({
  closeTrade: jest.fn(),
}));

import { evaluateExitStrategy, targetProximity, stopProximity } from "./trade-exit";

// ─── PRICE_TARGET / TIME_BASED → no-op after Fix #0 ──────────────────────────
// Fix #0 (docs/MORNING_RUN_V2_DESIGN.md) made per-thesis triggers the single
// source of truth for non-trailing exits. evaluateExitStrategy now no-ops for
// any strategy other than TRAILING; the PRICE_TARGET / TIME_BASED test suites
// were deleted with the branches.

describe("evaluateExitStrategy — non-TRAILING strategies are no-ops", () => {
  it("returns null for legacy PRICE_TARGET regardless of price vs levels", () => {
    const legacy = {
      direction: "LONG" as const,
      exitStrategy: "PRICE_TARGET" as const,
      trailingStopPct: null,
    };
    // Below stop, at target, above target — all should no-op.
    expect(evaluateExitStrategy(legacy, 50, 50)).toBeNull();
    expect(evaluateExitStrategy(legacy, 200, 200)).toBeNull();
  });

  it("returns null for legacy TIME_BASED regardless of price", () => {
    const legacy = {
      direction: "SHORT" as const,
      exitStrategy: "TIME_BASED" as const,
      trailingStopPct: null,
    };
    expect(evaluateExitStrategy(legacy, 50, 50)).toBeNull();
    expect(evaluateExitStrategy(legacy, 200, 200)).toBeNull();
  });
});

// ─── TRAILING — still active (explicit opt-in via manage_position) ───────────

describe("TRAILING — LONG", () => {
  const trailingLong = {
    direction: "LONG" as const,
    exitStrategy: "TRAILING" as const,
    trailingStopPct: 10,
  };

  it("returns STOP when price drops 10% from peak", () => {
    // peak = 130, 10% trail = 117, current = 115 → STOP
    expect(evaluateExitStrategy(trailingLong, 115, 130)).toEqual({
      reason: "STOP",
      label: "Trailing stop hit (10% from peak $130.00)",
    });
  });

  it("returns null when price is above trailing stop", () => {
    // peak = 130, 10% trail = 117, current = 120 → hold
    expect(evaluateExitStrategy(trailingLong, 120, 130)).toBeNull();
  });

  it("uses default 5% when trailingStopPct is null", () => {
    const noTrail = { ...trailingLong, trailingStopPct: null };
    // peak = 100, 5% trail = 95, current = 94 → STOP
    expect(evaluateExitStrategy(noTrail, 94, 100)).toEqual({
      reason: "STOP",
      label: "Trailing stop hit (5% from peak $100.00)",
    });
  });
});

describe("TRAILING — SHORT", () => {
  const trailingShort = {
    direction: "SHORT" as const,
    exitStrategy: "TRAILING" as const,
    trailingStopPct: 10,
  };

  it("returns STOP when price rises 10% from peak (lowest point)", () => {
    // peak (lowest) = 70, 10% trail up = 77, current = 78 → STOP
    expect(evaluateExitStrategy(trailingShort, 78, 70)).toEqual({
      reason: "STOP",
      label: "Trailing stop hit (10% from peak $70.00)",
    });
  });

  it("returns null when price is below trailing stop", () => {
    // peak = 70, trail = 77, current = 75 → hold
    expect(evaluateExitStrategy(trailingShort, 75, 70)).toBeNull();
  });
});

// ─── MANUAL — new default after Fix #0 ───────────────────────────────────────

describe("MANUAL", () => {
  it("never auto-closes regardless of price", () => {
    const manual = {
      direction: "LONG" as const,
      exitStrategy: "MANUAL" as const,
      trailingStopPct: null,
    };
    expect(evaluateExitStrategy(manual, 30, 30)).toBeNull();
    expect(evaluateExitStrategy(manual, 250, 250)).toBeNull();
  });
});

// ─── targetProximity / stopProximity helpers (still used by email path) ─────

describe("targetProximity", () => {
  it("returns 1.0 when at target (LONG)", () => {
    expect(
      targetProximity({ direction: "LONG", avgCost: 100, targetPrice: 120 }, 120)
    ).toBe(1);
  });

  it("returns 0.5 halfway to target (LONG)", () => {
    expect(
      targetProximity({ direction: "LONG", avgCost: 100, targetPrice: 120 }, 110)
    ).toBe(0.5);
  });

  it("returns 0.9 for 90% to target (SHORT)", () => {
    expect(
      targetProximity({ direction: "SHORT", avgCost: 100, targetPrice: 80 }, 82)
    ).toBeCloseTo(0.9);
  });

  it("returns 0 at entry price", () => {
    expect(
      targetProximity({ direction: "LONG", avgCost: 100, targetPrice: 120 }, 100)
    ).toBe(0);
  });

  it("clamps to 0 if price moves away from target", () => {
    expect(
      targetProximity({ direction: "LONG", avgCost: 100, targetPrice: 120 }, 90)
    ).toBe(0);
  });
});

describe("stopProximity", () => {
  it("returns 1.0 when price reaches stop (LONG)", () => {
    expect(
      stopProximity({ direction: "LONG", avgCost: 100, stopLoss: 90 }, 90)
    ).toBe(1);
  });

  it("returns 0 when price is at entry (LONG)", () => {
    expect(
      stopProximity({ direction: "LONG", avgCost: 100, stopLoss: 90 }, 100)
    ).toBe(0);
  });

  it("returns 1.0 when price reaches stop (SHORT)", () => {
    expect(
      stopProximity({ direction: "SHORT", avgCost: 100, stopLoss: 110 }, 110)
    ).toBe(1);
  });
});
