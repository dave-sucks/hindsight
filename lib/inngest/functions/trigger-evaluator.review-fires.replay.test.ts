/**
 * A review fires when it becomes true, and again only after a market close finds it false (2026-11-17).
 *
 * MU, Secular Compounder: "Review if below $878" (Flag for Review) fired on 14 of the 21 sessions from
 * 2026-10-16 to 11-13 under a 1-day wait, every day MU traded under $878. Now it fires on 4: 10-16
 * (closed $878.84, back above), 10-22 (stayed below until the 10-26 close), 10-30 (closed $884.74)
 * and 11-02, after which no close was above $878. ASML, the Compounder's "Review if below the 200-day
 * average": 10-22, then 10-30 after the closes above it from 10-23, then never again (every close
 * from 10-29 on was under it). NVDA's "Review every 7 days" fires each period a review starts.
 *
 * The evaluator's own cron handler, on one database, at each real fire's time with that fire's live
 * price, and at 16:20 ET each session with its close. Rows in lib/agent/__fixtures__/review-fires-2026-11.json.
 */
import raw from "@/lib/agent/__fixtures__/review-fires-2026-11.json";
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow, REPLAY_ACCOUNT_ID, type PrismaDouble } from "@/lib/replay";
import type { IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";

type Row = Record<string, unknown>;
type Fire = { at: string; price: number; held?: boolean };
const fx = raw as unknown as {
  mu: { thesis: Row & { id: string; createdAt: string }; analyst: { id: string; name: string }; position: { avgCost: number; openedAt: string }; review: Row & { id: string }; closes: Record<string, number>; fires: Fire[] };
  asml: { thesis: Row & { id: string; createdAt: string }; position: { avgCost: number; openedAt: string; closedAt: string }; rule: Row & { id: string }; fires: Fire[]; snapshots: Record<string, IndicatorSnapshot> };
  nvda: { thesis: Row & { id: string; createdAt: string; lastReviewedAt: string }; clock: Row & { id: string } };
};
const ANALYST = fx.mu.analyst;
const etDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const before = (days: string[], day: string) => days.filter((d) => d < day).sort().at(-1)!;
/** 16:20 ET on `day` (EDT until Nov 1, EST after). */
const closeAt = (day: string) => new Date(`${day}T${day < "2026-11-02" ? "20" : "21"}:20:05Z`);

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
    expect(fx.mu.review).toMatchObject({ action: "REVIEW", fireMode: "NEXT_MORNING", predicate: { watch: "price", is: "below", value: 878 }});
    expect(Object.values(fx.mu.closes)).toEqual([931.24, 878.84, 904.9, 896.07, 913.67, 856.49, 877.55, 903.7, 928.76, 983.23, 934.27, 884.74, 833.59, 855.1, 795.23, 656.39, 690, 733.15, 725.11, 811.3, 798.44]);
    expect(fx.mu.fires.map((f) => etDay(new Date(f.at)))).toEqual([
      "2026-10-16", "2026-10-22", "2026-10-23", "2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04",
      "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13",
    ]);
    expect(fx.mu.fires.every((f) => f.price < 878)).toBe(true);
  });
});

