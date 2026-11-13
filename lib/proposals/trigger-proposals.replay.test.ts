/**
 * A proposal a trigger makes stays open while its trigger holds (the owner's
 * ruling, 2026-11-13), over 30 days of production: NVDA, CEG and PLTR from
 * 2026-10-14 to 11-13 (__fixtures__/trigger-proposals-2026-10.json), and a
 * trigger's buy and add on the day each was proposed (ABBV, WST).
 *
 * Through the real entry points, in time order: the five-minute check at each
 * time it fired in production and its 16:20 ET close pass every day, the
 * trigger run each fire starts, the expiry sweep before every step, the
 * morning run's read where a morning run proposed the sale again, the decline
 * route where the owner declined, and the line edits as they happened.
 *
 * Before (main): each proposal lapsed after 24 hours and the standing order
 * asked again, the proposals production made: NVDA 23, CEG 14, PLTR 16. After:
 * one proposal per break of the line, withdrawn on a close back past it; a
 * decline still asks again the next day.
 *
 * Doubled: the database, Alpaca's tape (the fixture's prices and bars), the
 * model (it proposes the sale where production's run did, else holds), the
 * clock and the mail.
 */
import fixture from "./__fixtures__/trigger-proposals-2026-10.json";
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow, type PrismaDouble } from "@/lib/replay";

type Ev = [kind: string, at: string, ...rest: unknown[]];
type Stock = (typeof fixture.stocks)["NVDA"];

const mockState: { db: PrismaDouble | null; sell: boolean; ticker: string } = { db: null, sell: false, ticker: "" };

jest.mock("@/lib/prisma", () => ({ get prisma() { return mockState.db; } }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: unknown) => fn, send: jest.fn(async () => undefined) } }));
jest.mock("@/lib/notify/proposal-push", () => ({ sendProposalPendingPush: async () => undefined }));
jest.mock("@/lib/emails/proposal-pending", () => ({ sendProposalPendingEmail: async () => undefined }));
jest.mock("@/lib/agent/model", () => ({ modelFor: () => ({}) }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "34f5c589-e216-4afe-9ee8-613c13f300e7" } } }) } }) }));
jest.mock("@/lib/auth/account", () => ({ getAccountId: async () => "34f5c589-e216-4afe-9ee8-613c13f300e7", getUserRole: async () => "OWNER" }));
// The analyst: sells where production's trigger run proposed, else holds. An Auto fire's write-up has no trade tools.
jest.mock("ai", () => ({
  ...jest.requireActual("ai"),
  stepCountIs: () => () => false,
  generateText: jest.fn(async (a: { tools?: Record<string, { execute: (x: unknown, o: unknown) => Promise<unknown> }> }) => {
    if (mockState.sell && a.tools?.close_position) await a.tools.close_position.execute({ ticker: mockState.ticker, reason: "STOP", belief_survived: true }, { toolCallId: "sell", messages: [] });
    return { steps: [], response: { messages: [] }, text: "", usage: {} };
  }),
}));
// The trigger run's tools: the real close_position with the context the run builds; the stock's read is skipped.
jest.mock("@/lib/agent/tools", () => ({
  createResearchTools: (ctx: Record<string, unknown>) => {
    const { closePosition } = jest.requireActual("@/lib/agent/tools/close-position");
    return { get_theses: { execute: async () => ({ ok: false }) }, close_position: closePosition({ ...ctx, groupId: (p: string) => p }) };
  },
}));

