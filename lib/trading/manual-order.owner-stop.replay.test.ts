/**
 * A stop typed on the Trade ticket is the owner's floor, through the
 * Trade button's own entry point (placeManualOrder → approveProposal → the
 * fill). With stop when buying on at 8%, his tighter stop stays his sell line;
 * a looser one is raised to the line.
 *
 * TRV (Secular Compounder): the watched row on 2026-10-22, buy $398.70, the
 * analyst's floor $382.40 (the ticket's default), target $431.50; a buy at
 * $398.95, its price that day. The line is $367.03. Only the database, the
 * broker and the clock are doubled. The floor is stored as the 2026-11-16
 * migration stores a watch's (STOP_WATCHING, on the close): the fill takes it
 * off with the buy, and the ticket's stop is the holding's sale.
 */
import { prismaDouble, thesisRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID, REPLAY_ACCOUNT_ID, REPLAY_USER_ID, type PrismaDouble } from "@/lib/replay";
import type { Trigger } from "@/lib/agent/triggers/types";

const AT = new Date("2026-10-22T14:00:05Z"); // 10:00 ET
const PRICE = 398.95;
const FLOOR = {
  id: "aaf8dc78-a969-495d-ab0a-6bb95b55fe66",
  action: "STOP_WATCHING",
  source: "AGENT",
  fireMode: "ASK_NOW",
  predicate: { is: "below", value: 382.4, watch: "price", settings: { close: true } },
  rationale: "I am using $382.40 just under the recent swing-high-turned-support area so a failed breakout ends the plan quickly.",
  cooldownDays: 1,
};
const ROW = [
  { id: "6e111cb3-34f8-4d89-a2f5-f7ceff7f8f4b", action: "ENTER", source: "AGENT", fireMode: "ASK_NOW", predicate: { is: "above", value: 398.7, watch: "price", settings: { close: true } }, rationale: "I buy when it breaks above $398.70.", cooldownDays: 1 },
  FLOOR,
  { id: "c5b67206-924c-4260-be2a-82918f32bbbd", action: "REVIEW", source: "AGENT", fireMode: "NEXT_MORNING", predicate: { is: "above", value: 431.5, watch: "price" }, rationale: "The 1.272 Fibonacci extension of the January-July up-leg is $431.53.", cooldownDays: 1 },
];

/** TRV's row and the Trade button's own entry points, with only the database, the broker and the clock doubled. */
async function desk(use: (m: typeof import("@/lib/trading/manual-order")) => Promise<void>): Promise<PrismaDouble> {
  const db = prismaDouble({
    account: [accountRow({ autoStopOnBuy: true, autoStopPct: 8, setupOverrides: {} })],
    agentConfig: [agentConfigRow({ name: "Secular Compounder", tradingEnvironment: "LIVE", minPositionSize: 4000, maxPositionSize: 10000, maxPositionTotal: 20000, riskPct: 1 })],
    thesis: [
      thesisRow({ id: "thesis_TRV", ticker: "TRV", status: "WATCHING", direction: "LONG", horizon: "COMPOUNDER", setupId: "BASE_BREAKOUT", entryPrice: 398.7, stopLoss: 382.4, targetPrice: 431.5, triggers: ROW }),
    ],
  });
  // The double joins nothing: an order carries its position inline, as the approval reads it.
  const orders = db.order as { create: (a: { data: Record<string, unknown> }) => Promise<unknown> };
  const create = orders.create;
  orders.create = (a) => create({ ...a, data: { ...a.data, position: (db.store.position as Array<Record<string, unknown>>).find((p) => p.id === a.data.positionId) } });
  jest.useFakeTimers({ now: AT, doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  try {
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => ({ keyId: "PKTEST", secretKey: "s", baseUrl: "https://api.alpaca.markets" }) }));
      jest.doMock("@/lib/alpaca", () => ({
        getSnapshots: async () => ({
          TRV: { latestTrade: { p: PRICE, t: "2026-10-22T14:00:03Z" }, dailyBar: { t: "2026-10-22T04:00:00Z", o: 397, h: 399.5, l: 396.2, c: PRICE }, prevDailyBar: { t: "2026-10-21T04:00:00Z", o: 395, h: 399, l: 394, c: 398.1 } },
        }),
        getAccount: async () => ({ cash: "60000", equity: "113000", buying_power: "120000" }),
        placeMarketOrder: async () => ({ id: "alpaca_order_1", status: "accepted" }),
        closePositionPartial: async () => null,
        getLatestPrice: async () => PRICE,
      }));
      jest.doMock("@/lib/trading/after-buy", () => ({ sendWriterAfterBuy: async () => false }));
      jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: () => ({}), send: jest.fn() } }));
      await use(await import("@/lib/trading/manual-order"));
    });
  } finally {
    jest.useRealTimers();
  }
  return db;
}

