/**
 * schema.test.ts — the read path must never lose a whole ladder.
 *
 * On 2026-08-16, GD / ASML / ETN each carried a TIME_ELAPSED review rung
 * with a cooldown of 144 / 144 / 292 against the schema's max of 90. Array
 * validation is all-or-nothing, so ALL 8 / 8 / 6 of their rungs — entry
 * triggers included — were discarded on every read. No error, no alert.
 */

import { parseTriggersResilient, triggersArraySchema } from "./schema";

const good = {
  id: "t1",
  predicate: { kind: "PRICE_BELOW", level: 64 },
  action: "EXIT",
  rationale: "hard stop",
  cooldownDays: 0,
};
/** The exact shape that was discarding whole ladders. */
const badCooldown = {
  id: "t2",
  predicate: { kind: "TIME_ELAPSED", days: 180 },
  action: "REVIEW",
  rationale: "hygiene",
  cooldownDays: 292,
};
const unrepairable = {
  id: "t3",
  predicate: { kind: "NOT_A_PREDICATE" },
  action: "EXIT",
  rationale: "nonsense",
};

describe("parseTriggersResilient", () => {
  it("keeps the good rungs when one has an out-of-range cooldown", () => {
    // The regression: strict parsing returns nothing at all here.
    expect(triggersArraySchema.safeParse([good, badCooldown]).success).toBe(false);

    const r = parseTriggersResilient([good, badCooldown]);
    expect(r.triggers).toHaveLength(2);
    expect(r.clamped).toBe(1);
    expect(r.dropped).toBe(0);
  });

  it("clamps the cooldown into range rather than dropping the rung", () => {
    const r = parseTriggersResilient([badCooldown]);
    expect(r.triggers[0].cooldownDays).toBe(90);
  });

  it("clamps a negative cooldown to zero", () => {
    const r = parseTriggersResilient([{ ...badCooldown, cooldownDays: -5 }]);
    expect(r.triggers[0].cooldownDays).toBe(0);
  });

  it("drops only the unrepairable rung and keeps the rest", () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    const r = parseTriggersResilient([good, unrepairable, badCooldown]);
    expect(r.triggers.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(r.dropped).toBe(1);
    err.mockRestore();
  });

  it("leaves a clean ladder untouched", () => {
    const r = parseTriggersResilient([good]);
    expect(r).toMatchObject({ clamped: 0, dropped: 0 });
    expect(r.triggers).toHaveLength(1);
  });

  it("treats null / non-array as no triggers, not corruption", () => {
    for (const raw of [null, undefined, "nope", 42]) {
      expect(parseTriggersResilient(raw).triggers).toEqual([]);
    }
  });
});
