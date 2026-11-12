/**
 * loadPortfolioSnapshot through its own code, with the broker, the quotes and
 * the database stood in for. The case it exists for: at 10 PM ET on Nov 11 the
 * broker marked CEG at an after-hours $271.81 and called its day −1.1%, while
 * it closed at $274.73, up 2.6%. The snapshot takes the app's price (the close)
 * and the close's day. Stand-in shares and cash; the prices are public.
 */
const order = { findMany: jest.fn() };
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
const CLOSE_AT = Date.parse("2026-11-11T21:00:00Z") / 1000; // 4:00 PM ET
jest.mock("@/lib/market-data/live-quote", () => ({
  getLiveQuotes: jest.fn(async () => ({ CEG: { quote: { c: 274.73, pc: 267.76, t: CLOSE_AT } } })),
}));

import { loadPortfolioSnapshot, nyMidnight } from "./load-snapshot";

const NOW = new Date("2026-11-12T03:00:00Z"); // 10 PM ET, Nov 11

beforeEach(() => {
  order.findMany.mockReset();
  order.findMany.mockImplementation(async ({ where }: { where: { status: unknown } }) => {
    if (where.status === "AWAITING_APPROVAL")
      return [{ symbol: "CEG", side: "SELL", quantity: 10, rationale: "CEG is under your sell line.", positionId: "p1", createdAt: new Date("2026-11-11T14:40:00Z"), position: { analystId: "a1" } }];
    if (where.status === "FILLED") return [];
    // The proposal's history: two expired before it, and it.
    return [
      { positionId: "p1", side: "SELL", createdAt: new Date("2026-11-09T14:40:00Z") },
      { positionId: "p1", side: "SELL", createdAt: new Date("2026-11-10T14:40:00Z") },
      { positionId: "p1", side: "SELL", createdAt: new Date("2026-11-11T14:40:00Z") },
    ];
  });
});

describe("the snapshot at 10 PM ET", () => {
  it("prices at the close and dates the day by it, not by the broker's after-hours mark", async () => {
    const s = (await loadPortfolioSnapshot({ accountId: "acct", environment: "LIVE", now: NOW }))!;
    expect(s.day).toBe("2026-11-11");
    expect(s.live).toBe(false);
    const ceg = s.holdings[0];
    expect(ceg.price).toBe(274.73);
    expect(ceg.day!.pct).toBeCloseTo(2.6031, 3);
    expect(s.value).toBeCloseTo(10_000 + 10 * 274.73, 6);
    expect(s.lifetime!.contributed).toBe(15_000);
  });

  it("looks for fills in that New York day only, and counts how many times the waiting sale was proposed", async () => {
    const s = (await loadPortfolioSnapshot({ accountId: "acct", environment: "LIVE", now: NOW }))!;
    const filled = order.findMany.mock.calls.map((c) => c[0]).find((a) => a.where.status === "FILLED");
    expect(filled.where.filledAt).toEqual({ gte: new Date("2026-11-11T05:00:00Z"), lt: new Date("2026-11-12T05:00:00Z") });
    expect(filled.where.position).toEqual({ accountId: "acct" });
    expect(s.waiting).toEqual([
      { side: "SELL", ticker: "CEG", shares: 10, firstProposed: "2026-11-09T14:40:00.000Z", times: 3, note: "CEG is under your sell line.", analyst: "Analyst One" },
    ]);
  });
});

describe("New York's midnight", () => {
  it("is 5 AM UTC in winter and 4 AM UTC in summer", () => {
    expect(nyMidnight("2026-11-11").toISOString()).toBe("2026-11-11T05:00:00.000Z");
    expect(nyMidnight("2026-07-01").toISOString()).toBe("2026-07-01T04:00:00.000Z");
  });
});
