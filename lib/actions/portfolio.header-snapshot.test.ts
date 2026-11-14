/**
 * The homepage header reads getDashboardData: its Balance is
 * `portfolio.totalValue`, its 1D P&L `portfolio.dayPnl`, its All-time P&L
 * `portfolio.totalPnl`, and the chart ends at the curves' last points. All of
 * them now come from the portfolio snapshot, the numbers every agent is given.
 *
 * At 10 PM ET on Nov 11 the broker marked CEG at an after-hours $271.81; it
 * closed at $274.73, up from $267.76. The header valued the account at the
 * broker's equity, so at night it showed a different balance and day than
 * every agent was told. Through getDashboardData's own code, with the
 * broker, the quotes, sign-in and the database stood in
 * (lib/actions/__fixtures__/header-after-hours-2026-11-11.json: stand-in
 * shares, cash and deposits; the prices are public).
 */
import night from "@/lib/actions/__fixtures__/header-after-hours-2026-11-11.json";

const NOW = new Date(night.now);
const { shares, cash, contributed, depositedOn } = night.standIn;
const at = (price: number) => cash + shares * price;

jest.mock("@/lib/prisma", () => {
  // Nothing in the database: the header's numbers are the broker's and the snapshot's.
  const answer = (op: string) => (op.startsWith("findMany") || op === "groupBy" ? [] : op === "count" ? 0 : null);
  const model = new Proxy({}, { get: (_t, op: string) => async () => answer(op) });
  return { prisma: new Proxy({}, { get: () => model }) };
});
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user_owner" } } }) } }) }));
jest.mock("@/lib/auth/account", () => ({ getAccountId: async () => "acct", getOwnerUserId: async () => "user_owner" }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => ({ keyId: "k", secretKey: "s", baseUrl: "https://broker.test" }) }));
jest.mock("@/lib/actions/finnhub.actions", () => ({ getStockProfile: async () => null, getStockCandles: async () => [] }));
/** The app's one price: outside the session, the close stamped at the bell. */
const closeQuotes = async () => ({ CEG: { quote: { c: night.close.price, pc: night.close.prevClose, t: Date.parse(night.close.at) / 1000, source: "alpaca" } } });
const mockLiveQuotes = jest.fn();
jest.mock("@/lib/market-data/live-quote", () => ({ getLiveQuotes: (...a: unknown[]) => mockLiveQuotes(...a) }));
jest.mock("@/lib/alpaca", () => {
  const n = jest.requireActual("@/lib/actions/__fixtures__/header-after-hours-2026-11-11.json");
  const { shares: q, avgCost: cost, cash: c, contributed: put, depositedOn: on } = n.standIn;
  const v = (price: number) => c + q * price;
  return {
    // The broker's figures at 10 PM: its equity and its history's last point count the after-hours mark.
    getAccount: async () => ({ equity: String(v(n.brokerMark)), last_equity: String(v(n.close.prevClose)), cash: String(c), buying_power: String(c), long_market_value: String(q * n.brokerMark), short_market_value: "0" }),
    getAllPositions: async () => [
      { symbol: "CEG", qty: String(q), side: "long", avg_entry_price: String(cost), current_price: String(n.brokerMark), market_value: String(q * n.brokerMark), cost_basis: String(q * cost), unrealized_pl: "0", unrealized_plpc: "0" },
    ],
    getFundingActivities: async () => [{ date: on, amount: put }],
    getPortfolioHistory: async (opts: { timeframe?: string } = {}) =>
      opts.timeframe === "15Min"
        ? [
            { date: "2026-11-10T21:00:00.000Z", equity: v(n.close.prevClose), profitLoss: 0 },
            { date: "2026-11-11T21:00:00.000Z", equity: v(n.close.price), profitLoss: 0 },
            { date: "2026-11-12T00:45:00.000Z", equity: v(n.brokerMark), profitLoss: 0 },
          ]
        : [
            { date: on, equity: put, profitLoss: 0 },
            { date: "2026-11-10", equity: v(n.close.prevClose), profitLoss: 0 },
            { date: "2026-11-11", equity: v(n.brokerMark), profitLoss: 0 },
          ],
    getLatestPricesWithMeta: async () => ({ prices: {}, sources: {}, asOf: {}, fetchedAt: n.now }),
    getLatestPrices: async () => ({}),
  };
});

