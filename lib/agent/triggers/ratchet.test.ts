import {
  protectiveRatchetViolations,
  describeRatchetViolation,
} from "./ratchet";
import type { Trigger } from "./types";

/** Minimal rung builder — only the fields the ratchet reads. */
function rung(
  over: Partial<Trigger> & Pick<Trigger, "predicate" | "action">,
): Trigger {
  return {
    id: over.id ?? `id-${Math.random().toString(36).slice(2)}`,
    rationale: over.rationale ?? "because",
    ...over,
  } as Trigger;
}

const floor = (level: number, over: Partial<Trigger> = {}) =>
  rung({ predicate: { kind: "PRICE_BELOW", level }, action: "EXIT", ...over });

const trail = (pct: number, over: Partial<Trigger> = {}) =>
  rung({ predicate: { kind: "TRAILING_FROM_HIGH", pct }, action: "EXIT", ...over });

const drawdownExit = (pct: number) =>
  rung({
    predicate: { kind: "GAIN_FROM_ENTRY", pct, direction: "DOWN" },
    action: "EXIT",
  });

describe("protectiveRatchetViolations — the MU 2026-08-18 shape", () => {
  it("flags lowering a hard floor (948 → 814)", () => {
    const v = protectiveRatchetViolations({
      direction: "LONG",
      before: [floor(948, { fireMode: "DIRECT" })],
      after: [floor(814, { fireMode: "DIRECT" })],
      inherited: [],
    });
    expect(v).toHaveLength(1);
    expect(v[0].reason).toBe("LOWERED");
  });

  it("flags demoting a floor from DIRECT to TACTICAL at the same level", () => {
    const v = protectiveRatchetViolations({
      direction: "LONG",
      before: [floor(948, { fireMode: "DIRECT" })],
      after: [floor(948, { fireMode: "TACTICAL" })],
      inherited: [],
    });
    expect(v).toHaveLength(1);
    expect(v[0].reason).toBe("FIREMODE_DEMOTED");
  });

  it("reports LOWERED (not also DEMOTED) when both happen at once — one line per rung", () => {
    const v = protectiveRatchetViolations({
      direction: "LONG",
      before: [floor(948, { fireMode: "DIRECT" })],
      after: [floor(814, { fireMode: "TACTICAL" })],
      inherited: [],
    });
    expect(v).toHaveLength(1);
    expect(v[0].reason).toBe("LOWERED");
  });

  it("allows raising the floor (the legal direction)", () => {
    const v = protectiveRatchetViolations({
      direction: "LONG",
      before: [floor(860)],
      after: [floor(948, { fireMode: "DIRECT" })],
      inherited: [],
    });
    expect(v).toHaveLength(0);
  });
});

describe("protectiveRatchetViolations — delete and cascade shapes", () => {
  it("flags deleting the only floor", () => {
    const v = protectiveRatchetViolations({
      direction: "LONG",
      before: [floor(948)],
      after: [],
      inherited: [],
    });
    expect(v).toHaveLength(1);
    expect(v[0].reason).toBe("REMOVED");
  });

  it("flags deleting a thesis override so a weaker inherited floor shows through", () => {
    const v = protectiveRatchetViolations({
      direction: "LONG",
      before: [floor(948)],
      after: [],
      inherited: [floor(860)],
    });
    expect(v).toHaveLength(1);
    expect(v[0].reason).toBe("LOWERED");
  });

  it("is satisfied by inherited coverage when the thesis never stored the rung", () => {
    // Agent resent the inherited trail verbatim → dropRedundantInherited
    // dropped it → after=[] — the account rung still covers the bucket.
    const v = protectiveRatchetViolations({
      direction: "LONG",
      before: [],
      after: [],
      inherited: [trail(8, { fireMode: "DIRECT" })],
    });
    expect(v).toHaveLength(0);
  });

  it("flags a thesis override that weakens an inherited rung", () => {
    const v = protectiveRatchetViolations({
      direction: "LONG",
      before: [],
      after: [trail(12)],
      inherited: [trail(8)],
    });
    expect(v).toHaveLength(1);
    expect(v[0].reason).toBe("LOWERED");
  });

  it("flags a thesis override that demotes an inherited DIRECT rung", () => {
    const v = protectiveRatchetViolations({
      direction: "LONG",
      before: [],
      after: [trail(8, { fireMode: "TACTICAL" })],
      inherited: [trail(8, { fireMode: "DIRECT" })],
    });
    expect(v).toHaveLength(1);
    expect(v[0].reason).toBe("FIREMODE_DEMOTED");
  });
});

