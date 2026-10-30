/**
 * GEV, 2026-10-29: the morning's sale request expired at 10:01 ET, sixteen
 * minutes after the trigger run wrote the day's note. The expiry's Activity
 * line carried "The sale of 9 GEV expired without an answer. Its reason:"
 * and the first 240 characters of the day-old reason, and the sheet led with
 * it, signed by the analyst. The app writes the line's title now and no
 * paragraph; the reason stays on the order.
 */
import { prismaDouble, positionRow, thesisRow, REPLAY_ANALYST_ID } from "@/lib/replay";

const REASON = "GE Vernova is at $848.12 on Oct. 28, so the stock is still below the $868 September base low";

async function expire() {
  const db = prismaDouble({
    thesis: [thesisRow({ id: "gev", ticker: "GEV", status: "HOLDING" })],
    position: [positionRow({ id: "pos_gev", symbol: "GEV", status: "OPEN", analystId: REPLAY_ANALYST_ID })],
    order: [
      {
        id: "ord_gev",
        positionId: "pos_gev",
        symbol: "GEV",
        intent: "CLOSE",
        status: "AWAITING_APPROVAL",
        quantity: 9,
        rationale: REASON,
        expiresAt: new Date(Date.now() - 60_000),
        position: { id: "pos_gev", status: "OPEN", analystId: REPLAY_ANALYST_ID, accountId: "account_replay" },
      },
    ],
  });
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/inngest/client", () => ({
      inngest: { createFunction: (_c: unknown, _t: unknown, handler: unknown) => ({ handler }), send: jest.fn() },
    }));
    const { proposalExpiry } = (await import("./proposal-expiry")) as unknown as {
      proposalExpiry: { handler: (a: { step: { run: (id: string, fn: () => unknown) => unknown } }) => Promise<unknown> };
    };
    await proposalExpiry.handler({ step: { run: async (_id, fn) => fn() } });
  });
  jest.dontMock("@/lib/prisma");
  jest.dontMock("@/lib/inngest/client");
  return db;
}

describe("a sale request that expires", () => {
  it("GEV 10-29: one Activity line with its title and no paragraph; the reason stays on the order", async () => {
    const db = await expire();
    const lines = db.store.thesisUpdate as Array<{ type: string; summary: string; rationale?: string | null }>;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: "PROPOSAL_EXPIRED", summary: "CLOSE proposal on GEV expired without user decision" });
    expect(lines[0].rationale ?? null).toBeNull();
    expect(db.store.order[0]).toMatchObject({ status: "EXPIRED", rationale: REASON });
  });
});
