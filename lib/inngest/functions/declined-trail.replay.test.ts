/**
 * A declined sale on a trail stays on the morning list (2026-11-17 fix round). The morning read has no
 * position and no chart numbers, so it can't re-read a trail or an average: it lists a sale that fired and
 * hasn't been found false at a close since, which the close pass decided with every input in hand.
 *
 * V (Secular Compounder, HOLDING): 27 shares at $369.25, the high since we bought $442.23 (11-05), and the
 * account's "Sell if below 6% from the high since we bought" ($415.69), as stored on 2026-11-17. V's own
 * triggers as stored; its $409 floor fired 10-28 and V closed back above it, which the first close pass
 * after the deploy writes as `falseAtCloseAt`. The trail's fire and its decline are staged: V hasn't broken it.
 *
 * The evaluator's cron handler and get_theses, on one database; doubled: the database, Alpaca, the clock.
 */
import { prismaDouble, replayTool, thesisRow, agentConfigRow, accountRow, positionRow, type PrismaDouble } from "@/lib/replay";

const SECULAR = "cmmqxola3000004lbj7c11bfn";
const ACCOUNT = "34f5c589-e216-4afe-9ee8-613c13f300e7";
const V = "cmum3c2la000704l2nq4rgf8k";
const TRAIL = { id: "bd941c67-a53a-41b8-918f-d303ec3b5e66", action: "EXIT", source: "PRINCIPAL", fireMode: "ASK_NOW", predicate: { is: "below", value: 6, watch: "move", variable: "peak" }, rationale: "below 6% from the high since we bought — standing rule set by the principal." };
const t = (id: string, action: string, fireMode: string, predicate: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id, action, source: "AGENT", fireMode, predicate, rationale: "(as set)", ...extra });
const V_TRIGGERS = [
  t("cf42e448-ec50-40b4-9c33-f1ee60e2522c", "REVIEW", "NEXT_MORNING", { is: "above", value: 4.6, watch: "move", variable: "entry" }, { lastFiredAt: "2026-11-17T14:40:02.893Z" }),
  t("5568fb17-fe40-4af1-9e15-b3069473c6b9", "REVIEW", "NEXT_MORNING", { is: "after", value: 60, watch: "from_date", variable: "buy" }),
  t("71d8a84a-df07-44d6-acc9-34452d3e7206", "REVIEW", "NEXT_MORNING", { is: "before", value: 7, watch: "report" }, { lastFiredAt: "2026-10-20T16:05:06.181Z", firedReports: ["2026-10-27"] }),
  t("ee9ddbea-391f-446c-8672-744a31ba6ad7", "REVIEW", "NEXT_MORNING", { is: "below", watch: "price", variable: "sma200" }),
  t("84f59b07-5ad2-4f6c-882a-83f5ecce81a7", "EXIT", "DO_IT", { is: "below", value: 409, watch: "price" }, { lastFiredAt: "2026-10-28T13:40:25.625Z", falseAtCloseAt: "2026-10-29T20:20:05.000Z" }),
  t("203c3f47-82be-4411-a399-01d8a2c91278", "REVIEW", "NEXT_MORNING", { is: "above", value: 434, watch: "price" }, { lastFiredAt: "2026-11-04T16:45:16.615Z" }),
  t("a1d1220f-20c8-4d23-ac31-294eb67f166d", "REVIEW", "NEXT_MORNING", { value: 30, watch: "repeat" }, { source: "DEFAULT" }),
  t("a04e5161-4bc5-4c4f-8f5e-288d12cc9977", "REVIEW", "NEXT_MORNING", { is: "below", value: 339.39, watch: "price" }, { source: "DEFAULT" }),
];
const POSITION = "cmuvl5233000204jp3njifila";

function book(): PrismaDouble {
  return prismaDouble({
    account: [accountRow({ id: ACCOUNT, triggers: [TRAIL], triggersSeededAt: new Date("2026-09-01T00:00:00Z"), requireApprovalSellsLive: true, requireApprovalBuysLive: true })],
    agentConfig: [agentConfigRow({ id: SECULAR, accountId: ACCOUNT, userId: ACCOUNT, name: "Secular Compounder", tradingEnvironment: "LIVE", triggers: [] })],
    thesis: [
      thesisRow({
        id: V, userId: ACCOUNT, accountId: ACCOUNT, ticker: "V", status: "HOLDING", direction: "LONG", horizon: "COMPOUNDER", triggers: V_TRIGGERS, triggerState: {},
        lastReviewedAt: new Date("2026-11-17T14:50:00Z"),
        researchRun: { agentConfigId: SECULAR, agentConfig: { enabled: true, name: "Secular Compounder", setupIds: [] } },
      }),
    ],
    position: [positionRow({ id: POSITION, userId: ACCOUNT, accountId: ACCOUNT, analystId: SECULAR, symbol: "V", quantity: 27, avgCost: 369.2526, environment: "LIVE", openedAt: new Date("2026-10-05T18:55:56.870Z"), peakPrice: 442.2254, peakAt: new Date("2026-11-05T14:35:06.235Z") })],
    order: [],
  });
}

