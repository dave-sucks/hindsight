/**
 * get_portfolio_context gives the numbers every agent's Market and portfolio
 * block gives, because both read the one portfolio snapshot.
 *
 * At 10 PM ET on Nov 11 the broker marked CEG at an after-hours $271.81; it
 * closed at $274.73, up 2.6% on the day. The block (the snapshot) used the
 * close. The tool valued the account at the broker's equity, which counts
 * that mark, and gave no day for the stock at all, so a morning run reading
 * both was told two values for the same account.
 *
 * Through the tool's real execute and the block's real loader, with only the
 * broker, the quotes, the owner's keys and the database stood in
 * (lib/agent/__fixtures__/ceg-after-hours-2026-11-11.json: stand-in shares,
 * cost and cash; the prices are public).
 */
import { agentConfigRow, positionRow, prismaDouble, replayTool, thesisRow, REPLAY_ACCOUNT_ID, REPLAY_USER_ID } from "@/lib/replay";
import { STANDIN_MARKET_NUMBERS } from "@/lib/agent/__fixtures__/market-numbers-standin";
import night from "@/lib/agent/__fixtures__/ceg-after-hours-2026-11-11.json";

const NOW = new Date(night.now);
const { shares, avgCost, cash, contributed } = night.standIn;
const CLOSE_T = Date.parse(night.close.at) / 1000;
const BROKER_EQUITY = cash + shares * night.brokerMark;

const seed = () => ({
  agentConfig: [agentConfigRow({ id: night.position.analystId, name: night.position.analyst })],
  position: [
    positionRow({
      id: "pos_ceg",
      symbol: "CEG",
      analystId: night.position.analystId,
      analyst: { name: night.position.analyst },
      environment: "LIVE",
      direction: night.position.direction,
      quantity: shares,
      initialQty: shares,
      avgCost,
      peakPrice: night.position.peakPrice,
      exitStrategy: night.position.exitStrategy,
      openedAt: new Date(night.position.openedAt),
    }),
  ],
  thesis: [
    thesisRow({
      id: "th_ceg",
      ticker: "CEG",
      status: "HOLDING",
      direction: "LONG",
      stopLoss: night.position.thesisStop,
      researchRun: { agentConfigId: night.position.analystId, agentConfig: { name: night.position.analyst, setupIds: [] } },
    }),
  ],
});

/** The app's one price: outside the session, the close stamped at the bell. */
const quote = { c: night.close.price, pc: night.close.prevClose, t: CLOSE_T, source: "alpaca" };
const liveQuotes = async (symbols: string[]) => Object.fromEntries(symbols.map((s) => [s.toUpperCase(), s.toUpperCase() === "CEG" ? { quote } : { quote: null, error: "not stood in" }]));

/** The edges, the same for the tool and the block. The broker's figures are its after-hours ones. */
const edges: Record<string, () => unknown> = {
  "@/lib/market-data/live-quote": () => ({ getLiveQuotes: liveQuotes }),
  "@/lib/auth/account": () => ({ ...jest.requireActual("@/lib/auth/account"), getOwnerUserId: async () => REPLAY_USER_ID }),
  "@/lib/actions/api-keys.actions": () => ({ resolveAlpacaCredentials: async () => ({ keyId: "k", secretKey: "s", baseUrl: "https://broker.test" }) }),
  "@/lib/alpaca": () => ({
    getAccount: async () => ({ equity: String(BROKER_EQUITY), cash: String(cash), buying_power: String(cash), last_equity: String(BROKER_EQUITY) }),
    getAllPositions: async () => [
      { symbol: "CEG", qty: String(shares), side: "long", avg_entry_price: String(avgCost), current_price: String(night.brokerMark), market_value: String(shares * night.brokerMark), cost_basis: String(shares * avgCost), unrealized_pl: "0", unrealized_plpc: "0" },
    ],
    getFundingActivities: async () => [{ date: "2026-05-01", amount: contributed }],
    // Production's price helpers read the one quote path (lib/alpaca.ts).
    getLatestPricesWithMeta: async (symbols: string[]) => {
      const q = await liveQuotes(symbols);
      const priced = symbols.filter((s) => q[s.toUpperCase()]?.quote);
      return {
        prices: Object.fromEntries(priced.map((s) => [s, q[s.toUpperCase()].quote!.c])),
        sources: Object.fromEntries(symbols.map((s) => [s, priced.includes(s) ? "alpaca" : "missing"])),
        asOf: Object.fromEntries(priced.map((s) => [s, night.close.at])),
        fetchedAt: NOW.toISOString(),
      };
    },
    getLatestPrices: async (symbols: string[]) => {
      const q = await liveQuotes(symbols);
      return Object.fromEntries(symbols.filter((s) => q[s.toUpperCase()]?.quote).map((s) => [s, q[s.toUpperCase()].quote!.c]));
    },
  }),
};

