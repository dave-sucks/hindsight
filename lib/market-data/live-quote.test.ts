/**
 * live-quote.test.ts — what "the price" is, from Alpaca's own replies.
 *
 * The SMMT, SRRK and IOT snapshots are what the DAV-264 probe got back on
 * 2026-09-29 at 14:31:45 ET (feed=sip). SMMT is the mid-cap the vendor
 * probe uses; that morning it opened 22% above Monday's close and printed
 * 316 one-minute bars before 9:30, the first at $19.57 — prints Finnhub's
 * quote never carried, and which are not served as the price here.
 */

import type { AlpacaSnapshot } from "@/lib/alpaca";
import { freshQuotePrice, staleForTrading } from "./quote-age";
import { resetQuoteBudget } from "./quote-budget";

const PROBE_AT = new Date("2026-09-29T18:31:45.900Z"); // Tue 14:31:45 ET

// Latest trade, today's open / last / volume and the prior close are the
// probe's own lines; the session's high and low to that minute and the rest
// of Monday's bar were read back off the tape the same afternoon.
const PROBED: Record<string, AlpacaSnapshot> = {
  SMMT: {
    latestTrade: { p: 16.425, t: "2026-09-29T18:31:45Z" },
    dailyBar: { t: "2026-09-29T04:00:00Z", o: 18.91, h: 19.09, l: 16.15, c: 16.445, v: 22_318_315 },
    prevDailyBar: { t: "2026-09-28T04:00:00Z", o: 15.5, h: 15.82, l: 15.18, c: 15.48, v: 6_124_956 },
  },
  SRRK: {
    latestTrade: { p: 48.03, t: "2026-09-29T18:31:43Z" },
    dailyBar: { t: "2026-09-29T04:00:00Z", o: 48.98, h: 49.35, l: 47.47, c: 48.05, v: 407_677 },
    prevDailyBar: { t: "2026-09-28T04:00:00Z", o: 48.1, h: 49.98, l: 47.76, c: 49.13, v: 1_568_252 },
  },
  IOT: {
    latestTrade: { p: 37.345, t: "2026-09-29T18:31:45Z" },
    dailyBar: { t: "2026-09-29T04:00:00Z", o: 37.9, h: 38.43, l: 37.135, c: 37.34, v: 3_564_755 },
    prevDailyBar: { t: "2026-09-28T04:00:00Z", o: 37.15, h: 38.37, l: 36.4, c: 37.93, v: 4_495_772 },
  },
};

const seconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

type Vendors = { alpaca: "up" | "down" | "spent"; finnhub: "up" | "spent"; alpacaRemaining?: number };

/** Both vendors behind one fetch, each reporting what its key has left this minute. */
function vendors(state: Vendors, snapshots: Record<string, AlpacaSnapshot> = PROBED) {
  const calls: { url: string; init: RequestInit & { next?: unknown } }[] = [];
  let alpacaRemaining = state.alpacaRemaining ?? 9_999;
  let finnhubRemaining = 59;
  const reset = String(Math.floor(Date.now() / 1000) + 40);
  const reply = (status: number, body: unknown, headers: Record<string, string>) =>
    ({ ok: status === 200, status, headers: new Headers(headers), json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: unknown, init: unknown) => {
    const u = String(url);
    calls.push({ url: u, init: (init ?? {}) as RequestInit });
    if (u.includes("data.alpaca.markets")) {
      if (state.alpaca === "down") throw new Error("connect ETIMEDOUT");
      const h = { "x-ratelimit-limit": "10000", "x-ratelimit-remaining": String(Math.max(0, --alpacaRemaining)), "x-ratelimit-reset": reset };
      if (state.alpaca === "spent") return reply(429, { message: "too many requests" }, { ...h, "x-ratelimit-remaining": "0" });
      const symbols = (new URL(u).searchParams.get("symbols") ?? "").split(",");
      const bad = symbols.find((s) => !/^[A-Z.]+$/.test(s));
      if (bad) return reply(400, { code: 40010001, message: `invalid symbol: ${bad}` }, h);
      return reply(200, Object.fromEntries(symbols.filter((s) => snapshots[s]).map((s) => [s, snapshots[s]])), h);
    }
    const h = { "x-ratelimit-limit": "60", "x-ratelimit-remaining": String(Math.max(0, --finnhubRemaining)), "x-ratelimit-reset": reset };
    if (state.finnhub === "spent") return reply(429, { error: "API limit reached." }, { ...h, "x-ratelimit-remaining": "0" });
    const symbol = new URL(u).searchParams.get("symbol") ?? "";
    // Finnhub's reply for the three names at 14:31 ET on 2026-09-29: c, pc, o
    // and t as the probe printed them.
    const fh: Record<string, object> = {
      SMMT: { c: 16.47, d: 0.99, dp: 6.3953, h: 19.09, l: 16.15, o: 19.115, pc: 15.48, t: seconds("2026-09-29T18:31:16Z") },
      SRRK: { c: 48.07, d: -1.06, dp: -2.1575, h: 49.35, l: 47.47, o: 49.095, pc: 49.13, t: seconds("2026-09-29T18:30:46Z") },
      IOT: { c: 37.35, d: -0.58, dp: -1.5291, h: 38.43, l: 37.135, o: 37.845, pc: 37.93, t: seconds("2026-09-29T18:31:13Z") },
      "^VIX": { error: "Market data subscription required for CFD indices." },
    };
    return reply(200, fh[symbol] ?? { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 }, h);
  });
  return { calls, to: (host: string) => calls.filter((c) => c.url.includes(host)) };
}

