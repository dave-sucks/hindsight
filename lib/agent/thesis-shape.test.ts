/**
 * thesis-shape.test.ts — coverage for validateThesisShape.
 *
 * Pure function; no DB, no fetches. Walks the LONG / SHORT / PASS branches
 * with all-three-set, partial-set, and edge cases.
 */

// Uses jest globals (project test runner is jest per package.json) — same
// import-less pattern as lib/agent/triggers/evaluate.test.ts.
import { validateThesisShape } from "./thesis-shape";

describe("validateThesisShape", () => {
  // ── PASS ───────────────────────────────────────────────────────────────

  it("PASS direction: any shape passes", () => {
    expect(
      validateThesisShape({
        direction: "PASS",
        buy: 100,
        upside: 50,
        floor: 200, // nonsense pair, but PASS doesn't care
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
        buy: 100,
        upside: 120,
        floor: 90,
      }),
    ).toEqual({ ok: true });
  });

  it("LONG with only target+entry, target > entry: ok", () => {
    expect(
      validateThesisShape({
        direction: "LONG",
        buy: 100,
        upside: 120,
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
      buy: 487,
      upside: 470, // below entry — broken
      floor: 430,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("LONG-target-not-above-entry");
      expect(r.note).toContain("the buy is $487");
      expect(r.note).toContain("the upside line $470");
    }
  });

  it("LONG with target == entry: fails (zero R/R)", () => {
    const r = validateThesisShape({
      direction: "LONG",
      buy: 100,
      upside: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("LONG-target-not-above-entry");
  });

  it("LONG with stop > entry: fails (the 5/07 Earnings Drift MU case)", () => {
    const r = validateThesisShape({
      direction: "LONG",
      buy: 496,
      upside: 720,
      floor: 620, // above entry — broken
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("LONG-stop-not-below-entry");
  });

  it("LONG with stop == entry: fails", () => {
    const r = validateThesisShape({
      direction: "LONG",
      buy: 100,
      floor: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("LONG-stop-not-below-entry");
  });

  it("LONG with target ≤ stop (no entry): fails", () => {
    const r = validateThesisShape({
      direction: "LONG",
      upside: 95,
      floor: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("LONG-target-not-above-stop");
  });

  // ── SHORT happy path ───────────────────────────────────────────────────

  it("SHORT with target < entry < stop: ok", () => {
    expect(
      validateThesisShape({
        direction: "SHORT",
        buy: 100,
        upside: 80,
        floor: 110,
      }),
    ).toEqual({ ok: true });
  });

  it("SHORT with only target+stop (no entry): ok when target < stop", () => {
    expect(
      validateThesisShape({
        direction: "SHORT",
        upside: 80,
        floor: 110,
      }),
    ).toEqual({ ok: true });
  });

  // ── SHORT failures ─────────────────────────────────────────────────────

  it("SHORT with target > entry: fails", () => {
    const r = validateThesisShape({
      direction: "SHORT",
      buy: 100,
      upside: 110,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("SHORT-target-not-below-entry");
  });

  it("SHORT with stop < entry: fails", () => {
    const r = validateThesisShape({
      direction: "SHORT",
      buy: 100,
      floor: 90,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("SHORT-stop-not-above-entry");
  });

  it("SHORT with target ≥ stop (no entry): fails", () => {
    const r = validateThesisShape({
      direction: "SHORT",
      upside: 110,
      floor: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("SHORT-target-not-below-stop");
  });

  // ── Null / undefined handling ──────────────────────────────────────────

  it("LONG with null target: skips target check", () => {
    expect(
      validateThesisShape({
        direction: "LONG",
        buy: 100,
        upside: null,
        floor: 90,
      }),
    ).toEqual({ ok: true });
  });

  it("LONG with all nulls: ok (nothing to check)", () => {
    expect(
      validateThesisShape({
        direction: "LONG",
        buy: null,
        upside: null,
        floor: null,
      }),
    ).toEqual({ ok: true });
  });
});

describe("validateThesisShape — no reward/risk: the house sets no target of its own (2026-11-16)", () => {
  it("PLTR as stored: buy 183 / upside line 190 / Stop watching 110 is legal, and nothing reports a ratio", () => {
    expect(validateThesisShape({ direction: "LONG", buy: 183, upside: 190, floor: 110 })).toEqual({ ok: true });
  });

  it("no ratio reaches a refusal", () => {
    const r = validateThesisShape({ direction: "LONG", buy: 100, upside: 90, floor: 80 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.note).not.toMatch(/\d:1/);
  });

  it("on a watch the line under the buy is its Stop watching line; on a holding, the floor", () => {
    const watch = validateThesisShape({ direction: "LONG", buy: 50, floor: 52 });
    expect(watch.ok).toBe(false);
    if (!watch.ok) expect(watch.note).toContain("the Stop watching line sits below the buy");
    const held = validateThesisShape({ direction: "LONG", buy: 50, upside: 51, floor: 52, held: true });
    expect(held.ok).toBe(false);
    if (!held.ok) expect(held.note).toContain("the upside line sits above the floor");
  });
});

describe("validateThesisShape — a held name may carry a stop at or above the fill (DAV-233)", () => {
  it("SMMT: fill $14.35, stop moved to $16.20 — accepted on a held row", () => {
    expect(
      validateThesisShape({ direction: "LONG", buy: 14.35, upside: 26, floor: 16.2, held: true }),
    ).toMatchObject({ ok: true });
  });
  it("the same tuple on a plan we haven't bought is still inverted", () => {
    const r = validateThesisShape({ direction: "LONG", buy: 14.35, upside: 26, floor: 16.2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("LONG-stop-not-below-entry");
  });
  it("held still refuses a target under the stop — that is not a ratchet, that is nonsense", () => {
    const r = validateThesisShape({ direction: "LONG", buy: 14.35, upside: 15, floor: 16.2, held: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("LONG-target-not-above-stop");
  });
});
