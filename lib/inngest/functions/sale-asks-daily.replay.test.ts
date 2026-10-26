/**
 * A stock under its sell line asks again every trading day.
 *
 * ASML (Secular Compounder, LIVE): its $1835 floor (1-day wait) proposed a sale
 * 2026-10-22 13:45:42Z that expired 10-23 13:45:42Z. The 10-23 13:45:17Z pass
 * fired 25 s before that, was stamped, and was dropped as a duplicate, so the
 * floor waited a day and 10-23 had no ask. Now that pass is skipped unstamped
 * and the 13:50 pass, with the old proposal expired but not yet swept, asks.
 *
 * NVDA (PEAD, floor $236, no wait) is the cooldown-0 control. IOT is the close
 * pass: its 10-23 high, $44.985 at 15:58 ET, came after the last 5-minute pass.
 *
 * Real handlers, rows and tape; doubled: the database, Alpaca, the model, the clock.
 */
import { prismaDouble, replayTool, thesisRow, agentConfigRow, accountRow, positionRow, type PrismaDouble } from "@/lib/replay";

const SECULAR = "cmmqxola3000004lbj7c11bfn";
const PEAD = "cmnhxpjio000004jvox6kl6c7";
const ACCOUNT = "34f5c589-e216-4afe-9ee8-613c13f300e7";

const ASML_FLOOR = { id: "8e790d37-6e92-4eea-9b39-be8a537c471c", action: "EXIT", source: "AGENT", fireMode: "ASK_NOW", predicate: { is: "below", value: 1835, watch: "price" }, rationale: "Under the $1835 floor.", cooldownDays: 1 };
// The 10-22 stamp: the 13:45 pass, before the 13:45:20 run it started (10-23's 13:45:17 fire proves it was no later).
const ASML_STAMP = "2026-10-22T13:45:05.000Z";
const NVDA_FLOOR = { id: "6306936b-bb02-4298-9ca0-90f586772512", action: "EXIT", source: "AGENT", fireMode: "ASK_NOW", predicate: { is: "below", value: 236, watch: "price" }, rationale: "Under the $236 floor.", cooldownDays: 0, lastFiredAt: "2026-10-23T14:25:05.000Z" };

const proposal = (id: string, positionId: string, symbol: string, qty: number, thesisId: string, createdAt: string, status = "AWAITING_APPROVAL") => ({
  id, positionId, userId: ACCOUNT, environment: "LIVE", symbol, side: "SELL", orderType: "MARKET", quantity: qty, status, intent: "CLOSE",
  closeReason: "STOP", closeSource: "agent", thesisId, createdAt: new Date(createdAt), expiresAt: new Date(new Date(createdAt).getTime() + 86_400_000), updatedAt: new Date(createdAt),
});

function book(ticker: "ASML" | "NVDA", orderStatus = "AWAITING_APPROVAL"): PrismaDouble {
  const asml = ticker === "ASML";
  const analyst = asml ? SECULAR : PEAD;
  return prismaDouble({
    account: [accountRow({ id: ACCOUNT, requireApprovalSellsLive: true, requireApprovalBuysLive: true })],
    agentConfig: [agentConfigRow({ id: analyst, accountId: ACCOUNT, userId: ACCOUNT, name: asml ? "Secular Compounder" : "PEAD Specialist", tradingEnvironment: "LIVE" })],
    thesis: [
      thesisRow({
        id: asml ? "cmqooyvy8000004l5a9njg6n5" : "cmtg9nbdy000204jpc6cwawgg", userId: ACCOUNT, accountId: ACCOUNT, ticker, status: "HOLDING", direction: "LONG", horizon: "COMPOUNDER",
        triggers: [asml ? { ...ASML_FLOOR, lastFiredAt: ASML_STAMP } : NVDA_FLOOR],
        researchRun: { agentConfigId: analyst, agentConfig: { enabled: true, name: "x", setupIds: [] } },
      }),
    ],
    position: [
      asml
        ? positionRow({ id: "cmtn0hpa6000304juujs868k7", userId: ACCOUNT, accountId: ACCOUNT, analystId: SECULAR, symbol: "ASML", quantity: 5, avgCost: 1716.09, environment: "LIVE", openedAt: new Date("2026-09-04T14:23:33.865Z"), peakPrice: 1871.1, peakAt: new Date("2026-10-02T16:01:22.574Z"), troughPrice: 1550, troughAt: new Date("2026-10-23T13:35:06.302Z") })
        : positionRow({ id: "cmtha1mcg000804kyrns3lpjg", userId: ACCOUNT, accountId: ACCOUNT, analystId: PEAD, symbol: "NVDA", quantity: 33, avgCost: 218.2259, environment: "LIVE", openedAt: new Date("2026-08-31T13:53:39.975Z"), peakPrice: 242.505, peakAt: new Date("2026-10-06T15:01:01.219Z"), troughPrice: 210.18, troughAt: new Date("2026-10-23T13:35:06.302Z") }),
    ],
    order: [
      asml
        ? proposal("cmvjlg3ir000408l2ncicz5q6", "cmtn0hpa6000304juujs868k7", "ASML", 5, "cmqooyvy8000004l5a9njg6n5", "2026-10-22T13:45:42.457Z", orderStatus)
        : proposal("cmvjn28cy000a08jmzu6utmxk", "cmtha1mcg000804kyrns3lpjg", "NVDA", 33, "cmtg9nbdy000204jpc6cwawgg", "2026-10-22T14:30:54.793Z", orderStatus),
    ],
  });
}

