/**
 * trigger-evaluator.watched-floor-replay.test.ts — a watched stock's Stop
 * watching line ("Stop watching if below $359.87 · only on the close") ends
 * the watch on a close below it, never a morning dip (DAV-337), and retires
 * the thesis as dropped. The timing is the line's own saved setting: nothing
 * reads it on the close at check time, so one saved intraday fires intraday.
 *
 * TRV, Secular Compounder. Plan written 23:02 ET on 2026-09-28: buy $372.51
 * on the reclaim of the 50-day, floor $359.87, target $425. The floor sat
 * 0.9% under the $363.16 close. At 09:30:27 ET on 09-29 TRV opened at
 * $359.51, the five-minute check set the plan down ("the floor broke before
 * we ever bought it"), and TRV traded back to $363.83 that morning. The plan
 * was gone before its buy could ever fire.
 *
 * This runs the evaluator's own cron handler — the real ladder resolution,
 * the real check, the real set-down write — against TRV's rows as that tick
 * found them (lib/agent/__fixtures__/trv-watched-floor-2026-09-29.json), its
 * floor stored as the 2026-11-16 migration stores it (STOP_WATCHING, on the close), at
 * the real times. Only the edges are doubled: the database, the quote, the
 * day's bar, the earnings calendar, the SEC read and the chart snapshot.
 */
import raw from "@/lib/agent/__fixtures__/trv-watched-floor-2026-09-29.json";
import {
  prismaDouble,
  thesisRow,
  agentConfigRow,
  accountRow,
  positionRow,
  REPLAY_ACCOUNT_ID,
  type PrismaDouble,
} from "@/lib/replay";

type Trig = { id: string; action: string; predicate: Record<string, unknown> };
const fx = raw as unknown as {
  thesisBefore: Record<string, unknown> & { id: string; createdAt: string; triggers: Trig[] };
  analyst: { id: string; name: string; setupIds: string[]; triggers: unknown[] };
  account: { triggers: unknown[]; triggersSeededAt: string };
  setDown: { at: string; price: number; triggerId: string; summary: string; removed: Array<{ id: string; text: string }> };
};

/** TRV's 09-28 close — the mint's own data block and the ticket. */
const PRIOR_CLOSE = 363.16;
const TICK_0930 = new Date(fx.setDown.at); // 09:30:27 ET, when production set the plan down
const CLOSE_PASS = new Date("2026-09-29T20:20:00Z"); // 16:20 ET
const PLAN_IDS = fx.setDown.removed.map((r) => r.id); // buy, floor, target

/** TRV's triggers as the migration stores a watch's: its floor (a sale, in the fixture) becomes its Stop watching line, on the close unless `close` is false. */
const watched = (close = true): Trig[] =>
  fx.thesisBefore.triggers.map((t) => (t.action === "EXIT" ? { ...t, action: "STOP_WATCHING", predicate: { ...t.predicate, ...(close ? { settings: { close: true } } : {}) } } : t));

interface Tick {
  db: PrismaDouble;
  sent: Array<{ name: string; data: Record<string, unknown> }>;
  result: Record<string, unknown>;
}

/**
 * One pass of the trigger check at `at`, with TRV at `price` (the live quote;
 * on the close pass, the day's close as well).
 */
