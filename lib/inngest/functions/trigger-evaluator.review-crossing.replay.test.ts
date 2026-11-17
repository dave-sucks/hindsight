/**
 * A review fires on the crossing of its level, as a buy does: true now, false at the prior close.
 *
 * MU, Secular Compounder: "Review if below $878" (stored REVIEW, Flag for Review) fired on 14 of the
 * 21 sessions from 2026-10-16 to 11-13, every day MU traded under $878. It crossed on 4 of them.
 * ASML, the Compounder's "Review if below the 200-day average": 4 weekly fires from 10-22, 2 of them
 * crossings. NVDA's "Review every 7 days" reads no price and fires as it did.
 *
 * The evaluator's own cron handler, on one database, at each real fire's time, with that fire's live
 * price and the prior session's close. Rows in lib/agent/__fixtures__/review-crossing-2026-11.json.
 */
import raw from "@/lib/agent/__fixtures__/review-crossing-2026-11.json";
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow, REPLAY_ACCOUNT_ID, type PrismaDouble } from "@/lib/replay";
import type { IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";

type Row = Record<string, unknown>;
type Fire = { at: string; price: number; held?: boolean };
const fx = raw as unknown as {
  mu: { thesis: Row & { id: string; createdAt: string }; analyst: { id: string; name: string }; position: { avgCost: number; openedAt: string }; review: Row & { id: string }; closes: Record<string, number>; fires: Fire[] };
  asml: { thesis: Row & { id: string; createdAt: string }; position: { avgCost: number; openedAt: string }; rule: Row & { id: string }; fires: Fire[]; snapshots: Record<string, IndicatorSnapshot> };
  nvda: { thesis: Row & { id: string; createdAt: string; lastReviewedAt: string }; clock: Row & { id: string } };
};
const ANALYST = fx.mu.analyst;
const etDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const before = (days: string[], day: string) => days.filter((d) => d < day).sort().at(-1)!;

function book(thesis: Row, opts: { triggers?: Row[]; analystTriggers?: Row[]; position?: Row } = {}): PrismaDouble {
  return prismaDouble({
    thesis: [
      thesisRow({
        ...thesis,
        createdAt: new Date(thesis.createdAt as string),
        ...(thesis.lastReviewedAt ? { lastReviewedAt: new Date(thesis.lastReviewedAt as string) } : {}),
        triggers: opts.triggers ?? [],
        researchRun: { agentConfigId: ANALYST.id, agentConfig: { name: ANALYST.name, setupIds: [], enabled: true } },
      }),
    ],
    agentConfig: [agentConfigRow({ id: ANALYST.id, accountId: REPLAY_ACCOUNT_ID, triggers: opts.analystTriggers ?? [], enabled: true })],
    // Seeded with no rules, so only the trigger under test is checked.
    account: [accountRow({ triggers: [], triggersSeededAt: new Date("2026-09-01T00:00:00Z") })],
    position: opts.position ? [positionRow({ analystId: ANALYST.id, ...opts.position })] : [],
  });
}

/** One pass of the five-minute check at `at`: `ticker` at `price`, `prevClose` the prior session's close. Returns the trigger ids written down as fired. */
async function check(db: PrismaDouble, at: Date, ticker: string, price: number, prevClose: number, snapshot?: IndicatorSnapshot): Promise<string[]> {
  const firedBefore = new Set(((db.store.thesisUpdate ?? []) as Row[]).map((r) => r.id));
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
          path.startsWith(`/quote?symbol=${ticker}`)
            ? { data: { c: price, pc: prevClose, o: prevClose, dp: ((price - prevClose) / prevClose) * 100, t: Math.floor(at.getTime() / 1000) } }
            : { data: null },
      }));
      jest.doMock("@/lib/alpaca", () => ({ getTodaySessionBars: async () => ({ [ticker]: { close: price, high: price, low: price, volume: 5_000_000 } }) }));
      jest.doMock("@/lib/market-data/ensure-snapshots", () => ({ ensureIndicatorSnapshots: async () => new Map(snapshot ? [[ticker, snapshot]] : []) }));
      jest.doMock("@/lib/agent/triggers/earnings", () => ({ ...jest.requireActual("@/lib/agent/triggers/earnings"), fetchEarningsWindow: async () => ({ reported: new Map(), upcoming: new Map() }) }));
      jest.doMock("@/lib/market-data/sec-filings", () => ({ ...jest.requireActual("@/lib/market-data/sec-filings"), fetchBookFilings: async () => ({ byTicker: new Map() }) }));
      await import("@/lib/inngest/functions/trigger-evaluator");
      await handler!({ step: { run: async (_n: string, fn: () => Promise<unknown>) => fn(), sendEvent: async () => undefined } });
    });
  } finally {
    jest.useRealTimers();
  }
  return ((db.store.thesisUpdate ?? []) as Row[]).filter((r) => r.type === "TRIGGER_FIRED" && !firedBefore.has(r.id)).map((r) => r.triggerId as string);
}