/** Alpaca's snapshot at a pass: the print, the day so far, the prior close. */
const snap = (p: number, t: string, day: { o: number; h: number; l: number }, prevClose: number) => ({
  latestTrade: { p, t },
  dailyBar: { t: "2026-10-23T04:00:00Z", ...day, c: p },
  prevDailyBar: { t: "2026-10-22T04:00:00Z", o: prevClose, h: prevClose, l: prevClose, c: prevClose },
});

type Sent = { data: { ticker: string; triggerId: string; action: string; firedPrice: number | null; thesisId: string; analystId: string } };
const FAKE = { doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] as const };

async function pass(db: PrismaDouble, at: string, vendor: Record<string, unknown>) {
  const sent: Sent[] = [];
  let result: Record<string, unknown> = {};
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: unknown) => {
    const path = new URL(String(url)).pathname;
    const body = path.endsWith("/snapshots") ? vendor.snapshots : path.endsWith("/bars") ? { bars: vendor.bars } : undefined;
    if (body === undefined) throw new Error(`unexpected vendor call ${path}`);
    return { ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => "" } as unknown as Response;
  });
  jest.useFakeTimers({ now: new Date(at), doNotFake: [...FAKE.doNotFake] });
  try {
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<Record<string, unknown>>) | undefined;
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn() } }));
      await import("@/lib/inngest/functions/trigger-evaluator");
      result = await handler!({ step: { run: async (_n: string, fn: () => Promise<unknown>) => fn(), sendEvent: async (_id: string, e: Sent) => void sent.push(e) } });
    });
  } finally {
    jest.useRealTimers();
  }
  return { sent, result };
}

/** The trigger run for one fire: did it reach the analyst, or drop the fire as a duplicate? */
async function trigger(db: PrismaDouble, at: string, data: Sent["data"]) {
  let modelCalls = 0;
  let returned: Record<string, unknown> = {};
  jest.useFakeTimers({ now: new Date(at), doNotFake: [...FAKE.doNotFake] });
  try {
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<Record<string, unknown>>) | undefined;
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn() } }));
      jest.doMock("ai", () => ({ generateText: jest.fn(async () => ((modelCalls += 1), { steps: [], response: { messages: [] }, text: "" })), stepCountIs: () => () => false }));
      jest.doMock("@ai-sdk/openai", () => ({ openai: () => ({}) }));
      jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
      jest.doMock("@/lib/agent/tools", () => ({ createResearchTools: () => ({ get_theses: { execute: async () => ({ ok: false }) } }) }));
      await import("@/lib/inngest/functions/tactical-run");
      returned = await handler!({ event: { data }, step: { run: async (_n: string, fn: () => Promise<unknown>) => JSON.parse(JSON.stringify((await fn()) ?? null)), sendEvent: jest.fn() } });
    });
  } finally {
    jest.useRealTimers();
    for (const m of ["ai", "@ai-sdk/openai", "@/lib/agent/tools", "@/lib/actions/api-keys.actions", "@/lib/inngest/client", "@/lib/prisma"]) jest.dontMock(m);
  }
  return { modelCalls, returned };
}