const OLD_ENV = process.env;
beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.useFakeTimers({
    now: PROBE_AT,
    doNotFake: ["nextTick", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance", "hrtime"],
  });
  process.env = { ...OLD_ENV, ALPACA_API_KEY: "PKTEST", ALPACA_API_SECRET: "secret", FINNHUB_API_KEY: "fh" };
  resetQuoteBudget();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  process.env = OLD_ENV;
});

/** A fresh module graph per case — the Finnhub client keeps a 30-second memory. */
async function load() {
  let mod!: typeof import("./live-quote");
  let budget!: typeof import("./quote-budget");
  await jest.isolateModulesAsync(async () => {
    budget = await import("./quote-budget");
    mod = await import("./live-quote");
  });
  return { ...mod, budget };
}

describe("one snapshot → the price and its time", () => {
  it("SMMT at 14:31:45: the latest trade, its own timestamp, Monday's close, today's open", async () => {
    const { quoteFromSnapshot } = await load();
    const q = quoteFromSnapshot(PROBED.SMMT, PROBE_AT)!;
    expect(q).toMatchObject({ c: 16.425, t: seconds("2026-09-29T18:31:45Z"), pc: 15.48, o: 18.91, h: 19.09, l: 16.15, d: 0.945 });
    expect(q.dp).toBeCloseTo(6.1047, 3);
    expect(freshQuotePrice(q, PROBE_AT)).toBe(16.425);
    expect(staleForTrading(q, PROBE_AT)).toBe(false);
  });

  it("08:00 the next morning: a pre-market print is not the price — Tuesday's close is, stamped at the bell", async () => {
    const { quoteFromSnapshot } = await load();
    const at = new Date("2026-09-30T12:00:05Z"); // Wed 08:00:05 ET
    const q = quoteFromSnapshot(
      {
        latestTrade: { p: 17.9, t: "2026-09-30T12:00:01Z" },
        dailyBar: { t: "2026-09-29T04:00:00Z", o: 18.91, h: 19.18, l: 16.2, c: 16.6, v: 31_000_000 },
        prevDailyBar: PROBED.SMMT.prevDailyBar,
      },
      at,
    )!;
    expect(q).toMatchObject({ c: 16.6, t: seconds("2026-09-29T20:00:00Z"), pc: 15.48, o: 18.91 });
    // Sixteen hours old: no write stamps it as the price a buy level was set at.
    expect(freshQuotePrice(q, at)).toBeNull();
  });

  it("the same morning, if the vendor has already turned the daily bar over: still Tuesday's close, and no invented prior close", async () => {
    const { quoteFromSnapshot } = await load();
    const q = quoteFromSnapshot(
      {
        latestTrade: { p: 17.9, t: "2026-09-30T12:00:01Z" },
        dailyBar: { t: "2026-09-30T04:00:00Z", o: 17.7, h: 18.0, l: 17.6, c: 17.9, v: 40_000 },
        prevDailyBar: { t: "2026-09-29T04:00:00Z", o: 18.91, h: 19.18, l: 16.2, c: 16.6, v: 31_000_000 },
      },
      new Date("2026-09-30T12:00:05Z"),
    )!;
    expect(q).toMatchObject({ c: 16.6, t: seconds("2026-09-29T20:00:00Z"), pc: null, d: null, dp: null });
  });

  it("09:30:02, not yet opened: the last print is pre-market, so the price is the last close — and a buy waits on it", async () => {
    const { quoteFromSnapshot } = await load();
    const at = new Date("2026-09-30T13:30:02Z");
    const q = quoteFromSnapshot(
      {
        latestTrade: { p: 17.9, t: "2026-09-30T13:29:58Z" },
        dailyBar: { t: "2026-09-29T04:00:00Z", o: 18.91, h: 19.18, l: 16.2, c: 16.6, v: 31_000_000 },
        prevDailyBar: PROBED.SMMT.prevDailyBar,
      },
      at,
    )!;
    expect(q.c).toBe(16.6);
    expect(staleForTrading(q, at)).toBe(true);
  });

  it("17:00, an after-hours print on the tape: the price is today's close at 16:00", async () => {
    const { quoteFromSnapshot } = await load();
    const q = quoteFromSnapshot(
      {
        latestTrade: { p: 16.1, t: "2026-09-29T20:58:00Z" },
        dailyBar: { t: "2026-09-29T04:00:00Z", o: 18.91, h: 19.18, l: 16.2, c: 16.6, v: 31_000_000 },
        prevDailyBar: PROBED.SMMT.prevDailyBar,
      },
      new Date("2026-09-29T21:00:00Z"),
    )!;
    expect(q).toMatchObject({ c: 16.6, t: seconds("2026-09-29T20:00:00Z"), pc: 15.48 });
  });

  it("a half day closes at 13:00 — the day after Thanksgiving", async () => {
    const { quoteFromSnapshot } = await load();
    const q = quoteFromSnapshot(
      {
        latestTrade: { p: 20.4, t: "2026-11-27T19:30:00Z" },
        dailyBar: { t: "2026-11-27T05:00:00Z", o: 20, h: 20.6, l: 19.9, c: 20.5, v: 900_000 },
        prevDailyBar: { t: "2026-11-25T05:00:00Z", o: 19.5, h: 20.1, l: 19.4, c: 19.9, v: 2_000_000 },
      },
      new Date("2026-11-27T20:00:00Z"),
    )!;
    expect(q).toMatchObject({ c: 20.5, t: seconds("2026-11-27T18:00:00Z"), pc: 19.9 });
  });

  it("a thin stock that last traded yesterday afternoon: that trade, with yesterday's time — stale today", async () => {
    const { quoteFromSnapshot } = await load();
    const at = new Date("2026-09-30T14:00:00Z");
    const q = quoteFromSnapshot(
      {
        latestTrade: { p: 9.41, t: "2026-09-29T19:58:00Z" },
        dailyBar: { t: "2026-09-29T04:00:00Z", o: 9.3, h: 9.5, l: 9.2, c: 9.42, v: 12_000 },
        prevDailyBar: { t: "2026-09-28T04:00:00Z", o: 9.1, h: 9.4, l: 9.0, c: 9.3, v: 9_000 },
      },
      at,
    )!;
    expect(q).toMatchObject({ c: 9.41, t: seconds("2026-09-29T19:58:00Z"), pc: 9.3 });
    expect(staleForTrading(q, at)).toBe(true);
  });

  it("nothing from the vendor is no price", async () => {
    const { quoteFromSnapshot } = await load();
    expect(quoteFromSnapshot(undefined, PROBE_AT)).toBeNull();
    expect(quoteFromSnapshot({}, PROBE_AT)).toBeNull();
  });
});

