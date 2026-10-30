/**
 * A declined proposal's Activity line carries the price when you declined.
 * ASML, 2026-10-08: its sale of 5 shares (proposed 10-07 14:33 ET) was declined
 * at 12:59 ET, when ASML traded at $1,782.07. The line stored no price.
 */
import { prismaDouble, positionRow, thesisRow, REPLAY_ANALYST_ID, REPLAY_USER_ID } from "@/lib/replay";

const ORDER = "cmuyg481u000i04l7atzmlo64";

async function decline(price: number | null) {
  const db = prismaDouble({
    thesis: [thesisRow({ id: "asml", ticker: "ASML", status: "HOLDING" })],
    position: [positionRow({ id: "pos_asml", symbol: "ASML", status: "OPEN", quantity: 5, analystId: REPLAY_ANALYST_ID })],
    order: [
      {
        id: ORDER,
        positionId: "pos_asml",
        symbol: "ASML",
        intent: "CLOSE",
        side: "SELL",
        status: "AWAITING_APPROVAL",
        quantity: 5,
        createdAt: new Date("2026-10-07T18:33:20.725Z"),
        expiresAt: new Date(Date.now() + 3_600_000),
        position: { id: "pos_asml", accountId: "account_replay", analystId: REPLAY_ANALYST_ID, symbol: "ASML", status: "OPEN" },
      },
    ],
  });
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: () => ({}), send: jest.fn() } }));
    jest.doMock("@/lib/market-data/live-quote", () => ({
      getLiveQuote: async () => ({ quote: price != null ? { c: price, t: Math.floor(Date.now() / 1000) } : null }),
    }));
    const { rejectProposal } = await import("./execute");
    await rejectProposal(ORDER, "(your comment)", REPLAY_USER_ID);
  });
  for (const m of ["@/lib/prisma", "@/lib/inngest/client", "@/lib/market-data/live-quote"]) jest.dontMock(m);
  return (db.store.thesisUpdate as Array<{ type: string; priceAtTime: number | null; rationale: string | null }>)[0];
}

describe("declining a proposal", () => {
  it("ASML 10-08: the Declined line carries the price then, with your comment", async () => {
    expect(await decline(1782.07)).toMatchObject({ type: "PROPOSAL_REJECTED", priceAtTime: 1782.07, rationale: "(your comment)" });
  });

  it("no quote: the line has no price, as before", async () => {
    expect((await decline(null)).priceAtTime).toBeNull();
  });
});
