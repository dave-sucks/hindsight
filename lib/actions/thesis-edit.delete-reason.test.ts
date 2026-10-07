/**
 * A removal that is not a click says why (DAV-322).
 *
 * The cleanup of copied rules takes ABT's own "sell 25% off the high" off
 * the stock because the Secular Compounder's 25% governs instead. Through
 * the popover's delete, bare, that is logged as "Principal removed ABT
 * trigger — Trailing 25% from high → exit": a line that reads as the
 * principal taking a sale off a holding, and that the next audit would
 * file as a finding.
 */
import { prismaDouble, thesisRow, positionRow, REPLAY_ACCOUNT_ID, REPLAY_USER_ID } from "@/lib/replay";
import { principalDecision, type ActivityRow } from "@/lib/agent/stock-context";

const trail = {
  id: "trail-25",
  predicate: { watch: "move", is: "below", value: 25, variable: "peak" },
  action: "EXIT",
  rationale: "Gave back 25% from the high — the catastrophe line.",
  source: "DEFAULT",
  cooldownDays: 0,
};
const floor = {
  id: "floor",
  predicate: { watch: "price", is: "below", value: 96 },
  action: "EXIT",
  rationale: "Floor.",
  source: "AGENT",
  cooldownDays: 0,
};

async function remove(why?: string) {
  const db = prismaDouble({
    thesis: [thesisRow({ id: "abt", ticker: "ABT", status: "HOLDING", horizon: "COMPOUNDER", entryPrice: 103.66, stopLoss: 96, targetPrice: 135, triggers: [floor, trail] })],
    position: [positionRow({ symbol: "ABT", avgCost: 103.66, quantity: 88 })],
  });
  let mod!: typeof import("./thesis-edit");
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/actions/finnhub.actions", () => ({ getStockQuote: jest.fn(async () => ({ c: 99.4, t: Math.floor(Date.now() / 1000) })) }));
    mod = await import("./thesis-edit");
    await mod.applyTriggerDelete("abt", "trail-25", { accountId: REPLAY_ACCOUNT_ID, actorUserId: REPLAY_USER_ID }, why);
  });
  const row = (db.store.thesisUpdate as Array<{ summary: string; rationale: string }>).at(-1)!;
  const left = (db.store.thesis[0].triggers as Array<{ id: string }>).map((t) => t.id);
  return { row, left };
}

describe("applyTriggerDelete — the line says why when it is not a click", () => {
  it("the cleanup's removal names itself and its reason", async () => {
    const { row, left } = await remove("same rung, same number as the rule above it; the analyst's rule governs from here");
    expect(left).toEqual(["floor"]);
    expect(row.summary).toBe("Removed a copied rule from ABT — Sell if below 25% from the high since we bought");
    expect(row.rationale).toContain("in the cleanup of copied rules");
    expect(row.rationale).toContain("the analyst's rule governs from here");
    expect(row.summary).not.toMatch(/^Principal removed/);
  });

  it("a click in the popover is logged as it always was", async () => {
    const { row, left } = await remove();
    expect(left).toEqual(["floor"]);
    expect(row.summary).toBe("You removed a trigger on ABT: Sell if below 25% from the high since we bought");
    expect(row.rationale).toContain("Don't add it back unless the thesis changes.");
  });

  it("what the next run reads from each: the cleanup row nothing, the click its removal and what it asks", async () => {
    const read = async (why?: string) => principalDecision({ ...(await remove(why)).row, timestamp: new Date(0) } as unknown as ActivityRow);
    expect(await read("the analyst's rule governs from here")).toBeNull();
    expect(await read()).toMatchObject({
      wantsAnswer: true,
      line: "Set by hand: Removed: Sell if below 25% from the high since we bought. Don't add it back unless the thesis changes.",
    });
  });
});