describe("the book in one call, Finnhub behind it", () => {
  it("three mid-caps: one Alpaca request, feed named, never the Data Cache, no Finnhub call", async () => {
    const v = vendors({ alpaca: "up", finnhub: "up" });
    const { getLiveQuotes } = await load();
    const out = await getLiveQuotes(["SMMT", "SRRK", "IOT"], { caller: "trigger-check", now: PROBE_AT });

    expect(v.calls).toHaveLength(1);
    expect(v.calls[0].url).toBe("https://data.alpaca.markets/v2/stocks/snapshots?symbols=SMMT%2CSRRK%2CIOT&feed=sip");
    expect(v.calls[0].init.cache).toBe("no-store");
    expect(v.calls[0].init.next).toBeUndefined();
    expect(Object.fromEntries(Object.entries(out).map(([s, r]) => [s, [r.quote?.c, r.quote?.pc, r.quote?.source]]))).toEqual({
      SMMT: [16.425, 15.48, "alpaca"],
      SRRK: [48.03, 49.13, "alpaca"],
      IOT: [37.345, 37.93, "alpaca"],
    });
  });

  it("one malformed symbol refuses Alpaca's whole reply — it is dropped, the rest are priced, and it falls to Finnhub", async () => {
    const v = vendors({ alpaca: "up", finnhub: "up" });
    const { getLiveQuotes } = await load();
    const out = await getLiveQuotes(["SMMT", "^VIX", "IOT"], { caller: "trigger-check", now: PROBE_AT });

    expect(v.to("alpaca").map((c) => new URL(c.url).searchParams.get("symbols"))).toEqual(["SMMT,^VIX,IOT", "SMMT,IOT"]);
    expect(out.SMMT.quote?.source).toBe("alpaca");
    expect(out.IOT.quote?.source).toBe("alpaca");
    expect(out["^VIX"].quote).toBeNull();
    expect(out["^VIX"].error).toContain("Alpaca has no price for ^VIX");
  });

  it("a symbol Alpaca does not know is priced by Finnhub, and says so", async () => {
    vendors({ alpaca: "up", finnhub: "up" }, { IOT: PROBED.IOT });
    const { getLiveQuotes } = await load();
    const out = await getLiveQuotes(["SMMT", "IOT"], { caller: "other", now: PROBE_AT });
    expect(out.IOT.quote).toMatchObject({ c: 37.345, source: "alpaca" });
    expect(out.SMMT.quote).toMatchObject({ c: 16.47, pc: 15.48, t: seconds("2026-09-29T18:31:16Z"), source: "finnhub" });
  });

  it("Alpaca down: every price comes from Finnhub", async () => {
    const v = vendors({ alpaca: "down", finnhub: "up" });
    const { getLiveQuotes } = await load();
    const out = await getLiveQuotes(["SMMT", "SRRK", "IOT"], { caller: "trigger-check", now: PROBE_AT });
    expect(Object.values(out).map((r) => r.quote?.source)).toEqual(["finnhub", "finnhub", "finnhub"]);
    expect(v.to("finnhub.io").every((c) => c.init.cache === "no-store")).toBe(true);
  });

  it("both vendors refusing: no price, and the reason reads as rate-limited", async () => {
    vendors({ alpaca: "spent", finnhub: "spent" });
    const { getLiveQuote } = await load();
    const { readPrice } = await import("./quote-age");
    const r = await getLiveQuote("SMMT", { caller: "trigger-check", now: PROBE_AT });
    expect(r.quote).toBeNull();
    expect(readPrice({ ticker: "SMMT", quote: r.quote, quoteError: r.error, now: PROBE_AT }).warning).toBe(
      "Live price for $SMMT unavailable (the quote was rate-limited); this result has no price.",
    );
  });
});