async function tick(
  at: Date,
  price: number,
  opts: { held?: boolean; triggers?: Trig[]; prior?: number; order?: Record<string, unknown>[]; position?: Record<string, unknown>[] } = {},
): Promise<Tick> {
  // Held: the buy is gone and the floor is the holding's sale, as the fill writes it.
  const triggers = opts.triggers ?? (opts.held ? fx.thesisBefore.triggers.filter((t) => t.action !== "ENTER") : watched());
  const prior = opts.prior ?? PRIOR_CLOSE;
  const db = prismaDouble({
    thesis: [
      thesisRow({
        ...fx.thesisBefore,
        status: opts.held ? "HOLDING" : "WATCHING",
        triggers,
        createdAt: new Date(fx.thesisBefore.createdAt),
        researchRun: {
          agentConfigId: fx.analyst.id,
          agentConfig: { name: fx.analyst.name, setupIds: fx.analyst.setupIds, enabled: true },
        },
      }),
    ],
    agentConfig: [agentConfigRow({ id: fx.analyst.id, accountId: REPLAY_ACCOUNT_ID, triggers: fx.analyst.triggers, enabled: true })],
    account: [accountRow({ triggers: fx.account.triggers, triggersSeededAt: new Date(fx.account.triggersSeededAt) })],
    position: opts.position ?? (opts.held
      ? [positionRow({ analystId: fx.analyst.id, symbol: "TRV", avgCost: 372.51, peakPrice: 372.51, openedAt: new Date("2026-09-28T14:00:00Z") })]
      : []),
    ...(opts.order ? { order: opts.order } : {}),
  });
  const sent: Tick["sent"] = [];
  let result: Record<string, unknown> = {};

  // Only the clock is faked; timers and microtasks run for real.
  jest.useFakeTimers({
    now: at,
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  try {
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<Record<string, unknown>>) | undefined;
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => ({
        inngest: {
          createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => {
            handler = fn;
            return {};
          },
          send: jest.fn(),
        },
      }));
      jest.doMock("@/lib/agent/research-helpers", () => ({
        finnhub: async (path: string) =>
          path.startsWith("/quote?symbol=TRV")
            ? {
                data: {
                  c: price,
                  pc: prior,
                  o: opts.prior ? prior : fx.setDown.price,
                  dp: ((price - prior) / prior) * 100,
                  t: Math.floor(at.getTime() / 1000),
                },
              }
            : { data: null },
      }));
      jest.doMock("@/lib/alpaca", () => ({
        getTodaySessionBars: async () => ({ TRV: { close: price, high: opts.prior ? prior : 363.83, low: opts.prior ? price : fx.setDown.price, volume: 1_500_000 } }),
      }));
      jest.doMock("@/lib/market-data/ensure-snapshots", () => ({ ensureIndicatorSnapshots: async () => new Map() }));
      jest.doMock("@/lib/agent/triggers/earnings", () => ({
        ...jest.requireActual("@/lib/agent/triggers/earnings"),
        fetchEarningsWindow: async () => ({ reported: new Map(), upcoming: new Map() }),
      }));
      jest.doMock("@/lib/market-data/sec-filings", () => ({
        ...jest.requireActual("@/lib/market-data/sec-filings"),
        fetchBookFilings: async () => ({ byTicker: new Map() }),
      }));
      await import("@/lib/inngest/functions/trigger-evaluator");
      result = await handler!({
        step: {
          run: async (_name: string, fn: () => Promise<unknown>) => fn(),
          sendEvent: async (_id: string, e: Tick["sent"][number]) => {
            sent.push(e);
          },
        },
      });
    });
  } finally {
    jest.useRealTimers();
  }
  return { db, sent, result };
}

const trv = (t: Tick) => (t.db.store.thesis as Array<Record<string, unknown>>)[0];
const idsOf = (t: Tick) => (trv(t).triggers as Trig[]).map((x) => x.id);
const audit = (t: Tick) => (t.db.store.thesisUpdate ?? []) as Array<Record<string, unknown>>;

