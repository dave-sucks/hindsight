/**
 * The Market and portfolio block (lib/agent/market-and-portfolio.ts) as the
 * real loader builds it, on real rows:
 *   - the market at the Nov 10 close (lib/agent/__fixtures__/market-2026-11-10.json):
 *     Alpaca's daily bars for SPY, QQQ and the 11 sector funds, Cboe's own VIX
 *     and TNX rows (read through #943's parser), SPY's indicator snapshot and
 *     the holdings' report dates;
 *   - the book that evening with stand-in amounts (account-2026-11-10.json):
 *     stand-in quantities and cash, the real closes and after-hours marks, and
 *     the 4 sales waiting with their real history: how many sale proposals each position has had,
 *     the first one's time and the priced lines around it, and the verdict in
 *     the note on each waiting proposal.
 * No reviewer brief and no note to the account existed yet; those use stand-ins
 * in the stored shape.
 */
import nov10 from "@/lib/agent/__fixtures__/account-2026-11-10.json";
import market from "@/lib/agent/__fixtures__/market-2026-11-10.json";

const ACCOUNT = "account_live";
const USER = "user_owner";
/** Wed Nov 11, 8:00 AM ET: the next morning run. */
const MORNING = new Date("2026-11-11T13:00:00Z");
const DAY = 86_400_000;
const BELL = Date.parse(market.bell) / 1000;

const QUEUE = nov10.saleQueue;
/** The waiting sales, as the order table holds them. */
const WAITING = nov10.pending.map((o) => {
  const q = QUEUE.find((x) => x.symbol === o.symbol)!;
  return { id: q.orderId, symbol: o.symbol, intent: o.intent, side: o.side, positionId: q.positionId, thesisId: q.thesisId, createdAt: new Date(o.createdAt) };
});
/** Every sale proposed on those positions: the real count, the first at its real time, the rest a day apart. */
const HISTORY = QUEUE.flatMap((q) =>
  Array.from({ length: q.times }, (_, i) => ({ positionId: q.positionId, intent: "CLOSE", thesisId: q.thesisId, createdAt: new Date(Date.parse(q.firstAt) + i * DAY) })),
);
type Where = Record<string, unknown> & { tradeId?: { in: string[] }; thesisId?: string; timestamp?: { gte: Date; lte: Date } };
const note = (over: Record<string, unknown>) => ({
  id: "note", userId: USER, author: "PORTFOLIO_MANAGER", runId: null, body: "b", audience: "ACCOUNT", analystId: null, tickers: [],
  eventDate: null, pinnedUntil: new Date(MORNING.getTime() + 5 * DAY), createdAt: new Date(MORNING.getTime() - DAY), ...over,
});
const NOTES = [
  note({ id: "note_fed", body: "Fed decision Dec 9; the market prices a rise.", eventDate: "2026-12-09" }),
  note({ id: "note_mine", author: "OWNER", audience: "ANALYST", analystId: "analyst_1", body: "Nothing new on margin this week." }),
  note({ id: "note_theirs", audience: "ANALYST", analystId: "analyst_2", body: "Trim the winners before the print." }),
  note({ id: "note_ended", body: "An old note.", pinnedUntil: new Date(MORNING.getTime() - DAY) }),
  note({ id: "note_old", body: "Written eight days ago and still pinned.", createdAt: new Date(MORNING.getTime() - 8 * DAY) }),
  note({ id: "note_stocks", audience: "STOCKS", tickers: ["MU", "GEV"], body: "The vote rides on these two." }),
];
const NAMES: Record<string, string> = { analyst_1: "Secular Compounder", analyst_2: "PEAD Specialist" };
/** The Portfolio Reviewer's stored briefs, newest first: a stand-in, as no brief had been written. */
const BRIEFS: Array<{ date: Date; brief: string | null; createdAt: Date }> = [];
/** The chat's run row's parameters. */
const RUN_PARAMS: { value: Record<string, unknown> } = { value: { chatSessionId: "chat_1" } };
const queries: Array<{ table: string; args: unknown }> = [];

