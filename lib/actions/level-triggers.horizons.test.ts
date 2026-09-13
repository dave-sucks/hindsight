/**
 * Account rules are one set per horizon (DAV-250): a trade's trail and a
 * compounder's trail are different rules in the same bucket.
 */

const stored: { triggers: unknown[] } = { triggers: [] };
jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: {
      findUnique: jest.fn(async () => ({ triggers: stored.triggers })),
      update: jest.fn(async ({ data }: { data: { triggers: unknown[] } }) => {
        stored.triggers = data.triggers;
      }),
    },
  },
}));

import { addLevelTrigger } from "./level-triggers";

const ctx = { accountId: "acct", actorUserId: "u" };
const trail = (pct: number) => ({ kind: "TRAILING_FROM_HIGH" as const, pct });

beforeEach(() => {
  stored.triggers = [];
});

describe("addLevelTrigger — horizons", () => {
  it("stores the horizons the rule was added for", async () => {
    const t = await addLevelTrigger("ACCOUNT", "acct", { action: "EXIT", predicate: trail(8), horizons: ["TRADE"] }, ctx);
    expect(t.horizons).toEqual(["TRADE"]);
  });

  it("a trade trail and a compounder trail can live side by side", async () => {
    await addLevelTrigger("ACCOUNT", "acct", { action: "EXIT", predicate: trail(8), horizons: ["TRADE"] }, ctx);
    await addLevelTrigger("ACCOUNT", "acct", { action: "EXIT", predicate: trail(25), horizons: ["COMPOUNDER"] }, ctx);
    expect(stored.triggers).toHaveLength(2);
  });

  it("refuses a second trail for the same horizon", async () => {
    await addLevelTrigger("ACCOUNT", "acct", { action: "EXIT", predicate: trail(8), horizons: ["TRADE"] }, ctx);
    await expect(
      addLevelTrigger("ACCOUNT", "acct", { action: "EXIT", predicate: trail(6), horizons: ["TRADE"] }, ctx),
    ).rejects.toThrow(/already exists for trade/);
  });

  it("refuses a rule whose horizons overlap an existing one", async () => {
    await addLevelTrigger("ACCOUNT", "acct", { action: "EXIT", predicate: trail(8), horizons: ["TRADE", "TARGET"] }, ctx);
    await expect(
      addLevelTrigger("ACCOUNT", "acct", { action: "EXIT", predicate: trail(6), horizons: ["TARGET"] }, ctx),
    ).rejects.toThrow(/already exists/);
  });

  it("an every-horizon rule may sit beside horizon rules (the horizon rule wins for its horizon)", async () => {
    await addLevelTrigger("ACCOUNT", "acct", { action: "EXIT", predicate: trail(25), horizons: ["COMPOUNDER"] }, ctx);
    const t = await addLevelTrigger("ACCOUNT", "acct", { action: "EXIT", predicate: trail(8) }, ctx);
    expect(t.horizons).toBeUndefined();
    expect(stored.triggers).toHaveLength(2);
  });
});
