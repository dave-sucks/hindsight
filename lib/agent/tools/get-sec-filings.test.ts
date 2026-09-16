/**
 * get-sec-filings.test.ts — what the agent reads. The old tool listed
 * "8-K, Aug 26" with no idea it was MU's officer change, and reported any
 * failure as "No recent filings".
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import fixture from "@/lib/market-data/__fixtures__/edgar-search-2026-09.json";
import { parseSearchHits } from "@/lib/market-data/sec-filings";

const read = { byTicker: new Map(), error: undefined as string | undefined };
jest.mock("@/lib/market-data/sec-filings", () => ({
  ...jest.requireActual("@/lib/market-data/sec-filings"),
  fetchBookFilings: jest.fn(async () => read),
}));

import { getSecFilings } from "./get-sec-filings";
import type { ToolContext } from "@/lib/agent/tool-context";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (): Promise<any> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (getSecFilings({ runId: "r", userId: "u", accountId: "a", groupId: (p: string) => p } as unknown as ToolContext) as any).execute({ symbol: "mu" });

describe("get_sec_filings", () => {
  it("names MU's Aug 26 8-K as an officer change, material, with its link", async () => {
    read.byTicker = new Map([["MU", parseSearchHits(fixture.hits.hits, new Map([["0000723125", "MU"]]))]]);
    read.error = undefined;
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
    read.byTicker = new Map();
    read.error = "EDGAR search returned 429";
    const out = await run();
    expect(out.summary).toBe('SEC filings unavailable for $MU — EDGAR search returned 429. This is not "nothing filed".');
    expect(out.data.error).toBe("EDGAR search returned 429");
  });
});