const floor = (db: PrismaDouble) => ((db.store.thesis[0].triggers as Array<{ lastFiredAt?: string }>)[0]).lastFiredAt;
const fired = (sent: Sent[]) => sent.map((e) => [e.data.ticker, e.data.triggerId, e.data.firedPrice]);

const OLD_ENV = process.env;
beforeEach(() => {
  process.env = { ...OLD_ENV, ALPACA_API_KEY: "PKTEST", ALPACA_API_SECRET: "secret" };
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  process.env = OLD_ENV;
  jest.restoreAllMocks();
  // replayTool's doubles stay registered after it returns; the next pass must reach the vendor double above.
  for (const m of ["@/lib/prisma", "@/lib/alpaca", "@/lib/actions/finnhub.actions", "@/lib/agent/research-helpers", "@/lib/inngest/client", "@/lib/notify/proposal-push", "@/lib/emails/proposal-pending"]) jest.dontMock(m);
});

const ASML_DAY = { o: 1550.485, l: 1550 };
const ASML_1345 = { snapshots: { ASML: snap(1567.19, "2026-10-23T13:45:00Z", { ...ASML_DAY, h: 1568.76 }, 1560.54) } };
const ASML_1350 = { snapshots: { ASML: snap(1566.085, "2026-10-23T13:50:00Z", { ...ASML_DAY, h: 1573.07 }, 1560.54) } };

