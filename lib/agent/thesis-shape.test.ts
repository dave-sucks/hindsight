/**
 * thesis-shape.test.ts — coverage for validateThesisShape.
 *
 * Pure function; no DB, no fetches. Walks the LONG / SHORT / PASS branches
 * with all-three-set, partial-set, and edge cases.
 */

// Uses jest globals (project test runner is jest per package.json) — same
// import-less pattern as lib/agent/triggers/evaluate.test.ts.
import { MIN_RISK_REWARD, riskReward, validateThesisShape } from "./thesis-shape";

describe("validateThesisShape", () => {
  // ── PASS ───────────────────────────────────────────────────────────────

  it("PASS direction: any shape passes", () => {
    expect(
      validateThesisShape({
        direction: "PASS",
        entryPrice: 100,
        targetPrice: 50,
        stopLoss: 200, // nonsense pair, but PASS doesn't care
      }),
    ).toEqual({ ok: true });
  });

  it("PASS direction: missing values pass", () => {
    expect(validateThesisShape({ direction: "PASS" })).toEqual({ ok: true });
  });

  it("null direction (unresearched seed): no shape rule (P1-24 B4)", () => {
    // A seed has no entry/target/stop yet; the shape rule kicks in only once
    // it's promoted to LONG/SHORT.
    expect(validateThesisShape({ direction: null })).toEqual({ ok: true });
  });

  it("legacy 'PENDING' direction: no shape rule (dual-read window)", () => {
    expect(validateThesisShape({ direction: "PENDING" })).toEqual({ ok: true });
  });

  // ── LONG happy path ────────────────────────────────────────────────────

  it("LONG with target > entry > stop: ok", () => {
    expect(
      validateThesisShape({
        direction: "LONG",
        entryPrice: 100,
        targetPrice: 120,
        stopLoss: 90,
      }),
    ).toEqual({ ok: true, riskReward: 2 });
  });

  it("LONG with only target+entry, target > entry: ok", () => {
    expect(
      validateThesisShape({
        direction: "LONG",
        entryPrice: 100,
        targetPrice: 120,
      }),
    ).toEqual({ ok: true });
  });

  it("LONG with no prices: ok (nothing to check)", () => {
    expect(validateThesisShape({ direction: "LONG" })).toEqual({ ok: true });
  });

  // ── LONG failures ──────────────────────────────────────────────────────

  it("LONG with target < entry: fails (the 5/07 Secular Theme MU case)", () => {
    const r = validateThesisShape({
      direction: "LONG",
      entryPrice: 487,
      targetPrice: 470, // below entry — broken
      stopLoss: 430,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("LONG-target-not-above-entry");
      expect(r.note).toContain("entry=$487");
      expect(r.note).toContain("target=$470");
    }
  });

  it("LONG with target == entry: fails (zero R/R)", () => {
    const r = validateThesisShape({
      direction: "LONG",
      entryPrice: 100,
      targetPrice: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("LONG-target-not-above-entry");
  });

  it("LONG with stop > entry: fails (the 5/07 Earnings Drift MU case)", () => {
    const r = validateThesisShape({
      direction: "LONG",
      entryPrice: 496,
      targetPrice: 720,
      stopLoss: 620, // above entry — broken
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("LONG-stop-not-below-entry");
  });

  it("LONG with stop == entry: fails", () => {
    const r = validateThesisShape({
      direction: "LONG",
      entryPrice: 100,
      stopLoss: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("LONG-stop-not-below-entry");
  });

  it("LONG with target ≤ stop (no entry): fails", () => {
    const r = validateThesisShape({
      direction: "LONG",
      targetPrice: 95,
      stopLoss: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("LONG-target-not-above-stop");
  });

  // ── SHORT happy path ───────────────────────────────────────────────────

  it("SHORT with target < entry < stop: ok", () => {
    expect(
      validateThesisShape({
        direction: "SHORT",
        entryPrice: 100,
        targetPrice: 80,
        stopLoss: 110,
      }),
    ).toEqual({ ok: true, riskReward: 2 });
  });

  it("SHORT with only target+stop (no entry): ok when target < stop", () => {
    expect(
      validateThesisShape({
        direction: "SHORT",
        targetPrice: 80,
        stopLoss: 110,
      }),
    ).toEqual({ ok: true });
  });

  // ── SHORT failures ─────────────────────────────────────────────────────

  it("SHORT with target > entry: fails", () => {
    const r = validateThesisShape({
      direction: "SHORT",
      entryPrice: 100,
      targetPrice: 110,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("SHORT-target-not-below-entry");
  });

  it("SHORT with stop < entry: fails", () => {
    const r = validateThesisShape({
      direction: "SHORT",
      entryPrice: 100,
      stopLoss: 90,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("SHORT-stop-not-above-entry");
  });

  it("SHORT with target ≥ stop (no entry): fails", () => {
    const r = validateThesisShape({
      direction: "SHORT",
      targetPrice: 110,
      stopLoss: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("SHORT-target-not-below-stop");
  });

  // ── Null / undefined handling ──────────────────────────────────────────

  it("LONG with null target: skips target check", () => {
    expect(
      validateThesisShape({
        direction: "LONG",
        entryPrice: 100,
        targetPrice: null,
        stopLoss: 90,
      }),
    ).toEqual({ ok: true });
  });

  it("LONG with all nulls: ok (nothing to check)", () => {
    expect(
      validateThesisShape({
        direction: "LONG",
        entryPrice: null,
        targetPrice: null,
        stopLoss: null,
      }),
    ).toEqual({ ok: true });
  });
});

describe("validateThesisShape — the 2:1 floor (one rule, every write path)", () => {
  it("PLTR as stored: entry 183 / target 190 / stop 110 is 0.1:1 and refused", () => {
    const r = validateThesisShape({
      direction: "LONG",
      entryPrice: 183,
      targetPrice: 190,
      stopLoss: 110,
      minRiskReward: MIN_RISK_REWARD,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("risk-reward-below-floor");
      expect(r.note).toContain("0.10:1");
      expect(r.note).toContain("2:1");
    }
  });

  it("returns the realised R/R on a plan that clears the floor", () => {
    expect(
      validateThesisShape({
        direction: "LONG",
        entryPrice: 100,
        targetPrice: 125,
        stopLoss: 90,
        minRiskReward: MIN_RISK_REWARD,
      }),
    ).toEqual({ ok: true, riskReward: 2.5 });
  });

  it("SHORT mirrors the arithmetic", () => {
    const r = validateThesisShape({
      direction: "SHORT",
      entryPrice: 100,
      targetPrice: 90,
      stopLoss: 108,
      minRiskReward: MIN_RISK_REWARD,
    });
    expect(r.ok).toBe(false); // 10 / 8 = 1.25
    expect(riskReward("SHORT", 100, 80, 108)).toBe(2.5);
  });

  it("no floor requested (a held name) → ordering only, R/R still reported", () => {
    expect(
      validateThesisShape({ direction: "LONG", entryPrice: 100, targetPrice: 110, stopLoss: 90 }),
    ).toEqual({ ok: true, riskReward: 1 });
  });

  it("a partial plan has no R/R to check", () => {
    expect(
      validateThesisShape({ direction: "LONG", entryPrice: 100, targetPrice: 101, minRiskReward: 2 }),
    ).toEqual({ ok: true });
  });
});
