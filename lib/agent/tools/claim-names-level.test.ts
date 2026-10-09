/**
 * claim-names-level.test.ts — the one sentence a save adds when it moves a
 * level the claim still names (step 12, part 1), on MU's real claim text.
 */
import { claimNamesOldLevel, dollarFigures } from "./claim-names-level";

/** MU's claim as it stood on 2026-09-23 (and still on 10-09). */
const MU = {
  coreBelief:
    "Micron's HBM supply is contracted through 2027 with $22B in strategic customer agreements and $18B in cash deposits already secured, sustaining a multi-quarter earnings-upgrade cycle that drives MU to $1,100 before the September 30 Q4 FY2026 print as each sequential record forces estimate revisions higher.",
  invalidationConds: [
    "MU closes below the $969 stop-loss, signaling a break below the 50-day SMA and invalidating the drift recovery",
    "Q4 FY2026 earnings on September 30 deliver revenue materially below $50B guidance or guidance for Q1 FY2027 is cut, breaking the multi-quarter upgrade cycle",
    "A major HBM customer (Nvidia, AMD) publicly reduces or delays memory commitments under the strategic customer agreements",
  ],
};
const levels = (entryPrice: number | null, targetPrice: number | null, stopLoss: number | null) => ({ entryPrice, targetPrice, stopLoss });

describe("dollar figures in a claim", () => {
  it("reads prices, leaves out sizes and percentages", () => {
    expect(dollarFigures(MU.coreBelief)).toEqual([1100]);
    expect(dollarFigures(MU.invalidationConds.join("\n"))).toEqual([969]);
    expect(dollarFigures("a floor at $1,041.50 and $5K of volume, $2.5M a day, up 3% to $12")).toEqual([1041.5, 12]);
    expect(dollarFigures("no numbers here")).toEqual([]);
  });
});

describe("a moved level the claim still names", () => {
  it("MU 09-23: the floor leaves $969; what-proves-it-wrong still names it", () => {
    expect(claimNamesOldLevel({ before: levels(895.935, 1100, 969), after: levels(895.935, 1100, 1041), ...MU })).toEqual([
      "Your what-proves-it-wrong line still names $969; the floor is now $1,041.",
    ]);
  });
  it("the target leaves $1,100; the belief names it", () => {
    expect(claimNamesOldLevel({ before: levels(895.935, 1100, 1041), after: levels(895.935, 1150, 1041), ...MU })).toEqual([
      "Your belief still names $1,100; the target is now $1,150.",
    ]);
  });
  it("within half a percent counts; further off does not", () => {
    expect(claimNamesOldLevel({ before: levels(null, null, 965.5), after: levels(null, null, 1000), ...MU })).toHaveLength(1);
    expect(claimNamesOldLevel({ before: levels(null, null, 960), after: levels(null, null, 1000), ...MU })).toEqual([]);
  });
  it("nothing moved, or the claim names none of the old numbers, or the claim was rewritten with the move: no line", () => {
    expect(claimNamesOldLevel({ before: levels(895.935, 1100, 969), after: levels(895.935, 1100, 969), ...MU })).toEqual([]);
    expect(claimNamesOldLevel({ before: levels(895.935, 1100, 1041), after: levels(895.935, 1100, 1060), ...MU })).toEqual([]);
    expect(claimNamesOldLevel({ before: levels(895.935, 1100, 969), after: levels(895.935, 1100, 1041), coreBelief: MU.coreBelief, invalidationConds: ["MU closes below the $1,041 floor"] })).toEqual([]);
    expect(claimNamesOldLevel({ before: levels(null, null, null), after: levels(100, 130, 90), coreBelief: "a buy at $100", invalidationConds: [] })).toEqual([]);
  });
  it("a watched stock's buy level is said as the buy level", () => {
    expect(claimNamesOldLevel({ before: levels(100, 130, 90), after: levels(104, 130, 90), coreBelief: "Enter at $100 on the pullback.", invalidationConds: [] })).toEqual([
      "Your belief still names $100; the buy level is now $104.",
    ]);
  });
});
