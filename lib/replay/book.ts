/**
 * The 2026-10-16 book (lib/agent/__fixtures__/book-2026-10-16.ts) as database
 * rows, and the two handlers a protective sale runs through: one pass of the
 * trigger check, and the trigger run it wakes. Only the edges are doubled —
 * the database, the quote, the broker, the model.
 */
import { prismaDouble, thesisRow, positionRow, agentConfigRow, accountRow, type PrismaDouble, type Row } from "@/lib/replay";
import { ACCOUNT_TRIGGERS, ANALYST_TRIGGERS, AT, BOOK, CATALYST, PEAD, SECULAR, type BookStock } from "@/lib/agent/__fixtures__/book-2026-10-16";

const NAMES: Record<string, string> = { [PEAD]: "PEAD Specialist", [CATALYST]: "Catalyst Event PM", [SECULAR]: "Secular Compounder" };

export interface BookOptions {
  /** Account columns over the stored ones (approval switches, settings). */
  account?: Row;
  /** Per-stock overrides of the position row. */
  position?: (s: BookStock) => Row;
  /** Per-stock overrides of the thesis row. */
  thesis?: (s: BookStock) => Row;
  /** Orders already on the book. */
  orders?: Row[];
  /** Only these tickers (all twelve when absent). */
  only?: string[];
}

export const stockOf = (ticker: string) => BOOK.find((s) => s.ticker === ticker)!;

/** The book as rows: one account, three analysts, a HOLDING thesis and an OPEN LIVE position per stock. */
export function bookSeed(o: BookOptions = {}) {
  const stocks = BOOK.filter((s) => !o.only || o.only.includes(s.ticker));
  const position = stocks.map((s) =>
    positionRow({
      id: s.positionId, symbol: s.ticker, analystId: s.analystId, environment: "LIVE", quantity: s.quantity, initialQty: s.quantity,
      avgCost: s.avgCost, peakPrice: s.peakPrice, openedAt: new Date(s.openedAt), stopLoss: s.stopLoss, targetPrice: null, analyst: { name: NAMES[s.analystId] },
      ...o.position?.(s),
    }),
  );
  return {
    account: [accountRow({ triggers: ACCOUNT_TRIGGERS, triggersSeededAt: new Date("2026-09-01T00:00:00Z"), requireApprovalBuysLive: true, requireApprovalSellsLive: true, ...o.account })],
    agentConfig: Object.entries(ANALYST_TRIGGERS).map(([id, triggers]) => agentConfigRow({ id, name: NAMES[id], triggers, tradingEnvironment: "LIVE", enabled: true })),
    thesis: stocks.map((s) =>
      thesisRow({
        id: s.thesisId, ticker: s.ticker, status: "HOLDING", direction: "LONG", analystId: s.analystId, triggers: s.triggers, triggerState: s.triggerState,
        lastReviewedAt: new Date(s.lastReviewedAt), catalystDate: s.catalystDate ? new Date(s.catalystDate) : null, entryPrice: s.avgCost, stopLoss: null, targetPrice: null,
        researchRun: { agentConfigId: s.analystId, agentConfig: { name: NAMES[s.analystId], setupIds: [], enabled: true } },
        ...o.thesis?.(s),
      }),
    ),
    position,
    order: (o.orders ?? []).map((r) => ({ position: position.find((p) => p.id === r.positionId), ...r })),
  };
}

const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** Alpaca's snapshot for each stock: the trade at `at`, today's bar, and the prior close. */
function snapshots(at: Date, prices: Record<string, { price: number; prevClose: number }>) {
  return (symbols: string[]) =>
    Object.fromEntries(
      symbols
        .filter((s) => prices[s])
        .map((s) => {
          const { price, prevClose } = prices[s];
          return [s, {
            latestTrade: { p: price, t: at.toISOString() },
            dailyBar: { t: `${day(at)}T04:00:00Z`, o: price, h: price, l: price, c: price, v: 1_000_000 },
            prevDailyBar: { t: `${day(new Date(at.getTime() - 86_400_000))}T04:00:00Z`, o: prevClose, h: prevClose, l: prevClose, c: prevClose, v: 1_000_000 },
          }];
        }),
    );
}

/** The broker, doubled: a market order is accepted and fills at once at `fill`; `sent` collects what reached it. */
export function brokerDouble(sent: Row[], fill: number) {
  let n = 0;
  return () => ({
    MARKET_DATA_FEED: "sip",
    placeMarketOrder: async (o: Row) => (sent.push(o), { id: `alpaca_${++n}` }),
    getOrder: async () => ({ status: "filled", filled_avg_price: String(fill), filled_at: AT.toISOString() }),
    getLatestPrice: async () => fill,
    getLatestPrices: async (s: string[]) => Object.fromEntries(s.map((x) => [x, fill])),
    getSnapshots: async () => ({}),
    getBars: async () => [],
    getAccount: async () => ({ equity: "100000", cash: "40000", buying_power: "80000", portfolio_value: "100000" }),
    cancelOrder: async () => undefined,
    getTodaySessionBars: async () => ({}),
    getDailyRangePcts: async () => ({}),
  });
}

