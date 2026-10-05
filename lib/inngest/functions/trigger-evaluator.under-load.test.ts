/**
 * trigger-evaluator.under-load.test.ts — the trigger check still gets every
 * quote while the pages, a chat and a writer ask for prices (DAV-264).
 *
 * What happened. 2026-09-15, 09:50–10:00 ET: the pages' quote polling
 * (/api/quotes — 140 requests in 40 minutes, up to 20 symbols each) spent
 * the one Finnhub key's 60 calls a minute. The 10:00 trigger pass logged
 * "Finnhub /quote rate limited (429)" about 29 times: about 29 stocks with no
 * price, their triggers — stops included — not checked. The pass wrote one
 * row with no price on it (SMMT, 14:00:22Z, priceAtTime null).
 *
 * What is replayed. The six stocks held that morning, each with its hard
 * stop, against the tape at 10:55:10 ET the same day — the moment ASML
 * traded $1,579.12, under its $1,580 stop (the stop fired for real at
 * 10:55:14, at $1,577.47). Twenty-seven watched names fill the book to the 33
 * the ticket counts; they carry no trigger that can fire, and their prices
 * are placeholders. The spent minute is 10:00's and the breach is 10:55's:
 * put together, they are what a starved pass costs.
 *
 * Through the evaluator's real handler. Only the edges are doubled: the
 * database, Inngest, the clock, and the two vendors — each of which counts
 * its calls per minute and refuses past its limit, as the real ones do.
 *
 * On main the first case fails: the pass asks Finnhub for 33 quotes one at a
 * time, all 33 are refused, and ASML's stop is never checked.
 */

import { prismaDouble, type PrismaDouble } from "@/lib/replay/prisma-double";
import { accountRow, agentConfigRow, positionRow, thesisRow, REPLAY_ANALYST_ID } from "@/lib/replay/rows";

const PASS_AT = new Date("2026-09-15T14:55:11Z"); // Tue 10:55:11 ET

/** Alpaca's tape at 10:55:10 ET for the six held names, and Monday's bar. */
const HELD = {
  NVDA: { p: 212.08, t: "2026-09-15T14:55:10.999Z", o: 213.375, h: 213.94, l: 211.63, pc: 210.96, avgCost: 218.2259, stop: 200.15 },
  CEG: { p: 260.81, t: "2026-09-15T14:55:10.985Z", o: 265.8, h: 266.88, l: 260.4, pc: 264.57, avgCost: 276.8985, stop: 220 },
  WST: { p: 362.45, t: "2026-09-15T14:55:09.636Z", o: 355.02, h: 362.45, l: 354.65, pc: 355.2, avgCost: 355.28, stop: 330 },
  ABT: { p: 101.99, t: "2026-09-15T14:55:10.911Z", o: 102.98, h: 103.06, l: 101.47, pc: 103.09, avgCost: 103.663, stop: 96 },
  MU: { p: 930.5, t: "2026-09-15T14:55:10.959Z", o: 937.5, h: 944.94, l: 928.01, pc: 924.03, avgCost: 895.935, stop: 880 },
  ASML: { p: 1579.1212, t: "2026-09-15T14:55:10.818Z", o: 1615.61, h: 1616.55, l: 1575.78, pc: 1575.15, avgCost: 1716.09, stop: 1580 },
} as const;

const WATCHED = [
  "BWXT", "EME", "GEV", "ISRG", "NOW", "SYK", "VST", "GD", "ETN", "SMMT", "SRRK", "IOT", "FIVE", "KMX",
  "JBL", "PLTR", "HPE", "MSFT", "SNOW", "AMD", "AVGO", "GOOGL", "TSM", "EXEL", "CORT", "BBIO", "DYN",
];
const BOOK = [...Object.keys(HELD), ...WATCHED];

const snapshotOf = (symbol: string) => {
  const h = HELD[symbol as keyof typeof HELD];
  const p = h?.p ?? 100;
  return {
    latestTrade: { p, t: h?.t ?? new Date(Date.now() - 2_000).toISOString() },
    dailyBar: { t: "2026-09-15T04:00:00Z", o: h?.o ?? p, h: h?.h ?? p, l: h?.l ?? p, c: p, v: 1_000_000 },
    prevDailyBar: { t: "2026-09-14T04:00:00Z", o: h?.pc ?? p, h: h?.pc ?? p, l: h?.pc ?? p, c: h?.pc ?? p, v: 1_000_000 },
  };
};

/**
 * Both vendors behind one fetch. Each counts the calls it has served this
 * minute, says what is left on every reply, and answers 429 past its limit.
 */
