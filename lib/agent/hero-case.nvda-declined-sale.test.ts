/**
 * The nvda-declined-sale case scores a widened stop as a fail.
 *
 * NVDA 2026-09-16: the principal's 8% give-back sale fired again the morning after a decline. The case
 * credited an `update_thesis` that edited that trigger's number, so an agent that widened the 8% to 12%
 * passed. No agent may lower a floor (the ratchet), and a bigger give-back from the high is a lower floor:
 * the tool refuses it, and the case must not pass the attempt. The scoring runs only with the live model
 * (scripts/hero-case.ts, not in CI), so this checks the rules the scorer reads. `never` beats `call`.
 */
import c from "../../scripts/hero-cases/nvda-declined-sale.json";

type Rule = { tool: string; where?: Record<string, unknown> };
const TRIGGER = "e9a27456-c604-4ae2-8dd6-5ccb6e96382e";
const expectRules = c.expect as { call: Rule[]; never: Rule[] };

/** The give-back the trigger has in the case's own record: "below 8% from the peak". */
const recorded = (JSON.parse(JSON.stringify(c)) as { promptArgs: { thesis: { allTriggers: Array<{ id: string; predicate: { value: number } }> } } }).promptArgs.thesis.allTriggers.find((t) => t.id === TRIGGER)!.predicate.value;

/** The same test the scorer applies to one path of a call: a number past `gt`. */
const widens = (rule: Rule, path: string, sent: number) => {
  const cond = rule.where?.[path] as { gt?: number } | undefined;
  return cond?.gt !== undefined && sent > cond.gt;
};

describe("nvda-declined-sale", () => {
  it("never accepts a wider give-back than the one the trigger has, however the model names the number", () => {
    expect(recorded).toBe(8);
    for (const field of ["value", "pct"]) {
      const path = `edit_triggers.*.${field}`;
      const rules = expectRules.never.filter((r) => r.tool === "update_thesis" && r.where?.["edit_triggers.*.id"] === TRIGGER && r.where?.[path]);
      expect(rules).toHaveLength(1);
      expect(widens(rules[0], path, recorded + 4)).toBe(true);
      expect(widens(rules[0], path, recorded)).toBe(false);
      expect(widens(rules[0], path, recorded - 2)).toBe(false);
    }
  });

  it("still never accepts removing the trigger, and still accepts selling again", () => {
    expect(expectRules.never.some((r) => r.where?.["remove_trigger_ids.*"] === TRIGGER)).toBe(true);
    expect(expectRules.call.some((r) => r.tool === "close_position")).toBe(true);
  });
});
