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
  positionBand,
  SCALE_IN_CEILING_MULTIPLE,
} from "@/lib/agent/position-sizing";

/**
 * positionBand — the per-ENTRY band place_trade enforces (Guardrails 5a/5b).
 *
 * The floor half exists because the config was ceilings-only: PEAD Specialist
 * proposed $3,566 against a $14,000 ceiling, and Secular Compounder opened a
 * 1-share $922 LITE position against a $15,000 ceiling. Prose floors in
 * `analystPrompt` were Layer 3 doing Layer 1's job.
 */
describe("positionBand", () => {
  it("PAPER: ceiling is maxPositionSize, promotion cap ignored", () => {
    const band = positionBand({
      environment: "PAPER",
      minPositionSize: 7000,
      maxPositionSize: 14000,
      realMaxPosition: 1000, // must be ignored on PAPER
    });
    expect(band).toMatchObject({
      floor: 7000,
      ceiling: 14000,
      ceilingLabel: "max position size",
      floorClampedByCeiling: false,
    });
  });

  it("LIVE: the promotion cap wins when it is the smaller ceiling", () => {
    const band = positionBand({
      environment: "LIVE",
      minPositionSize: 2000,
      maxPositionSize: 14000,
      realMaxPosition: 6000,
    });
    expect(band.ceiling).toBe(6000);
    expect(band.ceilingLabel).toBe("live promotion cap");
    expect(band.floor).toBe(2000);
  });

  it("no floor configured → floor 0 (existing rows keep old behavior)", () => {
    expect(positionBand({ environment: "PAPER", maxPositionSize: 5000 }).floor).toBe(0);
    expect(
      positionBand({ environment: "PAPER", minPositionSize: 0, maxPositionSize: 5000 })
        .floor,
    ).toBe(0);
  });

  it("no ceiling configured → ceiling null, floor still enforced", () => {
    const band = positionBand({ environment: "PAPER", minPositionSize: 3000 });
    expect(band.ceiling).toBeNull();
    expect(band.floor).toBe(3000);
    expect(band.floorClampedByCeiling).toBe(false);
  });

  it("a promotion cap below the floor collapses the band instead of deadlocking", () => {
    // Promoting a $10k-floor analyst with a $5k throttle must not make EVERY
    // live entry unplaceable (below floor AND above ceiling at once).
    const band = positionBand({
      environment: "LIVE",
      minPositionSize: 10000,
      maxPositionSize: 15000,
      realMaxPosition: 5000,
    });
    expect(band.ceiling).toBe(5000);
    expect(band.floor).toBe(5000);
    expect(band.floorClampedByCeiling).toBe(true);
  });

  it("the production misses would now be caught", () => {
    // PEAD Specialist — $3,566 HPE against a $14k ceiling, $7k floor.
    expect(
      3566 < positionBand({ minPositionSize: 7000, maxPositionSize: 14000 }).floor,
    ).toBe(true);
    // Secular Compounder — 1-share $922 LITE against a $15k ceiling, $10k floor.
    expect(
      922 < positionBand({ minPositionSize: 10000, maxPositionSize: 15000 }).floor,
    ).toBe(true);
  });
});

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

  it("ignores minPositionSize — the floor governs ENTRIES, not scale-ins", () => {
    // A $2k add onto an existing winner is a legitimate scale-in, not an
    // undersized position, so the entry floor must not leak into this path.
    expect(
      scaleInCeiling({
        environment: "PAPER",
        minPositionSize: 10000,
        maxPositionSize: 2500,
      } as Parameters<typeof scaleInCeiling>[0]),
    ).toBe(5000);
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
