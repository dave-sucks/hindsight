/**
 * trigger-evaluator.wobble-pass-replay.test.ts — a buy fires when it is true,
 * then waits the day saved on it (2026-11-17: the crossing rule and the buy
 * re-arm are deleted; the wait is the only thing that stops a repeat).
 *
 * AAPL, Secular Compounder, 2026-09-30. At 09:30:22 ET the 5-minute check
 * fired the buy above $331 at $331.47. Twenty seconds later the trigger run
 * (cmuo57v4i000804jt4sad97p2) read $330.83 and passed. AAPL closed $333.02.
 * Under the crossing rule the buy could never fire again: every later prior
 * close sat above $331. Now it fires the next day it is true once its day is
 * up: 2026-10-01, the 09:40 check, $331.64 (the 09:40 bar's open, sip).
 *
 * Replayed through the evaluator's own cron handler on one database. AAPL's
 * row, its analyst's and account's rules, the run's rows and the tape (Alpaca,
 * sip) are in lib/agent/__fixtures__/aapl-wobble-pass-2026-09-30.json.
 */
import raw from "@/lib/agent/__fixtures__/aapl-wobble-pass-2026-09-30.json";
import { prismaDouble, thesisRow, agentConfigRow, accountRow, REPLAY_ACCOUNT_ID, type PrismaDouble } from "@/lib/replay";
import type { Trigger } from "@/lib/agent/triggers/types";

type Row = Record<string, unknown>;
const fx = raw as unknown as {
  thesisBefore: Row & { id: string; createdAt: string; triggers: Trigger[] };
  firedAt: string;
  analyst: { id: string; name: string; setupIds: string[]; triggers: unknown[] };
  account: { triggers: unknown[]; triggersSeededAt: string };
  run: { id: string; createdAt: string };
  runRows: Array<Row & { type: string; triggerId: string | null; priceAtTime: number; timestamp: string; rationale: string }>;
  tape: { priorClose: number; dayOpen: number; fire: { at: string; price: number }; nextCheck: { at: string; price: number } };
};

const BUY = fx.thesisBefore.triggers.find((t) => t.action === "ENTER")!;
const PASS = fx.runRows.find((r) => r.type !== "TRIGGER_FIRED")!;

function book(): PrismaDouble {
  return prismaDouble({
    thesis: [
      thesisRow({
        ...fx.thesisBefore,
        createdAt: new Date(fx.thesisBefore.createdAt),
        researchRun: {
          agentConfigId: fx.analyst.id,
          agentConfig: { name: fx.analyst.name, setupIds: fx.analyst.setupIds, enabled: true },
        },
      }),
    ],
    agentConfig: [
      agentConfigRow({ id: fx.analyst.id, accountId: REPLAY_ACCOUNT_ID, triggers: fx.analyst.triggers, enabled: true }),
    ],
    account: [accountRow({ triggers: fx.account.triggers, triggersSeededAt: new Date(fx.account.triggersSeededAt) })],
  });
}

const fakeClock = (at: Date) =>
  jest.useFakeTimers({
    now: at,
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });

/** One pass of the 5-minute check at `at`, with AAPL at `price`. Returns the fires it sent. */
async function check(db: PrismaDouble, at: Date, price: number, day = { priorClose: fx.tape.priorClose, open: fx.tape.dayOpen }): Promise<Array<{ data: Row }>> {
  const sent: Array<{ data: Row }> = [];
  fakeClock(at);
  try {
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<Row>) | undefined;
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
          path.startsWith("/quote?symbol=AAPL")
            ? {
                data: {
                  c: price,
                  pc: day.priorClose,
                  o: day.open,
                  dp: ((price - day.priorClose) / day.priorClose) * 100,
                  t: Math.floor(at.getTime() / 1000),
                },
              }
            : { data: null },
      }));
      jest.doMock("@/lib/alpaca", () => ({
        getTodaySessionBars: async () => ({ AAPL: { close: price, high: price, low: day.open, volume: 5_000_000 } }),
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
      await handler!({
        step: {
          run: async (_name: string, fn: () => Promise<unknown>) => fn(),
          sendEvent: async (_id: string, e: { data: Row }) => void sent.push(e),
        },
      });
    });
  } finally {
    jest.useRealTimers();
  }
  return sent.filter((e) => e.data.triggerId === BUY.id);
}

const FIRE_AT = new Date(fx.tape.fire.at);
const NEXT_CHECK = new Date(fx.tape.nextCheck.at);
/** 2026-10-01, Alpaca sip: the prior close (09-30's) and the open, and the 09:40 check. */
const OCT_1 = { priorClose: 333.02, open: 330 };
const OCT_1_0940 = { at: new Date("2026-10-01T13:40:20Z"), price: 331.64 };

describe("the fixture is the production case", () => {
  it("the buy fired at $331.47, the run passed at $330.83, and the price was $332.42 at the next check", () => {
    expect(BUY).toMatchObject({ action: "ENTER", predicate: { watch: "price", is: "above", value: 331 }, cooldownDays: 1 });
    expect(fx.tape.fire.price).toBeCloseTo(331.47, 2);
    expect(PASS).toMatchObject({ triggerId: BUY.id, priceAtTime: 330.83 });
    expect(fx.tape.nextCheck.price).toBeGreaterThan(331);
  });
});

describe("AAPL 2026-09-30 — the buy fires when it is true, then waits its day", () => {
  it("fires at 09:30 at $331.47; the 09:35 check at $332.42 sends nothing, its day isn't up", async () => {
    const db = book();
    expect(await check(db, FIRE_AT, fx.tape.fire.price)).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ action: "ENTER", firedPrice: fx.tape.fire.price }) }),
    ]);
    expect(await check(db, NEXT_CHECK, fx.tape.nextCheck.price)).toEqual([]);
  });

  it("fires again on 10-01 at 09:40 at $331.64, though the prior close ($333.02) was already above $331", async () => {
    const db = book();
    await check(db, FIRE_AT, fx.tape.fire.price);
    const refire = await check(db, OCT_1_0940.at, OCT_1_0940.price, OCT_1);
    expect(refire).toEqual([expect.objectContaining({ data: expect.objectContaining({ action: "ENTER", firedPrice: OCT_1_0940.price }) })]);
    const buy = (db.store.thesis[0].triggers as Trigger[]).find((t) => t.id === BUY.id)!;
    expect(buy.lastFiredAt).toBe(OCT_1_0940.at.toISOString());
  });

  it("under $331 the next day, nothing fires", async () => {
    const db = book();
    await check(db, FIRE_AT, fx.tape.fire.price);
    expect(await check(db, new Date("2026-10-01T13:35:20Z"), 330.9, OCT_1)).toEqual([]);
  });
});
