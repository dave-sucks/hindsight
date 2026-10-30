/**
 * GEV, 2026-10-29: the morning's sale request expired at 10:01 ET, sixteen
 * minutes after the trigger run wrote the day's note. The expiry's Activity
 * line carried "The sale of 9 GEV expired without an answer. Its reason:"
 * and the first 240 characters of the day-old reason, and the sheet led with
 * it, signed by the analyst. The app writes the line's title now and no
 * paragraph; the reason stays on the order.
 *
 * PLTR, 2026-10-30: its sale of 38 shares (proposed 10-29 10:15 ET) lapsed at
 * 10:15 and the job flipped it at 10:30, when PLTR traded at $187.07. The
 * line now carries that price.
 */
import { prismaDouble, positionRow, thesisRow, REPLAY_ANALYST_ID } from "@/lib/replay";

const REASON = "GE Vernova is at $848.12 on Oct. 28, so the stock is still below the $868 September base low";

const sale = (id: string, symbol: string, quantity: number, rationale: string) => ({
  id,
  positionId: `pos_${symbol}`,
  symbol,
  intent: "CLOSE",
  status: "AWAITING_APPROVAL",
  quantity,
  rationale,
  expiresAt: new Date(Date.now() - 60_000),
  position: { id: `pos_${symbol}`, status: "OPEN", analystId: REPLAY_ANALYST_ID, accountId: "account_replay" },
});

/** The job's pass over these sales; `prices` is the live quote per stock (absent = no quote). */
async function expire(orders = [sale("ord_gev", "GEV", 9, REASON)], prices: Record<string, number> = {}) {
  const symbols = orders.map((o) => o.symbol);
  const db = prismaDouble({
    thesis: symbols.map((t) => thesisRow({ id: t.toLowerCase(), ticker: t, status: "HOLDING" })),
    position: symbols.map((t) => positionRow({ id: `pos_${t}`, symbol: t, status: "OPEN", analystId: REPLAY_ANALYST_ID })),
    order: orders,
  });
  const quoteCalls: string[][] = [];
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/market-data/live-quote", () => ({
      getLiveQuotes: async (syms: string[]) => {
        quoteCalls.push(syms);
        return Object.fromEntries(syms.map((t) => [t, { quote: prices[t] != null ? { c: prices[t], t: Math.floor(Date.now() / 1000) } : null }]));
      },
    }));
    jest.doMock("@/lib/inngest/client", () => ({
      inngest: { createFunction: (_c: unknown, _t: unknown, handler: unknown) => ({ handler }), send: jest.fn() },
    }));
    const { proposalExpiry } = (await import("./proposal-expiry")) as unknown as {
      proposalExpiry: { handler: (a: { step: { run: (id: string, fn: () => unknown) => unknown } }) => Promise<unknown> };
    };
    await proposalExpiry.handler({ step: { run: async (_id, fn) => fn() } });
  });
  for (const m of ["@/lib/prisma", "@/lib/inngest/client", "@/lib/market-data/live-quote"]) jest.dontMock(m);
  return { db, quoteCalls };
}

const lines = (db: ReturnType<typeof prismaDouble>) => db.store.thesisUpdate as Array<{ type: string; summary: string; rationale?: string | null; priceAtTime: number | null }>;

describe("a sale request that expires", () => {
  it("GEV 10-29: one Activity line with its title and no paragraph; the reason stays on the order", async () => {
    const { db } = await expire();
    expect(lines(db)).toHaveLength(1);
    expect(lines(db)[0]).toMatchObject({ type: "PROPOSAL_EXPIRED", summary: "CLOSE proposal on GEV expired without user decision" });
    expect(lines(db)[0].rationale ?? null).toBeNull();
    expect(db.store.order[0]).toMatchObject({ status: "EXPIRED", rationale: REASON });
  });

  it("PLTR 10-30: the line carries the price when the sale lapsed; one quote call prices every lapse in the pass", async () => {
    const { db, quoteCalls } = await expire([sale("cmvtmlg0p000708l5i68zo9w0", "PLTR", 38, "(the reason)"), sale("ord_gev", "GEV", 9, REASON)], { PLTR: 187.07 });
    expect(quoteCalls).toEqual([["PLTR", "GEV"]]);
    expect(lines(db).map((l) => [l.summary, l.priceAtTime])).toEqual([
      ["CLOSE proposal on PLTR expired without user decision", 187.07],
      // No quote for GEV: no price, as before.
      ["CLOSE proposal on GEV expired without user decision", null],
    ]);
  });
});
