/**
 * The five-minute check keeps the high since we bought, and the trail reads it
 * in the same pass.
 *
 * NVDA (PEAD Specialist), bought 2026-08-31 at $218.2259. On 2026-10-06 it
 * printed $243.37 at 09:31 ET; the hourly monitor's first reading was 10:00, so
 * the stored high stayed $242.505. The analyst's trail — 12% off the high, once
 * up 10% — therefore drew its line at $213.40, not $214.17. At 15:01 ET on
 * 10-16 the check priced NVDA at $213.8799: inside that gap.
 *
 * Through the evaluator's real handler, against the real rows and tape. The
 * thesis's own $236 floor is left out so the trail is the only sale in view.
 * Only the edges are doubled: the database, Alpaca's snapshot reply, the clock.
 */

import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow, REPLAY_ANALYST_ID, type PrismaDouble } from "@/lib/replay";

const TRAIL = {
  id: "f552414c-ff2a-455d-b779-d5401ac9ea98",
  action: "EXIT",
  source: "PRINCIPAL",
  fireMode: "TACTICAL",
  predicate: { is: "below", value: 12, watch: "move", settings: { startOnceUpPct: 10 }, variable: "peak" },
  rationale: "Gave back 12% from the high, once the position had been up 10% — bank the run.",
  cooldownDays: 0,
};

/** The stored row before 10-06: the monitor's highest reading was 239.43 (10-05, 15:00 ET). */
const BEFORE_1006 = { peakPrice: 239.43, peakAt: new Date("2026-10-05T19:00:28.999Z"), troughPrice: 210.56, troughAt: new Date("2026-09-14T15:00:31.016Z") };
/** What the monitor actually held on 10-16. */
const MONITOR_1016 = { ...BEFORE_1006, peakPrice: 242.505, peakAt: new Date("2026-10-06T15:01:01.219Z") };

const PASS_1006 = new Date("2026-10-06T13:35:05Z"); // 09:35 ET
const SNAP_1006 = {
  latestTrade: { p: 241.245, t: "2026-10-06T13:34:59Z" },
  dailyBar: { t: "2026-10-06T04:00:00Z", o: 242.1, h: 243.37, l: 240.76, c: 241.245 },
  prevDailyBar: { t: "2026-10-05T04:00:00Z", o: 236.09, h: 240.0983, l: 235.15, c: 238.9 },
};
const PASS_1016 = new Date("2026-10-16T19:01:05Z"); // 15:01 ET
const SNAP_1016 = {
  latestTrade: { p: 213.8799, t: "2026-10-16T19:01:04Z" },
  dailyBar: { t: "2026-10-16T04:00:00Z", o: 216.56, h: 218.676, l: 213.32, c: 213.8799 },
  prevDailyBar: { t: "2026-10-15T04:00:00Z", o: 215.3, h: 218.4692, l: 212.85, c: 217.23 },
};

type Sent = { name: string; data: { ticker: string; triggerId: string; action: string; firedPrice: number | null } };

function book(marks: typeof BEFORE_1006): PrismaDouble {
  return prismaDouble({
    account: [accountRow({ triggersSeededAt: new Date("2026-08-13T00:00:00Z") })],
    agentConfig: [agentConfigRow({ triggers: [TRAIL] })],
    thesis: [
      thesisRow({
        id: "thesis_NVDA",
        ticker: "NVDA",
        status: "HOLDING",
        createdAt: new Date("2026-08-31T13:00:00Z"),
        lastReviewedAt: new Date("2026-10-05T12:10:00Z"),
        triggers: [],
        researchRun: { agentConfigId: REPLAY_ANALYST_ID, agentConfig: { enabled: true, name: "PEAD Specialist", setupIds: [] } },
      }),
    ],
    position: [
      positionRow({ id: "position_NVDA", symbol: "NVDA", avgCost: 218.2259, environment: "LIVE", openedAt: new Date("2026-08-31T13:53:39.975Z"), ...marks }),
    ],
  });
}

async function pass(db: PrismaDouble, at: Date, snap: typeof SNAP_1006): Promise<{ sent: Sent[]; result: Record<string, unknown> }> {
  const sent: Sent[] = [];
  let result: Record<string, unknown> = {};
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: unknown) => {
    const u = new URL(String(url));
    if (!u.pathname.endsWith("/snapshots")) throw new Error(`unexpected vendor call ${u.pathname}`);
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({ NVDA: snap }), text: async () => "" } as unknown as Response;
  });
  jest.useFakeTimers({ now: at, doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  try {
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<Record<string, unknown>>) | undefined;
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => ({
        inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn() },
      }));
      await import("@/lib/inngest/functions/trigger-evaluator");
      result = await handler!({
        step: { run: async (_n: string, fn: () => Promise<unknown>) => fn(), sendEvent: async (_id: string, e: Sent) => void sent.push(e) },
      });
    });
  } finally {
    jest.useRealTimers();
  }
  return { sent, result };
}

const position = (db: PrismaDouble) => (db.store.position as Array<Record<string, unknown>>)[0];

const OLD_ENV = process.env;
beforeEach(() => {
  process.env = { ...OLD_ENV, ALPACA_API_KEY: "PKTEST", ALPACA_API_SECRET: "secret" };
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env = OLD_ENV;
  jest.restoreAllMocks();
});

describe("NVDA — the high since we bought, every five minutes", () => {
  it("the 09:35 pass on 10-06 takes the session's $243.37 high, and the 15:01 pass on 10-16 fires the trail off it", async () => {
    const db = book(BEFORE_1006);

    const first = await pass(db, PASS_1006, SNAP_1006);
    expect(first.result).toMatchObject({ session: "INTRADAY", firings: 0 });
    expect(position(db)).toMatchObject({ peakPrice: 243.37, peakAt: PASS_1006, troughPrice: 210.56 });

    const second = await pass(db, PASS_1016, SNAP_1016);
    // 12% off $243.37 is $214.17; the price is $213.8799.
    expect(second.sent.map((e) => [e.data.ticker, e.data.triggerId, e.data.action, e.data.firedPrice])).toEqual([
      ["NVDA", TRAIL.id, "EXIT", 213.8799],
    ]);
    // The day's high of $218.676 is under the mark, so nothing is written.
    expect(position(db)).toMatchObject({ peakPrice: 243.37, peakAt: PASS_1006 });
  });

  it("off the $242.505 the hourly monitor held, the same 10-16 pass does not fire", async () => {
    const db = book(MONITOR_1016);
    const { sent, result } = await pass(db, PASS_1016, SNAP_1016);
    expect(result).toMatchObject({ session: "INTRADAY", firings: 0 });
    expect(sent).toEqual([]);
  });

  it("a stale quote moves no mark", async () => {
    const db = book(BEFORE_1006);
    const late = new Date(PASS_1006.getTime() + 20 * 60_000);
    await pass(db, late, SNAP_1006);
    expect(position(db)).toMatchObject({ peakPrice: 239.43, peakAt: BEFORE_1006.peakAt });
  });
});
