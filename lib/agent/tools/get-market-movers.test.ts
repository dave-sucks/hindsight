/**
 * get-market-movers.test.ts — what the agent reads off the movers list.
 *
 * Replayed from Alpaca's real 2026-09-17 gainers and their daily bars. The
 * top gainer that day was AEMD, +374% — and down 38% over six months. Eight
 * rows below it sat SDGR, +26% on the day and +152% over six months. The
 * day's percent alone cannot tell those apart, and the difference is the
 * whole momentum screen, so every row carries its 5-session, 1-month and
 * 6-month move too.
 *
 * The fixture keeps 136 daily bars per name — enough for the 126-session
 * read — for exactly the names the screener's $5 floor lets through. Three
 * of them (KATT, TEMC, USDE) are young listings with too little history for
 * the longer windows; those read as no answer rather than a number measured
 * off their first day.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import fixture from "@/lib/market-data/__fixtures__/alpaca-movers-runs-2026-09-17.json";
import { __resetCikCache } from "@/lib/market-data/sec-filings";
import { getMarketMovers } from "./get-market-movers";
import type { ToolContext } from "@/lib/agent/tool-context";

function alpaca() {
  const urls: string[] = [];
  global.fetch = jest.fn(async (url: string | URL) => {
    const u = String(url);
    urls.push(u);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (u.includes("/screener/stocks/movers")) return json(fixture.movers);
    // The screener returns symbols only; SEC's list names them. KATT isn't on
    // it — a symbol EDGAR doesn't carry keeps its row and its own name.
    if (u.includes("company_tickers_exchange.json"))
      return json({
        fields: ["cik", "name", "ticker", "exchange"],
        data: [
          [882291, "AETHLON MEDICAL INC", "AEMD", "Nasdaq"],
          [1490978, "Schrodinger, Inc.", "SDGR", "Nasdaq"],
        ],
      });
    if (u.includes("/v2/stocks/bars")) return json({ bars: fixture.bars });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return urls;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (args: Record<string, unknown>): Promise<any> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (getMarketMovers({ runId: "r", userId: "u", accountId: "a", groupId: (p: string) => p } as unknown as ToolContext) as any).execute(args);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bySymbol = (out: any, symbol: string) => out.data.rows.find((r: { symbol: string }) => r.symbol === symbol);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowFor = (out: any, symbol: string) => out.data.items.find((i: { ticker?: string }) => i.ticker === symbol);

beforeEach(() => {
  __resetCikCache();
  process.env.ALPACA_API_KEY = "k";
  process.env.ALPACA_API_SECRET = "s";
});

describe("get_market_movers", () => {
  it("reads the run behind today's move — AEMD is up 374% today and down 38% over six months", async () => {
    const urls = alpaca();
    const out = await run({ type: "gainers" });
    expect(out.ok).toBe(true);

    const aemd = bySymbol(out, "AEMD");
    expect(aemd.move5d).toBeCloseTo(329.1, 0);
    expect(aemd.move1m).toBeCloseTo(138.7, 0);
    expect(aemd.move6m).toBeCloseTo(-38.4, 0);
    expect(rowFor(out, "AEMD").tag).toBe("+374.13%");
    expect(rowFor(out, "AEMD").text).toBe("AETHLON MEDICAL INC · $6.78 · 5D +329% · 1M +139% · 6M -38%");

    // One batched bars call for the whole list, not one per name.
    expect(urls.filter((u) => u.includes("/v2/stocks/bars"))).toHaveLength(1);
  });

  it("separates the one-day pop from the name that has been climbing", async () => {
    alpaca();
    const out = await run({ type: "gainers" });
    // SDGR's day is the smaller one and the only one that is part of a run.
    const sdgr = bySymbol(out, "SDGR");
    expect(sdgr.percentChange).toBeLessThan(bySymbol(out, "AEMD").percentChange);
    expect(sdgr.move1m).toBeCloseTo(71.1, 0);
    expect(sdgr.move6m).toBeCloseTo(152.4, 0);
    // BIAF's 64% day sits on top of a six-month collapse.
    expect(bySymbol(out, "BIAF").move6m).toBeLessThan(-70);
  });

  it("a name too young for the window says nothing rather than measuring off its first day", async () => {
    alpaca();
    const out = await run({ type: "gainers" });
    const katt = bySymbol(out, "KATT"); // six sessions of history
    expect(katt.move5d).toBeCloseTo(29.5, 0);
    expect(katt.move1m).toBeNull();
    expect(katt.move6m).toBeNull();
    expect(rowFor(out, "KATT").text).toBe("KATT · $28.08 · 5D +30%");
    expect(rowFor(out, "KATT").text).not.toContain("6M");
  });
});
