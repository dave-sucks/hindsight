/**
 * trigger-evaluator.selectors.test.ts — which rungs each pass looks at, and
 * what each pass loads (DAV-247). The close pass reads only close-basis
 * rungs; the snapshot and today's volume load only when a rung reads them.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})) } }));

import { __test__ } from "./trigger-evaluator";
import type { TriggerPredicate } from "@/lib/agent/triggers/types";

const { hasCloseBasis, needsIndicators, needsTodayVolume, isClosePassTick, isPriceSidePredicate } = __test__;

const breakout: TriggerPredicate = {
  kind: "AND",
  predicates: [
    { kind: "PRICE_ABOVE", level: 100, basis: "close" },
    { kind: "VOLUME_RATIO", min: 1.5 },
  ],
};

describe("hasCloseBasis", () => {
  it("finds a close-basis level, alone or inside a composite", () => {
    expect(hasCloseBasis({ kind: "PRICE_ABOVE", level: 1, basis: "close" })).toBe(true);
    expect(hasCloseBasis(breakout)).toBe(true);
  });
  it("an intraday level is not a close rung", () => {
    expect(hasCloseBasis({ kind: "PRICE_BELOW", level: 1 })).toBe(false);
    expect(hasCloseBasis({ kind: "NEAR_SMA", period: 50, withinPct: 2 })).toBe(false);
  });
});

describe("needsIndicators / needsTodayVolume", () => {
  it("chart kinds and the multi-day move load the snapshot; 1D and price levels don't", () => {
    expect(needsIndicators({ kind: "VS_SMA", period: 50, direction: "ABOVE" })).toBe(true);
    expect(needsIndicators({ kind: "PRICE_MOVE_PCT", pct: 5, direction: "UP", window: "5D" })).toBe(true);
    expect(needsIndicators({ kind: "PRICE_MOVE_PCT", pct: 5, direction: "UP", window: "1D" })).toBe(false);
    expect(needsIndicators({ kind: "PRICE_ABOVE", level: 1 })).toBe(false);
    expect(needsIndicators(breakout)).toBe(true);
  });
  it("only volume and gap kinds fetch today's volume", () => {
    expect(needsTodayVolume(breakout)).toBe(true);
    expect(needsTodayVolume({ kind: "GAP_UP", minPct: 8, minVolRatio: 3 })).toBe(true);
    expect(needsTodayVolume({ kind: "NEAR_SMA", period: 50, withinPct: 2 })).toBe(false);
  });
});

describe("isPriceSidePredicate", () => {
  it("every chart kind is evaluated on the cron", () => {
    for (const p of [
      { kind: "NEAR_SMA", period: 50, withinPct: 2 },
      { kind: "VOLUME_RATIO", min: 1.5 },
      { kind: "NEW_HIGH", window: "20D" },
      { kind: "PCT_FROM_52W_HIGH", max: 5 },
      { kind: "RS_VS_SPY", window: "3M", min: 0 },
      { kind: "GAP_UP", minPct: 8, minVolRatio: 3 },
      { kind: "RSI", threshold: 30, direction: "BELOW" },
      breakout,
    ] as TriggerPredicate[]) {
      expect({ kind: p.kind, cron: isPriceSidePredicate(p) }).toEqual({ kind: p.kind, cron: true });
    }
  });
});

describe("isClosePassTick", () => {
  // 2026-09-10 is a Thursday (EDT, UTC−4).
  it("16:20–16:34 ET on a trading day is the close pass", () => {
    expect(isClosePassTick(new Date("2026-09-10T20:20:00Z"))).toBe(true);
    expect(isClosePassTick(new Date("2026-09-10T20:30:00Z"))).toBe(true);
  });
  it("not before 16:20, not from 16:35", () => {
    expect(isClosePassTick(new Date("2026-09-10T20:15:00Z"))).toBe(false);
    expect(isClosePassTick(new Date("2026-09-10T20:35:00Z"))).toBe(false);
  });
  it("not on a weekend", () => {
    expect(isClosePassTick(new Date("2026-09-12T20:20:00Z"))).toBe(false);
  });
});