describe("TRV 2026-09-29 — a watched plan and a floor just under the price", () => {
  it("the 09:30 open at $359.51, under the $359.87 floor, does not set the plan down", async () => {
    const t = await tick(TICK_0930, fx.setDown.price);
    expect(t.result).toMatchObject({ session: "INTRADAY" });
    // On main this tick wrote production's row — "TRV plan set down — the
    // floor broke before we ever bought it" — and removed all three.
    expect(audit(t)).toEqual([]);
    expect(idsOf(t)).toEqual(expect.arrayContaining(PLAN_IDS));
    expect(trv(t)).toMatchObject({ entryPrice: 372.51, targetPrice: 425, stopLoss: 359.87 });
    expect(t.sent).toEqual([]);
  });

  it("the 16:20 close pass keeps the plan when the day closes back above the floor", async () => {
    const t = await tick(CLOSE_PASS, 362.34);
    expect(t.result).toMatchObject({ session: "CLOSE" });
    expect(audit(t)).toEqual([]);
    expect(idsOf(t)).toEqual(expect.arrayContaining(PLAN_IDS));
  });

  it("the 16:20 close pass stops watching when the day closes below the line: retired as dropped, one Activity line, no run", async () => {
    const t = await tick(CLOSE_PASS, 358.9);
    expect(t.result).toMatchObject({ session: "CLOSE" });
    const rows = audit(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "TRIGGER_FIRED",
      triggerId: fx.setDown.triggerId,
      triggerAction: "STOP_WATCHING",
      priceAtTime: 358.9,
      summary: "Stop watching if below $359.87 · only on the close",
      fieldChanges: { status: { from: "WATCHING", to: "RETIRED" }, retiredReason: { from: null, to: "DROPPED" } },
    });
    expect(trv(t)).toMatchObject({ status: "RETIRED", retiredReason: "DROPPED", closeReason: "Stop watching if below $359.87 · only on the close" });
    // Nothing is taken off the stock and nothing is stamped on it: its triggers are as they were.
    expect(idsOf(t)).toEqual(fx.thesisBefore.triggers.map((x) => x.id));
    expect((trv(t).triggers as Trig[]).find((x) => x.id === fx.setDown.triggerId)?.action).toBe("STOP_WATCHING");
    // No run and no approval: no money moves.
    expect(t.sent).toEqual([]);
    expect(t.db.store.order ?? []).toEqual([]);
  });

  it("a Stop watching line saved intraday fires intraday: the 09:30 dip retires the watch, because that is what it says", async () => {
    const t = await tick(TICK_0930, fx.setDown.price, { triggers: watched(false) });
    expect(t.result).toMatchObject({ session: "INTRADAY" });
    expect(audit(t)).toEqual([expect.objectContaining({ type: "TRIGGER_FIRED", triggerAction: "STOP_WATCHING", summary: "Stop watching if below $359.87" })]);
    expect(trv(t)).toMatchObject({ status: "RETIRED", retiredReason: "DROPPED" });
    expect(t.sent).toEqual([]);
  });

  it("on a stock we hold, its sale is a Sell line and fires intraday", async () => {
    const t = await tick(TICK_0930, fx.setDown.price, { held: true });
    expect(t.sent).toEqual([
      expect.objectContaining({
        name: "app/thesis.trigger.fired",
        data: expect.objectContaining({ triggerId: fx.setDown.triggerId, action: "EXIT", firedPrice: fx.setDown.price }),
      }),
    ]);
    expect(trv(t)).toMatchObject({ status: "HOLDING", stopLoss: 359.87 });
    expect(audit(t)).toEqual([]);
  });
});

/**
 * A pullback buy waiting for approval when the watch ends. The buy ("below
 * $100") is still true at an $89 close, so the close pass keeps its proposal
 * (withdrawOnTheClose); the $90 Stop watching line closes below, the watch retires, and
 * the waiting buy goes with it: WITHDRAWN, its staged position CANCELLED.
 */
describe("a buy waiting for approval when its watch ends", () => {
  const BUY = { id: "buy-100", action: "ENTER", predicate: { watch: "price", is: "below", value: 100 }, rationale: "I buy the pullback to $100." };
  const LINE = { id: "line-90", action: "STOP_WATCHING", predicate: { watch: "price", is: "below", value: 90, settings: { close: true } }, rationale: "Below $90 the base has failed." };
  const waiting = {
    order: [{ id: "ord-buy", userId: REPLAY_ACCOUNT_ID, positionId: "pos-buy", thesisId: fx.thesisBefore.id, symbol: "TRV", side: "BUY", intent: "OPEN", status: "AWAITING_APPROVAL", triggerIds: [BUY.id], quantity: 10, orderType: "MARKET", createdAt: new Date("2026-09-29T15:00:00Z") }],
    position: [positionRow({ id: "pos-buy", analystId: fx.analyst.id, symbol: "TRV", status: "PENDING_APPROVAL", avgCost: 99, quantity: 10 })],
  };

  it("the $89 close below the $90 line retires the watch and withdraws the waiting buy, in the same pass", async () => {
    const t = await tick(CLOSE_PASS, 89, { triggers: [BUY, LINE], prior: 95, ...waiting });
    expect(trv(t)).toMatchObject({ status: "RETIRED", retiredReason: "DROPPED" });
    const order = (t.db.store.order as Array<Record<string, unknown>>)[0];
    expect(order).toMatchObject({ status: "WITHDRAWN", withdrawnReason: "Stop watching if below $90 · only on the close" });
    expect((t.db.store.position as Array<Record<string, unknown>>)[0]).toMatchObject({ status: "CANCELLED", closeReason: "MANUAL" });
    expect(t.sent).toEqual([]);
  });

  it("a close above the line keeps the watch and the waiting buy", async () => {
    const t = await tick(CLOSE_PASS, 92, { triggers: [BUY, LINE], prior: 95, ...waiting });
    expect(trv(t)).toMatchObject({ status: "WATCHING" });
    expect((t.db.store.order as Array<Record<string, unknown>>)[0]).toMatchObject({ status: "AWAITING_APPROVAL" });
    expect((t.db.store.position as Array<Record<string, unknown>>)[0]).toMatchObject({ status: "PENDING_APPROVAL" });
  });
});