/** Each real fire's pass and each session's close pass, in time order; the days `id` fired. */
async function month(db: PrismaDouble, ticker: string, id: string, fires: Fire[], closes: Record<string, number>, opts: { snapshot?: (day: string) => IndicatorSnapshot | undefined; before?: (f: { at: Date; fire?: Fire }) => void } = {}) {
  const days = Object.keys(closes).sort();
  const passes = [
    ...fires.map((f) => ({ at: new Date(f.at), price: f.price, fire: f })),
    ...days.map((d) => ({ at: closeAt(d), price: closes[d], fire: undefined as Fire | undefined })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const fired: string[] = [];
  for (const p of passes) {
    const day = etDay(p.at);
    opts.before?.(p);
    const prev = before(days, day) ?? day;
    const ids = await check(db, p.at, ticker, p.price, closes[prev], opts.snapshot?.(day));
    if (ids.includes(id)) fired.push(day);
  }
  return fired;
}

describe("MU, 2026-10-16 to 11-13 — review if below $878", () => {
  it("fires on the first day under $878 after each close above it: 4 days, not the 14 it traded under", async () => {
    const { lastFiredAt: _last, ...review } = fx.mu.review; // the replay starts before its first fire
    void _last;
    const db = book(fx.mu.thesis, { triggers: [review], position: { symbol: "MU", avgCost: fx.mu.position.avgCost, peakPrice: fx.mu.position.avgCost, openedAt: new Date(fx.mu.position.openedAt) } });
    const closes = { ...fx.mu.closes, "2026-11-13": 802.1 };
    expect(await month(db, "MU", review.id, fx.mu.fires, closes)).toEqual(["2026-10-16", "2026-10-22", "2026-10-30", "2026-11-02"]);
    // Fired 11-02 and no close above $878 since: ready again only after one.
    const stored = (db.store.thesis[0].triggers as Array<{ lastFiredAt?: string; falseAtCloseAt?: string }>)[0];
    expect(etDay(new Date(stored.lastFiredAt!))).toBe("2026-11-02");
    expect(etDay(new Date(stored.falseAtCloseAt!))).toBe("2026-10-30");
  });
});

describe("ASML, 2026-10-22 to 11-13 — the Compounder's review if below the 200-day", () => {
  it("fires 10-22, again 10-30 after the closes above it, then not while every close stays under it", async () => {
    const db = book(fx.asml.thesis, { analystTriggers: [{ ...fx.asml.rule }] });
    const asOf = Object.keys(fx.asml.snapshots).sort();
    // The day's closes, off the next snapshot's list (each ends the session before it was written).
    const closes: Record<string, number> = {
      "2026-10-22": 1571.8, "2026-10-23": 1590.9, "2026-10-26": 1635.57, "2026-10-27": 1662.85, "2026-10-28": 1675.7,
      "2026-10-29": 1565.9, "2026-10-30": 1526.14, "2026-11-02": 1552.14, "2026-11-03": 1496.3, "2026-11-04": 1356.65,
      "2026-11-05": 1424.75, "2026-11-06": 1513.25, "2026-11-09": 1507.85, "2026-11-10": 1534.42, "2026-11-11": 1497.12,
      "2026-11-12": 1500.4, "2026-11-13": 1499.72,
    };
    const fired = await month(db, "ASML", fx.asml.rule.id as string, fx.asml.fires, { "2026-10-21": 1560.54, ...closes }, {
      snapshot: (day) => fx.asml.snapshots[asOf.filter((d) => d <= day).at(-1)!],
      // Held on 10-22, sold 10-28 and watched after.
      before: ({ at }) => {
        const held = at < new Date(fx.asml.position.closedAt as unknown as string);
        (db.store.thesis as Row[])[0].status = held ? "HOLDING" : "WATCHING";
        db.store.position = held ? [positionRow({ analystId: ANALYST.id, symbol: "ASML", avgCost: fx.asml.position.avgCost, peakPrice: fx.asml.position.avgCost, openedAt: new Date(fx.asml.position.openedAt) })] : [];
      },
    });
    expect(fired).toEqual(["2026-10-22", "2026-10-30"]);
    // An inherited rule's fire state is the stock's, in triggerState.
    const state = (db.store.thesis[0] as Row).triggerState as Record<string, { firedAt?: string; falseAtCloseAt?: string }>;
    expect(etDay(new Date(state[fx.asml.rule.id as string].firedAt!))).toBe("2026-10-30");
  });
});

describe("NVDA — Review every 7 days fires each period", () => {
  const lastReview = new Date(fx.nvda.thesis.lastReviewedAt);
  const at = (days: number) => new Date(lastReview.getTime() + days * 86_400_000 + 10 * 60_000);

  it("seven days after the last review, it fires; six days after, it doesn't", async () => {
    // A clock doesn't read the price: any quote with a prior close will do.
    const db = () => book(fx.nvda.thesis, { triggers: [fx.nvda.clock] });
    expect(await check(db(), at(7), "NVDA", 190, 185)).toEqual([fx.nvda.clock.id]);
    expect(await check(db(), at(6), "NVDA", 190, 185)).toEqual([]);
  });

  it("the review it asked for starts the next period: that close finds it false, and seven days on it fires again", async () => {
    const db = book(fx.nvda.thesis, { triggers: [fx.nvda.clock] });
    // Last reviewed Fri 11-13: due Fri 11-20.
    expect(await check(db, at(7), "NVDA", 190, 185)).toEqual([fx.nvda.clock.id]);
    // Unanswered, it does not fire again on Monday.
    expect(await check(db, new Date("2026-11-23T14:35:00Z"), "NVDA", 190, 185)).toEqual([]);
    // The morning run reviews it Monday; that day's close finds the clock false.
    (db.store.thesis[0] as Row).lastReviewedAt = new Date("2026-11-23T15:00:00Z");
    expect(await check(db, closeAt("2026-11-23"), "NVDA", 191, 190)).toEqual([]);
    expect((db.store.thesis[0].triggers as Array<{ falseAtCloseAt?: string }>)[0].falseAtCloseAt).toBe(closeAt("2026-11-23").toISOString());
    expect(await check(db, new Date("2026-11-25T15:10:00Z"), "NVDA", 190, 185)).toEqual([]);
    expect(await check(db, new Date("2026-11-30T15:10:00Z"), "NVDA", 190, 185)).toEqual([fx.nvda.clock.id]);
  });

  it("Review every 30 days, the same way: due Mon 12-14, unanswered it waits; reviewed, it fires 30 days on", async () => {
    const clock = { ...fx.nvda.clock, id: "clock30", predicate: { watch: "repeat", value: 30 } };
    const db = book(fx.nvda.thesis, { triggers: [clock] });
    expect(await check(db, new Date("2026-12-11T15:10:00Z"), "NVDA", 190, 185)).toEqual([]);
    expect(await check(db, new Date("2026-12-14T15:10:00Z"), "NVDA", 190, 185)).toEqual(["clock30"]);
    expect(await check(db, new Date("2026-12-15T15:10:00Z"), "NVDA", 190, 185)).toEqual([]);
    (db.store.thesis[0] as Row).lastReviewedAt = new Date("2026-12-15T16:00:00Z");
    expect(await check(db, closeAt("2026-12-15"), "NVDA", 191, 190)).toEqual([]);
    expect(await check(db, new Date("2027-01-13T15:10:00Z"), "NVDA", 190, 185)).toEqual([]);
    expect(await check(db, new Date("2027-01-14T16:10:00Z"), "NVDA", 190, 185)).toEqual(["clock30"]);
  });
});
