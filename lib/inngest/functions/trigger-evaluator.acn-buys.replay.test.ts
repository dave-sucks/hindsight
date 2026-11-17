/**
 * ACN, Secular Compounder, 2026-11-17: a buy that is true now and never fired fires on the first
 * check, once; it fires again only after a close below the 50-day and a check back above it. Two
 * buys true on one pass wake one trigger run.
 *
 * The Writer minted ACN at 05:02 ET with one buy of three conditions joined by "or" (a close above
 * the $271.76 pivot on 1.5× volume, within 2% of the 50-day, above the 50-day). ACN closed $247.70 on
 * 11-16, above its $217.91 50-day: under the crossing rule (deleted) that buy could not fire, because
 * it was already true at the prior close. The 2026-11-21 migration splits the "or" into three buys.
 *
 * The evaluator's own cron handler, on one database, with the rows as the migration leaves them
 * (its dry run on a copy of production) and the 11-16 snapshot. lib/agent/__fixtures__/acn-buys-2026-11-17.json.
 */
import raw from "@/lib/agent/__fixtures__/acn-buys-2026-11-17.json";
import { prismaDouble, thesisRow, agentConfigRow, accountRow, REPLAY_ACCOUNT_ID, type PrismaDouble } from "@/lib/replay";
import { shapeOf } from "@/lib/agent/triggers/condition";
import type { IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";

type Row = Record<string, unknown>;
const fx = raw as unknown as {
  thesis: Row & { id: string; createdAt: string };
  analyst: { id: string; name: string };
  stored: Array<Row & { id: string; action: string; predicate: unknown }>;
  migrated: Array<Row & { id: string; action: string; predicate: unknown }>;
  snapshot: IndicatorSnapshot;
};
const CLOSE_1116 = fx.snapshot.closes.at(-1)!;
const BUYS = fx.migrated.filter((t) => t.action === "ENTER");
const [PIVOT_BUY, NEAR_50_BUY, ABOVE_50_BUY] = BUYS;

function book(): PrismaDouble {
  return prismaDouble({
    thesis: [
      thesisRow({
        ...fx.thesis,
        createdAt: new Date(fx.thesis.createdAt + "Z"),
        triggers: fx.migrated,
        researchRun: { agentConfigId: fx.analyst.id, agentConfig: { name: fx.analyst.name, setupIds: [], enabled: true } },
      }),
    ],
    agentConfig: [agentConfigRow({ id: fx.analyst.id, accountId: REPLAY_ACCOUNT_ID, triggers: [], enabled: true })],
    // Seeded with no rules, so only the stock's own triggers are checked.
    account: [accountRow({ triggers: [], triggersSeededAt: new Date("2026-09-01T00:00:00Z") })],
  });
}

/** One five-minute pass at `at` with ACN at `price`. Returns the events sent. */
async function check(db: PrismaDouble, at: Date, price: number): Promise<Row[]> {
  const sent: Row[] = [];
  jest.useFakeTimers({
    now: at,
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  try {
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<Row>) | undefined;
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn() } }));
      jest.doMock("@/lib/agent/research-helpers", () => ({
        finnhub: async (path: string) =>
          path.startsWith("/quote?symbol=ACN")
            ? { data: { c: price, pc: CLOSE_1116, o: CLOSE_1116, dp: ((price - CLOSE_1116) / CLOSE_1116) * 100, t: Math.floor(at.getTime() / 1000) } }
            : { data: null },
      }));
      jest.doMock("@/lib/alpaca", () => ({ getTodaySessionBars: async () => ({ ACN: { close: price, high: price, low: price, volume: 1_000_000 } }) }));
      jest.doMock("@/lib/market-data/ensure-snapshots", () => ({ ensureIndicatorSnapshots: async () => new Map([["ACN", fx.snapshot]]) }));
      jest.doMock("@/lib/agent/triggers/earnings", () => ({ ...jest.requireActual("@/lib/agent/triggers/earnings"), fetchEarningsWindow: async () => ({ reported: new Map(), upcoming: new Map() }) }));
      jest.doMock("@/lib/market-data/sec-filings", () => ({ ...jest.requireActual("@/lib/market-data/sec-filings"), fetchBookFilings: async () => ({ byTicker: new Map() }) }));
      await import("@/lib/inngest/functions/trigger-evaluator");
      await handler!({ step: { run: async (_n: string, fn: () => Promise<unknown>) => fn(), sendEvent: async (_id: string, e: { data: Row }) => void sent.push(e.data) } });
    });
  } finally {
    jest.useRealTimers();
  }
  return sent;
}

