/**
 * sec-filings.symbol.test.ts — the one-company read behind the stock page's
 * Filings tab, the thesis sheet's filings line and `get_sec_filings`.
 *
 * Rows are the real EDGAR fixture (fetched 2026-09-15): MU's Aug 26 officer
 * change and NVDA's three 8-Ks in 17 days.
 */

import fixture from "./__fixtures__/edgar-search-2026-09.json";
import {
  __resetCikCache,
  __setRetryDelay,
  getFilingsForSymbol,
  parseSearchHits,
  SYMBOL_FILING_FORMS,
} from "./sec-filings";

// SEC's company_tickers_exchange.json shape, real rows.
const tickerList = {
  fields: ["cik", "name", "ticker", "exchange"],
  data: [
    [1045810, "NVIDIA CORP", "NVDA", "Nasdaq"],
    [723125, "MICRON TECHNOLOGY INC", "MU", "Nasdaq"],
  ],
};

function mockFetch(search: () => Response) {
  const calls: string[] = [];
  global.fetch = jest.fn(async (url: string | URL) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("company_tickers_exchange.json")) return new Response(JSON.stringify(tickerList), { status: 200 });
    return search();
  }) as unknown as typeof fetch;
  return calls;
}

describe("getFilingsForSymbol", () => {
  beforeEach(() => {
    __resetCikCache();
    __setRetryDelay(0);
  });

  it("returns one company's filings newest first, and asks for the periodic reports too", async () => {
    const calls = mockFetch(() => new Response(JSON.stringify(fixture), { status: 200 }));
    const read = await getFilingsForSymbol("nvda", { now: new Date("2026-09-15T15:00:00Z") });
    expect(read.symbol).toBe("NVDA");
    expect(read.days).toBe(90);
    expect(read.error).toBeUndefined();
    expect(read.filings.map((f) => f.filedDate)).toEqual(["2026-09-03", "2026-08-26", "2026-08-17"]);
    const search = calls.find((c) => c.includes("efts.sec.gov"))!;
    expect(search).toContain("startdt=2026-06-17");
    for (const form of SYMBOL_FILING_FORMS) expect(search).toContain(encodeURIComponent(form));
  });

  it("the sheet's month window asks EDGAR for a month", async () => {
    const calls = mockFetch(() => new Response(JSON.stringify(fixture), { status: 200 }));
    await getFilingsForSymbol("MU", { days: 30, now: new Date("2026-09-15T15:00:00Z") });
    expect(calls.find((c) => c.includes("efts.sec.gov"))).toContain("startdt=2026-08-16");
  });

  it("a failed read is an error in words — the surfaces must not print 'nothing filed'", async () => {
    mockFetch(() => new Response("rate limited", { status: 429 }));
    const read = await getFilingsForSymbol("MU", { now: new Date() });
    expect(read.filings).toEqual([]);
    expect(read.error).toBe("EDGAR search returned 429");
  });
});

describe("the document link", () => {
  it("links the filing itself, not one of its exhibits, whichever EDGAR returns first", () => {
    // MU's real Aug 26 filing, exhibit listed first (the order EDGAR gives is
    // not guaranteed; measured 2026-09-15, all 92 book filings came back as a
    // single document, so this is a safety net).
    const mu = fixture.hits.hits.filter((h) => h._source.adsh === "0001104659-26-101067");
    const exhibitFirst = [...mu].reverse();
    expect(exhibitFirst[0]._id).toContain("ex99-1");
    const rows = parseSearchHits(exhibitFirst, new Map([["0000723125", "MU"]]));
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe(
      "https://www.sec.gov/Archives/edgar/data/723125/000110465926101067/tm2624017d1_8k.htm",
    );
  });
});