function vendors(opts: { alpacaLeft?: number } = {}) {
  const left = { alpaca: opts.alpacaLeft ?? 10_000, finnhub: 60 };
  const served = { alpaca: 0, finnhub: 0 };
  const refused = { alpaca: 0, finnhub: 0 };
  const reset = String(Math.floor(PASS_AT.getTime() / 1000) + 49);
  const reply = (status: number, body: unknown, vendor: "alpaca" | "finnhub") =>
    ({
      ok: status === 200,
      status,
      headers: new Headers({
        "x-ratelimit-limit": vendor === "alpaca" ? "10000" : "60",
        "x-ratelimit-remaining": String(Math.max(0, left[vendor])),
        "x-ratelimit-reset": reset,
      }),
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as unknown as Response;
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: unknown) => {
    const u = new URL(String(url));
    const vendor = u.host.includes("alpaca") ? "alpaca" : "finnhub";
    if (left[vendor] <= 0) {
      refused[vendor] += 1;
      return reply(429, { message: "too many requests" }, vendor);
    }
    left[vendor] -= 1;
    served[vendor] += 1;
    if (vendor === "alpaca") {
      const symbols = (u.searchParams.get("symbols") ?? "").split(",");
      return reply(200, Object.fromEntries(symbols.map((s) => [s, snapshotOf(s)])), vendor);
    }
    const snap = snapshotOf(u.searchParams.get("symbol") ?? "");
    const c = snap.latestTrade.p;
    const pc = snap.prevDailyBar.c;
    return reply(200, { c, d: c - pc, dp: ((c - pc) / pc) * 100, h: snap.dailyBar.h, l: snap.dailyBar.l, o: snap.dailyBar.o, pc, t: Math.floor(Date.now() / 1000) - 30 }, vendor);
  });
  return { left, served, refused };
}

function book(): PrismaDouble {
  const onAnalyst = { agentConfigId: REPLAY_ANALYST_ID, agentConfig: { enabled: true, name: "Replay Analyst", setupIds: [] } };
  const review = (id: string) => ({
    id,
    action: "REVIEW",
    predicate: { watch: "repeat", value: 30 },
    rationale: "Look at this every 30 days, counting from the last real review.",
    cooldownDays: 30,
    source: "AGENT",
  });
  return prismaDouble({
    account: [accountRow({ triggersSeededAt: new Date("2026-09-01T00:00:00Z") })],
    agentConfig: [agentConfigRow()],
    thesis: [
      ...Object.entries(HELD).map(([ticker, h]) =>
        thesisRow({
          id: `thesis_${ticker}`,
          ticker,
          status: "HOLDING",
          horizon: "COMPOUNDER",
          createdAt: new Date("2026-08-12T04:30:00Z"),
          lastReviewedAt: new Date("2026-09-14T12:10:00Z"),
          researchRun: onAnalyst,
          stopLoss: h.stop,
          triggers: [
            {
              id: `stop_${ticker}`,
              action: "EXIT",
              predicate: { watch: "price", is: "below", value: h.stop },
              rationale: `Hard stop at $${h.stop}. If we hit it the thesis is broken; close and write up the lesson.`,
              cooldownDays: 0,
              fireMode: "TACTICAL",
              source: "AGENT",
            },
            review(`review_${ticker}`),
          ],
        }),
      ),
      ...WATCHED.map((ticker) =>
        thesisRow({
          id: `thesis_${ticker}`,
          ticker,
          status: "WATCHING",
          entryPrice: null,
          targetPrice: null,
          stopLoss: null,
          createdAt: new Date("2026-08-12T04:30:00Z"),
          lastReviewedAt: new Date("2026-09-14T12:10:00Z"),
          researchRun: onAnalyst,
          triggers: [review(`review_${ticker}`)],
        }),
      ),
    ],
    position: Object.entries(HELD).map(([symbol, h]) =>
      positionRow({ id: `position_${symbol}`, symbol, avgCost: h.avgCost, peakPrice: null, peakAt: null, environment: "LIVE", openedAt: new Date("2026-09-04T14:23:33Z") }),
    ),
  });
}

interface Loaded {
  pass: () => Promise<{ firings: number; session: string }>;
  sent: { name: string; data: { ticker: string; action: string; firedPrice: number | null } }[];
  getStockQuote: (symbol: string) => Promise<{ c: number } | null>;
  db: PrismaDouble;
}

async function load(): Promise<Loaded> {
  const db = book();
  const sent: Loaded["sent"] = [];
  let handler!: (args: unknown) => Promise<{ firings: number; session: string }>;
  let getStockQuote!: Loaded["getStockQuote"];
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/inngest/client", () => ({
      inngest: { createFunction: (_config: unknown, _trigger: unknown, fn: unknown) => fn, send: jest.fn() },
    }));
    handler = ((await import("./trigger-evaluator")) as unknown as { triggerEvaluator: typeof handler }).triggerEvaluator;
    getStockQuote = (await import("@/lib/actions/finnhub.actions")).getStockQuote;
  });
  const step = {
    run: async (_name: string, fn: () => unknown) => fn(),
    sendEvent: async (_id: string, event: Loaded["sent"][number]) => {
      sent.push(event);
    },
  };
  return { pass: () => handler({ step }), sent, getStockQuote, db };
}

