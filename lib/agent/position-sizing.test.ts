/**
 * manage-position-scale-ceiling.test.ts — regression guard for the scale-in
 * ceiling (docs/plans/SCALE_INTO_WINNERS.md, PR1).
 *
 * The add_to_position gate lets a held winner grow to SCALE_IN_CEILING_MULTIPLE ×
 * the normal per-entry cap. On LIVE the base must respect realMaxPosition (the
 * live per-position cap); the pre-PR1 code used a flat maxPositionSize × 1.5 and
 * ignored realMaxPosition, so a LIVE add could grow past the live cap. These
 * tests pin the new behavior.
 */

import {
  scaleInCeiling,
  SCALE_IN_CEILING_MULTIPLE,
} from "@/lib/agent/position-sizing";

describe("scaleInCeiling", () => {
  it("is 2× per the principal's decision", () => {
    expect(SCALE_IN_CEILING_MULTIPLE).toBe(2);
  });

  it("PAPER: 2× maxPositionSize, ignores realMaxPosition", () => {
    expect(
      scaleInCeiling({
        environment: "PAPER",
        maxPositionSize: 2500,
        realMaxPosition: 1000, // must be ignored on PAPER
      }),
    ).toBe(5000);
  });

  it("LIVE: uses the smaller of maxPositionSize and realMaxPosition as the base", () => {
    // base = min(2500, 1500) = 1500 → ceiling = 3000
    expect(
      scaleInCeiling({
        environment: "LIVE",
        maxPositionSize: 2500,
        realMaxPosition: 1500,
      }),
    ).toBe(3000);
  });

  it("LIVE: realMaxPosition higher than maxPositionSize → maxPositionSize wins the base", () => {
    // base = min(2500, 9000) = 2500 → ceiling = 5000
    expect(
      scaleInCeiling({
        environment: "LIVE",
        maxPositionSize: 2500,
        realMaxPosition: 9000,
      }),
    ).toBe(5000);
  });

  it("LIVE with no realMaxPosition falls back to maxPositionSize base", () => {
    expect(
      scaleInCeiling({ environment: "LIVE", maxPositionSize: 2000 }),
    ).toBe(4000);
  });

  it("falls back to 5000 base when no cap is configured (matches place_trade)", () => {
    expect(scaleInCeiling({ environment: "PAPER" })).toBe(10000);
    expect(scaleInCeiling({ environment: "LIVE" })).toBe(10000);
  });

  it("honors an explicit multiple override", () => {
    expect(
      scaleInCeiling({
        environment: "PAPER",
        maxPositionSize: 2500,
        multiple: 1.5,
      }),
    ).toBe(3750);
  });

  it("the add gate compares (cost basis + add notional) against the ceiling", () => {
    // A LIVE winner: base $2,500 cap → $5,000 ceiling. Held cost basis $4,000.
    const ceiling = scaleInCeiling({
      environment: "LIVE",
      maxPositionSize: 2500,
      realMaxPosition: 2500,
    });
    const costBasis = 4000;
    expect(costBasis + 900 > ceiling).toBe(false); // $4,900 add allowed
    expect(costBasis + 1500 > ceiling).toBe(true); // $5,500 add rejected
  });
});
