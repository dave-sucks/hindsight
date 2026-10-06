/**
 * schema.test.ts — the read path must never lose a whole ladder.
 *
 * On 2026-08-16, GD / ASML / ETN each carried a time-based review rung
 * with a cooldown of 144 / 144 / 292 against the schema's max of 90. Array
 * validation is all-or-nothing, so ALL 8 / 8 / 6 of their rungs — entry
 * triggers included — were discarded on every read. No error, no alert.
 */

import { zodSchema } from "ai";
import { waitsForClose } from "./condition";
import { parseTriggersResilient, predicateInputSchema, triggerActionSchema, triggerPredicateSchema, triggersArraySchema } from "./schema";

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

describe("review clock keeps its counting-from choice through the schema", () => {
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

describe("the condition a model writes", () => {
  // The SDK writes a record as an object that allows no keys, so a model
  // reading the tool definition could never say "on the close".
  it("lists every setting it can send, and keeps the one it sent", () => {
    const schema = predicateInputSchema();
    const json = JSON.stringify(zodSchema(schema as never).jsonSchema);
    for (const key of ["close", "startOnceUpPct", "widenAtr", "fastWinnerPct", "period", "window", "fromDay"]) expect(json).toContain(`"${key}":`);
    expect(schema.parse({ watch: "price", is: "above", value: 183, settings: { close: true } })).toEqual({ watch: "price", is: "above", value: 183, settings: { close: true } });
  });

  it("defines each measure once, not once per level of nesting", () => {
    const json = JSON.stringify(zodSchema(predicateInputSchema() as never).jsonSchema);
    expect(json.split('"Condition":{').length - 1).toBe(1);
    for (const watch of ["price", "move", "volume", "rsi", "strength", "gap", "report", "surprise", "filing", "insiders", "repeat", "from_date"]) {
      expect({ watch, branches: json.split(`"const":"${watch}"`).length - 1 }).toEqual({ watch, branches: 1 });
    }
  });

  it("offers each measure only its own fields", () => {
    const json = zodSchema(predicateInputSchema() as never).jsonSchema as { definitions: { Condition: { oneOf?: unknown[]; anyOf?: unknown[] } } };
    const arms = (json.definitions.Condition.oneOf ?? json.definitions.Condition.anyOf ?? []) as Array<{ properties: Record<string, { properties?: Record<string, unknown> }> }>;
    const fields = Object.fromEntries(arms.map((a) => [(a.properties.watch as { const?: string }).const, Object.keys(a.properties.settings?.properties ?? {})]));
    expect(fields).toEqual({
      price: ["close"],
      move: ["fastWinnerPct", "fastWinnerDays", "startOnceUpPct", "widenAtr"],
      volume: [],
      rsi: ["period"],
      strength: ["window"],
      gap: ["volume", "withinDays"],
      report: ["fromDay"],
      surprise: [],
      filing: [],
      insiders: ["days"],
      repeat: [],
      from_date: [],
    });
    // A price reads a line in `value` and has no `variable`; a move has one.
    const price = arms.find((a) => (a.properties.watch as { const?: string }).const === "price")!;
    expect(Object.keys(price.properties)).toEqual(["watch", "is", "value", "settings"]);
  });
});

describe("a setting the measure doesn't take is dropped at the gate", () => {
  // Reproduced in review: a % move carrying `close` passed both schemas, so
  // the close pass picked it up while the move's reader ignores `close`.
  const undeclared = { watch: "move", is: "below", value: 7, variable: "prev_close", settings: { close: true } };

  it("the save gate stores the move without it, and the close pass doesn't pick it up", () => {
    const stored = triggerPredicateSchema.parse(undeclared);
    expect(stored).toEqual({ watch: "move", is: "below", value: 7, variable: "prev_close" });
    expect(waitsForClose(stored)).toBe(false);
  });

  it("the condition a model writes drops it too, and keeps what the measure or variable declares", () => {
    expect(predicateInputSchema().parse(undeclared)).toEqual({ watch: "move", is: "below", value: 7, variable: "prev_close" });
    const trail = { watch: "move", is: "below", value: 12, variable: "peak", settings: { startOnceUpPct: 10, close: true } };
    expect(predicateInputSchema().parse(trail)).toEqual({ watch: "move", is: "below", value: 12, variable: "peak", settings: { startOnceUpPct: 10 } });
    const closeBuy = { watch: "price", is: "above", value: 183, settings: { close: true } };
    expect(triggerPredicateSchema.parse(closeBuy)).toEqual(closeBuy);
  });

  it("inside a group too", () => {
    const group = { match: "all", conditions: [undeclared, { watch: "volume", value: 1.5, settings: { window: "3M" } }] };
    expect(triggerPredicateSchema.parse(group)).toEqual({ match: "all", conditions: [{ watch: "move", is: "below", value: 7, variable: "prev_close" }, { watch: "volume", value: 1.5 }] });
  });
});

describe("the actions a trigger can take", () => {
  // No stored trigger ever carried MOVE_STOP (production, 2026-10-06: 0 of 943
  // theses, every analyst, every account). A stop moves by editing the floor.
  it("are buy, add, trim, sell and review; there is no stop-move action", () => {
    expect(triggerActionSchema.options.filter((a) => a !== "DEMOTE")).toEqual(["REVIEW", "EXIT", "ENTER", "ADD", "TRIM"]);
    expect(triggerActionSchema.safeParse("MOVE_STOP").success).toBe(false);
  });
});
