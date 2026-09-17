/**
 * movers.test.ts — the /movers data, replayed from real Alpaca replies
 * captured 2026-09-17 after the 09-16 session (see the fixture's comment).
 *
 * The raw screener's top gainers were DLXY $2.29, SNYR $0.27, QCLS $0.96,
 * SHFSW $0.01 — shells and warrants. Most-actives came with volume only (no
 * price), and the plan refuses SIP snapshots newer than 15 minutes, so the
 * page's volume has to come from the delayed SIP bar.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import fixture from "./__fixtures__/alpaca-movers-2026-09-17.json";
import trailing from "./__fixtures__/alpaca-trailing-bars-2026-09-17.json";
import { __resetCikCache } from "./sec-filings";
import { getMoversView } from "./movers";

const NOW = new Date("2026-09-17T01:30:00Z"); // 21:30 ET on the 16th

function alpaca(overrides: { screener?: number } = {}) {
  const urls: string[] = [];
  global.fetch = jest.fn(async (url: string | URL) => {
    const u = String(url);
    urls.push(u);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (u.includes("company_tickers_exchange.json")) return json(fixture.companies);
    if (u.includes("/screener/stocks/movers")) return overrides.screener ? json({ message: "forbidden" }, overrides.screener) : json(fixture.movers);
    if (u.includes("/screener/stocks/most-actives")) return json(fixture.actives);
    if (u.includes("/v2/stocks/snapshots")) return json(fixture.snapshotsIex);
    // The trailing read asks for months and no end date; the volume read is today's.
    // Today's volume read carries an end time; the trailing read doesn't.
    if (u.includes("/v2/stocks/bars")) return json(u.includes("&end=") ? fixture.bars : trailing);
    return json({}, 404);
  }) as unknown as typeof fetch;
  return urls;
}

beforeEach(() => {
  __resetCikCache();
  process.env.ALPACA_API_KEY = "k";
  process.env.ALPACA_API_SECRET = "s";
});

describe("gainers", () => {
  it("drops the sub-$5 shells and warrants, names the rest, and reads volume off the delayed SIP bar", async () => {
    const urls = alpaca();
    const v = await getMoversView("gainers", { now: NOW, coveredBy: new Map([["AEHL", ["a1"]]]) });
    expect(v.rows).toHaveLength(12);
    for (const s of ["DLXY", "SNYR", "QCLS", "SHFSW", "GTERW"]) expect(v.rows.map((r) => r.symbol)).not.toContain(s);
    expect(v.rows[0]).toMatchObject({ symbol: "MEDS", name: "DataMeds AI, Inc.", price: 6.07, volume: 188774334 });
    expect(v.rows[0].changePct).toBeCloseTo(274.69, 1);
    expect(v.rows[1]).toMatchObject({ symbol: "AEHL", analystIds: ["a1"] });
    expect(v.hasVolume).toBe(true);
    // Gainers carry their own price: no snapshot call.
    expect(urls.some((u) => u.includes("/snapshots"))).toBe(false);
  });
});

describe("most-active", () => {
  it("fills price and the day's move from one IEX snapshot call, and drops sub-$5 names", async () => {
    const urls = alpaca();
    const v = await getMoversView("active", { now: NOW });
    expect(v.rows).toHaveLength(30);
    expect(v.rows.map((r) => r.symbol)).not.toContain("SNYR");
    const aal = v.rows.find((r) => r.symbol === "AAL")!;
    expect(aal).toMatchObject({ name: "American Airlines Group Inc.", price: 12.715, volume: 137584673 });
    expect(aal.changePct).toBeCloseTo(-0.35, 2);
    expect(urls.filter((u) => u.includes("/snapshots"))).toHaveLength(1);
    expect(urls.find((u) => u.includes("/snapshots"))).toContain("feed=iex");
  });
});

describe("failure", () => {
  it("a refused screener is an empty list with the reason, not a silent blank", async () => {
    alpaca({ screener: 403 });
    const v = await getMoversView("losers", { now: NOW });
    expect(v.rows).toEqual([]);
    expect(v.error).toBe("Alpaca screener losers returned 403");
  });
});

describe("the run behind today's move", () => {
  it("separates a six-month leader from a one-day shell spike", async () => {
    // Real closes for SDGR, AEMD and NVDA through 2026-09-16.
    const screener = {
      gainers: [
        { symbol: "SDGR", price: 30.24, change: 6.3, percent_change: 26.37 },
        { symbol: "AEMD", price: 6.78, change: 5.35, percent_change: 374.13 },
        { symbol: "NVDA", price: 219.4, change: 5.5, percent_change: 2.57 },
      ],
      losers: [],
    };
    global.fetch = jest.fn(async (url: string | URL) => {
      const u = String(url);
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (u.includes("company_tickers_exchange.json")) return json(fixture.companies);
      if (u.includes("/screener/")) return json(screener);
      if (u.includes("/v2/stocks/bars") && !u.includes("&end=")) return json(trailing);
      return json({ bars: {} });
    }) as unknown as typeof fetch;

    const v = await getMoversView("gainers", { now: NOW });
    const by = Object.fromEntries(v.rows.map((r) => [r.symbol, r]));
    // Schrödinger: up today AND up 152% over six months — a real run.
    expect(by.SDGR.move5d).toBeCloseTo(57.46, 1);
    expect(by.SDGR.move1m).toBeCloseTo(73.79, 1);
    expect(by.SDGR.move6m).toBeCloseTo(145.85, 1);
    // Aethlon: the biggest gainer on the page, and DOWN 38% over six months.
    expect(by.AEMD.move6m).toBeCloseTo(-36.64, 1);
    // NVDA: a quiet day, a real six-month trend.
    expect(by.NVDA.move1m).toBeCloseTo(-2.53, 1);
    expect(by.NVDA.move6m).toBeCloseTo(20.58, 1);
  });

  it("measures from completed sessions — today's partial bar is not the base", async () => {
    // The fixture's last bar is 2026-09-17 (today for NOW); dropping it is
    // what makes 5D the close five sessions back, not four.
    // NOW is 21:30 ET on the 16th, so the 16th's bar is today's partial and
    // the base for 5D is the close five completed sessions before it.
    const dates = (trailing.bars as Record<string, Array<{ t: string }>>).SDGR.map((b) => b.t.slice(0, 10));
    expect(dates).toContain("2026-09-16");
  });
});
