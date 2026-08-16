/**
 * seed-account.test.ts — standing rules as DATA.
 *
 * The claim: an account starts with the constant minimums as ordinary
 * editable rules, and an analyst only overrides where its archetype
 * genuinely differs. Seeding a full copy onto every analyst would give
 * each seat a frozen snapshot and make the account page powerless.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { accountSeedTriggers, analystSeedFromArchetype } from "./seed-account";
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

describe("analystSeedFromArchetype", () => {
  it("gives an accumulator dip entry and a wider trail", () => {
    const seed = analystSeedFromArchetype("DEEP_VALUE");
    expect(seed.entryTriggerMode).toBe("DIP");
    const trail = seed.triggers.find(
      (t) => t.predicate.kind === "TRAILING_FROM_HIGH",
    );
    expect((trail?.predicate as { pct: number }).pct).toBe(15);
  });

  it("gives a scalper confirmation entry and a tighter trail", () => {
    const seed = analystSeedFromArchetype("INTRADAY_MOMENTUM_SCALPER");
    expect(seed.entryTriggerMode).toBe("BREAKOUT");
    const trail = seed.triggers.find(
      (t) => t.predicate.kind === "TRAILING_FROM_HIGH",
    );
    expect((trail?.predicate as { pct: number }).pct).toBe(4);
  });

  it("leaves an archetype with no genuine difference inheriting the account", () => {
    // The point of the cascade: don't copy the house rules onto the seat.
    expect(analystSeedFromArchetype("EARNINGS_DRIFT").triggers).toEqual([]);
  });

  it("falls back to historic behavior for an unknown or absent archetype", () => {
    for (const id of [undefined, null, "NOPE"]) {
      const seed = analystSeedFromArchetype(id);
      expect(seed.entryTriggerMode).toBe("BREAKOUT");
      expect(seed.triggers).toEqual([]);
    }
  });

  it("stamps cooldown and fire mode on seeded rules", () => {
    for (const t of analystSeedFromArchetype("DEEP_VALUE").triggers) {
      expect(t.cooldownDays).toBeDefined();
      expect(t.fireMode).toBeDefined();
      expect(t.source).toBe("DEFAULT");
    }
  });
});