describe("ASML 10-22 → 10-23: a floor below the price asks every day", () => {
  it("13:45:17, 25 s before yesterday's proposal expires: skipped and not stamped", async () => {
    const db = book("ASML");
    const { sent, result } = await pass(db, "2026-10-23T13:45:17Z", ASML_1345);
    expect(result).toMatchObject({ session: "INTRADAY", firings: 0 });
    expect(sent).toEqual([]);
    expect(floor(db)).toBe(ASML_STAMP);
  });

  it("13:50, the proposal expired but not yet swept: the floor fires, the run reaches the analyst, and the sale is proposed anew", async () => {
    const db = book("ASML");
    await pass(db, "2026-10-23T13:45:17Z", ASML_1345);
    const { sent } = await pass(db, "2026-10-23T13:50:05Z", ASML_1350);
    expect(fired(sent)).toEqual([["ASML", ASML_FLOOR.id, 1566.085]]);
    expect(floor(db)).toBe("2026-10-23T13:50:05.000Z");

    const run = await trigger(db, "2026-10-23T13:50:20Z", sent[0].data);
    expect(run.returned.skipped).toBeUndefined();
    expect(run.modelCalls).toBeGreaterThan(0);

    // The analyst's close_position: a new proposal, not a fold into the expired one.
    jest.useFakeTimers({ now: new Date("2026-10-23T13:50:40Z"), doNotFake: [...FAKE.doNotFake] });
    try {
      const sale = await replayTool("close-position", "closePosition", {
        seed: db.store,
        args: { ticker: "ASML", reason: "STOP", notes: "Under the $1835 floor." },
        ctx: { userId: ACCOUNT, accountId: ACCOUNT, analystId: SECULAR, runEnvironment: "LIVE", runMode: "INTRADAY_TACTICAL" },
        quotes: { ASML: 1566.085 },
        mocks: { "@/lib/notify/proposal-push": () => ({ sendProposalPendingPush: async () => undefined }), "@/lib/emails/proposal-pending": () => ({ sendProposalPendingEmail: async () => undefined }) },
      });
      const waiting = (sale.db.store.order as Array<Record<string, unknown>>).filter((o) => o.status === "AWAITING_APPROVAL");
      expect(waiting.map((o) => o.id)).toEqual(["cmvjlg3ir000408l2ncicz5q6", expect.not.stringMatching("cmvjlg3ir000408l2ncicz5q6")]);
      expect(waiting[1]).toMatchObject({ intent: "CLOSE", quantity: 5, expiresAt: new Date("2026-10-24T13:50:40Z") });
    } finally {
      jest.useRealTimers();
    }
  });

  it("13:50, the stock's row no longer lists the expired proposal, so the analyst isn't told a sale is waiting", async () => {
    jest.useFakeTimers({ now: new Date("2026-10-23T13:50:20Z"), doNotFake: [...FAKE.doNotFake] });
    try {
      const at1345 = await replayTool("get-theses", "getTheses", { seed: book("ASML").store, args: { tickers: ["ASML"] }, ctx: { userId: ACCOUNT, analystId: SECULAR, runEnvironment: "LIVE" }, quotes: { ASML: 1566.085 } });
      const row = ((at1345.result.data as { theses: Array<Record<string, unknown>> }).theses)[0];
      expect(row.proposals ?? []).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("a REJECTED sale still holds the floor back for 4 hours, stamped as before", async () => {
    const db = book("ASML", "REJECTED");
    (db.store.order[0] as Record<string, unknown>).updatedAt = new Date("2026-10-23T13:00:00Z");
    const { sent } = await pass(db, "2026-10-23T13:45:17Z", ASML_1345);
    expect(fired(sent)).toEqual([["ASML", ASML_FLOOR.id, 1567.19]]);
    expect(floor(db)).toBe("2026-10-23T13:45:17.000Z");
    const run = await trigger(db, "2026-10-23T13:45:30Z", sent[0].data);
    expect(run.returned).toMatchObject({ skipped: "close-already-queued", reason: "REJECTED" });
  });
});

const NVDA_DAY = { o: 210.99, l: 210.18 };
describe("NVDA, no wait on its floor: unchanged", () => {
  it("while its proposal waits: no run, as before", async () => {
    const db = book("NVDA");
    const { sent } = await pass(db, "2026-10-23T14:30:05Z", { snapshots: { NVDA: snap(212.895, "2026-10-23T14:30:00Z", { ...NVDA_DAY, h: 213.32 }, 212.21) } });
    expect(sent).toEqual([]);
  });

  it("once the sweeper has marked it EXPIRED: it fires and the run reaches the analyst, as before", async () => {
    const db = book("NVDA", "EXPIRED");
    const { sent } = await pass(db, "2026-10-23T15:00:30Z", { snapshots: { NVDA: snap(212.975, "2026-10-23T15:00:29Z", { ...NVDA_DAY, h: 213.85 }, 212.21) } });
    expect(fired(sent)).toEqual([["NVDA", NVDA_FLOOR.id, 212.975]]);
    const run = await trigger(db, "2026-10-23T15:00:45Z", sent[0].data);
    expect(run.modelCalls).toBeGreaterThan(0);
  });
});

describe("IOT 10-23: the close pass takes the day's high", () => {
  const IOT_BAR = { bars: { IOT: [{ t: "2026-10-23T04:00:00Z", o: 43.65, h: 44.985, l: 43.22, c: 44.92, v: 3105939 }] }, snapshots: {} };
  const iot = (over: Record<string, unknown> = {}) =>
    prismaDouble({
      thesis: [],
      position: [positionRow({ id: "cmv9m90g0000a06l3zv45o24s", analystId: PEAD, symbol: "IOT", quantity: 300, avgCost: 42.695, environment: "LIVE", openedAt: new Date("2026-10-15T15:16:02.775Z"), peakPrice: 44.95, peakAt: new Date("2026-10-23T18:20:05Z"), troughPrice: 39.06, troughAt: new Date("2026-10-16T19:00:54.316Z"), ...over })],
    });

  it("16:20 ET: the high since we bought becomes $44.985, the 15:58 print the last 5-minute pass missed", async () => {
    const db = iot();
    await pass(db, "2026-10-23T20:20:05Z", IOT_BAR);
    expect(db.store.position[0]).toMatchObject({ peakPrice: 44.985, peakAt: new Date("2026-10-23T20:20:05Z"), troughPrice: 39.06 });
  });

  it("a position bought that day is left alone: the day's high may predate the buy", async () => {
    const db = iot({ openedAt: new Date("2026-10-23T15:00:00Z"), peakPrice: 44.5 });
    await pass(db, "2026-10-23T20:20:05Z", IOT_BAR);
    expect(db.store.position[0]).toMatchObject({ peakPrice: 44.5 });
  });

  it("a mark is never lowered", async () => {
    const db = iot({ peakPrice: 45.32 });
    await pass(db, "2026-10-23T20:20:05Z", IOT_BAR);
    expect(db.store.position[0]).toMatchObject({ peakPrice: 45.32, troughPrice: 39.06 });
  });
});
