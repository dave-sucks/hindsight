/**
 * review-fixes.test.ts — the holes the post-merge review of #628/#630 found,
 * each pinned by the scenario that exposed it.
 */

import { applyTriggerOps } from "./ops";
import { protectiveRatchetViolations } from "./ratchet";
import { shouldFire } from "./evaluate";
import { describeChartFire } from "./chart-context";
import { computeNeedsAction } from "@/lib/agent/needs-action";
import type { Trigger } from "./types";
import type { IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";

const closeBuy: Trigger = {
  id: "buy",
  predicate: { kind: "PRICE_ABOVE", level: 517.88, basis: "close" },
  action: "ENTER",
  rationale: "Buy on a close above the $517.88 pivot.",
  source: "AGENT",
};
const floor: Trigger = {
  id: "floor",
  predicate: { kind: "PRICE_BELOW", level: 475 },
  action: "EXIT",
  rationale: "Floor — sell below $475, the base low.",
  source: "AGENT",
};

describe("a level edit keeps WHEN the level fires", () => {
  it("moving a close-basis buy level keeps it close-basis (plan-level op)", () => {
    const out = applyTriggerOps({
      stored: [closeBuy, floor],
      ops: [{ op: "level", slot: "ENTRY", price: 520 }],
      direction: "LONG",
      status: "WATCHING",
      actor: "PRINCIPAL",
      currentPrice: 492.44,
      mintId: () => "x",
    });
    expect(out.results[0].ok).toBe(true);
    expect(out.triggers.find((t) => t.id === "buy")!.predicate).toEqual({ kind: "PRICE_ABOVE", level: 520, basis: "close" });
  });

  it("…and through an edit-by-id", () => {
    const out = applyTriggerOps({
      stored: [closeBuy, floor],
      ops: [{ op: "edit", id: "buy", level: 522, rationale: "New pivot after the handle." }],
      direction: "LONG",
      status: "WATCHING",
      actor: "AGENT",
      currentPrice: 492.44,
      mintId: () => "x",
    });
    expect(out.triggers.find((t) => t.id === "buy")!.predicate).toMatchObject({ level: 522, basis: "close" });
  });
});

describe("the ratchet sees a stop moved to close-basis as a loosening", () => {
  it("same level, intraday → close on a held floor is LOWERED", () => {
    const v = protectiveRatchetViolations({
      direction: "LONG",
      before: [floor],
      after: [{ ...floor, predicate: { kind: "PRICE_BELOW", level: 475, basis: "close" } }],
      inherited: [],
    });
    expect(v.map((x) => x.reason)).toEqual(["LOWERED"]);
  });
  it("close → intraday is a tightening, allowed", () => {
    const v = protectiveRatchetViolations({
      direction: "LONG",
      before: [{ ...floor, predicate: { kind: "PRICE_BELOW", level: 475, basis: "close" } }],
      after: [floor],
      inherited: [],
    });
    expect(v).toEqual([]);
  });
});

describe("the daily run's 'matching now' respects the close", () => {
  const input = (now: string) =>
    computeNeedsAction({
      thesis: {
        id: "t",
        direction: "LONG",
        status: "WATCHING",
        triggers: [closeBuy],
        createdAt: new Date("2026-09-01T00:00:00Z"),
        lastReviewedAt: new Date(now),
        horizon: "TARGET",
      },
      latestQuote: { price: 520, changePct: 1 },
      now: new Date(now),
    });
  it("mid-session a close-basis buy is not 'true now' — it waits for the close pass", () => {
    // 2026-09-10 15:00 UTC = 11:00 ET, market open.
    expect(input("2026-09-10T15:00:00Z")?.kind).not.toBe("TRIGGER_MATCHING_NOW");
  });
  it("after the close the last price is a close, so it reads true", () => {
    // 22:00 UTC = 18:00 ET.
    expect(input("2026-09-10T22:00:00Z")?.kind).toBe("TRIGGER_MATCHING_NOW");
  });
});

const snap: IndicatorSnapshot = {
  asOf: "2026-09-10",
  sma: { 20: 494.5, 50: 451.44, 150: 417.55, 200: 431.14 },
  high20: 517.78,
  low20: 477.15,
  high52w: 553.72,
  low52w: 349.2,
  volumeAvg20: 22_000_000,
  closes: Array.from({ length: 60 }, (_, i) => 440 + i),
  rsVsSpy: { "1M": -0.6, "3M": 19.5, "6M": 9.6 },
  gaps: [],
  atr14: 10.98,
};

describe("a multi-day move ENTER fires on the crossing, like a price level", () => {
  const t: Trigger = {
    id: "m",
    predicate: { kind: "PRICE_MOVE_PCT", pct: 5, direction: "UP", window: "5D" },
    action: "ENTER",
    rationale: "Momentum",
  };
  const ctx = (price: number, prevClose: number) => ({
    latestQuote: { price, changePct: 0, prevClose },
    indicators: snap,
    thesis: { createdAt: new Date() },
    now: new Date("2026-09-11T15:00:00Z"),
  });
  it("fires the day the 5-session move first reaches 5%", () => {
    // closes[55] = 495 → 520 is +5.05%; yesterday's 499 was +0.8%.
    expect(shouldFire(t, ctx(520, 499)).fires).toBe(true);
  });
  it("does not re-fire while it merely stays up", () => {
    expect(shouldFire(t, ctx(525, 521)).reason).toBe("no-crossing");
  });
});

describe("a chart fire carries its numbers", () => {
  it("names the average and the price", () => {
    expect(describeChartFire({ kind: "NEAR_SMA", period: 50, withinPct: 2 }, snap, 455)).toBe(
      "50-day $451.44; price $455.00 (+0.8% from it)",
    );
  });
  it("joins a composite's parts", () => {
    expect(
      describeChartFire(
        { kind: "AND", predicates: [{ kind: "PRICE_ABOVE", level: 517.88, basis: "close" }, { kind: "VOLUME_RATIO", min: 1.5 }] },
        snap,
        520,
        { volume: 35_000_000 },
      ),
    ).toBe("volume so far 35.00M = 1.59× the 20-day average");
  });
  it("says nothing without a snapshot", () => {
    expect(describeChartFire({ kind: "VS_SMA", period: 50, direction: "ABOVE" }, null, 455)).toBeNull();
  });
});
