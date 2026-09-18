/**
 * big-winner.test.ts — a stock that has run 20% off the buy is not cut in
 * half by the mechanical partial (DAV-294, playbook Part F: the partial at
 * N R exists to de-risk an ordinary winner, not to halve a big one).
 *
 * Replays from the live book, 2026-09-18:
 *   MU   — PEAD, cost $895.94, peak $1,034.58. Peak gain 15.5%: under the
 *          20% bar, so the partial at 2R still stands. Not every winner is
 *          a big winner.
 *   SMMT — cost $14.35, peak $18.73 in 17 days. Peak gain 30.5%: the
 *          partial is off for good and the trail manages it. (SMMT itself
 *          is a catalyst position and carries no partial; its numbers are
 *          the shape this rule is for.)
 *
 * The switch reads Position.peakPrice — the same water mark the trail
 * reads — so it needs no memory of its own and cannot drift from the trail.
 */
import { evaluateTrigger } from "./evaluate";
import { setupExitTriggers } from "./setup-exits";
import { getSetup, BIG_WINNER_PEAK_GAIN_PCT } from "@/lib/agent/knowledge/setups";
import type { TriggerPredicate } from "./types";

const PARTIAL: TriggerPredicate = {
  kind: "GAIN_FROM_ENTRY",
  pct: 12,
  direction: "UP",
  skipIfPeakGainPct: BIG_WINNER_PEAK_GAIN_PCT,
};

const fires = (p: TriggerPredicate, o: { price: number; avgCost: number; peak: number | null }) =>
  evaluateTrigger(p, {
    now: new Date("2026-09-18T15:00:00Z"),
    latestQuote: { price: o.price, changePct: 1 },
    position: { avgCost: o.avgCost, peakPrice: o.peak },
    thesis: { createdAt: new Date("2026-07-01T00:00:00Z"), direction: "LONG" },
  } as never);

describe("the partial at 2R, and the winner it lets run", () => {
  it("MU: peak gain 15.5% is under the bar, so the partial still fires at 2R", () => {
    expect(fires(PARTIAL, { price: 1010, avgCost: 895.935, peak: 1034.58 })).toBe(true);
  });

  it("SMMT's shape: peak gain 30.5% turns the partial off for good", () => {
    expect(fires(PARTIAL, { price: 18.0, avgCost: 14.35, peak: 18.725 })).toBe(false);
    // Still off after it gives some back — the trail, not the partial, manages it now.
    expect(fires(PARTIAL, { price: 16.5, avgCost: 14.35, peak: 18.725 })).toBe(false);
  });

  it("exactly at the bar counts as a big winner", () => {
    expect(fires(PARTIAL, { price: 118, avgCost: 100, peak: 120 })).toBe(false);
    expect(fires(PARTIAL, { price: 118, avgCost: 100, peak: 119.9 })).toBe(true);
  });

  it("a partial with no switch is untouched, and no tracked peak means no suppression", () => {
    const plain: TriggerPredicate = { kind: "GAIN_FROM_ENTRY", pct: 12, direction: "UP" };
    expect(fires(plain, { price: 18.0, avgCost: 14.35, peak: 18.725 })).toBe(true);
    expect(fires(PARTIAL, { price: 18.0, avgCost: 14.35, peak: null })).toBe(true);
  });

  it("a SHORT measures its run the other way", () => {
    const short = (price: number, peak: number) =>
      evaluateTrigger(PARTIAL, {
        now: new Date("2026-09-18T15:00:00Z"),
        latestQuote: { price, changePct: -1 },
        position: { avgCost: 100, peakPrice: peak },
        thesis: { createdAt: new Date("2026-07-01T00:00:00Z"), direction: "SHORT" },
      } as never);
    expect(short(86, 78)).toBe(false); // down 22% at its low — a big winner
    expect(short(86, 85)).toBe(true); // down 15% at its low — ordinary
  });

  it("the fill writes the switch on a trade and a target, never on a compounder or a catalyst", () => {
    const written = (horizon: string) =>
      setupExitTriggers({ setup: getSetup("PEAD")!, horizon, entry: 100, stop: 94, mintId: () => "x" })
        .find((t) => t.action === "TRIM")?.predicate as { skipIfPeakGainPct?: number } | undefined;
    expect(written("TARGET")?.skipIfPeakGainPct).toBe(BIG_WINNER_PEAK_GAIN_PCT);
    expect(written("TRADE")?.skipIfPeakGainPct).toBe(BIG_WINNER_PEAK_GAIN_PCT);
    expect(written("COMPOUNDER")?.skipIfPeakGainPct).toBeUndefined();
    expect(written("CATALYST")?.skipIfPeakGainPct).toBeUndefined();
  });
});
