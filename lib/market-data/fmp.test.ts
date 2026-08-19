/**
 * Guards the loudness contract of the shared FMP client.
 *
 * The DAV-191 bug: FMP went dark on our billing plan and *nothing said so*.
 * Six copy-pasted `fmp()` helpers each turned a 402 "not on your plan" and an
 * empty `[]` into `{ data: null }`; callers shrugged and reported success with
 * less data. `get_analyst_coverage` returned a null consensus on every call for
 * an unknown number of weeks, and `get_market_context` cited an economic
 * calendar it never received.
 *
 * The whole point of this client is that a vendor going dark is NOISY. These
 * assertions exist because that noise is a couple of `console.warn` lines and
 * an `error` field that a future refactor could quietly drop:
 *   • every non-OK status logs AND returns an error
 *   • an unexpected empty payload logs AND returns an error (the silent case)
 *   • a legitimately-empty payload stays quiet when the caller says so
 *   • live-price paths never opt into the Next.js Data Cache
 */

// This file has no top-level import (the module under test is loaded through
// jest.isolateModulesAsync), which would make TS treat it as a script and put
// these helpers in the global scope — colliding with the identically-named
// helpers in finnhub-quote.test.ts. `export {}` makes it a module.
export {};

type FetchArgs = {
  url: string;
  init: RequestInit & { next?: { revalidate?: number } };
};

const OLD_ENV = process.env;

async function loadFresh() {
  let mod!: typeof import("./fmp");
  await jest.isolateModulesAsync(async () => {
    mod = await import("./fmp");
  });
  return mod;
}

function mockFetch(status: number, body: unknown) {
  const calls: FetchArgs[] = [];
  const fn = jest.fn(async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as FetchArgs["init"] });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  });
  global.fetch = fn as unknown as typeof fetch;
  return calls;
}

describe("shared FMP client", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...OLD_ENV, FMP_API_KEY: "test-key" };
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = OLD_ENV;
    warn.mockRestore();
    jest.restoreAllMocks();
  });

  it("is loud about a plan-gated 402 instead of returning a quiet empty", async () => {
    mockFetch(402, {});
    const { fmp } = await loadFresh();

    const res = await fmp("/stable/economic-calendar?from=2026-08-19");

    expect(res.data).toBeNull();
    expect(res.error).toMatch(/402/);
    // The status must be INTERPRETED — "402" alone doesn't tell a reader
    // scanning logs that we simply aren't paying for this endpoint.
    expect(res.error).toMatch(/plan/i);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/402.*plan/i));
  });

  it("is loud about a 404 (endpoint retired or not served)", async () => {
    mockFetch(404, []);
    const { fmp } = await loadFresh();

    const res = await fmp("/stable/upgrades-downgrades?symbol=AAPL");

    expect(res.data).toBeNull();
    expect(res.error).toMatch(/404/);
    expect(warn).toHaveBeenCalled();
  });

  it("surfaces a 200 response carrying a vendor Error Message body", async () => {
    mockFetch(200, { "Error Message": "Legacy Endpoint" });
    const { fmp } = await loadFresh();

    const res = await fmp("/stable/quote?symbol=AAPL");

    expect(res.data).toBeNull();
    expect(res.error).toMatch(/Legacy Endpoint/);
    expect(warn).toHaveBeenCalled();
  });

  it("THE SILENT CASE: an unexpected empty array logs and returns an error", async () => {
    mockFetch(200, []);
    const { fmp } = await loadFresh();

    const res = await fmp("/stable/price-target-consensus?symbol=AAPL", {
      expectNonEmpty: true,
    });

    expect(res.data).toBeNull();
    expect(res.error).toMatch(/empty/i);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/EMPTY/));
  });

  it("stays quiet when an empty response is a legitimate answer", async () => {
    mockFetch(200, []);
    const { fmp } = await loadFresh();

    // No expectNonEmpty — "no rows this week" is a real answer here.
    const res = await fmp("/stable/earnings?symbol=AAPL");

    expect(res.data).toEqual([]);
    expect(res.error).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("treats an empty OBJECT as empty too, not just an empty array", async () => {
    mockFetch(200, {});
    const { fmp } = await loadFresh();

    const res = await fmp("/stable/price-target-summary?symbol=AAPL", {
      expectNonEmpty: true,
    });

    expect(res.data).toBeNull();
    expect(res.error).toMatch(/empty/i);
  });

  it("returns data untouched on a healthy response", async () => {
    mockFetch(200, [{ symbol: "AAPL", targetConsensus: 340.72 }]);
    const { fmp } = await loadFresh();

    const res = await fmp<{ symbol: string; targetConsensus: number }[]>(
      "/stable/price-target-consensus?symbol=AAPL",
      { expectNonEmpty: true },
    );

    expect(res.error).toBeUndefined();
    expect(res.data?.[0]?.targetConsensus).toBe(340.72);
    expect(warn).not.toHaveBeenCalled();
  });

  it("never puts a live-price path in the Next.js Data Cache", async () => {
    const calls = mockFetch(200, [{ symbol: "AAPL", price: 316.27 }]);
    const { fmp } = await loadFresh();

    await fmp("/stable/quote?symbol=AAPL", { liveQuote: true });

    expect(calls).toHaveLength(1);
    expect(calls[0].init.cache).toBe("no-store");
    // Both of these would reintroduce the stale-quote bug (see CLAUDE.md).
    expect(calls[0].init.next?.revalidate).toBeUndefined();
    expect(calls[0].init.cache).not.toBe("force-cache");
  });

  it("keeps the Data Cache for slow-moving endpoints", async () => {
    const calls = mockFetch(200, [{ symbol: "AAPL" }]);
    const { fmp } = await loadFresh();

    await fmp("/stable/income-statement?symbol=AAPL");

    expect(calls[0].init.next?.revalidate).toBe(300);
    expect(calls[0].init.cache).toBeUndefined();
  });

  it("refuses the retired /api/v3 + /v4 namespaces without a round-trip", async () => {
    const calls = mockFetch(200, []);
    const { fmp } = await loadFresh();

    const res = await fmp("/api/v3/historical-chart/1min/AAPL");

    // FMP retired these on 2025-08-31 — every call is a guaranteed 403, so it
    // must not cost us a network round-trip (this was on the 1D chart's 30s poll).
    expect(calls).toHaveLength(0);
    expect(res.data).toBeNull();
    expect(res.error).toMatch(/legacy/i);
    expect(warn).toHaveBeenCalled();
  });

  it("fails loudly and without throwing when the key is missing", async () => {
    process.env = { ...OLD_ENV };
    delete process.env.FMP_API_KEY;
    const calls = mockFetch(200, []);
    const { fmp } = await loadFresh();

    const res = await fmp("/stable/quote?symbol=AAPL");

    expect(calls).toHaveLength(0);
    expect(res.error).toMatch(/FMP_API_KEY/);
    expect(warn).toHaveBeenCalled();
  });
});
