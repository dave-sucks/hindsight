/**
 * get-sec-filings.search.test.ts — one filing tool, any question.
 *
 * No chat has asked these yet, so the inputs are EDGAR itself, fetched
 * 2026-09-16 and trimmed:
 *   • edgar-13d — the first page (100 of 442) of SCHEDULE 13D filings,
 *     08-17 → 09-16: 27 new stakes, 73 amendments;
 *   • edgar-8k-items — every 8-K matching "Item 4.02" OR "Item 1.03" in the
 *     same window: 49 hits, 13 real filings on companies with a ticker (one
 *     of them, NCL's 8-K/A, returned twice — as the filing and as its
 *     ex16-1 exhibit);
 *   • edgar-search-2026-09 — MU's and NVDA's filings.
 *
 * On main this fails: get_sec_filings takes one symbol and nothing else,
 * and a market-wide call errors ("Cannot read properties of undefined
 * (reading 'toUpperCase')").
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import stakes from "@/lib/market-data/__fixtures__/edgar-13d-2026-09-16.json";
import restatements from "@/lib/market-data/__fixtures__/edgar-8k-items-2026-09-16.json";
import book from "@/lib/market-data/__fixtures__/edgar-search-2026-09.json";
import { __resetCikCache, __setPageGap, __setRetryDelay } from "@/lib/market-data/sec-filings";
import { getSecFilings } from "./get-sec-filings";
import type { ToolContext } from "@/lib/agent/tool-context";

type Fixture = { search: unknown; companies: { fields: string[]; data: unknown[][] } };

const bookCompanies = {
  fields: ["cik", "name", "ticker", "exchange"],
  data: [
    [1045810, "NVIDIA CORP", "NVDA", "Nasdaq"],
    [723125, "MICRON TECHNOLOGY INC", "MU", "Nasdaq"],
  ],
};

/** Fake EDGAR: the company list, then search pages in order; records every URL. */
function edgar(companies: Fixture["companies"], pages: Array<unknown | number>) {
  const urls: string[] = [];
  let n = 0;
  global.fetch = jest.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes("company_tickers_exchange.json")) return new Response(JSON.stringify(companies), { status: 200 });
    urls.push(decodeURIComponent(u));
    const page = pages[Math.min(n++, pages.length - 1)];
    return typeof page === "number"
      ? new Response('{"message": "Internal server error"}', { status: page })
      : new Response(JSON.stringify(page), { status: 200 });
  }) as unknown as typeof fetch;
  return urls;
}