const FAKE = { doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] as const };
const ACCOUNT = fixture.account;
const ET = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** Alpaca's answers at the moment: the snapshot of the last print and the day's bar, for the one stock. */
function tape(stock: Stock, ticker: string, at: Date, px: number | null) {
  const days = Object.keys(stock.bars).sort();
  const today = ET(at);
  const bar = (d: string) => {
    const [o, h, l, c] = (stock.bars as Record<string, number[]>)[d];
    return { t: `${d}T04:00:00Z`, o, h, l, c, v: 1_000_000 };
  };
  const minutes = Number(at.toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour12: false }).slice(0, 5).replace(":", "."));
  const open = days.includes(today) && minutes >= 9.3;
  const prior = days.filter((d) => d < today);
  const last = prior.at(-1)!;
  let snapshot;
  if (!open) {
    // Before the bell: the last close, stamped at the bell.
    snapshot = { latestTrade: { p: bar(last).c, t: `${last}T20:00:00Z` }, dailyBar: bar(last), prevDailyBar: bar(prior.at(-2)!) };
  } else if (minutes >= 16) {
    snapshot = { latestTrade: { p: bar(today).c, t: `${today}T20:59:59Z` }, dailyBar: bar(today), prevDailyBar: bar(last) };
  } else {
    const b = bar(today);
    snapshot = { latestTrade: { p: px, t: at.toISOString() }, dailyBar: { ...b, h: Math.max(b.o, px!), l: Math.min(b.o, px!), c: px }, prevDailyBar: bar(last) };
  }
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: unknown) => {
    const u = new URL(String(url));
    const body = u.pathname.endsWith("/snapshots") ? { [ticker]: snapshot } : u.pathname.endsWith("/bars") ? { bars: open && minutes >= 16 ? { [ticker]: [bar(today)] } : {} } : {};
    return { ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
  });
}

function book(ticker: string, stock: Stock): PrismaDouble {
  return prismaDouble({
    account: [accountRow({ id: ACCOUNT, requireApprovalSellsLive: true, requireApprovalBuysLive: true, triggers: [], triggersSeededAt: new Date("2026-09-18T12:00:00Z") })],
    agentConfig: [agentConfigRow({ id: stock.analyst, accountId: ACCOUNT, userId: ACCOUNT, tradingEnvironment: "LIVE", triggers: stock.analystTriggers.map((t) => ({ ...t, rationale: "(not kept)" })) })],
    thesis: [
      thesisRow({
        id: stock.thesis, userId: ACCOUNT, accountId: ACCOUNT, ticker, status: "HOLDING", direction: "LONG", horizon: "COMPOUNDER",
        triggers: stock.triggers.map((t) => ({ ...t, rationale: "(not kept)" })),
        researchRun: { agentConfigId: stock.analyst, agentConfig: { enabled: true, name: "x", setupIds: [] } },
      }),
    ],
    position: [positionRow({ ...stock.position, userId: ACCOUNT, accountId: ACCOUNT, analystId: stock.analyst, symbol: ticker, environment: "LIVE", peakAt: new Date(stock.position.peakAt), openedAt: new Date(stock.position.openedAt) })],
  });
}

const handler = async (path: string) => (await import(path)) as Record<string, (ctx: unknown) => Promise<unknown>>;
const step = { run: async (_n: string, fn: () => Promise<unknown>) => JSON.parse(JSON.stringify((await fn()) ?? null)), sendEvent: jest.fn() };

