/**
 * The agent engine builds an agent's request from its record: its
 * instructions, its context and its tools, the message last
 * (docs/plans/AGENT_ENGINE.md). Moving an agent onto the three parts changes
 * no words except the moves the plan names, and these tests prove it agent by
 * agent: each request is the golden its old builder sent, with only those
 * moves made.
 *
 * The goldens were frozen from the old builders on the stand-in book
 * (lib/agent/__fixtures__): ./__fixtures__/*.golden.json.
 */
import GOLDEN from "./__fixtures__/portfolio-manager.golden.json";
import DIGEST_GOLDEN from "./__fixtures__/portfolio-digest.golden.json";
import REVIEWER_GOLDEN from "./__fixtures__/market-reviewer.golden.json";
import { STANDIN_SNAPSHOT } from "@/lib/agent/__fixtures__/portfolio-snapshot-standin";
import { STANDIN_MARKET_NUMBERS } from "@/lib/agent/__fixtures__/market-numbers-standin";

const loadPortfolioSnapshot = jest.fn();
const marketDigest = jest.fn();
const theses = [
  { ticker: "AAA", status: "HOLDING", coreBelief: "The company sells a product people keep buying. More.", triggers: [], researchRun: { agentConfig: { name: "Case Analyst" } } },
  { ticker: "CCC", status: "WATCHING", coreBelief: "A strong quarter, and the base held.", triggers: [], researchRun: { agentConfig: { name: "Case Analyst" } } },
];
jest.mock("@/lib/market-data/load-market-numbers", () => ({ loadMarketNumbers: async () => STANDIN_MARKET_NUMBERS }));
jest.mock("@/lib/portfolio/load-snapshot", () => ({ loadPortfolioSnapshot: (...a: unknown[]) => loadPortfolioSnapshot(...a) }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    portfolioDigest: { findFirst: async () => ({ narrative: "The account had a good day.", createdAt: new Date("2026-11-12T01:00:00Z") }) },
    marketDigest: { findFirst: (...a: unknown[]) => marketDigest(...a) },
    runEvent: { findFirst: async () => ({ message: "### Where the money is\nTwo stocks, one bet.", createdAt: new Date("2026-11-10T15:30:00Z") }) },
    thesis: { findMany: async () => theses },
  },
}));

import { buildAgentRequest, composeAgentRequest, dateLine, openingOf, type Sources } from "./engine";
import { AGENTS } from "./agents";
import { PORTFOLIO_MANAGER } from "./agents/portfolio-manager";
import { loadPortfolioPieces, portfolioPieceText } from "@/lib/agent/portfolio-block";
import { lastWriteup } from "@/lib/agent/portfolio-manager/run";
import { loadBook } from "@/lib/agent/book";
import { byParts } from "@/lib/agent/run-requests";
import { PORTFOLIO_DIGEST } from "./agents/portfolio-digest";
import { MARKET_REVIEWER } from "./agents/market-reviewer";
import { isOwnPart } from "./types";

const NOW = new Date(GOLDEN.now);
const book = { accountId: "acct", environment: "LIVE" as const };
const sources: Sources = {
  portfolioPieces: (want) => loadPortfolioPieces({ ...book, now: NOW, ...want }),
  context: { the_book: () => loadBook(book), last_output: async () => `## Your last write-up\n${await lastWriteup(book)}` },
};