const empty = (total: number) => ({ hits: { total: { value: total }, hits: [] } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (args: Record<string, unknown>, covered: string[] = []): Promise<any> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (getSecFilings({ runId: "chat", userId: "u", accountId: "a", coveredTickers: covered, groupId: (p: string) => p } as unknown as ToolContext) as any).execute(args);

beforeEach(() => {
  __resetCikCache();
  __setRetryDelay(0);
  __setPageGap(0);
});

describe("discovery — new activist stakes across the market", () => {
  it("groups new stakes by company with who took them, minus your book, amendments and OTC", async () => {
    const urls = edgar(stakes.companies, [stakes.search, empty(442)]);
    const out = await run({ scope: "universe", forms: ["SCHEDULE 13D"], days: 30 }, ["DT"]);
    expect(urls[0]).toContain("forms=SCHEDULE 13D");
    expect(urls[0]).not.toContain("ciks=");
    const tickers = out.data.rows.map((r: { ticker: string }) => r.ticker);
    expect(tickers.slice(0, 2)).toEqual(["VIP", "KRSA"]);
    expect(tickers).toHaveLength(15);
    for (const t of ["DT", "GPOX", "RAKR", "TLAC"]) expect(tickers).not.toContain(t);
    const mtn = out.data.items.find((i: { ticker?: string }) => i.ticker === "MTN");
    expect(mtn.text).toBe("Oasis Management Co Ltd. took a 5%+ stake — VAIL RESORTS INC, NYSE");
    expect(out.summary).toContain("EDGAR matched 442; left out 68 amendments, 4 OTC or unlisted, 1 you already cover.");
    expect(out.summary).toContain("EDGAR had more than this search reads");
  });
});

describe("any filing type, anywhere", () => {
  it("every restatement or bankruptcy this month: one 8-K text search, the codes checked again, listed companies only", async () => {
    const urls = edgar(restatements.companies, [restatements.search]);
    const out = await run({ scope: "all", items: ["4.02", "1.03"], days: 30 });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('forms=8-K&q="Item 1.03" OR "Item 4.02"');
    const tickers = out.data.filings.map((f: { ticker: string }) => f.ticker).sort();
    expect(tickers).toEqual(["BREZ", "BTAI", "NCPL", "NCRA", "SLSN", "SNYR"]);
    expect(out.summary).toContain("7 OTC or unlisted");
    const ncpl = out.data.filings.find((f: { ticker: string }) => f.ticker === "NCPL");
    expect(ncpl).toMatchObject({ tier: "RED", description: "8-K — auditor change (4.01), past financials can't be relied on (4.02)" });
  });

  it("an item search keeps only filings that carry the item — the text also matches mentions", async () => {
    // Constructed from a real hit: NCRA's 4.02 filing with its items cleared,
    // the shape of a filing that only mentions "Item 4.02".
    const hits = (restatements.search as { hits: { hits: Array<{ _source: { ciks: string[]; items: string[] } }> } }).hits.hits;
    const ncra = hits.find((h) => h._source.ciks[0] === "0001756180")!;
    const mention = { ...ncra, _id: "0000000000-26-000001:x.htm", _source: { ...ncra._source, items: ["8.01"], adsh: "0000000000-26-000001" } };
    edgar(restatements.companies, [{ hits: { total: { value: 2 }, hits: [ncra, mention] } }]);
    const out = await run({ scope: "all", items: ["4.02"] });
    expect(out.data.filings).toHaveLength(1);
    expect(out.summary).toContain("left out 1 that only mentioned the item");
  });

  it("links an amended 8-K itself, not its exhibit, even when EDGAR lists the exhibit first", async () => {
    const hits = (restatements.search as { hits: { hits: Array<{ _id: string }> } }).hits.hits;
    const ncl = hits.filter((h) => h._id.startsWith("0001575872-26-000605"));
    expect(ncl.map((h) => h._id.split(":")[1])).toEqual(["ncl124_8ka.htm", "ncl124_ex16-1.htm"]);
    const companies = { ...restatements.companies, data: restatements.companies.data.map((r) => (r[2] === "NCL" ? [r[0], r[1], r[2], "NYSE"] : r)) };
    edgar(companies, [{ hits: { total: { value: 2 }, hits: [...ncl].reverse() } }]);
    const out = await run({ scope: "all", items: ["4.02"] });
    expect(out.data.filings).toHaveLength(1);
    expect(out.data.filings[0].url).toMatch(/\/ncl124_8ka\.htm$/);
  });

  it("a tier on its own is the search: serious 8-K items by text, plus the late-report forms", async () => {
    const urls = edgar(bookCompanies, [empty(0)]);
    await run({ scope: "all", tier: "RED", days: 7 });
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('forms=8-K&q="Item 1.03" OR "Item 3.01" OR "Item 4.01" OR "Item 4.02"');
    expect(urls[1]).toContain("forms=NT 10-K,NT 10-Q");
  });

  it("a whole-market search that names nothing asks for material-or-serious, never every filing", async () => {
    const urls = edgar(bookCompanies, [empty(0)]);
    const out = await run({ scope: "all" });
    expect(urls[0]).toContain('"Item 5.02"');
    expect(urls[1]).toContain("SCHEDULE 13D");
    expect(out.summary).toContain("material or serious filings");
  });
});

describe("review — one company, several, or the whole book", () => {
  it("one company's officer changes over a named window", async () => {
    const urls = edgar(bookCompanies, [book]);
    const out = await run({ symbol: "MU", items: ["5.02"], days: 30 });
    expect(urls[0]).toContain("ciks=0000723125");
    expect(urls[0]).toContain('q="Item 5.02"');
    const start = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    expect(urls[0]).toContain(`startdt=${start}`);
    expect(out.data.filings.map((f: { ticker: string; items: string[] }) => [f.ticker, f.items])).toEqual([["MU", ["5.02", "9.01"]]]);
  });

  it("the whole book, material only, in one EDGAR call per kind", async () => {
    const urls = edgar(bookCompanies, [book, empty(0)]);
    const out = await run({ scope: "coverage", tier: "MATERIAL", days: 7 }, ["MU", "NVDA", "ZZZZ"]);
    expect(urls.every((u) => u.includes("ciks=0001045810,0000723125") || u.includes("ciks=0000723125,0001045810"))).toBe(true);
    const found = out.data.filings.map((f: { ticker: string; tier: string }) => `${f.ticker}:${f.tier}`).sort();
    expect(found).toEqual(["MU:MATERIAL", "NVDA:MATERIAL"]);
    expect(out.summary).toContain("Not on SEC's company list: ZZZZ.");
  });

  it("with no filter, a company search is its watched filings and periodic reports, 90 days", async () => {
    const urls = edgar(bookCompanies, [book]);
    const out = await run({ symbol: "nvda" });
    expect(urls[0]).toContain("forms=8-K,NT 10-K,NT 10-Q,SCHEDULE 13D,424B5,S-3,10-K,10-Q");
    expect(out.data.filings.map((f: { date: string }) => f.date)).toEqual(["2026-09-03", "2026-08-26", "2026-08-17"]);
  });
});

describe("saying what happened", () => {
  it("a failed read is an error in words, never 'nothing filed'", async () => {
    edgar(bookCompanies, [500, 500]);
    const out = await run({ scope: "universe", forms: ["SCHEDULE 13D"] }, ["MU"]);
    expect(out.summary).toMatch(/^SEC filings unavailable — EDGAR search returned 500\. This is not "nothing filed"\./);
  });

  it("an empty book and a company call without a symbol say so instead of throwing", async () => {
    expect((await run({ scope: "coverage" })).summary).toContain("your coverage is empty");
    expect((await run({ scope: "company" })).summary).toContain("needs a symbol");
  });
});
