/**
 * Guards the live-quote contract for `getStockQuote`.
 *
 * The 2026-08-14 bug (GAPS P1-41): the thesis sheet rendered the PRIOR
 * SESSION'S CLOSE as the live price because the quote fetch used
 * `force-cache` + `next.revalidate`, putting it in the Next.js Data Cache —
 * stale-while-revalidate and persistent across invocations/deploys, so its
 * staleness was bounded by how often a surface got hit, not by the revalidate
 * value. A stale quote is structurally identical to a live one, so nothing
 * caught it for weeks.
 *
 * Since 2026-09-29 the price comes from Alpaca's tape, with Finnhub `/quote`
 * behind it. The same rules hold on both:
 *   • neither fetch may opt into the Data Cache (no `next.revalidate`, no
 *     `force-cache`) — see "never touches the Next.js Data Cache"
 *   • the in-memory damper must EXPIRE — see "cannot serve a day-old quote"
 */

type FetchArgs = { url: string; init: RequestInit & { next?: { revalidate?: number } } };

const OLD_ENV = process.env;
// Tue 2026-09-29 14:31:45 ET — the moment of the DAV-264 probe, market open.
const NOW = new Date("2026-09-29T18:31:45Z");

async function loadFresh() {
  let mod!: typeof import("./finnhub.actions");
  await jest.isolateModulesAsync(async () => {
    mod = await import("./finnhub.actions");
  });
  return mod;
}

