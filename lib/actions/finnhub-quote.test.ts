/**
 * Guards the live-quote caching contract for `getStockQuote`.
 *
 * The 2026-08-14 bug (GAPS P1-41): the thesis sheet rendered the PRIOR
 * SESSION'S CLOSE as the live price because the quote fetch used
 * `force-cache` + `next.revalidate`, putting it in the Next.js Data Cache —
 * stale-while-revalidate and persistent across invocations/deploys, so its
 * staleness was bounded by how often a surface got hit, not by the revalidate
 * value. A stale quote is structurally identical to a live one, so nothing
 * caught it for weeks.
 *
 * These assertions exist because the fix is a handful of one-word options that
 * a future refactor could silently undo. The two that actually matter:
 *   • the fetch must NOT opt into the Data Cache (no `next.revalidate`, no
 *     `force-cache`) — see "never touches the Next.js Data Cache"
 *   • the in-memory damper must EXPIRE — see "cannot serve a day-old quote"
 */

type FetchArgs = { url: string; init: RequestInit & { next?: { revalidate?: number } } };

const OLD_ENV = process.env;

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
  let fail = false;
  const fn = jest.fn(async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as FetchArgs["init"] });
    if (fail) throw new Error("network down");
    price += 1;
    return {
      ok: true,
      json: async () => ({ c: price, d: 1, dp: 1, pc: price - 1, t: 1_786_723_277 }),
      text: async () => "",
    } as unknown as Response;
  });
  (global as unknown as { fetch: unknown }).fetch = fn;
  return {
    calls,
    setFail: (v: boolean) => {
      fail = v;
    },
  };
}

beforeEach(() => {
  jest.restoreAllMocks();
  process.env = { ...OLD_ENV, FINNHUB_API_KEY: "test-key" };
});

afterAll(() => {
  process.env = OLD_ENV;
});

test("never touches the Next.js Data Cache (the actual P1-41 defect)", async () => {
  const f = mockFetch();
  const { getStockQuote } = await loadFresh();
  await getStockQuote("SNOW");

  expect(f.calls).toHaveLength(1);
  const { init } = f.calls[0];
  // These three are the regression. Any of them coming back reintroduces the
  // overnight-stale price.
  expect(init.next?.revalidate).toBeUndefined();
  expect(init.cache).not.toBe("force-cache");
  expect(init.cache).toBe("no-store");
});

test("cannot serve a day-old quote even from a long-lived instance", async () => {
  const f = mockFetch();
  const { getStockQuote } = await loadFresh();

  const first = await getStockQuote("SNOW");
  expect(f.calls).toHaveLength(1);

  // Same serverless instance, 20 hours later (an overnight gap — precisely the
  // window that produced the bug).
  const realNow = Date.now();
  jest.spyOn(Date, "now").mockReturnValue(realNow + 20 * 60 * 60 * 1000);

  const second = await getStockQuote("SNOW");
  expect(f.calls).toHaveLength(2); // refetched rather than serving yesterday
  expect(second!.c).not.toBe(first!.c);
});

test("collapses concurrent callers for one symbol to a single upstream call", async () => {
  // /api/quotes is polled every 30s by every open tab, and two unthrottled
  // Promise.all fan-outs call this. Without coalescing, N callers = N calls
  // against Finnhub's 60/min limit.
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
  await Promise.all([getStockQuote("SPY"), getStockQuote("QQQ"), getStockQuote("IWM")]);
  expect(f.calls).toHaveLength(3);
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

  f.setFail(true);
  expect(await getStockQuote("SNOW")).toBeNull();

  // A wedged in-flight entry would make every later caller await a dead
  // promise forever; a cached null would pin the symbol for the whole TTL.
  f.setFail(false);
  const recovered = await getStockQuote("SNOW");
  expect(recovered).not.toBeNull();
  expect(f.calls).toHaveLength(2);
});

test("sends an abort signal so a hung request can't stall coalesced waiters", async () => {
  const f = mockFetch();
  const { getStockQuote } = await loadFresh();
  await getStockQuote("SNOW");
  expect(f.calls[0].init.signal).toBeDefined();
});