const empty = new Proxy({}, { get: (_t, op: string) => async () => (op === "findMany" ? [] : op === "count" ? 0 : null) });
jest.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get: (_t, name: string) => {
        const log = (args: unknown) => queries.push({ table: name, args });
        if (name === "agentConfig")
          return {
            findFirst: async () => ({ id: "analyst_1", userId: USER, name: "Secular Compounder", accountId: ACCOUNT, tradingEnvironment: "LIVE" }),
            findMany: async (q: { where: { id: { in: string[] } } }) => q.where.id.in.map((id) => ({ id, name: NAMES[id] })),
          };
        if (name === "order")
          return {
            findMany: async (q: { where: { status?: string; side?: string; environment?: string; position?: { accountId: string }; positionId?: { in: string[] } } }) => {
              if (q.where.positionId) return HISTORY.filter((h) => q.where.positionId!.in.includes(h.positionId));
              if (q.where.status !== "AWAITING_APPROVAL" || q.where.environment !== "LIVE" || q.where.position?.accountId !== ACCOUNT) return [];
              // Every order waiting (the chat's book print), the sales, or the buys (none that night).
              return q.where.side === undefined || q.where.side === "SELL" ? WAITING : [];
            },
          };
        if (name === "thesisUpdate")
          return {
            findMany: async (q: { where: Where }) => {
              if (q.where.tradeId)
                return QUEUE.filter((x) => q.where.tradeId!.in.includes(x.orderId)).map((x) => ({ tradeId: x.orderId, verdict: x.verdict, rationale: `Stand-in note on ${x.symbol}.` }));
              const w = q.where.timestamp!;
              return (QUEUE.find((x) => x.thesisId === q.where.thesisId)?.priced ?? [])
                .map((p) => ({ priceAtTime: p.price, timestamp: new Date(p.at) }))
                .filter((p) => p.timestamp >= w.gte && p.timestamp <= w.lte);
            },
            // The floor's fire just before a proposal.
            findFirst: async (q: { where: Where & { type?: string } }) => {
              const fire = QUEUE.find((x) => x.thesisId === q.where.thesisId)?.fire;
              const at = fire ? new Date(fire.at) : null;
              const w = q.where.timestamp!;
              return q.where.type === "TRIGGER_FIRED" && fire && at! >= w.gte && at! <= w.lte ? { triggerCondition: fire.condition, priceAtTime: fire.price, timestamp: at } : null;
            },
          };
        if (name === "researchRun")
          return {
            findUnique: async () => ({ parameters: RUN_PARAMS.value }),
            update: async (q: { data: { parameters: Record<string, unknown> } }) => {
              RUN_PARAMS.value = q.data.parameters;
              return {};
            },
          };
        if (name === "sharedNote") return { findMany: async (q: { where: { userId: string } }) => NOTES.filter((n) => n.userId === q.where.userId) };
        if (name === "portfolioDigest")
          return {
            findFirst: async (q: unknown) => {
              log(q);
              return BRIEFS.find((b) => b.brief) ?? null;
            },
            findUnique: async (q: { where: { accountId_environment_date: { date: Date } } }) => {
              const facts = DIGESTS.get(q.where.accountId_environment_date.date.toISOString().slice(0, 10));
              return facts ? { facts } : null;
            },
          };
        return empty;
      },
    },
  ),
}));
jest.mock("@/lib/alpaca", () => ({ getLatestPrices: async () => ({}), getAccount: jest.fn(), getFundingActivities: jest.fn(), getAllPositions: jest.fn() }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
jest.mock("@/lib/market-data/live-quote", () => ({
  getLiveQuotes: jest.fn(async (symbols: string[]) =>
    Object.fromEntries(
      symbols.map((s) => {
        // The market's funds from their bars; each holding from the quote path the same night.
        const b = (market.bars as Record<string, { c: number; pc: number }>)[s] ?? (nov10.quotes as Record<string, { c: number; pc: number }>)[s];
        return [s, { quote: b ? { c: b.c, pc: b.pc, dp: (b.c / b.pc - 1) * 100, t: BELL } : null }];
      }),
    ),
  ),
}));
jest.mock("@/lib/market-data/load-indicators", () => ({
  loadIndicatorSnapshots: async () => new Map([["SPY", { asOf: market.spy.asOf, closes: [market.spy.close], sma: { 50: market.spy.sma50, 200: market.spy.sma200 } }]]),
}));
jest.mock("@/lib/agent/triggers/earnings", () => ({
  ...jest.requireActual("@/lib/agent/triggers/earnings"),
  fetchEarningsWindow: jest.fn(),
}));
jest.mock("@/lib/agent/triggers/load-levels", () => ({ ...jest.requireActual("@/lib/agent/triggers/load-levels"), loadLevelSources: async () => new Map() }));
jest.mock("@/lib/agent/gate-rejections", () => ({ listOpenRefusalsForAnalyst: async () => [] }));
jest.mock("@/lib/agent/market-digest-slot", () => ({ latestMarketBrief: jest.fn() }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { getAccount, getAllPositions, getFundingActivities } from "@/lib/alpaca";
import { buildRunInput } from "@/lib/agent/run-input";
import { buildDailyRunSystemPromptV2 } from "@/lib/agent/system-prompt";
import { HOUSE_RULES } from "@/lib/agent/house-rules";
import { SITUATIONS } from "@/lib/agent/situations";
import { blockForConversation, loadMarketAndPortfolio } from "@/lib/agent/load-market-and-portfolio";
import { BLOCK_PARTS, marketAndPortfolioBlock, portfolioNumbersLines, EMPTY_BLOCK } from "@/lib/agent/market-and-portfolio";
import { marketNumbersLines } from "@/lib/market-data/market-numbers";
import { forgetGauges, GAUGES_LIMIT } from "@/lib/market-data/load-market-numbers";
import { loadSaleQueue } from "@/lib/portfolio/load-sale-queue";
import { latestMarketBrief } from "@/lib/agent/market-digest-slot";
import { buildTacticalSystemPrompt } from "@/lib/agent/system-prompts/intraday-tactical";
import { BUILDER_SYSTEM_PROMPT, buildEditorSystemPrompt, buildPrincipalSystemPrompt } from "@/lib/agent/modes";
import { buildWriterResearchPrompt } from "@/lib/agent/run-thesis-writer";
import { EARNINGS_LOOKAHEAD_DAYS, fetchEarningsWindow } from "@/lib/agent/triggers/earnings";
import { PART_LIMIT } from "@/lib/agent/load-market-and-portfolio";

const broker = getAccount as jest.MockedFunction<typeof getAccount>;
const transfers = getFundingActivities as jest.MockedFunction<typeof getFundingActivities>;
const positions = getAllPositions as jest.MockedFunction<typeof getAllPositions>;
const marketBrief = latestMarketBrief as jest.MockedFunction<typeof latestMarketBrief>;
const calendar = fetchEarningsWindow as jest.MockedFunction<typeof fetchEarningsWindow>;
const REPORTS = () => ({ reported: new Map(), upcoming: new Map(market.earnings.map((e) => [e.symbol, { symbol: e.symbol, reportDate: e.date, hour: e.hour }])) }) as never;
const LIMITED = { reported: new Map(), upcoming: new Map(), error: "Finnhub /calendar/earnings rate limited (429) after 1 retries" };
/** The 8 PM digest rows by day, for a read after the broker has moved its prior close on. */
const DIGESTS = new Map<string, unknown>();
const cboe = jest.fn();

const LIVE_BOOK = { accountId: ACCOUNT, environment: "LIVE", userId: USER, analystId: "analyst_1" };
const MARKET_BRIEF = { date: "2026-11-11", brief: "Stand-in. Stocks slipped as chipmakers fell. Yields rose. The book's chipmakers carry the most risk." };

beforeEach(() => {
  jest.useFakeTimers({ now: MORNING, doNotFake: ["setTimeout", "clearTimeout", "nextTick", "setImmediate"] });
  queries.length = 0;
  BRIEFS.length = 0;
  RUN_PARAMS.value = { chatSessionId: "chat_1" };
  forgetGauges();
  broker.mockReset().mockResolvedValue(nov10.broker as never);
  transfers.mockReset().mockResolvedValue([]);
  positions.mockReset().mockResolvedValue(nov10.positions as never);
  marketBrief.mockReset().mockResolvedValue(null);
  calendar.mockReset().mockImplementation(async () => REPORTS());
  DIGESTS.clear();
  // Cboe's own files: the rows read on Nov 11, through #943's parser.
  cboe.mockReset().mockImplementation(async (url: string) => {
    const ix = String(url).includes("VIX_History") ? "VIX" : String(url).includes("TNX_History") ? "TNX" : null;
    if (!ix) throw new Error(`unexpected fetch ${url}`);
    return { ok: true, status: 200, text: async () => `DATE,CLOSE\n${market.cboe[ix].join("\n")}` };
  });
  global.fetch = cboe as never;
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the market numbers at the Nov 10 close, as Wednesday's morning run reads them", () => {
  it("SPY and QQQ on the day, SPY against its averages, the VIX and the 10-year, the sectors best to worst", async () => {
    const { marketNumbers } = await loadMarketAndPortfolio(LIVE_BOOK, MORNING);
    expect(marketNumbersLines(marketNumbers!, MORNING)).toEqual([
      "S&P 500 (SPY) −0.37% on Tue Nov 10; 1.7% below its 50-day and 3.0% above its 200-day at the Mon Nov 9 close",
      "Nasdaq (QQQ) −0.68% on Tue Nov 10",
      "VIX 19.46 (19.92 the day before), 10-year yield 4.98% (4.86% the day before) at the Tue Nov 10 close",
      "Sectors on Tue Nov 10, best to worst: Financials +0.5% · Energy +0.4% · Communication +0.4% · Health care +0.3% · Consumer staples +0.2% · Consumer discretionary 0.0% · Industrials −0.1% · Real estate −0.1% · Utilities −0.1% · Materials −0.2% · Tech −1.2%",
      // The producer price index joined the calendar with #949 (bls.gov, read 2026-11-11).
      "Market dates in the next 7 days: Fri Nov 13 producer price index (PPI)",
    ]);
  });

  it("names a market date in the next 7 days, and says 'today' during the session", async () => {
    const cpiMorning = new Date("2026-12-07T15:00:00Z");
    const lines = marketNumbersLines((await loadMarketAndPortfolio(LIVE_BOOK, cpiMorning)).marketNumbers!, new Date("2026-11-10T15:00:00Z"));
    expect(lines.some((l) => l.startsWith("S&P 500 (SPY) −0.37% today"))).toBe(true);
    expect(lines).toContain("Market dates in the next 7 days: Wed Dec 9 Fed decision, with its projections · Thu Dec 10 inflation report (CPI)");
  });

  it("a release earlier today is behind us: Nov 10's 8:30 AM inflation report is ahead at 8 AM, not at 8 PM", async () => {
    const at = (iso: string) => loadMarketAndPortfolio(LIVE_BOOK, new Date(iso)).then((l) => marketNumbersLines(l.marketNumbers!, new Date(iso)).join("\n"));
    expect(await at("2026-11-10T13:00:00Z")).toContain("Market dates in the next 7 days: Tue Nov 10 inflation report (CPI)");
    expect(await at(nov10.at)).not.toContain("Tue Nov 10 inflation report");
  });

  it("with Cboe unreachable the VIX line is left out and the rest stands", async () => {
    cboe.mockRejectedValue(new Error("network"));
    const lines = marketNumbersLines((await loadMarketAndPortfolio(LIVE_BOOK, MORNING)).marketNumbers!, MORNING);
    expect(lines.join("\n")).not.toMatch(/VIX|10-year/);
    expect(lines[0]).toContain("S&P 500 (SPY)");
  });

  it("a Cboe failure, or a Cboe too slow to answer, is remembered for 5 minutes, so the next requests don't wait on it", async () => {
    const was = GAUGES_LIMIT.ms;
    GAUGES_LIMIT.ms = 20;
    cboe.mockImplementation(() => new Promise(() => {}));
    try {
      const slow = marketNumbersLines((await loadMarketAndPortfolio(LIVE_BOOK, MORNING)).marketNumbers!, MORNING);
      expect(slow.join("\n")).not.toMatch(/VIX/);
      expect(slow[0]).toContain("S&P 500 (SPY)");
      const asked = cboe.mock.calls.length;
      await loadMarketAndPortfolio(LIVE_BOOK, new Date(MORNING.getTime() + 4 * 60_000));
      expect(cboe.mock.calls.length).toBe(asked);
      await loadMarketAndPortfolio(LIVE_BOOK, new Date(MORNING.getTime() + 6 * 60_000));
      expect(cboe.mock.calls.length).toBeGreaterThan(asked);
    } finally {
      GAUGES_LIMIT.ms = was;
    }
  });
});

describe("the portfolio numbers on the evening of Nov 10", () => {
  it("the value and the day at the close, real cash, the holdings and the 3 biggest, each sale waiting with its history, NVDA's report", async () => {
    const { portfolioNumbers } = await loadMarketAndPortfolio(LIVE_BOOK, new Date(nov10.at));
    expect(portfolioNumbersLines(portfolioNumbers!)).toEqual([
      "At the Tue Nov 10 close: $95,802 · −$1,476 on the day (−1.52%) · $25,000 cash (26.1%)",
      "8 holdings; the biggest: CEG 11.2% · MSFT 11.1% · V 11.0%",
      "Sales waiting for approval:",
      "- MU: proposed 9 times since Oct 29, −22.0% since; its note: case unchanged",
      "- IOT: proposed 13 times since Oct 16, +0.7% since; its note: case weaker",
      "- PLTR: proposed 13 times since Oct 23, −13.8% since; its note: case unchanged",
      "- NVDA: proposed 27 times since Sep 14, −19.5% since; its note: case broken",
      "Reporting in the next 14 days: NVDA Tue Nov 17 after the close",
    ]);
  });

  it("for the Portfolio Reviewer each sale also carries the floor that fired and its note in full; the agents' block shows neither", async () => {
    const sales = await loadSaleQueue({ accountId: ACCOUNT, environment: "LIVE", priceOf: () => null, decision: true });
    expect(sales.find((x) => x.ticker === "MU")!.decision).toEqual({
      floor: "Sell if below $930.60", level: 930.6, firedAt: "2026-11-10T14:35:05.402Z", firedPrice: 712.34, note: "Stand-in note on MU.",
    });
    expect(sales.find((x) => x.ticker === "NVDA")!.decision).toMatchObject({ floor: "Sell if below $236", level: 236, firedPrice: 171.81 });
    const block = marketAndPortfolioBlock(await loadMarketAndPortfolio(LIVE_BOOK, MORNING), MORNING);
    expect(block).not.toMatch(/Stand-in note|floor that fired|930\.60/);
  });

  it("the price at a first proposal is the priced line nearest to it: NVDA's run note five seconds after, not the fire twelve before", async () => {
    const { portfolioNumbers } = await loadMarketAndPortfolio(LIVE_BOOK, new Date(nov10.at));
    const nvda = portfolioNumbers!.sales!.find((x) => x.ticker === "NVDA")!;
    expect(nvda.movePct).toBeCloseTo((168.89 / 209.7 - 1) * 100, 6);
  });

  it("the cash is the account's cash, never the margin buying power", async () => {
    const block = marketAndPortfolioBlock(await loadMarketAndPortfolio(LIVE_BOOK, MORNING), MORNING);
    expect(block).toContain("$25,000 cash");
    expect(block).not.toMatch(/190,000|buying power/i);
  });

  it("a deposit that posted today is not read as a gain", async () => {
    broker.mockResolvedValue({ ...nov10.broker, cash: "30000.00" } as never);
    transfers.mockResolvedValue([{ date: "2026-11-10", amount: 5_000 }]);
    const { portfolioNumbers } = await loadMarketAndPortfolio(LIVE_BOOK, new Date(nov10.at));
    expect(portfolioNumbers?.today?.dollars).toBeCloseTo(-1475.68, 2);
  });

  it("never the broker's after-hours marks: at 2:37 AM it values the book at $96,794 with MU at $756.70; the block still reads the close", async () => {
    const night = new Date("2026-11-11T07:37:31Z");
    const { portfolioNumbers } = await loadMarketAndPortfolio(LIVE_BOOK, night);
    const lines = portfolioNumbersLines(portfolioNumbers!);
    expect(lines[0]).toBe("At the Tue Nov 10 close: $95,802 · −$1,476 on the day (−1.52%) · $25,000 cash (26.1%)");
    expect(lines).toContain("- MU: proposed 9 times since Oct 29, −22.0% since; its note: case unchanged");
    expect(lines.join("\n")).not.toMatch(/96,794|756/);
  });

  it("at 8 AM, once the broker has moved its prior close to Tuesday's (as it had by 3:16 AM), the day is Tuesday's 8 PM digest figure", async () => {
    broker.mockResolvedValue({ ...nov10.broker, last_equity: nov10.brokerRolled.last_equity, balance_asof: nov10.brokerRolled.balance_asof } as never);
    DIGESTS.set("2026-11-10", { book: { closeOf: "2026-11-10" }, pnl: { dayPnl: -1475.68, dayPnlPct: -1.517 } });
    const { portfolioNumbers } = await loadMarketAndPortfolio(LIVE_BOOK, MORNING);
    expect(portfolioNumbersLines(portfolioNumbers!)[0]).toBe("At the Tue Nov 10 close: $95,802 · −$1,476 on the day (−1.52%) · $25,000 cash (26.1%)");
  });

  it("with no digest priced at that close (the ones before Nov 11 read the broker's marks), the block says the day's change couldn't be read", async () => {
    broker.mockResolvedValue({ ...nov10.broker, last_equity: nov10.brokerRolled.last_equity, balance_asof: nov10.brokerRolled.balance_asof } as never);
    DIGESTS.set("2026-11-10", { book: {}, pnl: { dayPnl: -484.15, dayPnlPct: -0.4977 } });
    const { portfolioNumbers } = await loadMarketAndPortfolio(LIVE_BOOK, MORNING);
    expect(portfolioNumbersLines(portfolioNumbers!)[0]).toBe("At the Tue Nov 10 close: $95,802 · the day's change couldn't be read · $25,000 cash (26.1%)");
  });

  it("in the session the value is at the latest trades and the change is today's", async () => {
    const session = new Date("2026-11-10T16:00:00Z");
    const { portfolioNumbers } = await loadMarketAndPortfolio(LIVE_BOOK, session);
    expect(portfolioNumbersLines(portfolioNumbers!)[0]).toBe("At 11:00 AM ET: $95,802 · −$1,476 today (−1.52%) · $25,000 cash (26.1%)");
  });

  it("the report dates come from the calendar call the earnings triggers make", async () => {
    const { portfolioNumbers } = await loadMarketAndPortfolio(LIVE_BOOK, MORNING);
    expect(calendar).toHaveBeenCalledWith({ now: MORNING, lookaheadDays: EARNINGS_LOOKAHEAD_DAYS });
    expect(portfolioNumbersLines(portfolioNumbers!)).toContain("Reporting in the next 14 days: NVDA Tue Nov 17 after the close");
  });

  it("when the report dates can't be read, or don't come in time, the block says so and doesn't wait", async () => {
    calendar.mockReset().mockResolvedValue(LIMITED);
    const limited = marketAndPortfolioBlock(await loadMarketAndPortfolio(LIVE_BOOK, MORNING), MORNING);
    expect(limited).toContain("Report dates couldn't be read this run");
    expect(limited).not.toContain("Reporting in the next 14 days");
    const was = PART_LIMIT.reportsMs;
    PART_LIMIT.reportsMs = 20;
    calendar.mockReset().mockImplementation(() => new Promise(() => {}));
    try {
      const slow = marketAndPortfolioBlock(await loadMarketAndPortfolio(LIVE_BOOK, MORNING), MORNING);
      expect(slow).toContain("Report dates couldn't be read this run");
      expect(slow).toContain("At the Tue Nov 10 close: $95,802");
    } finally {
      PART_LIMIT.reportsMs = was;
    }
  });

  it("when the sales waiting can't be read, the block says so rather than showing none", async () => {
    const { portfolioNumbers } = await loadMarketAndPortfolio(LIVE_BOOK, MORNING);
    const lines = portfolioNumbersLines({ ...portfolioNumbers!, sales: null });
    expect(lines).toContain("Sales waiting for approval couldn't be read this run");
    expect(lines.join("\n")).not.toContain("- MU:");
  });

  it("with the broker unreadable, or too slow, the account's part says it couldn't be read, and the rest stands", async () => {
    broker.mockRejectedValue(new Error("alpaca down"));
    const down = marketAndPortfolioBlock(await loadMarketAndPortfolio(LIVE_BOOK, MORNING), MORNING);
    expect(down).toContain("### Portfolio numbers\nAccount numbers couldn't be read this run");
    expect(down).toContain("### Market numbers");
    const was = PART_LIMIT.ms;
    PART_LIMIT.ms = 20;
    broker.mockImplementation(() => new Promise(() => {}));
    try {
      const slow = marketAndPortfolioBlock(await loadMarketAndPortfolio(LIVE_BOOK, MORNING), MORNING);
      expect(slow).toContain("### Portfolio numbers\nAccount numbers couldn't be read this run");
      expect(slow).toContain("### Market numbers");
    } finally {
      PART_LIMIT.ms = was;
    }
  });
});

describe("the briefs", () => {
  it("each brief with its day and time: the market's through the slot, the portfolio's from the newest row that has one", async () => {
    marketBrief.mockResolvedValue({ ...MARKET_BRIEF, writtenAt: "2026-11-11T12:34:00Z" });
    BRIEFS.push({ date: new Date("2026-11-10T00:00:00Z"), brief: "Stand-in. Four sales wait against two notes that hold.", createdAt: new Date("2026-11-11T01:00:40Z") });
    const block = marketAndPortfolioBlock(await loadMarketAndPortfolio(LIVE_BOOK, MORNING), MORNING);
    expect(marketBrief).toHaveBeenCalledWith({ accountId: ACCOUNT, environment: "LIVE" });
    expect(block).toContain(`### Market brief\nWed Nov 11, 7:34 AM ET: ${MARKET_BRIEF.brief}`);
    expect(block).toContain("### Portfolio brief\nTue Nov 10, 8:00 PM ET: Stand-in. Four sales wait against two notes that hold.");
  });

  it("a brief without its time shows its day", () => {
    expect(marketAndPortfolioBlock({ ...EMPTY_BLOCK, marketBrief: MARKET_BRIEF }, MORNING)).toContain(`### Market brief\nWed Nov 11: ${MARKET_BRIEF.brief}`);
  });

  it("never reads the digest's long text", async () => {
    await loadMarketAndPortfolio(LIVE_BOOK, MORNING);
    const select = (queries.find((q) => q.table === "portfolioDigest")?.args as { select: Record<string, boolean> }).select;
    expect(select).toEqual({ date: true, brief: true, createdAt: true });
  });

  it("a brief more than 4 days old is left out; a long one is cut at its last full sentence within 700", async () => {
    marketBrief.mockResolvedValue({ date: "2026-11-06", brief: "Old." });
    expect((await loadMarketAndPortfolio(LIVE_BOOK, MORNING)).marketBrief).toBeNull();
    marketBrief.mockResolvedValue({ date: "2026-11-07", brief: "Four days." });
    expect((await loadMarketAndPortfolio(LIVE_BOOK, MORNING)).marketBrief?.brief).toBe("Four days.");
    const long = `${"A sentence of forty characters, roughly. ".repeat(17)}The end.`;
    const block = marketAndPortfolioBlock({ ...EMPTY_BLOCK, marketBrief: { date: "2026-11-11", brief: long } }, MORNING);
    const text = block.split("\n")[3];
    expect(text.length).toBeLessThanOrEqual("Wed Nov 11: ".length + 700);
    expect(text.endsWith(".")).toBe(true);
  });
});

describe("the notes to the account or an analyst", () => {
  it("the account's and this analyst's while they last, by each note's own end, never another analyst's, an ended one or a note on stocks", async () => {
    const { notes } = await loadMarketAndPortfolio(LIVE_BOOK, MORNING);
    expect(notes.map((n) => n.line.match(/\[note (\w+)\]/)?.[1])).toEqual(["note_fed", "note_mine", "note_old"]);
    expect(notes[1]).toEqual({ author: "OWNER", line: expect.stringContaining(`note to the Secular Compounder, until 11-16: "Nothing new on margin this week."`) });
  });

  it("the chat on the whole account reads every analyst's", async () => {
    const { notes } = await loadMarketAndPortfolio({ ...LIVE_BOOK, analystId: null }, MORNING);
    expect(notes.map((n) => n.line.match(/\[note (\w+)\]/)?.[1])).toEqual(["note_fed", "note_mine", "note_theirs", "note_old"]);
  });

  it("a note of yours reaches every run in full with its id, all 2,000 characters, and one pinned for 14 days still reaches it on day 13", async () => {
    const body = `Hold the line on margin. ${"Keep the book under ninety percent invested. ".repeat(50)}`.slice(0, 2_000);
    NOTES.push(
      note({ id: "note_long", author: "OWNER", body, createdAt: new Date(MORNING.getTime() - 2 * DAY) }),
      note({ id: "note_fortnight", author: "OWNER", body: "Fed week: size down.", createdAt: new Date(MORNING.getTime() - 13 * DAY), pinnedUntil: new Date(MORNING.getTime() + DAY) }),
    );
    try {
      const block = marketAndPortfolioBlock(await loadMarketAndPortfolio(LIVE_BOOK, MORNING), MORNING);
      const shown = block.split("### Notes\n")[1].split("\n");
      const long = shown.find((l) => l.includes("[note note_long]"))!;
      expect(long).toContain(body.replace(/\s+/g, " ").trim());
      expect(long.endsWith("[note note_long]")).toBe(true);
      expect(shown.some((l) => l.includes('"Fed week: size down." [note note_fortnight]'))).toBe(true);
    } finally {
      NOTES.splice(NOTES.length - 2, 2);
    }
  });

  it("the block shows every note of yours and the reviewers' newest 3, none cut, and says how many of the reviewers' it left out", () => {
    const line = (id: string) => `Stand-in note ${"x".repeat(400)} [note ${id}]`;
    const notes = [
      { author: "PORTFOLIO_MANAGER", line: line("pm1") },
      { author: "OWNER", line: line("own1") },
      { author: "PORTFOLIO_MANAGER", line: line("pm2") },
      { author: "PORTFOLIO_MANAGER", line: line("pm3") },
      { author: "OWNER", line: line("own2") },
      { author: "PORTFOLIO_MANAGER", line: line("pm4") },
      { author: "PORTFOLIO_MANAGER", line: line("pm5") },
    ];
    const shown = marketAndPortfolioBlock({ ...EMPTY_BLOCK, notes }, MORNING).split("### Notes\n")[1].split("\n");
    expect(shown.map((l) => l.match(/\[note (\w+)\]/)?.[1] ?? l)).toEqual(["pm1", "own1", "pm2", "pm3", "own2", "(2 older notes from the Market Reviewer and Portfolio Reviewer not shown)"]);
    expect(shown[0]).toBe(`- ${line("pm1")}`);
  });
});

describe("the block: one table of parts, under fixed headings", () => {
  it("prints its parts in the table's order under the exact headings", async () => {
    marketBrief.mockResolvedValue(MARKET_BRIEF);
    BRIEFS.push({ date: new Date("2026-11-10T00:00:00Z"), brief: "Stand-in.", createdAt: new Date("2026-11-11T01:00:40Z") });
    const block = marketAndPortfolioBlock(await loadMarketAndPortfolio(LIVE_BOOK, MORNING), MORNING);
    expect(block.split("\n").filter((l) => l.startsWith("#"))).toEqual([
      "## Market and portfolio",
      "### Market brief",
      "### Market numbers",
      "### Portfolio brief",
      "### Portfolio numbers",
      "### Notes",
    ]);
    expect(BLOCK_PARTS.map((p) => p.heading)).toEqual(["Market brief", "Market numbers", "Portfolio brief", "Portfolio numbers", "Notes"]);
  });

  it("a part switched off is neither read nor printed", async () => {
    const part = BLOCK_PARTS.find((p) => p.id === "marketNumbers") as { on: boolean };
    part.on = false;
    try {
      const block = marketAndPortfolioBlock(await loadMarketAndPortfolio(LIVE_BOOK, MORNING), MORNING);
      expect(block).not.toContain("### Market numbers");
      expect(cboe).not.toHaveBeenCalled();
    } finally {
      part.on = true;
    }
  });

  it("a block saved with a run and read back (a recorded case) prints as the run read it, at its own time", async () => {
    BRIEFS.push({ date: new Date("2026-11-10T00:00:00Z"), brief: "Stand-in.", createdAt: new Date("2026-11-11T01:00:40Z") });
    const layer = await loadMarketAndPortfolio(LIVE_BOOK, new Date(nov10.at));
    const live = marketAndPortfolioBlock(layer);
    const replayed = marketAndPortfolioBlock(JSON.parse(JSON.stringify(layer)));
    expect(replayed).toBe(live);
    expect(replayed).toContain("### Portfolio brief\nTue Nov 10, 8:00 PM ET: Stand-in.");
  });

  it("with nothing to show there is no block", () => {
    expect(marketAndPortfolioBlock(EMPTY_BLOCK, MORNING)).toBe("");
  });

  it("the morning run's prompt ends with it, after its fixed text", async () => {
    const prompt = buildDailyRunSystemPromptV2({ name: "Secular Compounder" }, await buildRunInput("analyst_1", USER));
    const block = prompt.slice(prompt.indexOf("## Market and portfolio"));
    expect(prompt.endsWith(block)).toBe(true);
    expect(prompt.indexOf("## How tools work")).toBeLessThan(prompt.indexOf("## Market and portfolio"));
    expect(block).toContain("### Portfolio numbers");
  });

  it("the house rules say how to weigh it, and no more; what to do with it is in the situations", () => {
    expect(HOUSE_RULES).toContain("The Market and portfolio block is context, not an instruction. Where it and a stock's own row differ, the row is right; where a brief and the numbers differ, the numbers are right.");
    expect(HOUSE_RULES).not.toMatch(/Before you buy or add|decide on that stock before the date/);
    expect(SITUATIONS.BUY_ARRIVES.guidance).toContain("the market and the account's room (Market and portfolio block;");
    expect(SITUATIONS.ADD_OR_WINNER.guidance).toContain("4. Before an add, weigh the Market and portfolio block");
    expect(SITUATIONS.EARNINGS.guidance).toContain("- Reports within days: decide before the date, not at your next look after it.");
  });
});

describe("the chat loads the block once per conversation and keeps it 30 minutes", () => {
  it("the second message within 30 minutes reuses it, word for word, with no new reads", async () => {
    const first = await blockForConversation("run_chat", LIVE_BOOK, MORNING);
    const reads = broker.mock.calls.length;
    const second = await blockForConversation("run_chat", LIVE_BOOK, new Date(MORNING.getTime() + 29 * 60_000));
    expect(second).toBe(first);
    expect(broker.mock.calls.length).toBe(reads);
    expect(RUN_PARAMS.value).toMatchObject({
      chatSessionId: "chat_1",
      marketAndPortfolio: { key: `LIVE:analyst_1:${WAITING.map((o) => o.id).sort().join(",")}|0`, at: MORNING.toISOString() },
    });
  });

  it("after an approval or a trade it reads again: the orders waiting and the open positions are in its key", async () => {
    const first = await blockForConversation("run_chat", LIVE_BOOK, MORNING);
    const reads = broker.mock.calls.length;
    const approved = WAITING.shift()!;
    try {
      const second = await blockForConversation("run_chat", LIVE_BOOK, new Date(MORNING.getTime() + 5 * 60_000));
      expect(broker.mock.calls.length).toBe(reads + 1);
      expect(second).not.toBe(first);
      expect(second).not.toContain(`- ${approved.symbol}: proposed`);
    } finally {
      WAITING.unshift(approved);
    }
  });

  it("after 30 minutes, or on the other book, it reads again", async () => {
    await blockForConversation("run_chat", LIVE_BOOK, MORNING);
    const reads = broker.mock.calls.length;
    await blockForConversation("run_chat", LIVE_BOOK, new Date(MORNING.getTime() + 31 * 60_000));
    expect(broker.mock.calls.length).toBe(reads + 1);
    await blockForConversation("run_chat", { ...LIVE_BOOK, environment: "PAPER" }, new Date(MORNING.getTime() + 32 * 60_000));
    expect(broker.mock.calls.length).toBe(reads + 2);
  });
});

describe("every door that decides on stocks carries it, after its fixed text and before its read", () => {
  const block = marketAndPortfolioBlock({ ...EMPTY_BLOCK, marketBrief: MARKET_BRIEF }, MORNING);

  it("the trigger run: before the stock's row", () => {
    const prompt = buildTacticalSystemPrompt({
      analyst: { name: "PEAD Specialist", analystPrompt: null },
      stock: { ticker: "MU", direction: "LONG", row: { id: "t", ticker: "MU" } },
      trigger: { id: "trig", predicate: { watch: "price", is: "below", value: 800 }, action: "EXIT" },
      position: null,
      marketAndPortfolio: block,
    } as never);
    expect(prompt.indexOf("TOOL-CALL DISCIPLINE")).toBeLessThan(prompt.indexOf(block));
    expect(prompt.indexOf(block)).toBeLessThan(prompt.indexOf("$MU, its row (get_theses)"));
  });

  it("the chat and the Writer: last in their prompts", () => {
    expect(buildPrincipalSystemPrompt({ scopedAnalyst: null, marketAndPortfolio: block }).endsWith(`\n\n${block}`)).toBe(true);
    const writer = buildWriterResearchPrompt({ analyst: { analystPrompt: null }, ticker: "MU", mode: "mint", existingThesis: null, reason: "r", runDate: "2026-11-11", marketAndPortfolio: block } as never);
    expect(writer.endsWith(`\n\n${block}`)).toBe(true);
  });

  it("not the analyst builder or the editor", () => {
    for (const prompt of [BUILDER_SYSTEM_PROMPT, buildEditorSystemPrompt({})]) expect(prompt).not.toContain("Market and portfolio");
  });
});
