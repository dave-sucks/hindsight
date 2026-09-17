/**
 * get-sec-filings.test.ts — what the agent reads about one company. The old
 * tool listed "8-K, Aug 26" with no idea it was MU's officer change, and
 * reported any failure as "No recent filings".
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import fixture from "@/lib/market-data/__fixtures__/edgar-search-2026-09.json";
import { __resetCikCache, __setRetryDelay } from "@/lib/market-data/sec-filings";
import { getSecFilings } from "./get-sec-filings";
import type { ToolContext } from "@/lib/agent/tool-context";

const companies = {
  fields: ["cik", "name", "ticker", "exchange"],
  data: [[723125, "MICRON TECHNOLOGY INC", "MU", "Nasdaq"]],
};

function edgar(search: () => Response) {
  global.fetch = jest.fn(async (url: string | URL) =>
    String(url).includes("company_tickers_exchange.json")
      ? new Response(JSON.stringify(companies), { status: 200 })
      : search(),
  ) as unknown as typeof fetch;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (): Promise<any> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (getSecFilings({ runId: "r", userId: "u", accountId: "a", groupId: (p: string) => p } as unknown as ToolContext) as any).execute({ symbol: "mu" });

beforeEach(() => {
  __resetCikCache();
  __setRetryDelay(0);
});

describe("get_sec_filings, one company", () => {
  it("names MU's Aug 26 8-K as an officer change, material, with its link", async () => {
    edgar(() => new Response(JSON.stringify(fixture), { status: 200 }));
    const out = await run();
    expect(out.ok).toBe(true);
    expect(out.data.filings[0]).toMatchObject({
      date: "2026-08-26",
      description: "8-K — officer or director leaving or joining (5.02)",
      tier: "MATERIAL",
    });
    expect(out.data.items[1].text).toBe("8-K — officer or director leaving or joining (5.02) · material");
    expect(out.sources.map((s: { url: string }) => s.url)).toContain(
      "https://www.sec.gov/Archives/edgar/data/723125/000110465926101067/tm2624017d1_8k.htm",
    );
  });

  it("says EDGAR was unavailable — never 'no filings' — when the read failed", async () => {
    edgar(() => new Response("rate limited", { status: 429 }));
    const out = await run();
    expect(out.summary).toMatch(/^SEC filings unavailable — EDGAR search returned 429\. This is not "nothing filed"\./);
    expect(out.data.error).toBe("EDGAR search returned 429");
  });
});