type Tool = {
  positions: Array<{ symbol: string; currentPrice: number | null; dayMovePct?: number | null; unrealizedPnlPct: number | null; value?: number | null }>;
  capitalSummary: { totalEquity: number; cash: number; dayChange?: { pct: number } | null } | null;
};

async function tool(): Promise<Tool> {
  const { result } = await replayTool("get-portfolio-context", "getPortfolioContext", {
    seed: seed(),
    ctx: { runMode: "MORNING_PLAN", runEnvironment: "LIVE", analystId: night.position.analystId },
    args: { include_thesis: false },
    mocks: edges,
  });
  return result.data as unknown as Tool;
}

async function block(): Promise<string> {
  let text = "";
  await jest.isolateModulesAsync(async () => {
    const db = prismaDouble(seed());
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    for (const [path, factory] of Object.entries(edges)) jest.doMock(path, factory);
    jest.doMock("@/lib/market-data/load-market-numbers", () => ({ loadMarketNumbers: async () => STANDIN_MARKET_NUMBERS }));
    const { BLOCK_HEADING, loadPortfolioPieces } = await import("@/lib/agent/portfolio-block");
    text = [BLOCK_HEADING, ...(await loadPortfolioPieces({ accountId: REPLAY_ACCOUNT_ID, environment: "LIVE", now: NOW })).map((p) => p.text)].join("\n\n");
  });
  return text;
}

const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;
const cents = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["setTimeout", "clearTimeout", "setImmediate", "nextTick", "queueMicrotask"] });
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("get_portfolio_context and the block, 10 PM ET on Nov 11", () => {
  it("CEG's price, its day and its gain since bought are the block's, at the close", async () => {
    const t = await tool();
    const text = await block();
    const ceg = t.positions.find((p) => p.symbol === "CEG")!;
    const line = text.split("\n").find((l) => l.startsWith("- CEG:"))!;
    const [, price, day, since] = line.match(/at \$([\d.]+) = .* · day ([+−][\d.]+%) .* · since bought at \$[\d.]+: ([+−][\d.]+%)/)!;
    expect(price).toBe("274.73");
    expect(ceg.currentPrice).toBe(Number(price));
    expect(day).toBe("+2.6%");
    expect(ceg.dayMovePct != null ? pct(ceg.dayMovePct) : ceg.dayMovePct).toBe(day);
    expect(pct(ceg.unrealizedPnlPct!)).toBe(since);
  });

  it("the account's value, cash and day are the block's, not the broker's after-hours equity", async () => {
    const t = await tool();
    const text = await block();
    const [, value, blockCash] = text.match(/^Value (\$[\d,.]+) · cash (\$[\d,.]+)/m)!;
    expect(value).toBe(cents(cash + shares * night.close.price));
    expect(cents(t.capitalSummary!.totalEquity)).toBe(value);
    expect(t.capitalSummary!.totalEquity).not.toBeCloseTo(BROKER_EQUITY, 2);
    expect(cents(t.capitalSummary!.cash)).toBe(blockCash);
    const [, blockDay] = text.match(/^Wed, Nov 11: ([+−][\d.]+%)/m)!;
    expect(t.capitalSummary!.dayChange ? pct(t.capitalSummary!.dayChange.pct) : t.capitalSummary!.dayChange).toBe(blockDay);
  });
});