const tradeTicket = (stopLoss: number | null) =>
  desk(async ({ placeManualOrder }) => {
    const r = await placeManualOrder({
      userId: REPLAY_USER_ID,
      accountId: REPLAY_ACCOUNT_ID,
      environment: "LIVE",
      ticker: "TRV",
      analystId: REPLAY_ANALYST_ID,
      order: { side: "BUY", shares: 25, reviewedPrice: PRICE, stopLoss, targetPrice: 431.5 },
    });
    if (!r.ok) throw new Error(r.error);
    expect(r).toMatchObject({ ok: true, intent: "OPEN" });
  });

const thesis = (db: PrismaDouble) => (db.store.thesis as Array<Record<string, unknown>>)[0];
const below = (db: PrismaDouble, action: string) =>
  (thesis(db).triggers as Trigger[]).filter((t) => t.action === action && (t.predicate as { watch?: string }).watch === "price" && (t.predicate as { is?: string }).is === "below");

describe("TRV bought from the Trade button, stop when buying on at 8% ($367.03)", () => {
  it("a typed $390 stop, tighter than the line: it is his sell line, as he set it, and no review line is made from it", async () => {
    const db = await tradeTicket(390);
    expect(thesis(db)).toMatchObject({ status: "HOLDING", stopLoss: 390 });
    expect(below(db, "EXIT")).toEqual([
      expect.objectContaining({ predicate: { is: "below", value: 390, watch: "price" }, source: "PRINCIPAL", rationale: "Sell if below $390. You set this." }),
    ]);
    // The watch's line came off with the buy: it is never the sale.
    expect(below(db, "STOP_WATCHING")).toEqual([]);
    // No review line below: none at the analyst's $382.40, and no template's 8%-below-entry line (deleted 2026-11-16).
    expect(below(db, "REVIEW")).toEqual([]);
  });

  it("a typed $360 stop, looser than the line: raised to $367.03 in place, sold right away, his", async () => {
    const db = await tradeTicket(360);
    expect(below(db, "EXIT")).toEqual([
      expect.objectContaining({ predicate: { is: "below", value: 367.03, watch: "price" }, fireMode: "DO_IT", source: "PRINCIPAL" }),
    ]);
    expect(thesis(db)).toMatchObject({ stopLoss: 367.03 });
    expect((db.store.position as Array<Record<string, unknown>>)[0]).toMatchObject({ stopLoss: 367.03 });
  });

  it("a typed $382.40 (the watch's line, which the ticket no longer offers): the stop on the ticket is the owner's sale, tighter than the line, so it stays", async () => {
    const db = await tradeTicket(382.4);
    expect(below(db, "EXIT")).toEqual([expect.objectContaining({ predicate: { is: "below", value: 382.4, watch: "price" }, source: "PRINCIPAL", rationale: "Sell if below $382.40. You set this." })]);
    expect(below(db, "STOP_WATCHING")).toEqual([]);
    expect(below(db, "REVIEW")).toEqual([]);
  });
});

describe("the Trade ticket on TRV, a stock we only watch", () => {
  it("starts with no sell price: the row's hidden stopLoss ($382.40, its Stop watching line) is not offered as a stop", async () => {
    let lane: Record<string, unknown> | undefined;
    const db = await desk(async ({ getTradeTicket }) => {
      const ticket = await getTradeTicket({ userId: REPLAY_USER_ID, accountId: REPLAY_ACCOUNT_ID, ticker: "TRV", environment: "LIVE" });
      lane = ticket.lanes.find((l) => l.analystId === REPLAY_ANALYST_ID)?.buy as Record<string, unknown> | undefined;
    });
    expect(thesis(db)).toMatchObject({ status: "WATCHING", stopLoss: 382.4 });
    expect(lane).toEqual({ kind: "OPEN", thesisId: "thesis_TRV", needsResearch: false, targetPrice: 431.5 });
  });
});
