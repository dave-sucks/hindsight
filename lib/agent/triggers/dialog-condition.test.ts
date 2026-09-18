/**
 * dialog-condition.test.ts — the Add Trigger dialog can build the two-
 * condition triggers the playbook writes (DAV-281).
 *
 * The replay is the trigger every PEAD buy already writes onto the stock
 * (`setupExitTriggers`, in production on FIVE): "a beat the market sold" —
 * an earnings beat AND down 3% on the day → review. The agents and the fill
 * could write it; a person could not. Whatever the dialog posts has to be
 * the same predicate, and has to pass the same schema the routes parse with.
 */
import { conditionPredicate, conditionValid, defaultCondition, dialogPredicate, patchCondition } from "./dialog-condition";
import { setupExitTriggers } from "./setup-exits";
import { triggerSchema } from "./schema";
import { getSetup } from "@/lib/agent/knowledge/setups";
import { addablePredicateProblem } from "./two-conditions";
import { editableTriggerParts, withEditedValue } from "./editable";
import { applyTriggerOps } from "./ops";
import type { Trigger, TriggerPredicate } from "./types";

const beat = patchCondition(defaultCondition("EARNINGS"), { earningsWhen: "BEAT" });
const down3 = patchCondition(defaultCondition("MOVE"), { val: "3" });

describe("the dialog builds the playbook's beat-the-market-sold trigger", () => {
  it("beat AND down 3% on the day is the predicate a PEAD fill writes", () => {
    const fromFill = setupExitTriggers({ setup: getSetup("PEAD")!, horizon: "TRADE", entry: 100, stop: 94, mintId: () => "x" }).find(
      (t) => t.predicate.kind === "AND",
    )!;
    expect(conditionValid(beat)).toBe(true);
    expect(conditionValid(down3)).toBe(true);
    expect(dialogPredicate(beat, down3)).toEqual(fromFill.predicate);
  });

  it("parses with the schema the routes use", () => {
    const parsed = triggerSchema.safeParse({ id: "t1", action: "REVIEW", rationale: "A beat the market sold.", predicate: dialogPredicate(beat, down3) });
    expect(parsed.success).toBe(true);
  });

  it("one condition posts exactly what it posted before", () => {
    expect(dialogPredicate(patchCondition(defaultCondition("PRICE"), { val: "96", basis: "close" }), null)).toEqual({ kind: "PRICE_BELOW", level: 96, basis: "close" });
    expect(conditionPredicate(patchCondition(defaultCondition("CADENCE"), { val: "7", countFrom: "BUY" }))).toEqual({ kind: "REVIEW_CADENCE", days: 7, from: "BUY" });
    expect(conditionPredicate(patchCondition(defaultCondition("EARNINGS"), { val: "3" }))).toEqual({ kind: "EARNINGS_WITHIN", days: 3 });
    expect(conditionPredicate(patchCondition(defaultCondition("CHART"), { chartKind: "RSI", val: "30" }))).toEqual({ kind: "RSI", period: 14, threshold: 30, direction: "BELOW" });
  });

  it("a beat by at least 5% carries the number; a heads-up past 14 days is not valid", () => {
    expect(conditionPredicate({ ...beat, val: "5" })).toEqual({ kind: "EARNINGS_BEAT", minSurprisePct: 5 });
    expect(conditionValid(patchCondition(defaultCondition("EARNINGS"), { val: "15" }))).toBe(false);
  });
});

describe("what a hand-built pair may be", () => {
  const allowed = (k: string) => k !== "PRICE_BELOW";
  const pair = dialogPredicate(beat, down3) as unknown as TriggerPredicate;

  it("two addable conditions pass", () => {
    expect(addablePredicateProblem(pair, allowed)).toBeNull();
  });
  it("a day count is a schedule, not a condition", () => {
    const p = { kind: "AND", predicates: [{ kind: "REVIEW_CADENCE", days: 7 }, { kind: "EARNINGS_BEAT" }] } as TriggerPredicate;
    expect(addablePredicateProblem(p, allowed)).toMatch(/schedule/);
  });
  it("a condition the level doesn't allow is named", () => {
    const p = { kind: "AND", predicates: [{ kind: "PRICE_BELOW", level: 96 }, { kind: "EARNINGS_BEAT" }] } as TriggerPredicate;
    expect(addablePredicateProblem(p, allowed)).toMatch(/PRICE_BELOW/);
  });
});

describe("the popover edits either condition's number", () => {
  const pair = dialogPredicate(beat, down3) as unknown as TriggerPredicate;

  it("lists the move's % as condition 2 (a beat with no bar has no number)", () => {
    const parts = editableTriggerParts(pair);
    expect(parts.map((p) => [p.part, p.label, p.value])).toEqual([[1, "Move %", 3]]);
  });

  it("an account or analyst rule: the number moves on that condition only", () => {
    expect(withEditedValue(pair, 4, 1)).toEqual({
      kind: "AND",
      predicates: [{ kind: "EARNINGS_BEAT" }, { kind: "PRICE_MOVE_PCT", pct: 4, direction: "DOWN", window: "1D" }],
    });
  });

  it("a stock's trigger: the edit op moves condition 2 and writes one line", () => {
    const stored: Trigger[] = [{ id: "bf", action: "REVIEW", rationale: "A beat the market sold.", predicate: pair, cooldownDays: 7 }];
    const out = applyTriggerOps({ stored, ops: [{ op: "edit", id: "bf", pct: 4, part: 1 }], direction: "LONG", status: "HOLDING", actor: "PRINCIPAL", mintId: () => "n" });
    expect(out.results).toHaveLength(1);
    expect(out.results[0].ok).toBe(true);
    expect((out.triggers[0].predicate as { predicates: unknown[] }).predicates[1]).toEqual({ kind: "PRICE_MOVE_PCT", pct: 4, direction: "DOWN", window: "1D" });
    expect((out.triggers[0].predicate as { predicates: unknown[] }).predicates[0]).toEqual({ kind: "EARNINGS_BEAT" });
  });

  it("a condition that isn't there is refused by place, not guessed", () => {
    const stored: Trigger[] = [{ id: "bf", action: "REVIEW", rationale: "x", predicate: pair }];
    const out = applyTriggerOps({ stored, ops: [{ op: "edit", id: "bf", pct: 4, part: 5 }], direction: "LONG", status: "HOLDING", actor: "PRINCIPAL", mintId: () => "n" });
    expect(out.results[0].ok).toBe(false);
  });
});