function mockFetch() {
  const calls: FetchArgs[] = [];
  let price = 100;
  const down = { alpaca: false, finnhub: false };
  const reply = (body: unknown, ok = true, status = 200) =>
    ({ ok, status, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;
  const fn = jest.fn(async (url: unknown, init: unknown) => {
    const u = String(url);
    calls.push({ url: u, init: (init ?? {}) as FetchArgs["init"] });
    const alpaca = u.includes("data.alpaca.markets");
    if (alpaca ? down.alpaca : down.finnhub) throw new Error("network down");
    price += 1;
    if (!alpaca) return reply({ c: price, d: 1, dp: 1, pc: price - 1, t: Math.floor(Date.now() / 1000) - 30 });
    const symbols = decodeURIComponent(new URL(u).searchParams.get("symbols") ?? "").split(",");
    return reply(
      Object.fromEntries(
        symbols.map((s) => [
          s,
          {
            latestTrade: { p: price, t: new Date(Date.now() - 800).toISOString() },
            dailyBar: { t: "2026-09-29T04:00:00Z", o: price, h: price, l: price, c: price, v: 1 },
            prevDailyBar: { t: "2026-09-28T04:00:00Z", o: price - 1, h: price, l: price - 1, c: price - 1, v: 1 },
          },
        ]),
      ),
    );
  });
  (global as unknown as { fetch: unknown }).fetch = fn;
  return {
    calls,
    to: (vendor: "alpaca" | "finnhub") => calls.filter((c) => c.url.includes(vendor === "alpaca" ? "data.alpaca.markets" : "finnhub.io")),
    setDown: (v: Partial<typeof down>) => Object.assign(down, v),
  };
}

beforeEach(() => {
  jest.restoreAllMocks();
  // Only the clock is faked — the vendors' own timeouts and retries run real.
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ["nextTick", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance", "hrtime"],
  });
  process.env = { ...OLD_ENV, FINNHUB_API_KEY: "test-key", ALPACA_API_KEY: "PKTEST", ALPACA_API_SECRET: "secret" };
});

afterEach(() => {
  jest.useRealTimers();
});

afterAll(() => {
  process.env = OLD_ENV;
});

test("the price comes from Alpaca's tape, feed named, and never touches the Next.js Data Cache (the actual P1-41 defect)", async () => {
  const f = mockFetch();
  const { getStockQuote } = await loadFresh();
  const quote = await getStockQuote("SNOW");

  expect(f.calls).toHaveLength(1);
  expect(f.calls[0].url).toContain("https://data.alpaca.markets/v2/stocks/snapshots?symbols=SNOW");
  expect(f.calls[0].url).toContain("feed=sip");
  const { init } = f.calls[0];
  // These three are the regression. Any of them coming back reintroduces the
  // overnight-stale price.
  expect(init.next?.revalidate).toBeUndefined();
  expect(init.cache).not.toBe("force-cache");
  expect(init.cache).toBe("no-store");
  // The age travels with the price: `t` is when the trade printed, not when we asked.
  expect(quote!.t).toBe(Math.floor((NOW.getTime() - 800) / 1000));
  expect(quote!.pc).toBe(quote!.c - 1);
});

test("when Alpaca is down the price is Finnhub's — and that fetch never touches the Data Cache either", async () => {
  const f = mockFetch();
  f.setDown({ alpaca: true });
  const { getStockQuote } = await loadFresh();
  const quote = await getStockQuote("SNOW");

  expect(quote).not.toBeNull();
  expect(f.to("finnhub")).toHaveLength(1);
  const { init } = f.to("finnhub")[0];
  expect(init.next?.revalidate).toBeUndefined();
  expect(init.cache).toBe("no-store");
});

test("cannot serve a day-old quote even from a long-lived instance", async () => {
  const f = mockFetch();
  const { getStockQuote } = await loadFresh();

  const first = await getStockQuote("SNOW");
  expect(f.calls).toHaveLength(1);

  // Same serverless instance, 20 hours later (an overnight gap — precisely the
  // window that produced the bug).
  jest.setSystemTime(new Date(NOW.getTime() + 20 * 60 * 60 * 1000));

  const second = await getStockQuote("SNOW");
  expect(f.calls).toHaveLength(2); // refetched rather than serving yesterday
  expect(second!.c).not.toBe(first!.c);
});

test("collapses concurrent callers for one symbol to a single upstream call", async () => {
  // /api/quotes is hit by every open tab and quote row, and two unthrottled
  // Promise.all fan-outs call this. Without coalescing, N callers = N calls.
  const f = mockFetch();
  const { getStockQuote } = await loadFresh();

  const results = await Promise.all(
    Array.from({ length: 25 }, () => getStockQuote("SNOW")),
  );

  expect(f.calls).toHaveLength(1);
  expect(new Set(results.map((r) => r!.c)).size).toBe(1);
});

test("does not collapse distinct symbols", async () => {
  const f = mockFetch();
  const { getStockQuote } = await loadFresh();
  const [spy, qqq, iwm] = await Promise.all([getStockQuote("SPY"), getStockQuote("QQQ"), getStockQuote("IWM")]);
  expect(f.calls).toHaveLength(3);
  expect(new Set([spy!.c, qqq!.c, iwm!.c]).size).toBe(3);
});

test("normalizes symbol case so one ticker is one cache entry", async () => {
  const f = mockFetch();
  const { getStockQuote } = await loadFresh();
  await getStockQuote("snow");
  await getStockQuote("SNOW");
  expect(f.calls).toHaveLength(1);
});

test("failures are not cached and never wedge the in-flight slot", async () => {
  const f = mockFetch();
  const { getStockQuote } = await loadFresh();

  f.setDown({ alpaca: true, finnhub: true });
  expect(await getStockQuote("SNOW")).toBeNull();
  const whileDown = f.calls.length;

  // A wedged in-flight entry would make every later caller await a dead
  // promise forever; a cached null would pin the symbol for the whole TTL.
  f.setDown({ alpaca: false, finnhub: false });
  const recovered = await getStockQuote("SNOW");
  expect(recovered).not.toBeNull();
  expect(f.calls).toHaveLength(whileDown + 1);
});

test("sends an abort signal so a hung request can't stall coalesced waiters", async () => {
  const f = mockFetch();
  const { getStockQuote } = await loadFresh();
  await getStockQuote("SNOW");
  expect(f.calls[0].init.signal).toBeDefined();
});
