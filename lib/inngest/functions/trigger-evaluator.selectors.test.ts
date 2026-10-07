/**
 * trigger-evaluator.selectors.test.ts — which rungs each pass looks at, and
 * what each pass loads (DAV-247). The close pass reads only close-basis
 * rungs; the snapshot and today's volume load only when a rung reads them.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})) } }));

import { __test__ } from "./trigger-evaluator";
import type { When } from "@/lib/agent/triggers/condition";


const { hasCloseBasis, needsIndicators, needsTodayVolume, isClosePassTick, isPriceSidePredicate } = __test__;

const breakout: When = { match: "all", conditions: [{ watch: "price", is: "above", value: 100, settings: { close: true } }, { watch: "volume", value: 1.5 }] };

describe("hasCloseBasis", () => {
  it("finds a close-basis level, alone or inside a composite", () => {
    expect(hasCloseBasis({ watch: "price", is: "above", value: 1, settings: { close: true } })).toBe(true);
    expect(hasCloseBasis(breakout)).toBe(true);
  });
  it("an intraday level is not a close rung", () => {
    expect(hasCloseBasis({ watch: "price", is: "below", value: 1 })).toBe(false);
    expect(hasCloseBasis({ watch: "move", is: "near", value: 2, variable: "sma50" })).toBe(false);
  });
});

describe("needsIndicators / needsTodayVolume", () => {
  it("chart kinds and the multi-day move load the snapshot; 1D and price levels don't", () => {
    expect(needsIndicators({ watch: "price", is: "above", variable: "sma50" })).toBe(true);
    expect(needsIndicators({ watch: "move", is: "above", value: 5, variable: "close_5d" })).toBe(true);
    expect(needsIndicators({ watch: "move", is: "above", value: 5, variable: "prev_close" })).toBe(false);
    expect(needsIndicators({ watch: "price", is: "above", value: 1 })).toBe(false);
    expect(needsIndicators(breakout)).toBe(true);
  });
  it("only volume and gap kinds fetch today's volume", () => {
    expect(needsTodayVolume(breakout)).toBe(true);
    expect(needsTodayVolume({ watch: "gap", value: 8, settings: { volume: 3 } })).toBe(true);
    expect(needsTodayVolume({ watch: "move", is: "near", value: 2, variable: "sma50" })).toBe(false);
  });
});

describe("isPriceSidePredicate", () => {
  it("every chart kind is evaluated on the cron", () => {
    for (const p of [
      { watch: "move", is: "near", value: 2, variable: "sma50" },
      { watch: "volume", value: 1.5 },
      { watch: "price", is: "above", variable: "high20" },
      { watch: "move", is: "near", value: 5, variable: "high52" },
      { watch: "strength", value: 0, settings: { window: "3M" } },
      { watch: "gap", value: 8, settings: { volume: 3 } },
      { watch: "rsi", is: "below", value: 30 },
      breakout,
    ] as When[]) {
      expect({ p, cron: isPriceSidePredicate(p) }).toEqual({ p, cron: true });
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
