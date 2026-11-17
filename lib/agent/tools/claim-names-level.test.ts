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
/** A price trigger by id: the same id before and after is the same trigger, moved. */
const at = (id: string, action: string, is: "above" | "below", value: number) => ({ id, action, predicate: { watch: "price", is, value }, rationale: "x" }) as never;
const mu = (floor: number, upside = 1100, buy?: number) => [
  ...(buy != null ? [at("buy", "ENTER", "below", buy)] : []),
  at("floor", "EXIT", "below", floor),
  at("up", "REVIEW", "above", upside),
];

describe("dollar figures in a claim", () => {
  it("reads prices, leaves out sizes and percentages", () => {
    expect(dollarFigures(MU.coreBelief)).toEqual([1100]);
    expect(dollarFigures(MU.invalidationConds.join("\n"))).toEqual([969]);
    expect(dollarFigures("a floor at $1,041.50 and $5K of volume, $2.5M a day, up 3% to $12")).toEqual([1041.5, 12]);
    expect(dollarFigures("no numbers here")).toEqual([]);
  });
});

describe("a moved trigger the claim still names", () => {
  it("MU 09-23: the floor leaves $969; what-proves-it-wrong still names it", () => {
    expect(claimNamesOldLevel({ before: mu(969), after: mu(1041), ...MU })).toEqual([
      'Your what-proves-it-wrong line still names $969; the trigger now reads "Sell if below $1041".',
    ]);
  });
  it("the upside line leaves $1,100; the belief names it", () => {
    expect(claimNamesOldLevel({ before: mu(1041, 1100), after: mu(1041, 1150), ...MU })).toEqual([
      'Your belief still names $1,100; the trigger now reads "Review if above $1150".',
    ]);
  });
  it("within half a percent counts; further off does not", () => {
    expect(claimNamesOldLevel({ before: mu(965.5), after: mu(1000), ...MU })).toHaveLength(1);
    expect(claimNamesOldLevel({ before: mu(960), after: mu(1000), ...MU })).toEqual([]);
  });
  it("nothing moved, or the claim names none of the old numbers, or the claim was rewritten with the move, or the trigger is new: no line", () => {
    expect(claimNamesOldLevel({ before: mu(969), after: mu(969), ...MU })).toEqual([]);
    expect(claimNamesOldLevel({ before: mu(1041), after: mu(1060), ...MU })).toEqual([]);
    expect(claimNamesOldLevel({ before: mu(969), after: mu(1041), coreBelief: MU.coreBelief, invalidationConds: ["MU closes below the $1,041 floor"] })).toEqual([]);
    expect(claimNamesOldLevel({ before: [], after: mu(90, 130, 100), coreBelief: "a buy at $100", invalidationConds: [] })).toEqual([]);
  });
  it("a watched stock's buy and its Stop watching line are each said as the trigger now reads", () => {
    expect(claimNamesOldLevel({ before: mu(90, 130, 100), after: mu(90, 130, 104), coreBelief: "Enter at $100 on the pullback.", invalidationConds: [] })).toEqual([
      'Your belief still names $100; the trigger now reads "Buy if below $104".',
    ]);
    const watch = (v: number) => [at("out", "STOP_WATCHING", "below", v)];
    expect(claimNamesOldLevel({ before: watch(90), after: watch(92), coreBelief: "Out below $90 on a close", invalidationConds: [] })).toEqual([
      'Your belief still names $90; the trigger now reads "Stop watching if below $92".',
    ]);
  });
});
