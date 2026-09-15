/**
 * sec-filings.test.ts — the EDGAR read: one call for the book, and a failure
 * that says so instead of reading as "nothing filed".
 */

import fixture from "./__fixtures__/edgar-search-2026-09.json";
import { __resetCikCache, __setRetryDelay, fetchBookFilings } from "./sec-filings";

const tickerList = {
  "0": { cik_str: 723125, ticker: "MU" },
  "1": { cik_str: 1045810, ticker: "NVDA" },
};

function mockFetch(search: () => Response) {
  const calls: string[] = [];
  global.fetch = jest.fn(async (url: string | URL) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("company_tickers.json")) return new Response(JSON.stringify(tickerList), { status: 200 });
    return search();
  }) as unknown as typeof fetch;
  return calls;
}

describe("fetchBookFilings", () => {
  beforeEach(() => {
    __resetCikCache();
    __setRetryDelay(0);
  });

  it("reads the whole book in one search call and groups it newest first", async () => {
    const calls = mockFetch(() => new Response(JSON.stringify(fixture), { status: 200 }));
    const read = await fetchBookFilings({ tickers: ["MU", "NVDA", "ZZZZ"], now: new Date("2026-09-15T15:00:00Z") });
    expect(read.error).toBeUndefined();
    const searches = calls.filter((c) => c.includes("efts.sec.gov"));
    expect(searches).toHaveLength(1);
    expect(searches[0]).toContain("ciks=0000723125,0001045810");
    expect(searches[0]).toContain("startdt=2026-09-11&enddt=2026-09-15");
    expect(read.byTicker.get("MU")?.map((f) => f.items)).toEqual([["5.02", "9.01"]]);
    expect(read.byTicker.get("NVDA")?.map((f) => f.filedDate)).toEqual(["2026-09-03", "2026-08-26", "2026-08-17"]);
  });

  it("a failed search is an error in words, not an empty book", async () => {
    mockFetch(() => new Response("rate limited", { status: 429 }));
    const read = await fetchBookFilings({ tickers: ["MU"], now: new Date() });
    expect(read.byTicker.size).toBe(0);
    expect(read.error).toBe("EDGAR search returned 429");
  });

  it("an intermittent 500 is retried once", async () => {
    let n = 0;
    const calls = mockFetch(() =>
      ++n === 1 ? new Response('{"message": "Internal server error"}', { status: 500 }) : new Response(JSON.stringify(fixture), { status: 200 }),
    );
    const read = await fetchBookFilings({ tickers: ["MU"], now: new Date("2026-09-15T15:00:00Z"), lookbackDays: 45 });
    expect(read.error).toBeUndefined();
    expect(calls.filter((c) => c.includes("efts.sec.gov"))).toHaveLength(2);
    expect(read.byTicker.get("MU")).toHaveLength(1);
  });

  it("an unreachable ticker list is an error too", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const read = await fetchBookFilings({ tickers: ["MU"], now: new Date() });
    expect(read.error).toBe("SEC's ticker list couldn't be reached");
  });
});