const TUESDAY_0935 = new Date("2026-11-18T14:35:00Z");

describe("the fixture is the production case", () => {
  it("stored: one buy, its three conditions joined by 'or', which no longer reads as a condition", () => {
    const buy = fx.stored.find((t) => t.action === "ENTER")!;
    expect((buy.predicate as { match: string }).match).toBe("any");
    expect(shapeOf(buy.predicate)).toBeNull();
  });

  it("migrated: three buys, each its own condition, with the stored buy's mode and mark, and no wait", () => {
    expect(BUYS.map((t) => t.predicate)).toEqual([
      { match: "all", conditions: [{ is: "above", value: 271.76, watch: "price", settings: { close: true } }, { value: 1.5, watch: "volume" }] },
      { is: "near", value: 2, watch: "move", variable: "sma50" },
      { is: "above", watch: "price", variable: "sma50" },
    ]);
    for (const t of BUYS) expect(t).toMatchObject({ fireMode: "ASK_NOW", playbook: "WATCH", source: "AGENT"});
    for (const t of fx.migrated) expect(t).not.toHaveProperty("cooldownDays");
    expect(new Set(BUYS.map((t) => t.id)).size).toBe(3);
  });
});

describe("ACN, the first check after the deploy", () => {
  it("at the 11-16 close, $247.70, the buy above the 50-day fires on the first check", async () => {
    const sent = await check(book(), TUESDAY_0935, CLOSE_1116);
    expect(sent).toEqual([expect.objectContaining({ triggerId: ABOVE_50_BUY.id, action: "ENTER", firedPrice: CLOSE_1116 })]);
    expect(sent[0].coFired).toBeUndefined();
  });

  it("…once fired, it does not fire again while ACN stays above the 50-day: not the next check, not the next day", async () => {
    const db = book();
    await check(db, TUESDAY_0935, CLOSE_1116);
    expect(await check(db, new Date(TUESDAY_0935.getTime() + 5 * 60_000), CLOSE_1116 + 1)).toEqual([]);
    // Tuesday closes $249.10, still above the 50-day: not ready.
    expect(await check(db, new Date("2026-11-18T21:20:05Z"), 249.1)).toEqual([]);
    expect(await check(db, new Date("2026-11-19T14:35:00Z"), 251.3)).toEqual([]);
  });

  it("…and again after a close below the 50-day ($215 against $217.91) and a check back above it", async () => {
    const db = book();
    await check(db, TUESDAY_0935, CLOSE_1116);
    expect(await check(db, new Date("2026-11-18T21:20:05Z"), 215)).toEqual([]);
    const buy = (db.store.thesis[0].triggers as Array<{ id: string; falseAtCloseAt?: string }>).find((t) => t.id === ABOVE_50_BUY.id)!;
    expect(buy.falseAtCloseAt).toBe("2026-11-18T21:20:05.000Z");
    // Under the 50-day the next morning: nothing.
    expect(await check(db, new Date("2026-11-19T14:35:00Z"), 210)).toEqual([]);
    // Back above it (5% over, so the near-the-50-day buy is false): the buy fires.
    const sent = await check(db, new Date("2026-11-19T16:05:00Z"), 229.5);
    expect(sent).toEqual([expect.objectContaining({ triggerId: ABOVE_50_BUY.id, action: "ENTER", firedPrice: 229.5 })]);
  });

  it("at $220, within 2% of the 50-day and above it: two buys true on one pass wake one run, carrying the other", async () => {
    const sent = await check(book(), TUESDAY_0935, 220);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ triggerId: NEAR_50_BUY.id, action: "ENTER", coFired: [{ triggerId: ABOVE_50_BUY.id }] });
    expect(sent.some((e) => e.triggerId === PIVOT_BUY.id)).toBe(false);
  });
});
