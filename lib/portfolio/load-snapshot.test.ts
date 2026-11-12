/**
 * loadPortfolioSnapshot through its own code, with the broker, the quotes and
 * the database stood in for. The case it exists for: at 10 PM ET on Nov 11 the
 * broker marked CEG at an after-hours $271.81 and called its day −1.1%, while
 * it closed at $274.73, up 2.6%. The snapshot takes the app's price (the close)
 * and the close's day. Stand-in shares and cash; the prices are public.
 */
const order = { findMany: jest.fn(), findFirst: jest.fn() };
jest.mock("@/lib/prisma", () => ({
  prisma: {
    position: { findMany: jest.fn(async () => [{ symbol: "CEG", analystId: "a1" }]) },
    agentConfig: { findMany: jest.fn(async () => [{ id: "a1", name: "Analyst One" }]) },
    order,
  },
}));
jest.mock("@/lib/auth/account", () => ({ getOwnerUserId: jest.fn(async () => "user_owner") }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: jest.fn(async () => ({ keyId: "k", secretKey: "s", baseUrl: "https://broker.test" })) }));
jest.mock("@/lib/alpaca", () => ({
  getAccount: jest.fn(async () => ({ cash: "10000", equity: "999999", last_equity: "1" })),
  getAllPositions: jest.fn(async () => [
    // The broker's after-hours mark, which the snapshot must not use.
    { symbol: "CEG", qty: "10", side: "long", avg_entry_price: "282.006094", current_price: "271.81", market_value: "2718.1", unrealized_pl: "0", unrealized_plpc: "0", cost_basis: "2820.06" },
  ]),
  getFundingActivities: jest.fn(async () => [{ date: "2026-05-01", amount: 15_000 }]),
}));
const CLOSE_AT = Date.parse("2026-11-11T21:00:00Z") / 1000; // 4:00 PM ET, Nov 11
const getLiveQuotes = jest.fn();
jest.mock("@/lib/market-data/live-quote", () => ({ getLiveQuotes: (...a: unknown[]) => getLiveQuotes(...a) }));

import { loadPortfolioSnapshot, nyMidnight } from "./load-snapshot";

const NOW = new Date("2026-11-12T03:00:00Z"); // 10 PM ET, Nov 11
type Where = { status?: unknown; side?: string; positionId?: string; symbol?: string; position?: { analystId?: string }; createdAt?: { gt: Date } };

const SELL_WAITING = { symbol: "CEG", side: "SELL", quantity: 10, rationale: "CEG is under your sell line.", positionId: "p1", createdAt: new Date("2026-11-11T14:40:00Z"), position: { analystId: "a1" } };
const BUY_WAITING = { symbol: "WST", side: "BUY", quantity: 21, rationale: "WST is over its buy level.", positionId: "p9", createdAt: new Date("2026-11-11T14:35:00Z"), position: { analystId: "a1" } };

beforeEach(() => {
  getLiveQuotes.mockReset().mockResolvedValue({ CEG: { quote: { c: 274.73, pc: 267.76, t: CLOSE_AT } } });
  order.findFirst.mockReset().mockResolvedValue({ filledAt: new Date("2026-10-28T14:00:00Z") });
  order.findMany.mockReset().mockImplementation(async ({ where }: { where: Where }) => {
    if (where.status === "AWAITING_APPROVAL") return [SELL_WAITING, BUY_WAITING];
    if (where.status === "FILLED") return [];
    // The sale's history: two expired before it, and it.
    if (where.positionId === "p1")
      return [{ createdAt: new Date("2026-11-09T14:40:00Z") }, { createdAt: new Date("2026-11-10T14:40:00Z") }, { createdAt: new Date("2026-11-11T14:40:00Z") }];
    // The buy's history, by analyst and stock since the stock's last fill: each proposal was its own position.
    if (where.symbol === "WST") return [{ createdAt: new Date("2026-10-29T14:35:00Z") }, { createdAt: new Date("2026-11-05T14:35:00Z") }, { createdAt: new Date("2026-11-11T14:35:00Z") }];
    return [];
  });
});