import { getDashboardData } from "./portfolio.actions";

beforeEach(() => {
  mockLiveQuotes.mockReset().mockImplementation(closeQuotes);
  jest.useFakeTimers({ now: NOW, doNotFake: ["setTimeout", "clearTimeout", "setImmediate", "nextTick", "queueMicrotask"] });
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the homepage header at 10 PM ET on Nov 11", () => {
  it("Balance is the account at CEG's close, not at the broker's after-hours mark", async () => {
    const { portfolio } = await getDashboardData("LIVE");
    expect(portfolio.totalValue).toBeCloseTo(at(night.close.price), 6);
    expect(portfolio.totalValue).not.toBeCloseTo(at(night.brokerMark), 2);
    // The cash and the positions beside it add up to it.
    expect(portfolio.cash + portfolio.netPositionValue).toBeCloseTo(portfolio.totalValue, 6);
  });

  it("1D is the snapshot's day: CEG's 10 shares from $267.76 to $274.73", async () => {
    const { portfolio } = await getDashboardData("LIVE");
    const day = shares * (night.close.price - night.close.prevClose);
    expect(portfolio.dayPnl).toBeCloseTo(day, 6);
    expect(portfolio.dayPnlPct).toBeCloseTo((day / at(night.close.prevClose)) * 100, 6);
  });

  it("All-time is the snapshot's lifetime: the value less the money put in", async () => {
    const { portfolio } = await getDashboardData("LIVE");
    expect(portfolio.netContributed).toBe(contributed);
    expect(portfolio.totalPnl).toBeCloseTo(at(night.close.price) - contributed, 6);
  });

  it("the chart ends at the Balance, on the daily and the 15-minute curves, and its P&L curve at the lifetime", async () => {
    const { portfolio, equityCurve, intradayEquityCurve, pnlCurve, intradayPnlCurve } = await getDashboardData("LIVE");
    const value = at(night.close.price);
    expect(equityCurve.at(-1)!.value).toBeCloseTo(value, 6);
    expect(intradayEquityCurve.at(-1)!.value).toBeCloseTo(value, 6);
    expect(pnlCurve.at(-1)!.value).toBeCloseTo(value - contributed, 6);
    expect(intradayPnlCurve.at(-1)!.value).toBeCloseTo(value - contributed, 6);
    expect(equityCurve.at(-1)!.value).toBeCloseTo(portfolio.totalValue, 6);
    // Only the last point moves: the rest of the history is the broker's.
    expect(equityCurve.map((p) => p.date)).toEqual([depositedOn, "2026-11-10", "2026-11-11"]);
    expect(equityCurve[1].value).toBeCloseTo(at(night.close.prevClose), 6);
  });
});

describe("when the snapshot can't be read and the broker can", () => {
  beforeEach(() => mockLiveQuotes.mockRejectedValue(new Error("quotes down")));

  it("Balance, cash, invested and the day are the broker's, not the database's estimate", async () => {
    const { portfolio } = await getDashboardData("LIVE");
    // The broker's equity, at its after-hours mark: better than the database's sum of open trades (here none, so the money put in).
    expect(portfolio.totalValue).toBeCloseTo(at(night.brokerMark), 6);
    expect(portfolio.totalValue).not.toBeCloseTo(contributed, 2);
    expect(portfolio.cash).toBe(cash);
    expect(portfolio.netPositionValue).toBeCloseTo(shares * night.brokerMark, 6);
    expect(portfolio.dayPnl).toBeCloseTo(at(night.brokerMark) - at(night.close.prevClose), 6);
    expect(portfolio.totalPnl).toBeCloseTo(at(night.brokerMark) - contributed, 6);
  });
});
