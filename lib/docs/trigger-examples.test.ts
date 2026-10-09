import { MEASURES, TRIGGER_TYPES, conditionsOf, measureOf, triggerText } from "@/lib/agent/triggers/condition";
import { triggerSchema } from "@/lib/agent/triggers/schema";
import { TRIGGER_TYPE_DOCS } from "./trigger-examples";

describe("the Triggers page examples", () => {
  const all = TRIGGER_TYPE_DOCS.flatMap((t) => t.examples.map((e) => ({ type: t.type, ...e })));

  it("has one tab per trigger type, in the menu's order", () => {
    expect(TRIGGER_TYPE_DOCS.map((t) => t.type)).toEqual(TRIGGER_TYPES.map((t) => t.id));
  });

  it("shows every measure in the catalog at least once", () => {
    const shown = new Set(all.flatMap((e) => conditionsOf(e.when).map((c) => c.watch)));
    expect([...Object.keys(MEASURES)].filter((m) => !shown.has(m as keyof typeof MEASURES))).toEqual([]);
  });

  it("puts each example under its own type's tab", () => {
    for (const e of all) expect(measureOf(conditionsOf(e.when)[0]).type).toBe(e.type);
  });

  it("is a trigger the save path accepts, with an action its measure allows", () => {
    for (const e of all) {
      const parsed = triggerSchema.safeParse({ predicate: e.when, action: e.action, rationale: e.why });
      expect(parsed.success).toBe(true);
      for (const c of conditionsOf(e.when)) {
        const allowed = measureOf(c).actions;
        if (allowed) expect(allowed).toContain(e.action);
      }
    }
  });

  it("reads as a sentence, never as a removed condition", () => {
    for (const e of all) expect(triggerText(e.action, e.when, true)).not.toMatch(/removed condition/);
  });
});
