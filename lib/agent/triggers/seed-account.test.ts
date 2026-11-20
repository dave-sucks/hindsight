/**
 * seed-account.test.ts — standing rules as DATA.
 *
 * The claim: an account starts with the constant minimums as ordinary
 * editable rules, and an analyst only overrides where its archetype
 * genuinely differs. Seeding a full copy onto every analyst would give
 * each seat a frozen snapshot and make the account page powerless.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { accountSeedTriggers, unseededAccountFallback } from "./seed-account";
import { isFilingRule, shapeName } from "@/lib/agent/triggers/condition/__fixtures__/shape-name";
import { triggerSlot } from "./condition/slot";

describe("accountSeedTriggers", () => {
  it("carries the trail as its one sale and no add — an add is a playbook's line on the stock (expert review 1.1)", () => {
    const seed = accountSeedTriggers();
    expect(seed.filter((t) => t.action === "ADD")).toEqual([]);
    expect(seed.filter((t) => t.action === "EXIT").map((t) => t.predicate)).toEqual([{ watch: "move", is: "below", value: 6, variable: "peak" }]);
  });

  it("looks before a report in time for a morning run, and the day after at once", () => {
    const seed = accountSeedTriggers();
    expect(seed.find((t) => shapeName(t.predicate) === "report:before")).toMatchObject({ predicate: { value: 5 }, fireMode: "NEXT_MORNING" });
    expect(seed.find((t) => shapeName(t.predicate) === "report:after")).toMatchObject({ predicate: { value: 1 }, fireMode: "ASK_NOW" });
  });

  it("carries the earnings rules — a look before the report and a look on it", () => {
    const kinds = accountSeedTriggers().map((t) => shapeName(t.predicate));
    expect(kinds).toContain("report:before");
    expect(kinds).toContain("report:after");
    // One look on the report, not a beat rule and a miss rule beside it (NVDA 2026-11-18: two runs on one report).
    expect(kinds.filter((k) => k?.startsWith("surprise:"))).toEqual([]);
    // Wakes, not clocks: every earnings rule is a REVIEW, never a trade.
    expect(
      accountSeedTriggers()
        .filter((t) => /^(report|surprise):/.test(shapeName(t.predicate) ?? ""))
        .every((t) => t.action === "REVIEW"),
    ).toBe(true);
  });

  it("carries the SEC filing wake — one rule, a review, never a trade", () => {
    const sec = accountSeedTriggers().filter((t) => isFilingRule(t.predicate));
    expect(sec).toHaveLength(1);
    expect(sec[0]).toMatchObject({ predicate: { watch: "filing", variable: "tier:MATERIAL" }, action: "REVIEW" });
  });

  it("mints fresh ids per call — these are real stored rows now", () => {
    const a = accountSeedTriggers();
    const b = accountSeedTriggers();
    expect(a.map((t) => t.id)).not.toEqual(b.map((t) => t.id));
    // And not the old synthetic runtime handles.
    expect(a.every((t) => !t.id.startsWith("default:"))).toBe(true);
  });

  it("emits one rung per bucket so it resolves without self-collision", () => {
    const seed = accountSeedTriggers();
    expect(new Set(seed.map(triggerSlot)).size).toBe(seed.length);
  });

  it("the unseeded fallback keeps the same ids on every read, so a trail that fired doesn't fire on every check", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(unseededAccountFallback("a").map((t) => t.id)).toEqual(unseededAccountFallback("a").map((t) => t.id));
    warn.mockRestore();
  });
});
