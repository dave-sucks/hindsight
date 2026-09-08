/**
 * position-sizing.test.ts — the three plain sizing settings and the one
 * helper the tool gates and the Settings UI both call.
 *
 * The floor half exists because the config was ceilings-only: PEAD Specialist
 * proposed $3,566 against a $14,000 ceiling, and Secular Compounder opened a
 * 1-share $922 LITE position against a $15,000 ceiling. Prose floors in
 * `analystPrompt` were Layer 3 doing Layer 1's job.
 */
import { positionBand, positionTotalCap, DEFAULT_POSITION_CAP } from "./position-sizing";

describe("positionBand — smallest trade to largest trade", () => {
  it("floor and ceiling come straight from the two settings", () => {
    expect(positionBand({ minPositionSize: 7000, maxPositionSize: 14000 })).toEqual({
      floor: 7000,
      ceiling: 14000,
      floorClampedByCeiling: false,
    });
  });

  it("no smallest trade configured → floor 0", () => {
    expect(positionBand({ maxPositionSize: 5000 }).floor).toBe(0);
    expect(positionBand({ minPositionSize: 0, maxPositionSize: 5000 }).floor).toBe(0);
  });

  it("no largest trade configured → ceiling null, floor still enforced", () => {
    const band = positionBand({ minPositionSize: 3000 });
    expect(band.ceiling).toBeNull();
    expect(band.floor).toBe(3000);
    expect(band.floorClampedByCeiling).toBe(false);
  });

  it("a smallest trade above the largest collapses the band instead of deadlocking", () => {
    const band = positionBand({ minPositionSize: 10000, maxPositionSize: 5000 });
    expect(band.ceiling).toBe(5000);
    expect(band.floor).toBe(5000);
    expect(band.floorClampedByCeiling).toBe(true);
  });

  it("the production misses would now be caught", () => {
    expect(3566 < positionBand({ minPositionSize: 7000, maxPositionSize: 14000 }).floor).toBe(true);
    expect(922 < positionBand({ minPositionSize: 10000, maxPositionSize: 15000 }).floor).toBe(true);
  });
});

describe("positionTotalCap — most in one stock", () => {
  it("is the setting when set", () => {
    expect(positionTotalCap({ maxPositionSize: 8000, maxPositionTotal: 16000 })).toBe(16000);
    expect(positionTotalCap({ maxPositionSize: 8000, maxPositionTotal: 12000 })).toBe(12000);
  });

  it("unset → twice the largest trade (what every analyst was backfilled with)", () => {
    expect(positionTotalCap({ maxPositionSize: 2500 })).toBe(5000);
    expect(positionTotalCap({ maxPositionSize: 2500, maxPositionTotal: 0 })).toBe(5000);
  });

  it("nothing configured → twice the default cap (matches place_trade)", () => {
    expect(positionTotalCap({})).toBe(DEFAULT_POSITION_CAP * 2);
  });

  it("the add gate compares (cost basis + add) against it", () => {
    const cap = positionTotalCap({ maxPositionSize: 2500, maxPositionTotal: 5000 });
    expect(4000 + 900 > cap).toBe(false); // $4,900 add allowed
    expect(4000 + 1500 > cap).toBe(true); // $5,500 add rejected
  });
});

describe("entrySizeForConviction — the analyst's band, placed by conviction (DAV-237)", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { entrySizeForConviction, positionBand } = require("./position-sizing");
  const catalyst = positionBand({ minPositionSize: 5_000, maxPositionSize: 8_000 });

  it("MEDIUM and LOW buy the smallest trade", () => {
    expect(entrySizeForConviction({ conviction: "MEDIUM", band: catalyst })).toBe(5_000);
    expect(entrySizeForConviction({ conviction: "LOW", band: catalyst })).toBe(5_000);
    expect(entrySizeForConviction({ conviction: null, band: catalyst })).toBe(5_000);
  });

  it("STRONG and HIGH buy the largest trade", () => {
    expect(entrySizeForConviction({ conviction: "STRONG", band: catalyst })).toBe(8_000);
    expect(entrySizeForConviction({ conviction: "HIGH", band: catalyst })).toBe(8_000);
  });

  it("no floor configured → the smallest trade is the ceiling; nothing configured → the default cap", () => {
    const noFloor = positionBand({ minPositionSize: 0, maxPositionSize: 6_000 });
    expect(entrySizeForConviction({ conviction: "MEDIUM", band: noFloor })).toBe(6_000);
    const bare = positionBand({});
    expect(entrySizeForConviction({ conviction: "MEDIUM", band: bare })).toBe(5_000);
  });
});
