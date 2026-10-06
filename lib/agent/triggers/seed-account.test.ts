/**
 * seed-account.test.ts — standing rules as DATA.
 *
 * The claim: an account starts with the constant minimums as ordinary
 * editable rules, and an analyst only overrides where its archetype
 * genuinely differs. Seeding a full copy onto every analyst would give
 * each seat a frozen snapshot and make the account page powerless.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { accountSeedTriggers } from "./seed-account";
import { isFilingRule, shapeName } from "@/lib/agent/triggers/condition/__fixtures__/shape-name";
import { triggerBucket } from "./bucket";

describe("accountSeedTriggers", () => {
  it("carries the up-7% add prompt and no sell rule — the down-7% add and the sell rules live on each analyst (DAV-279)", () => {
    const seed = accountSeedTriggers();
    expect(seed.filter((t) => t.action === "ADD").map((t) => t.predicate)).toEqual([
      { watch: "move", is: "above", value: 7, variable: "prev_close" },
    ]);
    expect(seed.filter((t) => t.action === "EXIT")).toEqual([]);
  });

  it("carries the earnings rules — a look before the report and a look on it", () => {
    const kinds = accountSeedTriggers().map((t) => shapeName(t.predicate));
    expect(kinds).toContain("report:before");
    expect(kinds).toContain("surprise:beat");
    expect(kinds).toContain("surprise:miss");
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
    expect(new Set(seed.map(triggerBucket)).size).toBe(seed.length);
  });
});
