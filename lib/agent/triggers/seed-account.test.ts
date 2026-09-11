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
import { triggerBucket } from "./bucket";

describe("accountSeedTriggers", () => {
  it("carries a sell ladder for every horizon (DAV-250)", () => {
    const seed = accountSeedTriggers();
    for (const h of ["TRADE", "TARGET", "COMPOUNDER"] as const) {
      expect(
        seed.some((t) => t.action === "EXIT" && t.predicate.kind === "TRAILING_FROM_HIGH" && t.horizons?.includes(h)),
      ).toBe(true);
    }
    // No sell rule applies to every horizon — each one names its horizon.
    expect(seed.filter((t) => t.action === "EXIT" && !t.horizons?.length)).toEqual([]);
  });

  it("carries the earnings rules — a look before the report and a look on it", () => {
    const kinds = accountSeedTriggers().map((t) => t.predicate.kind);
    expect(kinds).toContain("EARNINGS_WITHIN");
    expect(kinds).toContain("EARNINGS_BEAT");
    expect(kinds).toContain("EARNINGS_MISS");
    // Wakes, not clocks: every earnings rule is a REVIEW, never a trade.
    expect(
      accountSeedTriggers()
        .filter((t) => t.predicate.kind.startsWith("EARNINGS"))
        .every((t) => t.action === "REVIEW"),
    ).toBe(true);
  });

  it("mints fresh ids per call — these are real stored rows now", () => {
    const a = accountSeedTriggers();
    const b = accountSeedTriggers();
    expect(a.map((t) => t.id)).not.toEqual(b.map((t) => t.id));
    // And not the old synthetic runtime handles.
    expect(a.every((t) => !t.id.startsWith("default:"))).toBe(true);
  });

  it("emits one rule per bucket per horizon, so each horizon resolves without self-collision", () => {
    const seed = accountSeedTriggers();
    for (const h of ["TRADE", "TARGET", "CATALYST", "COMPOUNDER"] as const) {
      const mine = seed.filter((t) => !t.horizons?.length || t.horizons.includes(h));
      expect(new Set(mine.map(triggerBucket)).size).toBe(mine.length);
    }
  });
});
