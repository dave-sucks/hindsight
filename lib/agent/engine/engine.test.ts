/**
 * The agent engine builds an agent's request from its record, and moving an
 * agent onto it changes nothing it is sent (docs/plans/AGENT_ENGINE.md).
 *
 * The Portfolio Manager's request was frozen from its old builder
 * (lib/agent/portfolio-manager/prompt.ts, deleted in the same change) on the
 * stand-in book (lib/agent/__fixtures__), before the move:
 * ./__fixtures__/portfolio-manager.golden.json.
 */
import GOLDEN from "./__fixtures__/portfolio-manager.golden.json";
import { STANDIN_SNAPSHOT } from "@/lib/agent/__fixtures__/portfolio-snapshot-standin";
import { STANDIN_MARKET_NUMBERS } from "@/lib/agent/__fixtures__/market-numbers-standin";

const loadPortfolioSnapshot = jest.fn();
const marketDigest = jest.fn();
jest.mock("@/lib/market-data/load-market-numbers", () => ({ loadMarketNumbers: async () => STANDIN_MARKET_NUMBERS }));
jest.mock("@/lib/portfolio/load-snapshot", () => ({ loadPortfolioSnapshot: (...a: unknown[]) => loadPortfolioSnapshot(...a) }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    portfolioDigest: { findFirst: async () => ({ narrative: "The account had a good day.", createdAt: new Date("2026-11-12T01:00:00Z") }) },
    marketDigest: { findFirst: (...a: unknown[]) => marketDigest(...a) },
    runEvent: { findFirst: async () => ({ message: "### Where the money is\nTwo stocks, one bet.", createdAt: new Date("2026-11-10T15:30:00Z") }) },
  },
}));

import { buildAgentRequest, type Sources } from "./engine";
import { PORTFOLIO_MANAGER } from "./agents/portfolio-manager";
import { loadPortfolioPieces } from "@/lib/agent/portfolio-block";
import { lastWriteup } from "@/lib/agent/portfolio-manager/run";
import { byParts } from "@/lib/agent/run-requests";

const NOW = new Date(GOLDEN.now);
const book = { accountId: "acct", environment: "LIVE" as const };
const sources: Sources = {
  portfolioPieces: (want) => loadPortfolioPieces({ ...book, now: NOW, ...want }),
  lastWriteup: () => lastWriteup(book),
};

beforeEach(() => {
  loadPortfolioSnapshot.mockReset().mockResolvedValue(STANDIN_SNAPSHOT);
  marketDigest.mockReset().mockResolvedValue({ digest: "### Market overview\n\nStocks rose.", createdAt: new Date("2026-11-11T12:40:00Z") });
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("the Portfolio Manager on the engine", () => {
  it("is sent what its old builder sent, character for character", async () => {
    const built = await buildAgentRequest(PORTFOLIO_MANAGER, { now: NOW, environment: "LIVE" }, sources);
    expect(built.instructions).toBe(GOLDEN.system);
    expect(built.message).toBe(GOLDEN.message);
  });

  it("has the tools its old run listed, in the same order", () => {
    expect(PORTFOLIO_MANAGER.tools).toEqual(["get_theses", "get_stock_data", "update_thesis", "place_trade", "manage_position", "close_position", "dispatch_thesis_research"]);
  });

  it("asks the block for the Watching part and not the 8 PM digest, because its record lists the one and not the other", async () => {
    const want = jest.fn(sources.portfolioPieces!);
    await buildAgentRequest(PORTFOLIO_MANAGER, { now: NOW, environment: "LIVE" }, { ...sources, portfolioPieces: want });
    expect(want).toHaveBeenCalledTimes(1);
    expect(want).toHaveBeenCalledWith({ watching: true, portfolioDigest: false });
  });

  it("names every part of the request, in order, and the parts add up to what is sent", async () => {
    const built = await buildAgentRequest(PORTFOLIO_MANAGER, { now: NOW, environment: "LIVE" }, sources);
    expect(built.parts.map((p) => `${p.where}:${p.title}`)).toEqual([
      "instructions:Its role",
      "instructions:House rules",
      "instructions:How you write",
      "instructions:Market numbers",
      "instructions:Market digest",
      "instructions:Portfolio snapshot",
      "instructions:Watching",
      "instructions:Your job",
      "instructions:What you may do",
      "instructions:Rules",
      "instructions:Your write-up",
      "instructions:Unattended",
      "message:The day",
      "message:Its last write-up",
    ]);
    const rows = byParts(built.parts, built.instructions, built.message);
    expect(rows?.map((r) => r.name)).toEqual(built.parts.map((p) => p.title));
    const textOf = (where: string) => rows!.filter((_, i) => built.parts[i].where === where).map((r) => r.sections[0].text).join("\n\n");
    expect(textOf("instructions")).toBe(built.instructions);
    expect(textOf("message")).toBe(built.message);
    // The Market and portfolio heading prints once, on the first of its parts.
    expect(rows?.find((r) => r.name === "Market numbers")?.sections[0].text.startsWith("## Market and portfolio\n\n### Market numbers")).toBe(true);
    expect(built.instructions.match(/^## Market and portfolio$/gm)).toHaveLength(1);
  });

  it("a block that can't be read prints its one line under the heading, as before", async () => {
    const built = await buildAgentRequest(PORTFOLIO_MANAGER, { now: NOW, environment: "LIVE" }, { ...sources, portfolioPieces: async () => [{ id: "unreadable", text: "The portfolio snapshot and the digest couldn't be read for this request." }] });
    expect(built.instructions).toContain("\n\n## Market and portfolio\n\nThe portfolio snapshot and the digest couldn't be read for this request.\n\n## Your job\n");
    expect(built.parts.filter((p) => p.where === "instructions").map((p) => p.title)).toContain("Market numbers");
  });
});

describe("the Context panel's rows", () => {
  it("a request that doesn't add up to its parts falls back to the headings", () => {
    expect(byParts([{ id: "role", title: "Its role", kind: "own", where: "instructions", source: "x", chars: 5 }], "Hello world", "")).toBeNull();
  });
});
