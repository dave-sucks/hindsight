/**
 * A sale a trigger proposes stays open while its reason holds (the owner's
 * ruling, 2026-11-13), over 30 days of production: NVDA, CEG and PLTR from
 * 2026-10-14 to 11-13 (__fixtures__/sale-card-2026-10.json).
 *
 * Through the real entry points, in time order: the five-minute check at each
 * time it fired in production and its 16:20 ET close pass every day, the
 * trigger run each fire starts, the expiry sweep before every step, the
 * morning run's read where a morning run proposed the sale again, the decline
 * route where the owner declined, and the line edits as they happened.
 *
 * Before (main): each sale lapsed after 24 hours and the standing order asked
 * again, the proposals production made: NVDA 23, CEG 14, PLTR 16. After: one
 * card per break of the line, withdrawn on a close back above it, and quiet
 * after the owner's Hold until the line re-arms.
 *
 * Doubled: the database, Alpaca's tape (the fixture's prices and bars), the
 * model (it proposes the sale where production's run did, else holds), the
 * clock and the mail.
 */
import fixture from "./__fixtures__/sale-card-2026-10.json";
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow, type PrismaDouble } from "@/lib/replay";
import { cardLine } from "@/lib/proposals/sale-card";

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
async function month(ticker: "NVDA" | "CEG" | "PLTR", extra: Ev[] = [], base?: Ev[]) {
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
  const answers: Array<Record<string, unknown>> = [];
  const events: Ev[] = [...(base ?? (stock.events as Ev[])), ...extra, ["trail-on", fixture.trail.from] as Ev].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
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
      if (card) {
        const res = await decline(new Request(`http://x/api/proposals/${card.id}/reject`, { method: "POST", body: JSON.stringify(rest[0] ?? {}) }), { params: Promise.resolve({ orderId: card.id }) });
        answers.push((await res.json()) as Record<string, unknown>);
      }
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
    proposals: proposals.map((o) => ({ at: (o.createdAt as Date).toISOString().slice(0, 16), status: o.status, triggerIds: o.triggerIds, expiresAt: o.expiresAt ?? null, withdrawnReason: o.withdrawnReason ?? null })),
    runs: runs.length,
    mornings,
    answers,
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
const NVDA_TRAIL_12 = "f552414c-ff2a-455d-b779-d5401ac9ea98";

jest.setTimeout(120_000);

describe("a trigger's sale card over 2026-10-14 → 11-13", () => {
  it("NVDA: one card for the whole break of $236 (main: 23 proposals, 19 trigger runs); the owner's Hold on 11-03 keeps the floor and the trail quiet while it never closes back above", async () => {
    const r = await month("NVDA");
    expect(r.proposals).toEqual([
      // The floor broke 10-14; the analyst's 12% trail (10-23) and the account's 6% trail (10-28) broke while it waited.
      { at: "2026-10-14T18:01", status: "REJECTED", triggerIds: [FLOOR.NVDA, NVDA_TRAIL_12, TRAIL], expiresAt: null, withdrawnReason: null },
    ]);
    expect(r.runs).toBe(1);
    // The four mornings production proposed it again: the read worked, and with the card open it asked nothing.
    expect(r.mornings).toEqual(["2026-10-19T12:01:00Z", "2026-10-26T12:01:20Z", "2026-10-27T12:02:10Z", "2026-11-02T13:01:45Z"].map((at) => ({ at, ok: true, situations: [] })));
    const held = (r.db.store.thesis[0] as { triggerState: Record<string, { held?: { at: string } }> }).triggerState;
    expect(held[FLOOR.NVDA]?.held?.at).toBe("2026-11-03T14:52:58.000Z");
    expect(held[TRAIL]?.held?.at).toBe("2026-11-03T14:52:58.000Z");
  });

  it("CEG: one card from 10-14, open through 11-13: it never closed back above $287.30, $289.59 or (11-13) $280 (main: 14 proposals)", async () => {
    const r = await month("CEG");
    expect(r.proposals).toEqual([{ at: "2026-10-14T13:45", status: "AWAITING_APPROVAL", triggerIds: [FLOOR.CEG, TRAIL], expiresAt: null, withdrawnReason: null }]);
    expect(r.runs).toBe(1);
  });

  it("PLTR: a card per break, withdrawn on each close back above, the last open on the trail (main: 16 proposals, 23 trigger runs)", async () => {
    const r = await month("PLTR");
    expect(r.proposals).toEqual([
      // Auto-sell at $196 (set 10-23); PLTR closed $196.75.
      { at: "2026-10-23T18:40", status: "WITHDRAWN", triggerIds: [FLOOR.PLTR], expiresAt: null, withdrawnReason: "closed at $196.75, back above $196" },
      // The account's 6% trail ($197.64 off the $210.25 high): closed $198.84, then $198.73.
      { at: "2026-10-26T13:31", status: "WITHDRAWN", triggerIds: [TRAIL], expiresAt: null, withdrawnReason: "closed at $198.84, back above $197.64, 6% off the high" },
      { at: "2026-10-27T14:05", status: "WITHDRAWN", triggerIds: [TRAIL], expiresAt: null, withdrawnReason: "closed at $198.73, back above $197.64, 6% off the high" },
      // Both broke 10-28. It closed back above $196 that day ($196.81) but not above the trail, so the card stayed.
      { at: "2026-10-28T14:10", status: "AWAITING_APPROVAL", triggerIds: [FLOOR.PLTR, TRAIL], expiresAt: null, withdrawnReason: null },
    ]);
    // Six runs on 10-15 → 10-22 held without a sale, as in production; then one per card.
    expect(r.runs).toBe(10);
  });
});

// The same tape, with an answer production never gave: what Hold does from there.
describe("Hold: quiet until the line re-arms, or a new line", () => {
  const state = (r: Awaited<ReturnType<typeof month>>) => (r.db.store.thesis[0] as { triggerState: Record<string, { held?: { at: string } }> }).triggerState ?? {};

  it("PLTR, held at 19:00 on 10-23: the $196.75 close re-arms it, and on 10-28's break it asks again with the trail", async () => {
    const r = await month("PLTR", [["decline", "2026-10-23T19:00:00Z"]]);
    expect(r.proposals[0]).toMatchObject({ at: "2026-10-23T18:40", status: "REJECTED", triggerIds: [FLOOR.PLTR] });
    expect(state(r)[FLOOR.PLTR]?.held).toBeUndefined();
    // Held through 10-28, only the trail could have asked; the card carries the line again.
    expect(r.proposals.at(-1)).toMatchObject({ at: "2026-10-28T14:10", status: "AWAITING_APPROVAL", triggerIds: [FLOOR.PLTR, TRAIL] });
  });

  it("NVDA, the owner moves the floor to $190 on 11-05 after holding at $236: the hold lets go, and the 11-09 break of $190 is a new card", async () => {
    const r = await month("NVDA", [["edit", "2026-11-05T22:00:00Z", FLOOR.NVDA, { value: 190 }]]);
    expect(r.proposals.map((p) => [p.at, p.status, p.triggerIds])).toEqual([
      ["2026-10-14T18:01", "REJECTED", [FLOOR.NVDA, NVDA_TRAIL_12, TRAIL]],
      // 11-06 traded $193.66, above the new line; 11-09 $173.04. The trail stays held: its line didn't move.
      ["2026-11-09T14:30", "AWAITING_APPROVAL", [FLOOR.NVDA]],
    ]);
    expect(state(r)[TRAIL]?.held?.at).toBe("2026-11-03T14:52:58.000Z");
  });
});

// The card's second answer: Hold with a new line, one request through the decline route.
describe("Hold with a new line (the card)", () => {
  it("NVDA, held on 11-03 with a new line at $190: the floor becomes $190 at once, the trail stays held, and 11-09's break of $190 is a new card", async () => {
    const line = { watch: "price", is: "below", value: 190 };
    const events = (fixture.stocks.NVDA.events as Ev[]).filter((e) => e[0] !== "decline");
    const r = await month("NVDA", [["decline", "2026-11-03T14:52:58Z", { line }]], events);
    expect(r.answers[0]).toMatchObject({ ok: true, line: { id: FLOOR.NVDA, predicate: line, fireMode: "ASK_NOW", source: "PRINCIPAL" } });
    expect(r.answers[0].lineError).toBeUndefined();
    expect(r.proposals.map((p) => [p.at, p.status, p.triggerIds])).toEqual([
      ["2026-10-14T18:01", "REJECTED", [FLOOR.NVDA, NVDA_TRAIL_12, TRAIL]],
      ["2026-11-09T14:30", "AWAITING_APPROVAL", [FLOOR.NVDA]],
    ]);
    const state = (r.db.store.thesis[0] as { triggerState: Record<string, { held?: unknown }> }).triggerState;
    expect(state[FLOOR.NVDA]?.held).toBeUndefined();
    expect(state[TRAIL]?.held).toBeDefined();
  });
});

describe("the card's line, as it reads now", () => {
  it("a sell line is its level; a trail is its level off the tracked high; a trigger no longer on the stock is skipped", () => {
    const floor = { id: "f", action: "EXIT", predicate: { watch: "price", is: "below", value: 236 }, rationale: "" } as never;
    const trail = { id: "t", action: "EXIT", predicate: { watch: "move", is: "below", value: 6, variable: "peak" }, rationale: "" } as never;
    expect(cardLine([floor, trail], ["gone", "f"], { peak: 242.505, direction: "LONG" })).toEqual({ price: 236, sentence: "Sell if below $236" });
    expect(cardLine([floor, trail], ["t"], { peak: 210.25, direction: "LONG" })).toEqual({ price: 197.64, sentence: expect.stringContaining("6%") });
    expect(cardLine([floor], ["gone"], { peak: null, direction: "LONG" })).toBeNull();
  });
});