const load = () => loadPortfolioSnapshot({ accountId: "acct", environment: "LIVE", now: NOW }).then((s) => s!);

describe("the snapshot at 10 PM ET", () => {
  it("prices at the close and dates the day by it, not by the broker's after-hours mark", async () => {
    const s = await load();
    expect(s.day).toBe("2026-11-11");
    expect(s.live).toBe(false);
    const ceg = s.holdings[0];
    expect(ceg.price).toBe(274.73);
    expect(ceg.move).toBeCloseTo(2.6031, 3);
    expect(s.value).toBeCloseTo(10_000 + 10 * 274.73, 6);
    expect(s.lifetime!.contributed).toBe(15_000);
  });

  it("looks for fills in that New York day only, scoped to the account", async () => {
    await load();
    const filled = order.findMany.mock.calls.map((c) => c[0]).find((a) => a.where.status === "FILLED");
    expect(filled.where.filledAt).toEqual({ gte: new Date("2026-11-11T05:00:00Z"), lt: new Date("2026-11-12T05:00:00Z") });
    expect(filled.where.position).toEqual({ accountId: "acct" });
  });

  it("counts a waiting sale's proposals by its position, and a waiting buy's by its analyst and stock since the last fill", async () => {
    const s = await load();
    expect(s.waiting).toEqual([
      { side: "SELL", ticker: "CEG", shares: 10, firstProposed: "2026-11-09T14:40:00.000Z", times: 3, note: "CEG is under your sell line.", analyst: "Analyst One" },
      { side: "BUY", ticker: "WST", shares: 21, firstProposed: "2026-10-29T14:35:00.000Z", times: 3, note: "WST is over its buy level.", analyst: "Analyst One" },
    ]);
    const buyQuery = order.findMany.mock.calls.map((c) => c[0]).find((a) => a.where.symbol === "WST");
    expect(buyQuery.where).toMatchObject({ side: "BUY", expiresAt: { not: null }, position: { accountId: "acct", analystId: "a1" }, createdAt: { gt: new Date("2026-10-28T14:00:00Z") } });
    // Broker rejections were never proposals: only orders with an expiry count.
    const sellQuery = order.findMany.mock.calls.map((c) => c[0]).find((a) => a.where.positionId === "p1");
    expect(sellQuery.where).toMatchObject({ expiresAt: { not: null } });
  });

  it("a stock with no trade that day (its quote is older) is flat", async () => {
    getLiveQuotes.mockResolvedValue({ CEG: { quote: { c: 274.73, pc: 267.76, t: Date.parse("2026-11-10T21:00:00Z") / 1000 } } });
    const s = await loadPortfolioSnapshot({ accountId: "acct", environment: "LIVE", now: new Date("2026-11-11T19:00:00Z") }); // 2 PM ET, in the session
    expect(s!.holdings[0].noTradeThatDay).toBe(true);
    expect(s!.dayChange!.dollars).toBe(0);
  });

  it("a fill with no recorded price leaves the day unknown", async () => {
    order.findMany.mockImplementation(async ({ where }: { where: Where }) =>
      where.status === "FILLED" ? [{ symbol: "CEG", side: "BUY", quantity: 5, filledQty: 5, filledPrice: null, filledAt: new Date("2026-11-11T15:00:00Z"), position: { analystId: "a1" } }] : [],
    );
    expect((await load()).dayChange).toBeNull();
  });
});

describe("New York's midnight", () => {
  it("is 5 AM UTC in winter and 4 AM UTC in summer, the switch days included", () => {
    expect(nyMidnight("2026-11-11").toISOString()).toBe("2026-11-11T05:00:00.000Z");
    expect(nyMidnight("2026-07-01").toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(nyMidnight("2026-03-08").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(nyMidnight("2026-11-01").toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });
});