const FAKE = ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] as const;
const snap = (p: number, at: string, prevClose: number) => ({ snapshots: { V: { latestTrade: { p, t: at }, dailyBar: { t: `${at.slice(0, 10)}T05:00:00Z`, o: prevClose, h: Math.max(p, prevClose), l: Math.min(p, prevClose), c: p }, prevDailyBar: { t: "2026-11-17T05:00:00Z", o: prevClose, h: prevClose, l: prevClose, c: prevClose } } } });
const close = (day: string, c: number) => ({ snapshots: {}, bars: { V: [{ t: `${day}T05:00:00Z`, o: c, h: c, l: c, c, v: 6_000_000 }] } });

/** One pass of the trigger check at `at`: the fires it sent. */
async function pass(db: PrismaDouble, at: string, vendor: Record<string, unknown>) {
  const sent: Array<{ data: Record<string, unknown> }> = [];
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: unknown) => {
    const path = new URL(String(url)).pathname;
    const body = path.endsWith("/snapshots") ? vendor.snapshots : path.endsWith("/bars") ? { bars: vendor.bars } : undefined;
    if (body === undefined) throw new Error(`unexpected vendor call ${path}`);
    return { ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => "" } as unknown as Response;
  });
  jest.useFakeTimers({ now: new Date(at), doNotFake: [...FAKE] });
  try {
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn() } }));
      await import("@/lib/inngest/functions/trigger-evaluator");
      await handler!({ step: { run: async (_n: string, fn: () => Promise<unknown>) => fn(), sendEvent: async (_id: string, e: { data: Record<string, unknown> }) => void sent.push(e) } });
    });
  } finally {
    jest.useRealTimers();
  }
  return sent.map((e) => e.data.triggerId);
}

/** The morning read of V: its situations. */
async function morning(db: PrismaDouble, at: string, price: number) {
  jest.useFakeTimers({ now: new Date(at), doNotFake: [...FAKE] });
  try {
    const read = await replayTool("get-theses", "getTheses", { seed: db.store, args: { tickers: ["V"] }, ctx: { userId: ACCOUNT, accountId: ACCOUNT, analystId: SECULAR, runEnvironment: "LIVE", runMode: "MORNING_PLAN" }, quotes: { V: price } });
    return ((read.result.data as { theses: Array<{ situations?: string[] }> }).theses)[0].situations ?? [];
  } finally {
    jest.useRealTimers();
    for (const m of ["@/lib/prisma", "@/lib/alpaca", "@/lib/actions/finnhub.actions", "@/lib/agent/research-helpers", "@/lib/inngest/client"]) jest.dontMock(m);
  }
}

const OLD_ENV = process.env;
beforeEach(() => {
  process.env = { ...OLD_ENV, ALPACA_API_KEY: "PKTEST", ALPACA_API_SECRET: "secret" };
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  process.env = OLD_ENV;
  jest.restoreAllMocks();
});

jest.setTimeout(60_000);

describe("V: the 6% trail fired and was declined", () => {
  it("listed on the next two mornings with no new card; after a close back above the line, not listed", async () => {
    const db = book();
    // 11-18, 10:00 ET at $412.10: 6.8% off the $442.23 high, under the $415.69 line.
    expect(await pass(db, "2026-11-18T15:00:00Z", snap(412.1, "2026-11-18T15:00:00Z", 420.04))).toEqual([TRAIL.id]);
    // Its sale proposed and declined.
    db.store.order.push({ id: "v_sale", userId: ACCOUNT, environment: "LIVE", positionId: POSITION, symbol: "V", side: "SELL", orderType: "MARKET", quantity: 27, intent: "CLOSE", closeReason: "STOP", closeSource: "agent", status: "REJECTED", thesisId: V, triggerIds: [TRAIL.id], expiresAt: null, createdAt: new Date("2026-11-18T15:01:00Z"), updatedAt: new Date("2026-11-18T16:00:00Z") });
    expect(await pass(db, "2026-11-18T21:20:05Z", close("2026-11-18", 411.6))).toEqual([]);

    expect(await morning(db, "2026-11-19T13:01:00Z", 411.6)).toContain("PROTECTIVE_SALE");
    expect(await pass(db, "2026-11-19T15:00:00Z", snap(410.4, "2026-11-19T15:00:00Z", 411.6))).toEqual([]);
    expect(await pass(db, "2026-11-19T21:20:05Z", close("2026-11-19", 412.4))).toEqual([]);
    expect(await morning(db, "2026-11-20T13:01:00Z", 412.4)).toContain("PROTECTIVE_SALE");
    expect(db.store.order.map((o) => (o as { status: string }).status)).toEqual(["REJECTED"]);

    // 11-20 closes $417.20, back above the $415.69 line: the close pass marks the trail ready.
    await pass(db, "2026-11-20T21:20:05Z", close("2026-11-20", 417.2));
    expect(((db.store.thesis[0] as { triggerState: Record<string, { falseAtCloseAt?: string }> }).triggerState)[TRAIL.id].falseAtCloseAt).toBe("2026-11-20T21:20:05.000Z");
    expect(await morning(db, "2026-11-23T13:01:00Z", 417.2)).not.toContain("PROTECTIVE_SALE");
  });
});
