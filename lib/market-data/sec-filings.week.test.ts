/**
 * sec-filings.week.test.ts — the week behind /earnings → Filings, on real
 * EDGAR pages: MU's and NVDA's filings as the book, and the real "Item 4.02
 * OR Item 1.03" search as the market.
 */

import book from "./__fixtures__/edgar-search-2026-09.json";
import restatements from "./__fixtures__/edgar-8k-items-2026-09-16.json";
import { __resetCikCache, __setPageGap, __setRetryDelay, getFilingsWeek } from "./sec-filings";

const companies = {
  fields: restatements.companies.fields,
  data: [...restatements.companies.data, [1045810, "NVIDIA CORP", "NVDA", "Nasdaq"], [723125, "MICRON TECHNOLOGY INC", "MU", "Nasdaq"]],
};

function edgar(onSearch: (u: string) => unknown) {
  const urls: string[] = [];
  global.fetch = jest.fn(async (url: string | URL) => {
    const u = decodeURIComponent(String(url));
    if (u.includes("company_tickers_exchange.json")) return new Response(JSON.stringify(companies), { status: 200 });
    urls.push(u);
    return new Response(JSON.stringify(onSearch(u)), { status: 200 });
  }) as unknown as typeof fetch;
  return urls;
}
const empty = { hits: { total: { value: 0 }, hits: [] } };

beforeEach(() => {
  __resetCikCache();
  __setRetryDelay(0);
  __setPageGap(0);
});

describe("getFilingsWeek", () => {
  it("your names first, then listed serious filings; counted per day; Sunday to Saturday", async () => {
    const urls = edgar((u) => (u.includes("ciks=") ? book : u.includes("Item 4.02") ? restatements.search : empty));
    const coveredBy = new Map([["MU", ["a1"]], ["NVDA", ["a2"]]]);
    const w = await getFilingsWeek({ date: "2026-08-19", coveredBy, now: new Date("2026-09-17T02:00:00Z") });
    expect(w.weekStart).toBe("2026-08-16");
    expect(w.days.map((d) => d.date)).toEqual(["2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22"]);
    // The week's book filing (NVDA 08-17) leads; then listed restatements that week.
    expect(w.rows[0]).toMatchObject({ ticker: "NVDA", filedDate: "2026-08-17", analystIds: ["a2"] });
    const market = w.rows.slice(1).map((r) => `${r.filedDate}:${r.ticker}`);
    expect(market).toEqual(["2026-08-21:SLSN", "2026-08-18:NCPL", "2026-08-17:NCRA"]);
    expect(w.days.find((d) => d.date === "2026-08-17")!.count).toBe(2);
    // The market read is for the week ending Saturday.
    expect(urls.every((u) => u.includes("enddt=2026-08-22"))).toBe(true);
  });

  it("the same week again is served from memory — clicking between days doesn't search", async () => {
    const urls = edgar(() => empty);
    const opts = { coveredBy: new Map([["MU", ["a1"]]]), now: new Date("2026-09-17T02:00:00Z") };
    await getFilingsWeek({ date: "2026-09-01", ...opts });
    const first = urls.length;
    await getFilingsWeek({ date: "2026-09-03", ...opts });
    expect(urls.length).toBe(first);
  });

  it("a future week is empty without asking EDGAR, and a failed read says so", async () => {
    const urls = edgar(() => empty);
    const future = await getFilingsWeek({ date: "2026-12-01", coveredBy: new Map(), now: new Date("2026-09-17T02:00:00Z") });
    expect(future.rows).toEqual([]);
    expect(urls).toHaveLength(0);

    global.fetch = jest.fn(async (url: string | URL) =>
      String(url).includes("company_tickers_exchange.json")
        ? new Response(JSON.stringify(companies), { status: 200 })
        : new Response("{}", { status: 500 }),
    ) as unknown as typeof fetch;
    const failed = await getFilingsWeek({ date: "2026-08-05", coveredBy: new Map([["MU", ["a1"]]]), now: new Date("2026-09-17T02:00:00Z") });
    expect(failed.error).toBe("EDGAR search returned 500");
  });
});
