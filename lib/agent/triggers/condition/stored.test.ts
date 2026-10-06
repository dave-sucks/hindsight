/**
 * Storage in the condition shape, over every stored trigger: what a write
 * stores, what a read gives back, and that every rule answers the same for a
 * trigger stored either way. docs/plans/TRIGGER_TYPES.md §9.
 */

import stored from "./__fixtures__/stored-triggers.json";
import { UNSTORED, type StoredRow } from "./__fixtures__/unstored-triggers";
import { isShape, samePredicate, shapeOf, toStoredPredicate, toStoredTriggers, viewPredicate, viewTriggers } from ".";
import { triggerBucket } from "../bucket";
import { defaultCooldownDaysForPredicate } from "../defaults";
import { flooredCooldownDays } from "../state-cooldown";
import { canonicalLevels, isPlanLevel, levelSlotOf } from "../price-levels";
import { agentWatchDays } from "../agent-watch";
import { effectiveTriggerAction, isDirectEligiblePredicate, protectiveExitCloseReason, watchedFloorOnClose, type TriggerAction } from "../types";
import { storeTriggersIn } from "@/lib/prisma";

jest.mock("@/lib/generated/prisma/client", () => ({ PrismaClient: jest.fn(() => ({ $extends: jest.fn(() => ({})) })) }));
jest.mock("@prisma/adapter-pg", () => ({ PrismaPg: jest.fn() }));

const rows = (stored as unknown as { rows: { predicate: StoredRow; action: TriggerAction }[] }).rows;
const all = [...rows.map((r) => r.predicate), ...(UNSTORED as StoredRow[])];
const live = all.filter((p) => shapeOf(p) != null);
const retired = all.filter((p) => shapeOf(p) == null);

describe("what a write stores", () => {
  it("every condition in the shape, and the removed kind verbatim", () => {
    expect(live.every((p) => isShape(toStoredPredicate(p)))).toBe(true);
    expect(retired.length).toBeGreaterThan(0);
    expect(retired.every((p) => toStoredPredicate(p) === p)).toBe(true);
  });

  it("is the same written twice", () => {
    for (const p of all) expect(toStoredPredicate(toStoredPredicate(p))).toEqual(toStoredPredicate(p));
  });

  it("on every write that carries triggers, and only there", () => {
    const legacy = [{ id: "a", action: "EXIT", predicate: { kind: "PRICE_BELOW", level: 90 } }];
    const shaped = [{ id: "a", action: "EXIT", predicate: { watch: "price", is: "below", value: 90 } }];
    expect(storeTriggersIn({ where: { id: "x" }, data: { triggers: legacy, status: "HOLDING" } })).toEqual({
      where: { id: "x" },
      data: { triggers: shaped, status: "HOLDING" },
    });
    expect(storeTriggersIn({ data: [{ triggers: legacy }, { ticker: "X" }] })).toEqual({ data: [{ triggers: shaped }, { ticker: "X" }] });
    expect(storeTriggersIn({ where: {}, create: { triggers: legacy }, update: { triggers: legacy } })).toEqual({
      where: {},
      create: { triggers: shaped },
      update: { triggers: shaped },
    });
    // Nothing to store: left exactly as it was (a JSON null, a write with no triggers).
    const untouched = { data: { status: "WATCHING" } };
    expect(storeTriggersIn(untouched)).toEqual(untouched);
    expect(toStoredTriggers(null)).toBeNull();
  });
});

describe("what a read gives back", () => {
  it("the kind that says the same thing, in the spelling the checker reads", () => {
    for (const p of live) expect(samePredicate(viewPredicate(toStoredPredicate(p)), p)).toBe(true);
    for (const p of live) expect((viewPredicate(toStoredPredicate(p)) as { kind?: string }).kind).toBe(p.kind);
  });

  it("a row still in a kind, untouched", () => {
    for (const p of all) expect(viewPredicate(p)).toBe(p);
    const list = [{ id: "a", predicate: rows[0].predicate }];
    expect(viewTriggers(list)).toEqual(list);
  });
});

describe("every rule answers the same for a trigger stored either way", () => {
  const ACTIONS: TriggerAction[] = ["ENTER", "ADD", "TRIM", "EXIT", "REVIEW"];
  const DIRECTIONS = ["LONG", "SHORT", null];
  const cases = live.flatMap((p) => ACTIONS.flatMap((action) => DIRECTIONS.map((direction) => ({ p, s: toStoredPredicate(p) as StoredRow, action, direction }))));
  type Case = (typeof cases)[number];
  const both = (f: (p: StoredRow, c: Case) => unknown) =>
    cases.filter((c) => JSON.stringify(f(c.p, c)) !== JSON.stringify(f(c.s, c))).map((c) => ({ p: c.p, action: c.action, direction: c.direction }));

  const RULES: Array<[string, (p: StoredRow, c: Case) => unknown]> = [
    ["the cascade slot", (p: StoredRow, c: Case) => triggerBucket({ predicate: p, action: c.action })],
    ["the default cooldown and the weekly floor", (p: StoredRow, c: Case) => flooredCooldownDays({ predicate: p, action: c.action }, defaultCooldownDaysForPredicate(p, c.action))],
    ["a direct sale and its close label", (p: StoredRow, c: Case) => [isDirectEligiblePredicate(p), protectiveExitCloseReason(p, c.direction)]],
    ["what it does on a stock we don't hold", (p: StoredRow, c: Case) => effectiveTriggerAction({ predicate: p, action: c.action }, { status: "WATCHING", direction: c.direction })],
    ["a watched floor on the close", (p: StoredRow, c: Case) => samePredicate(watchedFloorOnClose({ predicate: p, action: c.action }, { status: "WATCHING" }).predicate, watchedFloorOnClose({ predicate: c.p, action: c.action }, { status: "WATCHING" }).predicate)],
    ["the plan slot", (p: StoredRow, c: Case) => [levelSlotOf({ id: "t", predicate: p, action: c.action, rationale: "" }, c.direction), isPlanLevel({ id: "t", predicate: p, action: c.action, rationale: "" }, c.direction)]],
    ["the chart line", (p: StoredRow, c: Case) => canonicalLevels({ triggers: [{ id: "t", predicate: p, action: c.action, rationale: "", level: "THESIS", inherited: false }], direction: c.direction, avgCost: 100, peakPrice: 130, atr14: 5 }).all],
    ["Agent Watch", (p: StoredRow) => agentWatchDays([{ predicate: p }])],
  ];
  it.each(RULES)("%s", (_, f) => {
    expect(both(f)).toEqual([]);
  });
});
