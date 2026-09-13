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

describe("sizeByRisk — shares from the stop distance (DAV-251)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { sizeByRisk, positionBand } = require("./position-sizing");
  const band = positionBand({ minPositionSize: 5_000, maxPositionSize: 16_000 });

  it("a STRONG buy with a 14% stop on a $100k book at 1% risk is ~$8.9k, not the $16k maximum", () => {
    const r = sizeByRisk({ equity: 100_000, riskPct: 1, conviction: "STRONG", entry: 100, stop: 86, band });
    // 1% × 1.25 = $1,250 at risk ÷ $14 a share = 89 shares.
    expect(r.shares).toBe(89);
    expect(r.notional).toBe(8_900);
    expect(r.clampedBy).toBeNull();
    expect(r.riskDollars).toBe(1_246);
    expect(r.line).toContain("1% of $100,000 × 1.25 (STRONG) = $1,250 at risk over a $14.00 stop distance → 89 shares ($8,900)");
  });

  it("the MU case: ~$16k over a 14% stop becomes a ~$7k position at MEDIUM", () => {
    const r = sizeByRisk({ equity: 100_000, riskPct: 1, conviction: "MEDIUM", entry: 1000, stop: 860, band });
    expect(r.shares).toBe(5);
    expect(r.notional).toBe(5_000);
    expect(r.riskDollars).toBe(700);
  });

  it("a tight stop buys more shares, capped at the largest trade", () => {
    const r = sizeByRisk({ equity: 100_000, riskPct: 1, conviction: "HIGH", entry: 100, stop: 98, band });
    // $1,000 ÷ $2 = 500 shares ($50k) → capped at $16k.
    expect(r.formulaNotional).toBe(50_000);
    expect(r.clampedBy).toBe("LARGEST_TRADE");
    expect(r.notional).toBe(16_000);
    expect(r.line).toContain("Capped at the largest trade");
  });

  it("a wide stop is raised to the smallest trade, and the line says the risk is above target", () => {
    const r = sizeByRisk({ equity: 100_000, riskPct: 1, conviction: "LOW", entry: 100, stop: 60, band });
    // $500 ÷ $40 = 12 shares ($1,200) → raised to $5,000.
    expect(r.clampedBy).toBe("SMALLEST_TRADE");
    expect(r.notional).toBe(5_000);
    expect(r.riskPctOfEquity).toBeCloseTo(2, 5);
    // Target was 1% × 0.5 (LOW) = 0.50%; the floor pushed it to 2%.
    expect(r.line).toMatch(/2\.00% of equity, above this trade's 0\.50% target/);
  });

  // No smallest trade here, so the halving isn't hidden by the floor clamp.
  const open = positionBand({ minPositionSize: 0, maxPositionSize: 16_000 });

  it("a binary catalyst halves the risk", () => {
    const normal = sizeByRisk({ equity: 100_000, riskPct: 1, conviction: "HIGH", entry: 50, stop: 40, band: open });
    const binary = sizeByRisk({ equity: 100_000, riskPct: 1, conviction: "HIGH", entry: 50, stop: 40, band: open, binary: true });
    expect(binary.shares).toBe(normal.shares / 2);
    expect(binary.line).toContain("(binary catalyst)");
  });

  it("a CAUTION market halves the size; RISK_OFF does not change the arithmetic", () => {
    const on = sizeByRisk({ equity: 100_000, riskPct: 1, conviction: "HIGH", entry: 50, stop: 40, band: open, regime: "RISK_ON" });
    const caution = sizeByRisk({ equity: 100_000, riskPct: 1, conviction: "HIGH", entry: 50, stop: 40, band: open, regime: "CAUTION" });
    expect(caution.shares).toBe(on.shares / 2);
  });

  it("shorts measure the stop above entry", () => {
    const r = sizeByRisk({ equity: 100_000, riskPct: 1, conviction: "HIGH", entry: 100, stop: 110, band, direction: "SHORT" });
    expect(r.shares).toBe(100);
  });

  it("no usable stop distance → null (the caller falls back and says so)", () => {
    expect(sizeByRisk({ equity: 100_000, entry: 100, stop: 100, band })).toBeNull();
    expect(sizeByRisk({ equity: 100_000, entry: 100, stop: 105, band })).toBeNull();
    expect(sizeByRisk({ equity: 0, entry: 100, stop: 90, band })).toBeNull();
  });

  it("no riskPct → the 1% default; unknown conviction → MEDIUM", () => {
    const r = sizeByRisk({ equity: 100_000, riskPct: null, conviction: "WHATEVER", entry: 100, stop: 90, band });
    expect(r.line).toContain("1% of $100,000 × 0.75 (WHATEVER)");
  });
});
