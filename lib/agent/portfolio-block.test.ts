/**
 * The Market and portfolio block every agent that decides on stocks is given:
 * the latest market digest, the portfolio snapshot, written for the request,
 * and the latest portfolio digest, each digest from the last 4 days. A part
 * that can't be read says so; the block never throws.
 * Stand-in book (lib/agent/__fixtures__/portfolio-snapshot-standin.ts).
 */
import { STANDIN_SNAPSHOT } from "@/lib/agent/__fixtures__/portfolio-snapshot-standin";
import { snapshotText } from "@/lib/portfolio/snapshot";

const loadPortfolioSnapshot = jest.fn();
const findFirst = jest.fn();
const marketFindFirst = jest.fn();
jest.mock("@/lib/portfolio/load-snapshot", () => ({ loadPortfolioSnapshot: (...a: unknown[]) => loadPortfolioSnapshot(...a) }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    portfolioDigest: { findFirst: (...a: unknown[]) => findFirst(...a) },
    marketDigest: { findFirst: (...a: unknown[]) => marketFindFirst(...a) },
  },
}));

import { loadPortfolioBlock } from "./portfolio-block";

const NOW = new Date("2026-11-12T13:00:00Z"); // 8 AM ET, Thu Nov 12
const DIGEST = { narrative: "The account had a good day.", createdAt: new Date("2026-11-12T01:00:00Z") }; // 8 PM ET, Wed Nov 11
const MARKET = { digest: "### Market overview\n\nStocks rose.\n\nSources: [Reuters](https://example.com/r)", createdAt: new Date("2026-11-11T12:40:00Z") }; // 7:40 AM ET, Wed Nov 11
const MARKET_PART = "### Market digest (written Wed, Nov 11, 7:40 AM ET)\n#### Market overview\n\nStocks rose.\n\nSources: [Reuters](https://example.com/r)";

beforeEach(() => {
  loadPortfolioSnapshot.mockReset().mockResolvedValue(STANDIN_SNAPSHOT);
  findFirst.mockReset().mockResolvedValue(DIGEST);
  marketFindFirst.mockReset().mockResolvedValue(MARKET);
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("the Market and portfolio block", () => {
  it("is the snapshot's text, then the latest digest stamped with when it was written", async () => {
    const block = await loadPortfolioBlock({ accountId: "acct", environment: "LIVE", now: NOW });
    expect(block).toBe(
      ["## Market and portfolio", "", MARKET_PART, "", "### Portfolio snapshot", snapshotText(STANDIN_SNAPSHOT), "", "### Portfolio digest (written Wed, Nov 11, 8:00 PM ET)", "The account had a good day."].join("\n"),
    );
    expect(loadPortfolioSnapshot).toHaveBeenCalledWith({ accountId: "acct", environment: "LIVE", now: NOW });
    // A digest the old writer wrote (gpt-4o, from the run-log dump) is never given to an agent.
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: "acct", environment: "LIVE", NOT: { model: "gpt-4o" } }, orderBy: { date: "desc" } }));
  });

  it("the market digest's own section headings sit one level down, inside its part", async () => {
    const block = await loadPortfolioBlock({ accountId: "acct", environment: "LIVE", now: NOW });
    expect(block).toContain("#### Market overview");
    expect(block.match(/^### /gm)).toEqual(["### ", "### ", "### "]);
    expect(marketFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: "acct", environment: "LIVE" }, orderBy: { date: "desc" } }));
  });

  it("any heading in the market digest, even a stray # or ##, sits below the block's own", async () => {
    marketFindFirst.mockResolvedValue({ ...MARKET, digest: "# Today\n\n## Overview\n\nStocks rose." });
    const block = await loadPortfolioBlock({ accountId: "acct", environment: "LIVE", now: NOW });
    expect(block).toContain("#### Today\n\n#### Overview\n\nStocks rose.");
    expect(block.match(/^#{1,2} /gm)).toEqual(["## "]);
  });

  it("a market digest older than 4 days reads as none", async () => {
    marketFindFirst.mockResolvedValue({ ...MARKET, createdAt: new Date("2026-11-06T12:40:00Z") });
    const block = await loadPortfolioBlock({ accountId: "acct", environment: "LIVE", now: NOW });
    expect(block).toContain("### Market digest\nNo market digest in the last 4 days.");
    expect(block).not.toContain("Stocks rose.");
  });

  it("no market digest yet (before the first 7:30 run), or a failed read, reads as none", async () => {
    const none = "### Market digest\nNo market digest in the last 4 days.\n\n### Portfolio snapshot";
    marketFindFirst.mockResolvedValue(null);
    expect(await loadPortfolioBlock({ accountId: "acct", environment: "LIVE", now: NOW })).toContain(none);
    marketFindFirst.mockRejectedValue(new Error("no such table"));
    expect(await loadPortfolioBlock({ accountId: "acct", environment: "LIVE", now: NOW })).toContain(none);
  });

  it("a digest older than 4 days reads as none", async () => {
    findFirst.mockResolvedValue({ ...DIGEST, createdAt: new Date("2026-11-07T01:00:00Z") });
    const block = await loadPortfolioBlock({ accountId: "acct", environment: "LIVE", now: NOW });
    expect(block).toContain("### Portfolio digest\nNo digest written from the portfolio snapshot in the last 4 days.");
    expect(block).not.toContain("The account had a good day.");
  });

  it("a snapshot that can't be read says so in one line; the digest still comes", async () => {
    loadPortfolioSnapshot.mockRejectedValue(new Error("broker 503"));
    const block = await loadPortfolioBlock({ accountId: "acct", environment: "LIVE", now: NOW });
    expect(block).toContain("### Portfolio snapshot\nThe portfolio snapshot couldn't be read for this request.");
    expect(block).toContain("The account had a good day.");
  });

  it("never throws: a database that can't be read gives the block's heading and one line", async () => {
    findFirst.mockImplementation(() => {
      throw new Error("no such table");
    });
    const block = await loadPortfolioBlock({ accountId: "acct", environment: "PAPER", now: NOW });
    expect(block).toBe("## Market and portfolio\n\nThe portfolio snapshot and the digest couldn't be read for this request.");
  });
});

describe("a slow snapshot", () => {
  it("is given up at the caller's wait, and the block says so", async () => {
    jest.useFakeTimers();
    try {
      loadPortfolioSnapshot.mockImplementation(() => new Promise(() => {}));
      const pending = loadPortfolioBlock({ accountId: "acct", environment: "LIVE", now: NOW, waitMs: 5_000 });
      await jest.advanceTimersByTimeAsync(5_000);
      expect(await pending).toContain("### Portfolio snapshot\nThe portfolio snapshot couldn't be read for this request.");
    } finally {
      jest.useRealTimers();
    }
  });
});
