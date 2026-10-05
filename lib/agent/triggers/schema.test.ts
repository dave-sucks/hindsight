/**
 * schema.test.ts — the read path must never lose a whole ladder.
 *
 * On 2026-08-16, GD / ASML / ETN each carried a time-based review rung
 * with a cooldown of 144 / 144 / 292 against the schema's max of 90. Array
 * validation is all-or-nothing, so ALL 8 / 8 / 6 of their rungs — entry
 * triggers included — were discarded on every read. No error, no alert.
 */

import { parseTriggersResilient, triggerPredicateSchema, triggersArraySchema } from "./schema";

const good = {
  id: "t1",
  predicate: { watch: "price", is: "below", value: 64 },
  action: "EXIT",
  rationale: "hard stop",
  cooldownDays: 0,
};
/** The exact shape that was discarding whole ladders. */
const badCooldown = {
  id: "t2",
  predicate: { watch: "repeat", value: 180 },
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

describe("REVIEW_CADENCE keeps its counting-from choice through the schema", () => {
  it("'sell 30 days after the buy' survives the parse as a count from the buy — on main it came back as a review clock", () => {
    const parsed = triggerPredicateSchema.parse({ watch: "from_date", is: "after", value: 30, variable: "buy" });
    expect(parsed).toEqual({ watch: "from_date", is: "after", value: 30, variable: "buy" });
    const before = triggerPredicateSchema.parse({ watch: "from_date", is: "before", value: 3, variable: "event" });
    expect(before).toEqual({ watch: "from_date", is: "before", value: 3, variable: "event" });
  });
  it("a plain review clock parses as before", () => {
    expect(triggerPredicateSchema.parse({ watch: "repeat", value: 7 })).toEqual({ watch: "repeat", value: 7 });
  });
});