/** The month for one stock, in order; what it leaves behind. */
async function month(ticker: "NVDA" | "CEG" | "PLTR", extra: Ev[] = []) {
  const stock = fixture.stocks[ticker] as Stock;
  const db = book(ticker, stock);
  mockState.db = db;
  mockState.ticker = ticker;
  const { triggerEvaluator } = await handler("@/lib/inngest/functions/trigger-evaluator");
  const { proposalExpiry } = await handler("@/lib/inngest/functions/proposal-expiry");
  const { tacticalRun } = await handler("@/lib/inngest/functions/tactical-run");
  const { POST: decline } = (await import("@/app/api/proposals/[orderId]/reject/route")) as { POST: (r: Request, c: unknown) => Promise<Response> };
  const { getTheses } = await import("@/lib/agent/tools/get-theses");
  const { closePosition } = await import("@/lib/agent/tools/close-position");

  const mornings: Array<{ at: string; ok: boolean; situations: string[] | null }> = [];
  const events: Ev[] = [...(stock.events as Ev[]), ...extra, ["trail-on", fixture.trail.from] as Ev].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const thesis = () => db.store.thesis[0] as { triggers: Array<Record<string, unknown>> };
  for (const [kind, at, ...rest] of events) {
    const now = new Date(at);
    jest.setSystemTime(now);
    tape(stock, ticker, now, kind === "pass" ? (rest[0] as number) : null);
    if (kind === "trail-on") (db.store.account[0] as Record<string, unknown>).triggers = [{ ...fixture.trail.trigger, rationale: "(not kept)" }];
    else if (kind === "analyst-trail-off") (db.store.agentConfig[0] as Record<string, unknown>).triggers = [];
    else if (kind === "edit") {
      const t = thesis().triggers.find((x) => x.id === rest[0])!;
      const change = rest[1] as { value?: number; fireMode?: string };
      if (change.value != null) t.predicate = { ...(t.predicate as object), value: change.value };
      if (change.fireMode) t.fireMode = change.fireMode;
    } else if (kind === "decline") {
      const card = (db.store.order as Array<Record<string, unknown>>).find((o) => o.status === "AWAITING_APPROVAL" && o.side === "SELL");
      // The double carries a relation inline: the decline reads the order's position.
      if (card) card.position = db.store.position[0];
      if (card) await decline(new Request(`http://x/api/proposals/${card.id}/reject`, { method: "POST", body: "{}" }), { params: Promise.resolve({ orderId: card.id }) });
    } else {
      await proposalExpiry({ step });
      if (kind === "pass" || kind === "close") {
        const sent: Array<{ data: Record<string, unknown> }> = [];
        await triggerEvaluator({ step: { ...step, sendEvent: async (_id: string, e: { data: Record<string, unknown> }) => void sent.push(e) } });
        for (const e of sent) {
          jest.setSystemTime(new Date(now.getTime() + 15_000));
          mockState.sell = rest[1] === "sell";
          await tacticalRun({ event: { data: e.data }, step });
        }
      } else if (kind === "morning") {
        // A morning run proposed the sale again here. It reads the stock; it sells if the read hands it a sale signal.
        const ctx = { runId: `morning-${at}`, userId: ACCOUNT, accountId: ACCOUNT, analystId: stock.analyst, runMode: "MORNING_PLAN", runEnvironment: "LIVE", groupId: (p: string) => p };
        const read = (await getTheses(ctx as never).execute!({ tickers: [ticker] } as never, { toolCallId: "read", messages: [] })) as { ok?: boolean; data?: { theses?: Array<{ situations?: string[] }> } };
        mornings.push({ at, ok: read.ok === true, situations: read.data?.theses?.[0]?.situations ?? null });
        if (read.data?.theses?.[0]?.situations?.includes("PROTECTIVE_SALE")) {
          await closePosition(ctx as never).execute!({ ticker, reason: "STOP", belief_survived: true } as never, { toolCallId: "sell", messages: [] });
        }
      }
    }
  }
  const proposals = (db.store.order as Array<Record<string, unknown>>).filter((o) => o.side === "SELL");
  const runs = (db.store.researchRun as Array<Record<string, unknown>>).filter((r) => r.mode === "INTRADAY_TACTICAL");
  return {
    db,
    proposals: proposals.map((o) => ({ at: (o.createdAt as Date).toISOString().slice(0, 16), status: o.status, triggerIds: o.triggerIds, expiresAt: o.expiresAt ?? null, withdrawnReason: o.withdrawnReason ?? null, proposedPrice: o.proposedPrice ?? null })),
    runs: runs.length,
    mornings,
  };
}