describe("protectiveRatchetViolations — percentage bands widen = weaker", () => {
  it("flags widening a trailing give-back (8% → 12%)", () => {
    const v = protectiveRatchetViolations({
      direction: "LONG",
      before: [trail(8)],
      after: [trail(12)],
      inherited: [],
    });
    expect(v).toHaveLength(1);
    expect(v[0].reason).toBe("LOWERED");
  });

  it("allows tightening a trailing give-back (8% → 6%)", () => {
    const v = protectiveRatchetViolations({
      direction: "LONG",
      before: [trail(8)],
      after: [trail(6)],
      inherited: [],
    });
    expect(v).toHaveLength(0);
  });

  it("flags widening a down-from-entry exit (12% → 20%)", () => {
    const v = protectiveRatchetViolations({
      direction: "LONG",
      before: [drawdownExit(12)],
      after: [drawdownExit(20)],
      inherited: [],
    });
    expect(v).toHaveLength(1);
  });
});

describe("protectiveRatchetViolations — what is deliberately NOT gated", () => {
  it("ignores profit targets (PRICE_ABOVE exit on LONG is TARGET, not STOP)", () => {
    const target = (level: number) =>
      rung({ predicate: { kind: "PRICE_ABOVE", level }, action: "EXIT" });
    const v = protectiveRatchetViolations({
      direction: "LONG",
      before: [target(1100)],
      after: [target(1000)],
      inherited: [],
    });
    expect(v).toHaveLength(0);
  });

  it("ignores REVIEW rungs (pruning upside reviews is not a protection change)", () => {
    const review = rung({
      predicate: { kind: "GAIN_FROM_ENTRY", pct: 20, direction: "UP" },
      action: "REVIEW",
    });
    const v = protectiveRatchetViolations({
      direction: "LONG",
      before: [review, floor(948)],
      after: [floor(948)],
      inherited: [],
    });
    expect(v).toHaveLength(0);
  });

  it("ignores judgment rungs (earnings/signals) — no deterministic level to ratchet", () => {
    const miss = rung({
      predicate: { kind: "EARNINGS_MISS" },
      action: "EXIT",
    });
    const v = protectiveRatchetViolations({
      direction: "LONG",
      before: [miss],
      after: [],
      inherited: [],
    });
    expect(v).toHaveLength(0);
  });

  it("allows adding a new protective rung in a bucket that had none", () => {
    const v = protectiveRatchetViolations({
      direction: "LONG",
      before: [floor(948)],
      after: [floor(948), trail(8)],
      inherited: [],
    });
    expect(v).toHaveLength(0);
  });
});

describe("protectiveRatchetViolations — SHORT positions", () => {
  it("flags raising a SHORT stop (PRICE_ABOVE is the protective side)", () => {
    const cover = (level: number) =>
      rung({ predicate: { kind: "PRICE_ABOVE", level }, action: "EXIT" });
    const v = protectiveRatchetViolations({
      direction: "SHORT",
      before: [cover(50)],
      after: [cover(60)],
      inherited: [],
    });
    expect(v).toHaveLength(1);
    expect(v[0].reason).toBe("LOWERED");
  });

  it("ignores PRICE_BELOW on SHORT (that is the profit target)", () => {
    const v = protectiveRatchetViolations({
      direction: "SHORT",
      before: [floor(40)],
      after: [floor(35)],
      inherited: [],
    });
    expect(v).toHaveLength(0);
  });
});

describe("protectiveRatchetViolations — malformed legacy rungs", () => {
  it("skips rungs it cannot classify instead of crashing", () => {
    const malformed = [
      { id: "x", action: "EXIT" }, // no predicate — legacy corruption shape
      null,
      { id: "y", predicate: {}, action: "EXIT" },
    ] as unknown as Trigger[];
    const v = protectiveRatchetViolations({
      direction: "LONG",
      before: [...malformed, floor(948)],
      after: [floor(948)],
      inherited: [],
    });
    expect(v).toHaveLength(0);
  });
});

describe("describeRatchetViolation", () => {
  it("names the rung in product language", () => {
    const [v] = protectiveRatchetViolations({
      direction: "LONG",
      before: [floor(948)],
      after: [floor(814)],
      inherited: [],
    });
    const line = describeRatchetViolation(v);
    expect(line).toContain("$948");
    expect(line).toContain("$814");
  });
});