describe("who yields when Alpaca's minute runs low", () => {
  it("at the reserve, a page or a chat is refused without spending a call; the trigger check is not", async () => {
    // 10,000 a minute, a fifth held back. Other servers have spent the rest.
    const v = vendors({ alpaca: "up", finnhub: "spent", alpacaRemaining: 2_002 });
    const { getLiveQuote, getLiveQuotes } = await load();

    // The call that learns how little is left goes through…
    expect((await getLiveQuote("IOT", { caller: "other", now: PROBE_AT })).quote?.source).toBe("alpaca");
    expect(v.to("alpaca")).toHaveLength(1);

    // …and from then on a chat and a writer are turned away at the door.
    const others = await Promise.all(
      ["SMMT", "SRRK", "IOT", "SMMT", "SRRK"].map((s) => getLiveQuote(s, { caller: "other", now: PROBE_AT })),
    );
    expect(v.to("alpaca")).toHaveLength(2);
    expect(others.filter((r) => r.quote?.source === "alpaca")).toHaveLength(1);
    const held = others.filter((r) => !r.quote);
    expect(held).toHaveLength(4);
    expect(held[0].error).toContain("alpaca quote held for the trigger check");

    // The trigger check, in the same minute, gets every quote.
    const book = await getLiveQuotes(["SMMT", "SRRK", "IOT"], { caller: "trigger-check", now: PROBE_AT });
    expect(Object.values(book).map((r) => r.quote?.source)).toEqual(["alpaca", "alpaca", "alpaca"]);
  });

  it("the minute turns over and everyone is served again", async () => {
    const v = vendors({ alpaca: "up", finnhub: "spent", alpacaRemaining: 2_001 });
    const { getLiveQuote } = await load();
    await getLiveQuote("IOT", { caller: "other", now: PROBE_AT });
    expect((await getLiveQuote("SMMT", { caller: "other", now: PROBE_AT })).quote).toBeNull();

    jest.setSystemTime(new Date(PROBE_AT.getTime() + 41_000));
    expect((await getLiveQuote("SMMT", { caller: "other" })).quote?.source).toBe("alpaca");
    expect(v.to("alpaca")).toHaveLength(2);
  });
});