const OLD_ENV = process.env;
beforeEach(() => {
  process.env = { ...OLD_ENV, ALPACA_API_KEY: "PKTEST", ALPACA_API_SECRET: "secret" };
  jest.useFakeTimers({ now: new Date("2026-10-14T12:00:00Z"), doNotFake: [...FAKE.doNotFake] });
  for (const m of ["log", "warn", "info", "error"] as const) jest.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => {
  process.env = OLD_ENV;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const FLOOR = { NVDA: "6306936b-bb02-4298-9ca0-90f586772512", CEG: "cafcc57b-4b0c-47ee-b2c2-d4cd6e0b942e", PLTR: "21976408-e091-49d6-9411-649feba59fdf" };
const TRAIL = fixture.trail.trigger.id;

jest.setTimeout(120_000);

describe("a trigger's proposal over 2026-10-14 → 11-13", () => {
  it("NVDA: one proposal for the break of $236, open 20 days (main: 23 proposals, 19 trigger runs); declined 11-03, it asks again the next day, as before", async () => {
    const r = await month("NVDA");
    expect(r.proposals).toEqual([
      // NVDA never closed back above $236, so nothing came down; the run read $220.55 when it proposed.
      { at: "2026-10-14T18:01", status: "REJECTED", triggerIds: [FLOOR.NVDA], expiresAt: null, withdrawnReason: null, proposedPrice: 220.55 },
      // A decline still means "not today": the floor and the 6% trail fire together the next day.
      { at: "2026-11-04T14:35", status: "AWAITING_APPROVAL", triggerIds: [FLOOR.NVDA, TRAIL], expiresAt: null, withdrawnReason: null, proposedPrice: 201.61 },
    ]);
    expect(r.runs).toBe(2);
    // The four mornings production proposed it again: the read worked, and with the proposal open it asked nothing.
    expect(r.mornings).toEqual(["2026-10-19T12:01:00Z", "2026-10-26T12:01:20Z", "2026-10-27T12:02:10Z", "2026-11-02T13:01:45Z"].map((at) => ({ at, ok: true, situations: [] })));
  });

  it("CEG: one proposal from 10-14, open through 11-13: it never closed back above $287.30, $289.59 or (11-13) $280 (main: 14 proposals)", async () => {
    const r = await month("CEG");
    expect(r.proposals).toEqual([{ at: "2026-10-14T13:45", status: "AWAITING_APPROVAL", triggerIds: [FLOOR.CEG], expiresAt: null, withdrawnReason: null, proposedPrice: 286.175 }]);
    expect(r.runs).toBe(1);
  });

  it("PLTR: a proposal per break, withdrawn on each close back above, the last open on the trail (main: 16 proposals, 23 trigger runs)", async () => {
    const r = await month("PLTR");
    expect(r.proposals).toEqual([
      // Auto-sell at $196 (set 10-23); PLTR closed $196.75.
      { at: "2026-10-23T18:40", status: "WITHDRAWN", triggerIds: [FLOOR.PLTR], expiresAt: null, withdrawnReason: "closed back above $196 at $196.75", proposedPrice: 195.84 },
      // The account's 6% trail ($197.64 off the $210.25 high): closed $198.84, then $198.73.
      { at: "2026-10-26T13:31", status: "WITHDRAWN", triggerIds: [TRAIL], expiresAt: null, withdrawnReason: "closed back above $197.64, 6% off the high at $198.84", proposedPrice: 196.52 },
      { at: "2026-10-27T14:05", status: "WITHDRAWN", triggerIds: [TRAIL], expiresAt: null, withdrawnReason: "closed back above $197.64, 6% off the high at $198.73", proposedPrice: 197.41 },
      // Both broke 10-28. It closed back above $196 that day ($196.81) but not above the trail, so it stayed.
      { at: "2026-10-28T14:10", status: "AWAITING_APPROVAL", triggerIds: [FLOOR.PLTR, TRAIL], expiresAt: null, withdrawnReason: null, proposedPrice: 194.485 },
    ]);
    // Six runs on 10-15 → 10-22 held without a sale, as in production; then one per proposal.
    expect(r.runs).toBe(10);
  });
});

// A trigger's buy and add, as the run stages them, on the day each was proposed: the close pass is the whole test.
describe("a trigger's buy and add come down on the close too", () => {
  const SECULAR = "cmmqxola3000004lbj7c11bfn";
  const DAY = (o: number, h: number, l: number, c: number) => [o, h, l, c];
  async function closePass(db: PrismaDouble, ticker: string, bars: Record<string, number[]>, at: string) {
    mockState.db = db;
    jest.setSystemTime(new Date(at));
    tape({ bars } as unknown as Stock, ticker, new Date(at), null);
    const { triggerEvaluator } = await handler("@/lib/inngest/functions/trigger-evaluator");
    const { proposalExpiry } = await handler("@/lib/inngest/functions/proposal-expiry");
    await proposalExpiry({ step });
    await triggerEvaluator({ step: { ...step, sendEvent: async () => undefined } });
    return db;
  }
  const order = (over: Record<string, unknown>) => ({ userId: ACCOUNT, environment: "LIVE", side: "BUY", orderType: "MARKET", status: "AWAITING_APPROVAL", expiresAt: null, closeReason: null, closeSource: null, ...over });

  it("ABBV 10-19: the buy above $285.42, proposed at $285.76, closed at $282.68: withdrawn, and the staged position with it", async () => {
    const ENTER = { id: "9e61601d", action: "ENTER", source: "AGENT", fireMode: "ASK_NOW", predicate: { watch: "price", is: "above", value: 285.42 }, rationale: "(not kept)", cooldownDays: 1, lastFiredAt: "2026-10-19T13:35:05.000Z" };
    const db = prismaDouble({
      account: [accountRow({ id: ACCOUNT, requireApprovalSellsLive: true, requireApprovalBuysLive: true, triggers: [], triggersSeededAt: new Date("2026-09-18T12:00:00Z") })],
      agentConfig: [agentConfigRow({ id: SECULAR, accountId: ACCOUNT, userId: ACCOUNT, tradingEnvironment: "LIVE", triggers: [] })],
      thesis: [thesisRow({ id: "cmum2st7y000504jfkeagglf2", userId: ACCOUNT, accountId: ACCOUNT, ticker: "ABBV", status: "WATCHING", direction: "LONG", horizon: "COMPOUNDER", triggers: [ENTER], researchRun: { agentConfigId: SECULAR, agentConfig: { enabled: true, name: "x", setupIds: [] } } })],
      position: [positionRow({ id: "cmvfarefv000308l7lvdj2szy", userId: ACCOUNT, accountId: ACCOUNT, analystId: SECULAR, symbol: "ABBV", status: "PENDING_APPROVAL", quantity: 34, avgCost: 286.43, environment: "LIVE", openedAt: new Date("2026-10-19T13:35:29Z") })],
      order: [order({ id: "cmvfarei2000408l7y6iddnph", positionId: "cmvfarefv000308l7lvdj2szy", thesisId: "cmum2st7y000504jfkeagglf2", symbol: "ABBV", intent: "OPEN", quantity: 34, triggerIds: [ENTER.id], proposedPrice: 285.76, createdAt: new Date("2026-10-19T13:35:29Z") })],
    });
    await closePass(db, "ABBV", { "2026-10-16": DAY(283.61, 286.64, 282.955, 285.42), "2026-10-19": DAY(284.23, 287.93, 282.59, 282.68) }, "2026-10-19T20:20:05Z");
    expect(db.store.order[0]).toMatchObject({ status: "WITHDRAWN", withdrawnReason: "closed back below $285.42 at $282.68" });
    expect(db.store.position[0]).toMatchObject({ status: "CANCELLED" });
  });

  it("WST 10-29: the add on a 7% day, proposed at $432.50; it closed up 3.2%: withdrawn, the holding untouched", async () => {
    const ADD = { id: "1aba586f-cd45-4bbd-82da-d651f1e2802a", action: "ADD", source: "DEFAULT", fireMode: "ASK_NOW", predicate: { is: "above", value: 7, watch: "move", variable: "prev_close" }, rationale: "(not kept)", cooldownDays: 3 };
    const db = prismaDouble({
      account: [accountRow({ id: ACCOUNT, requireApprovalSellsLive: true, requireApprovalBuysLive: true, triggers: [ADD], triggersSeededAt: new Date("2026-09-18T12:00:00Z") })],
      agentConfig: [agentConfigRow({ id: SECULAR, accountId: ACCOUNT, userId: ACCOUNT, tradingEnvironment: "LIVE", triggers: [] })],
      thesis: [thesisRow({ id: "cmsplcu9u000004l71leub93x", userId: ACCOUNT, accountId: ACCOUNT, ticker: "WST", status: "HOLDING", direction: "LONG", horizon: "COMPOUNDER", triggers: [], triggerState: { [ADD.id]: { firedAt: "2026-10-29T15:25:05.000Z" } }, researchRun: { agentConfigId: SECULAR, agentConfig: { enabled: true, name: "x", setupIds: [] } } })],
      position: [positionRow({ id: "cmt1h3x8p001604jlbxnkzwpb", userId: ACCOUNT, accountId: ACCOUNT, analystId: SECULAR, symbol: "WST", status: "OPEN", quantity: 20, avgCost: 355.28, environment: "LIVE", peakPrice: 438.27, openedAt: new Date("2026-08-20T19:55:54Z") })],
      order: [order({ id: "cmvtp3cpx000208jsyarhgkiv", positionId: "cmt1h3x8p001604jlbxnkzwpb", thesisId: "cmsplcu9u000004l71leub93x", symbol: "WST", intent: "ADD", quantity: 11, triggerIds: [ADD.id], proposedPrice: 432.5, createdAt: new Date("2026-10-29T15:25:28Z") })],
    });
    await closePass(db, "WST", { "2026-10-28": DAY(396.95, 404.985, 396.83, 403.64), "2026-10-29": DAY(420.69, 438.27, 415.32, 416.67) }, "2026-10-29T20:20:05Z");
    expect(db.store.order[0]).toMatchObject({ status: "WITHDRAWN", withdrawnReason: "closed at $416.67; no longer above 7% from yesterday's close" });
    expect(db.store.position[0]).toMatchObject({ status: "OPEN" });
  });

  it("a proposal no trigger made is left to its 24 hours", async () => {
    const db = prismaDouble({
      thesis: [thesisRow({ id: "t-chat", userId: ACCOUNT, accountId: ACCOUNT, ticker: "ABBV", status: "WATCHING", direction: "LONG", triggers: [], researchRun: { agentConfigId: SECULAR, agentConfig: { enabled: true, name: "x", setupIds: [] } } })],
      position: [positionRow({ id: "p-chat", userId: ACCOUNT, accountId: ACCOUNT, analystId: SECULAR, symbol: "ABBV", status: "PENDING_APPROVAL", quantity: 34, avgCost: 286.43, environment: "LIVE" })],
      order: [order({ id: "o-chat", positionId: "p-chat", thesisId: "t-chat", symbol: "ABBV", intent: "OPEN", quantity: 34, expiresAt: new Date("2026-10-20T13:35:29Z"), createdAt: new Date("2026-10-19T13:35:29Z") })],
    });
    await closePass(db, "ABBV", { "2026-10-16": DAY(283.61, 286.64, 282.955, 285.42), "2026-10-19": DAY(284.23, 287.93, 282.59, 282.68) }, "2026-10-19T20:20:05Z");
    expect(db.store.order[0]).toMatchObject({ status: "AWAITING_APPROVAL" });
  });
});
