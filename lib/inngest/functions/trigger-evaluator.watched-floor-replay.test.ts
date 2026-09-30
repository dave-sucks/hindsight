/**
 * trigger-evaluator.watched-floor-replay.test.ts — a watched stock's plan
 * comes down on a close below its floor, never a morning dip (DAV-337).
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
 * found them (lib/agent/__fixtures__/trv-watched-floor-2026-09-29.json), at
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

interface Tick {
  db: PrismaDouble;
  sent: Array<{ name: string; data: Record<string, unknown> }>;
  result: Record<string, unknown>;
}

/**
 * One pass of the trigger check at `at`, with TRV at `price` (the live quote;
 * on the close pass, the day's close as well).
 */
async function tick(at: Date, price: number, opts: { held?: boolean } = {}): Promise<Tick> {
  const triggers = opts.held ? fx.thesisBefore.triggers.filter((t) => t.action !== "ENTER") : fx.thesisBefore.triggers;
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
    position: opts.held
      ? [positionRow({ analystId: fx.analyst.id, symbol: "TRV", avgCost: 372.51, peakPrice: 372.51, openedAt: new Date("2026-09-28T14:00:00Z") })]
      : [],
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
                  pc: PRIOR_CLOSE,
                  o: fx.setDown.price,
                  dp: ((price - PRIOR_CLOSE) / PRIOR_CLOSE) * 100,
                  t: Math.floor(at.getTime() / 1000),
                },
              }
            : { data: null },
      }));
      jest.doMock("@/lib/alpaca", () => ({
        getTodaySessionBars: async () => ({ TRV: { close: price, high: 363.83, low: fx.setDown.price, volume: 1_500_000 } }),
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

  it("the 16:20 close pass sets the plan down when the day closes below the floor, and says it closed there", async () => {
    const t = await tick(CLOSE_PASS, 358.9);
    expect(t.result).toMatchObject({ session: "CLOSE" });
    const rows = audit(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "TRIGGER_FIRED",
      triggerId: fx.setDown.triggerId,
      priceAtTime: 358.9,
      summary: "TRV plan set down — it closed below the $359.87 floor before we ever bought it, so the plan's premise is gone.",
    });
    // The same three the 09:30 set-down removed; the four reviews stay.
    expect(idsOf(t).some((id) => PLAN_IDS.includes(id))).toBe(false);
    expect(idsOf(t)).toHaveLength(fx.thesisBefore.triggers.length - PLAN_IDS.length);
    expect(trv(t)).toMatchObject({ status: "WATCHING", entryPrice: null, targetPrice: null, stopLoss: null });
    expect(t.sent).toEqual([]);
  });

  it("on a stock we hold, the same floor is a sale and still fires intraday", async () => {
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
