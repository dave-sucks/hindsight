/**
 * The 8 PM facts through buildDigestFacts itself, on the stand-in book of Tue
 * Nov 10 (lib/agent/__fixtures__/account-2026-11-10.json).
 *
 * A failed transfers read used to become an empty list, so a deposit posted
 * that day read as the day's profit; once the broker moved its prior close on
 * overnight, that figure reached every run's block through the digest
 * (lib/portfolio/closed-day.ts). Now a failed read makes the day unknown.
 */
import nov10 from "@/lib/agent/__fixtures__/account-2026-11-10.json";

const runsQuery = jest.fn(async () => []);
const empty = new Proxy({}, { get: (_t, op: string) => async () => (op === "findMany" ? [] : op === "count" ? 0 : null) });
jest.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, name: string) => (name === "researchRun" ? { findMany: runsQuery } : empty) }),
}));
jest.mock("@/lib/auth/account", () => ({ getOwnerUserId: async () => "user_owner" }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => ({ keyId: "k", secretKey: "s", baseUrl: "https://api.alpaca.markets" }) }));
const transfers = jest.fn();
const broker = jest.fn();
const positions = jest.fn();
jest.mock("@/lib/alpaca", () => ({ getAccount: () => broker(), getAllPositions: () => positions(), getFundingActivities: () => transfers() }));
jest.mock("@/lib/market-data/live-quote", () => ({
  getLiveQuotes: async (symbols: string[]) =>
    Object.fromEntries(symbols.map((s) => [s.toUpperCase(), { quote: (nov10.quotes as Record<string, { c: number; pc: number; t: number }>)[s.toUpperCase()] ?? null }])),
}));

import { buildDigestFacts } from "./digest-facts-builder";

/** $5,000 deposited on Nov 10: in the cash, and not a gain. */
const DEPOSIT = { date: "2026-11-10", amount: 5_000 };
const funded = { ...nov10.broker, cash: String(Number(nov10.broker.cash) + DEPOSIT.amount) };

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(nov10.at), doNotFake: ["setTimeout", "clearTimeout", "nextTick", "setImmediate"] });
  jest.spyOn(console, "warn").mockImplementation(() => {});
  broker.mockReset().mockResolvedValue(funded);
  transfers.mockReset().mockResolvedValue([DEPOSIT]);
  positions.mockReset().mockResolvedValue(nov10.positions);
  runsQuery.mockClear();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the 8 PM facts on a day with a deposit", () => {
  it("with the transfers read, the deposit comes off: the day is the book's own move", async () => {
    const facts = await buildDigestFacts("account_live", "2026-11-10", "LIVE");
    expect(facts.pnl.dayPnl).toBeCloseTo(-1475.68, 2);
    expect(facts.pnl.dayUnknown).toBeUndefined();
  });

  it("with the transfers read failed, the day is unknown, never the deposit counted as profit", async () => {
    transfers.mockRejectedValue(new Error("alpaca 500"));
    const facts = await buildDigestFacts("account_live", "2026-11-10", "LIVE");
    expect(facts.pnl.dayUnknown).toBe(true);
    expect(facts.pnl.dayPnl).toBe(0);
  });

  it("and with the positions unread too, the broker's own figures don't count the deposit either", async () => {
    transfers.mockRejectedValue(new Error("alpaca 500"));
    positions.mockRejectedValue(new Error("alpaca 500"));
    const facts = await buildDigestFacts("account_live", "2026-11-10", "LIVE");
    expect(facts.pnl.dayUnknown).toBe(true);
  });
});

describe("the day's runs", () => {
  it("are the analysts' only: the account's own reviews are neither listed nor counted as failed", async () => {
    await buildDigestFacts("account_live", "2026-11-10", "LIVE");
    const where = (runsQuery.mock.calls[0] as unknown as [{ where: { mode: { notIn: string[] } } }])[0].where;
    expect(where.mode.notIn).toContain("PORTFOLIO_REVIEW");
  });
});
