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
  it("carries the up-7% add prompt and no sell rule — the down-7% add and the sell rules live on each analyst (DAV-279)", () => {
    const seed = accountSeedTriggers();
    expect(seed.filter((t) => t.action === "ADD").map((t) => t.predicate)).toEqual([
      { kind: "PRICE_MOVE_PCT", pct: 7, direction: "UP", window: "1D" },
    ]);
    expect(seed.filter((t) => t.action === "EXIT")).toEqual([]);
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

  it("carries the SEC filing wake — one rule, a review, never a trade", () => {
    const sec = accountSeedTriggers().filter((t) => t.predicate.kind === "SEC_EVENT");
    expect(sec).toHaveLength(1);
    expect(sec[0]).toMatchObject({ predicate: { kind: "SEC_EVENT", tier: "MATERIAL" }, action: "REVIEW" });
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