describe("the fixture is the production case", () => {
  it("MU's review is the stored $878 line, its 14 fires and the closes from 10-15 to 11-12", () => {
    expect(fx.mu.review).toMatchObject({ action: "REVIEW", fireMode: "NEXT_MORNING", predicate: { watch: "price", is: "below", value: 878 }, cooldownDays: 1 });
    expect(Object.values(fx.mu.closes)).toEqual([931.24, 878.84, 904.9, 896.07, 913.67, 856.49, 877.55, 903.7, 928.76, 983.23, 934.27, 884.74, 833.59, 855.1, 795.23, 656.39, 690, 733.15, 725.11, 811.3, 798.44]);
    expect(fx.mu.fires.map((f) => etDay(new Date(f.at)))).toEqual([
      "2026-10-16", "2026-10-22", "2026-10-23", "2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04",
      "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13",
    ]);
    expect(fx.mu.fires.every((f) => f.price < 878)).toBe(true);
  });
});

describe("MU, 2026-10-16 to 11-13 — review if below $878", () => {
  it("fires on the four days MU crossed under $878 from a close above it, not the ten it stayed under", async () => {
    const { lastFiredAt: _last, ...review } = fx.mu.review; // the replay starts before its first fire
    void _last;
    const db = book(fx.mu.thesis, { triggers: [review], position: { symbol: "MU", avgCost: fx.mu.position.avgCost, peakPrice: fx.mu.position.avgCost, openedAt: new Date(fx.mu.position.openedAt) } });
    const days = Object.keys(fx.mu.closes);
    const fired: string[] = [];
    for (const f of fx.mu.fires) {
      const at = new Date(f.at);
      const ids = await check(db, at, "MU", f.price, fx.mu.closes[before(days, etDay(at))]);
      if (ids.includes(review.id)) fired.push(etDay(at));
    }
    // On main: all 14.
    expect(fired).toEqual(["2026-10-16", "2026-10-22", "2026-10-30", "2026-11-02"]);
  });
});

describe("ASML, 2026-10-22 to 11-13 — the Compounder's review if below the 200-day", () => {
  it("fires on the two days ASML crossed under its 200-day, not the two it was already under", async () => {
    const db = book(fx.asml.thesis, { analystTriggers: [fx.asml.rule] });
    const asOf = Object.keys(fx.asml.snapshots);
    const fired: string[] = [];
    for (const f of fx.asml.fires) {
      const at = new Date(f.at);
      // Held on 10-22, sold 10-28 and watched after.
      const thesis = (db.store.thesis as Row[])[0];
      thesis.status = f.held ? "HOLDING" : "WATCHING";
      db.store.position = f.held ? [positionRow({ analystId: ANALYST.id, symbol: "ASML", avgCost: fx.asml.position.avgCost, peakPrice: fx.asml.position.avgCost, openedAt: new Date(fx.asml.position.openedAt) })] : [];
      const snap = fx.asml.snapshots[before(asOf, etDay(at))];
      const ids = await check(db, at, "ASML", f.price, snap.closes.at(-1)!, snap);
      if (ids.includes(fx.asml.rule.id)) fired.push(etDay(at));
    }
    // On main: all 4.
    expect(fired).toEqual(["2026-10-22", "2026-10-30"]);
  });
});

describe("NVDA — a review clock reads no price, and fires as it did", () => {
  const lastReview = new Date(fx.nvda.thesis.lastReviewedAt);
  const at = (days: number) => new Date(lastReview.getTime() + days * 86_400_000 + 10 * 60_000);

  it("seven days after the last review, it fires; six days after, it doesn't", async () => {
    // A clock doesn't read the price: any quote with a prior close will do.
    const db = () => book(fx.nvda.thesis, { triggers: [fx.nvda.clock] });
    expect(await check(db(), at(7), "NVDA", 190, 185)).toEqual([fx.nvda.clock.id]);
    expect(await check(db(), at(6), "NVDA", 190, 185)).toEqual([]);
  });
});