function clock(at: Date) {
  jest.useFakeTimers({
    now: at,
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
}

const bookPrices = (only?: string[]) =>
  Object.fromEntries(BOOK.filter((s) => !only || only.includes(s.ticker)).map((s) => [s.ticker, { price: s.price, prevClose: s.prevClose }]));

export interface Pass {
  sent: Array<{ name: string; data: Record<string, unknown> }>;
  result: Record<string, unknown>;
}

/**
 * One pass of the trigger check at `at` over `db`, every stock priced as given
 * (the book's 13:36 prices by default) by a trade printed at `tradeAt` (`at`).
 */
export async function checkPass(db: PrismaDouble, opts: { at?: Date; tradeAt?: Date; prices?: Record<string, { price: number; prevClose: number }> } = {}): Promise<Pass> {
  const at = opts.at ?? AT;
  const tradeAt = opts.tradeAt ?? at;
  const prices = opts.prices ?? bookPrices();
  const sent: Pass["sent"] = [];
  let result: Record<string, unknown> = {};
  clock(at);
  try {
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<Record<string, unknown>>) | undefined;
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn() } }));
      jest.doMock("@/lib/alpaca", () => ({ MARKET_DATA_FEED: "sip", getSnapshots: async (s: string[]) => snapshots(tradeAt, prices)(s), getTodaySessionBars: async () => ({}) }));
      jest.doMock("@/lib/agent/research-helpers", () => ({ finnhub: async () => ({ data: null }) }));
      jest.doMock("@/lib/market-data/ensure-snapshots", () => ({ ensureIndicatorSnapshots: async () => new Map() }));
      jest.doMock("@/lib/agent/triggers/earnings", () => ({ ...jest.requireActual("@/lib/agent/triggers/earnings"), fetchEarningsWindow: async () => ({ reported: new Map(), upcoming: new Map() }) }));
      jest.doMock("@/lib/market-data/sec-filings", () => ({ ...jest.requireActual("@/lib/market-data/sec-filings"), fetchBookFilings: async () => ({ byTicker: new Map() }) }));
      await import("@/lib/inngest/functions/trigger-evaluator");
      result = await handler!({
        step: {
          run: async (_n: string, fn: () => Promise<unknown>) => JSON.parse(JSON.stringify((await fn()) ?? null)),
          sendEvent: async (_id: string, e: Pass["sent"][number]) => void sent.push(e),
        },
      });
    });
  } finally {
    jest.useRealTimers();
  }
  return { sent, result };
}

export interface TriggerRun {
  returned: Record<string, unknown> | null;
  modelCalls: number;
  /** Market orders that reached the broker. */
  sent: Row[];
}

/** What the run's model does: plays back the run's own tool calls through the real tools. */
export type ModelDouble = (tools: Record<string, { execute: (args: unknown, o: unknown) => Promise<unknown> }>) => Promise<void>;

/**
 * The trigger run for one fire, its broker filling at once at `fill`. With no
 * `model`, the model does nothing and the tools are left out; with one, the
 * real tools run and the model double plays the run's calls through them.
 */
export async function triggerRun(db: PrismaDouble, data: Record<string, unknown>, opts: { at?: Date; fill?: number; model?: ModelDouble } = {}): Promise<TriggerRun> {
  const at = opts.at ?? AT;
  const ticker = String(data.ticker);
  const fill = opts.fill ?? stockOf(ticker)?.price ?? 0;
  const sent: Row[] = [];
  let modelCalls = 0;
  let returned: Record<string, unknown> | null = null;
  clock(at);
  try {
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<Record<string, unknown>>) | undefined;
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn(async () => undefined) } }));
      const generateText = async ({ tools }: { tools: Parameters<ModelDouble>[0] }) => {
        modelCalls += 1;
        await opts.model?.(tools);
        return { steps: [], response: { messages: [] }, text: "" };
      };
      jest.doMock("ai", () => ({ ...jest.requireActual("ai"), generateText, stepCountIs: () => () => false }));
      jest.doMock("@ai-sdk/openai", () => ({ openai: () => ({}) }));
      if (!opts.model) jest.doMock("@/lib/agent/tools", () => ({ createResearchTools: () => ({}) }));
      jest.doMock("@/lib/agent/research-helpers", () => ({ ...jest.requireActual("@/lib/agent/research-helpers"), finnhub: async () => ({ data: null }) }));
      jest.doMock("@/lib/actions/finnhub.actions", () => ({
        ...jest.requireActual("@/lib/actions/finnhub.actions"),
        getStockQuote: async () => ({ c: fill, d: 0, dp: 0, h: fill, l: fill, o: fill, pc: fill, t: Math.floor(at.getTime() / 1000) }),
      }));
      jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
      jest.doMock("@/lib/alpaca", brokerDouble(sent, fill));
      jest.doMock("@/lib/email", () => ({ sendEmail: jest.fn(async () => undefined), getUserEmail: async () => null }));
      jest.doMock("@/lib/emails/proposal-pending", () => ({ sendProposalPendingEmail: jest.fn(async () => undefined) }));
      jest.doMock("@/lib/notify/proposal-push", () => ({ sendProposalPendingPush: jest.fn(async () => undefined) }));
      await import("@/lib/inngest/functions/tactical-run");
      returned = await handler!({
        event: { data },
        step: { run: async (_n: string, fn: () => Promise<unknown>) => JSON.parse(JSON.stringify((await fn()) ?? null)), sendEvent: jest.fn() },
      });
    });
  } finally {
    jest.useRealTimers();
  }
  return { returned, modelCalls, sent };
}

