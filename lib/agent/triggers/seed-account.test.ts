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
  it("carries the constant minimums", () => {
    const seed = accountSeedTriggers();
    const kinds = seed.map((t) => t.predicate.kind);
    expect(kinds).toContain("TRAILING_FROM_HIGH");
    expect(kinds.filter((k) => k === "GAIN_FROM_ENTRY")).toHaveLength(2);
    expect(kinds.filter((k) => k === "PRICE_MOVE_PCT")).toHaveLength(2);
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