/** One page poll: /api/quotes asks for up to 20 symbols at a time. */
const pagePoll = (l: Loaded, symbols: string[]) => Promise.all(symbols.map((s) => l.getStockQuote(s)));

const OLD_ENV = process.env;
let logged: string[] = [];
beforeEach(() => {
  logged = [];
  for (const level of ["log", "warn", "error"] as const) {
    jest.spyOn(console, level).mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" ")));
  }
  // Only the clock is moved. The vendors' own retries and timeouts run real.
  jest.useFakeTimers({
    now: PASS_AT,
    doNotFake: ["nextTick", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance", "hrtime"],
  });
  process.env = { ...OLD_ENV, FINNHUB_API_KEY: "fh-test", ALPACA_API_KEY: "PKTEST", ALPACA_API_SECRET: "secret" };
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  process.env = OLD_ENV;
});

const unpriced = () => logged.filter((l) => /NO PRICE|rate limited \(429\)/.test(l));

describe("a trigger pass while the app is in use", () => {
  it("the pages have polled the book twice this minute, a chat and a writer are asking — all 33 stocks are priced and ASML's stop fires", async () => {
    const v = vendors();
    const l = await load();

    // The minute before the pass: two tabs' worth of polling, 66 quotes.
    await pagePoll(l, BOOK.slice(0, 20));
    await pagePoll(l, BOOK.slice(20));
    jest.setSystemTime(new Date(PASS_AT.getTime() - 11_000 + 22_000)); // the 10-second page cache has turned over
    await pagePoll(l, BOOK.slice(0, 20));
    await pagePoll(l, BOOK.slice(20));

    // The pass, with a chat's four lookups and a writer's two write prices in parallel.
    const [result] = await Promise.all([
      l.pass(),
      pagePoll(l, ["NVDA", "CEG", "ASML", "MU"].map((s) => s.toLowerCase())),
      pagePoll(l, ["ETN", "KMX"]),
    ]);

    expect(unpriced()).toEqual([]);
    expect(result).toMatchObject({ session: "INTRADAY", firings: 1 });
    expect(l.sent.map((e) => [e.name, e.data.ticker, e.data.action, e.data.firedPrice])).toEqual([
      ["app/thesis.trigger.fired", "ASML", "EXIT", 1579.1212],
    ]);
    // No vendor refused anyone.
    expect(v.refused).toEqual({ alpaca: 0, finnhub: 0 });
  }, 20_000);

  it("the whole book is one Alpaca call — not 33 against a 60-a-minute key", async () => {
    const v = vendors();
    const l = await load();
    await l.pass();
    expect(v.served).toEqual({ alpaca: 1, finnhub: 0 });
  });

  it("Alpaca's own minute nearly spent by other servers: pages, chat and writer yield; the pass still prices all 33", async () => {
    // 10,000 a minute, 2,000 of them only the trigger check may spend.
    const v = vendors({ alpacaLeft: 2_002 });
    const l = await load();

    // The first page quote learns how little is left; it is the last one served.
    expect(await l.getStockQuote("NVDA")).toMatchObject({ c: 212.08 });
    const polled = await pagePoll(l, BOOK.slice(1, 21));
    const alpacaAfterPages = v.served.alpaca;
    expect(alpacaAfterPages).toBeLessThanOrEqual(2);
    // Finnhub is behind it, and holds 45 of its 60 back the same way.
    expect(v.served.finnhub).toBeLessThanOrEqual(20);
    expect(polled.filter((q) => q == null).length).toBeGreaterThan(0);

    const [result] = await Promise.all([l.pass(), pagePoll(l, ["ETN", "KMX", "JBL", "FIVE"])]);

    expect(logged.filter((x) => x.includes("NO PRICE"))).toEqual([]);
    expect(result).toMatchObject({ firings: 1 });
    expect(l.sent.map((e) => [e.data.ticker, e.data.firedPrice])).toEqual([["ASML", 1579.1212]]);
    // The pass spent one call; nobody else spent any after the line was seen.
    expect(v.served.alpaca).toBe(alpacaAfterPages + 1);
    expect(v.left.alpaca).toBeGreaterThanOrEqual(1_999);
    expect(v.refused.alpaca).toBe(0);
  }, 20_000);

  it("Alpaca down: the pass falls back to Finnhub and is served ahead of the pages", async () => {
    const v = vendors({ alpacaLeft: 0 });
    const l = await load();

    // Pages first — they may spend 15 of Finnhub's 60, no more.
    await pagePoll(l, BOOK.slice(0, 20));
    await pagePoll(l, BOOK.slice(20));
    expect(v.served.finnhub).toBeLessThanOrEqual(20);

    const result = await l.pass();
    expect(logged.filter((x) => x.includes("NO PRICE"))).toEqual([]);
    expect(result).toMatchObject({ firings: 1 });
    expect(l.sent.map((e) => e.data.ticker)).toEqual(["ASML"]);
  }, 20_000);
});