beforeEach(() => {
  loadPortfolioSnapshot.mockReset().mockResolvedValue(STANDIN_SNAPSHOT);
  marketDigest.mockReset().mockResolvedValue({ digest: "### Market overview\n\nStocks rose.", createdAt: new Date("2026-11-11T12:40:00Z") });
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

/** The parts of a text between two markers. */
const between = (text: string, from: string, to?: string) => text.slice(text.indexOf(from), to ? text.indexOf(to) : undefined);

describe("every agent is instructions, context and tools", () => {
  it("each record's own text is one fixed string, given once", () => {
    for (const r of AGENTS) {
      const own = r.instructions.filter(isOwnPart);
      expect([r.id, own.length, typeof own[0]?.own]).toEqual([r.id, 1, "string"]);
    }
  });

  it("the date line opens every first message: the date and time in New York, and the account", () => {
    expect(dateLine(NOW, "LIVE")).toBe("Thu, Nov 12, 2026, 10:00 AM ET, the LIVE account.");
    expect(dateLine(new Date("2026-07-01T23:05:00Z"), "PAPER")).toBe("Wed, Jul 1, 2026, 7:05 PM ET, the PAPER account.");
  });

  it("prints the message last, and the run page's opening is the message alone", () => {
    const built = composeAgentRequest(PORTFOLIO_DIGEST, { now: NOW, environment: "PAPER", message: "Write today's." }, { pieces: [{ id: "portfolio_snapshot", text: "### Portfolio snapshot\nS" }] });
    expect(built.message).toBe(`${dateLine(NOW, "PAPER")}\n\n## Market and portfolio\n\n### Portfolio snapshot\nS\n\nWrite today's.`);
    expect(built.parts.map((p) => `${p.kind}:${p.id}`)).toEqual(["own:own", "line:line", "context:portfolio", "message:message"]);
    expect(openingOf(built)).toBe("Write today's.");
  });

  it("refuses a read the record lists and the run didn't give, and situations for an agent with no stock", async () => {
    await expect(buildAgentRequest(PORTFOLIO_MANAGER, { now: NOW, environment: "LIVE" }, { portfolioPieces: sources.portfolioPieces })).rejects.toThrow("reads the_book");
    expect(() => composeAgentRequest(PORTFOLIO_DIGEST, { now: NOW, environment: "PAPER" }, { pieces: [], situations: "## Its situations" })).toThrow("its context has no stock");
  });
});

describe("the Portfolio Manager", () => {
  it("is its old request with only the documented moves: its context into the first message, Watching to the book, the day to the date line", async () => {
    const built = await buildAgentRequest(PORTFOLIO_MANAGER, { now: NOW, environment: "LIVE" }, sources);
    const old = GOLDEN.system;
    const role = old.slice(0, old.indexOf("\n\n"));
    const houseAndWrite = between(old, "The principal's words", "\n\n## Market and portfolio");
    const market = between(old, "## Market and portfolio", "\n\n## Your job");
    const job = old.slice(old.indexOf("## Your job"));
    // Its own text now names where the holdings and watches are (the one sentence that moved with them).
    const ownJob = job.replace(
      "The Portfolio snapshot above lists every stock we own and the Watching block every stock we watch.",
      "The Portfolio snapshot and the book in your first message list every stock we own and every stock we watch.",
    );
    expect(built.instructions).toBe(`${role}\n\n${ownJob}\n\n${houseAndWrite}`);
    const theBook = "## The book\nHolding (1):\n- AAA · Case Analyst · The company sells a product people keep buying.\nWatching (1):\n- CCC · Case Analyst · A strong quarter, and the base held.";
    const marketWithoutWatching = market.slice(0, market.indexOf("\n\n### Watching"));
    expect(built.message).toBe(`${dateLine(NOW, "LIVE")}\n\n${marketWithoutWatching}\n\n${theBook}\n\n${GOLDEN.message.replace("Thu, Nov 12, the LIVE account.\n\n", "")}`);
  });

  it("asks for the Market and portfolio reads without the 8 PM digest, because its record doesn't list it", async () => {
    const want = jest.fn(sources.portfolioPieces!);
    await buildAgentRequest(PORTFOLIO_MANAGER, { now: NOW, environment: "LIVE" }, { ...sources, portfolioPieces: want });
    expect(want).toHaveBeenCalledWith({ portfolioDigest: false });
  });

  it("names every part, in order, and the parts add up to what is sent", async () => {
    const built = await buildAgentRequest(PORTFOLIO_MANAGER, { now: NOW, environment: "LIVE" }, sources);
    expect(built.parts.map((p) => `${p.where}:${p.title}`)).toEqual([
      "instructions:Its own text",
      "instructions:House rules",
      "instructions:How you write",
      "message:The date and account",
      "message:Market numbers",
      "message:Market digest",
      "message:The portfolio",
      "message:The book",
      "message:Its last output",
    ]);
    const cut = (where: "instructions" | "message", text: string) => byParts(built.parts.filter((p) => p.where === where), text)!;
    const rows = [...cut("instructions", built.instructions).parts, ...cut("message", built.message).parts];
    expect(rows.map((r) => r.group)).toEqual(["Instructions", "Instructions", "Instructions", "Context", "Context", "Context", "Context", "Context", "Context"]);
    expect(built.message.match(/^## Market and portfolio$/gm)).toHaveLength(1);
  });

  it("has the tools its old run listed, in the same order", () => {
    expect(PORTFOLIO_MANAGER.tools).toEqual(["get_theses", "get_stock_data", "update_thesis", "place_trade", "manage_position", "close_position", "dispatch_thesis_research"]);
  });

  it("a Market and portfolio read that can't be read prints its one line under the heading, as before", async () => {
    const built = await buildAgentRequest(PORTFOLIO_MANAGER, { now: NOW, environment: "LIVE" }, { ...sources, portfolioPieces: async () => [{ id: "unreadable", text: "The portfolio snapshot and the digest couldn't be read for this request." }] });
    expect(built.message).toContain("\n\n## Market and portfolio\n\nThe portfolio snapshot and the digest couldn't be read for this request.\n\n## The book\n");
  });
});

describe("the portfolio digest", () => {
  it("is its old request with only the documented moves: the date line, and the snapshot under its heading", async () => {
    const built = await buildAgentRequest(PORTFOLIO_DIGEST, { now: NOW, environment: "PAPER" }, { portfolioPieces: async () => [{ id: "portfolio_snapshot", text: portfolioPieceText(STANDIN_SNAPSHOT) }] });
    expect(built.instructions).toBe(DIGEST_GOLDEN.system);
    expect(built.message).toBe(`${dateLine(NOW, "PAPER")}\n\n## Market and portfolio\n\n### Portfolio snapshot\n${DIGEST_GOLDEN.message}`);
    expect(built.tools).toEqual([]);
  });
});

describe("the Market Reviewer", () => {
  it("is sent its old instructions; its context is the market numbers, the portfolio, the book and its last output", async () => {
    const built = await buildAgentRequest(MARKET_REVIEWER, { now: NOW, environment: "LIVE" }, {
      portfolioPieces: (want) => loadPortfolioPieces({ ...book, now: NOW, ...want }),
      context: { the_book: async () => "## The book\nb", last_output: async () => "## Your notes in the last 5 days\n- none\n\n## Your last digest\nd" },
    });
    expect(built.instructions).toBe(REVIEWER_GOLDEN.system);
    expect(built.parts.map((p) => p.title)).toEqual(["Its own text", "The date and account", "Market numbers", "The portfolio", "The book", "Its last output"]);
    expect(built.message.startsWith(`${dateLine(NOW, "LIVE")}\n\n## Market and portfolio\n\n### Market numbers (as of`)).toBe(true);
    expect(built.message.endsWith("\n\n## The book\nb\n\n## Your notes in the last 5 days\n- none\n\n## Your last digest\nd")).toBe(true);
    expect(MARKET_REVIEWER.providerTools).toEqual(["OpenAI's web search"]);
  });
});

describe("the Context panel's rows", () => {
  it("a request that doesn't add up to its parts is shown whole", () => {
    expect(byParts([{ id: "own", title: "Its own text", kind: "own", where: "instructions", source: "x", chars: 5 }], "Hello world")).toBeNull();
  });

  it("what follows a message's parts, after a blank line, is the person's words", () => {
    const cut = byParts([{ id: "line", title: "The date and account", kind: "line", where: "newest", source: "x", chars: 5 }], "[3pm]\n\nWhy hold it?");
    expect(cut?.parts.map((p) => [p.name, p.group])).toEqual([["The date and account", "Context"]]);
    expect(cut?.after).toBe("Why hold it?");
  });
});
