/**
 * The Market Reviewer V1 is a run Dave can open: given the book in compact
 * form and its last digest, it researches with its tools and saves the
 * digest, and its page keeps the first request exactly as the SDK sent it.
 * Through the job's own handler, with the real run, the real digest tool and
 * the doubled database; OpenAI answers through a fake fetch, and the four
 * read tools are stand-ins so no vendor is called. Made-up book, stand-in
 * amounts.
 */
import { prismaDouble, thesisRow, type PrismaDouble } from "@/lib/replay";

let db: PrismaDouble;
jest.mock("@/lib/prisma", () => ({
  get prisma() {
    return db;
  },
}));
const mockJob: { handler?: (ctx: unknown) => Promise<unknown> } = {};
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: (ctx: unknown) => Promise<unknown>) => ((mockJob.handler = fn), {}) } }));
jest.mock("@/lib/auth/account", () => ({ getOwnerUserId: async () => "user_owner" }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
// The one portfolio snapshot, stood in: made-up numbers, one holding.
jest.mock("@/lib/portfolio/load-snapshot", () => {
  const { buildSnapshot } = jest.requireActual("@/lib/portfolio/snapshot");
  const snapshot = buildSnapshot({
    day: "2026-11-10",
    live: false,
    at: "2026-11-11T01:00:00.000Z",
    cash: 40_000,
    contributed: 100_000,
    holdings: [{ ticker: "MU", shares: 10, avgCost: 600, price: 650, prevClose: 640, analyst: "Secular Compounder" }],
    trades: [],
    waiting: [],
  });
  return { loadPortfolioSnapshot: async () => snapshot };
});
// The real web_search, Perplexity stood in: it returns one Reuters page.
jest.mock("@/lib/intelligence/sonar", () => ({
  searchSignals: async () => ({
    signals: [{ headline: "Stocks rebound on AI demand", summary: "Technology led.", tickers: [], themes: [], sentiment: "neutral", urgency: "low", sourceNames: ["Reuters"], sourceUrls: ["https://www.reuters.com/markets/us/example-rebound/"] }],
  }),
}));
// The other three read tools, stood in: a call returns a line, as a real read would.
jest.mock("@/lib/agent/tools", () => {
  const { tool } = jest.requireActual("ai");
  const { z } = jest.requireActual("zod");
  const { webSearch } = jest.requireActual("@/lib/agent/tools/web-search");
  const read = (name: string) => tool({ description: `${name}, stood in`, inputSchema: z.object({ query: z.string().optional() }), execute: async () => ({ ok: true, summary: `${name} read` }) });
  return { createResearchTools: (ctx: unknown) => ({ web_search: webSearch(ctx), ...Object.fromEntries(["get_market_context", "get_stock_data", "get_theses"].map((n) => [n, read(n)])) }) };
});
/** One Chat Completions reply per request, in order; the request bodies are kept. */
const mockOpenAI = { bodies: [] as Array<Record<string, unknown>>, replies: [] as Array<Record<string, unknown>> };
jest.mock("@ai-sdk/openai", () => {
  const actual = jest.requireActual("@ai-sdk/openai");
  const provider = actual.createOpenAI({
    apiKey: "test",
    fetch: async (_url: string, init: { body: string }) => {
      mockOpenAI.bodies.push(JSON.parse(init.body));
      const message = mockOpenAI.replies[mockOpenAI.bodies.length - 1];
      if (!message) throw new Error(`no fake reply for request ${mockOpenAI.bodies.length}`);
      const finish = message.tool_calls ? "tool_calls" : "stop";
      return new Response(JSON.stringify({ id: `c${mockOpenAI.bodies.length}`, object: "chat.completion", created: 1762900000, model: "gpt-5.4", choices: [{ index: 0, message, finish_reason: finish }], usage: { prompt_tokens: 900, completion_tokens: 80, total_tokens: 980 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { ...actual, openai: provider };
});

import "./market-reviewer";
import { viewOfRecord, type RequestRecord } from "@/lib/agent/run-requests";
import { loadPortfolioSnapshot } from "@/lib/portfolio/load-snapshot";
import { snapshotText, type PortfolioSnapshot } from "@/lib/portfolio/snapshot";

const ACCOUNT = "account_live";
/** Wed Nov 11, 7:30 AM ET. */
const AT = new Date("2026-11-11T12:30:00Z");
const call = (n: number, name: string, args: unknown) => ({ role: "assistant", content: null, tool_calls: [{ id: `call_${n}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
const SOURCE = { title: "Reuters: stocks rebound on AI demand", url: "https://www.reuters.com/markets/us/example-rebound" };
const section = (text: string) => ({ text, sources: [SOURCE] });
const SECTIONS = {
  market_overview: section("Stocks rebounded, led by technology (Reuters, Nov 11). That reads as relief on AI demand, not a turn in rates."),
  sector_developments: section("Technology led; real estate was flat (get_market_context, Nov 11)."),
  major_developments: section("A cloud provider said AI demand outruns supply (Reuters, Nov 11)."),
  portfolio_implications: section("MU's case rests on memory demand; the report supports it, as interpretation."),
  deserves_attention: section("Whether chip-export bills gain a vehicle in Congress (Reuters, Nov 11)."),
  upcoming_events: section("The producer price index is due Friday at 8:30 AM ET (bls.gov)."),
};
const inBook = (over: Record<string, unknown>) =>
  thesisRow({ userId: "user_owner", ...over, researchRun: { agentConfigId: "analyst_1", agentConfig: { name: "Secular Compounder", setupIds: [], accountId: ACCOUNT, tradingEnvironment: "LIVE" } } });

async function runTheJob(at = AT) {
  jest.setSystemTime(at);
  await mockJob.handler!({ step: { run: async (_name: string, fn: () => unknown) => fn() } });
  const rows = (db.store.runMessage ?? []) as Array<{ role: string; content: string }>;
  const requestRow = rows.find((r) => r.role === "request");
  const record = requestRow ? (JSON.parse(requestRow.content) as RequestRecord) : null;
  const threadRow = rows.find((r) => r.role === "thread");
  return { record, thread: threadRow ? String(threadRow.content) : "", runs: (db.store.researchRun ?? []) as Array<Record<string, unknown>>, digests: (db.store.marketDigest ?? []) as Array<Record<string, unknown>> };
}

beforeEach(() => {
  jest.useFakeTimers({ now: AT, doNotFake: ["setTimeout", "clearTimeout", "setImmediate", "nextTick", "queueMicrotask"] });
  mockOpenAI.bodies.length = 0;
  mockOpenAI.replies.length = 0;
  db = prismaDouble({
    agentConfig: [{ id: "analyst_1", accountId: ACCOUNT, tradingEnvironment: "LIVE", enabled: true }],
    thesis: [
      inBook({ id: "t_mu", ticker: "MU", status: "HOLDING", coreBelief: "Micron compounds for years as high-bandwidth memory stays scarce. It keeps its price." }),
      inBook({ id: "t_asml", ticker: "ASML", status: "WATCHING", coreBelief: "ASML compounds as High-NA EUV ramps." }),
    ],
    marketDigest: [{ id: "md_tue", accountId: ACCOUNT, environment: "LIVE", date: new Date("2026-11-10T00:00:00.000Z"), digest: "### Market overview\n\nStocks slipped on Tuesday.", createdAt: new Date("2026-11-10T12:40:00Z") }],
  });
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the 7:30 Market Reviewer", () => {
  it("researches with its tools, saves the digest, and keeps its first request exactly as sent", async () => {
    // Its sources: the page its search returned, a vendor's docs link from a tool's data, and a made-up one.
    const cited = {
      ...SECTIONS,
      market_overview: { ...SECTIONS.market_overview, sources: [SOURCE, { title: "Alpaca — SPY quote", url: "https://docs.alpaca.markets/reference/stocksnapshots-1" }] },
      upcoming_events: { ...SECTIONS.upcoming_events, sources: [{ title: "Thesis library", url: "internal://get_theses/live-book" }] },
    };
    mockOpenAI.replies.push(call(1, "get_market_context", {}), call(2, "web_search", { query: "why stocks rose Nov 11", recency: "day" }), call(3, "write_market_digest", { sections: cited }));
    const { record, thread, runs, digests } = await runTheJob();

    // A read-only run for the account, closed COMPLETE.
    expect(runs).toEqual([expect.objectContaining({ mode: "MARKET_REVIEWER", accountId: ACCOUNT, environment: "LIVE", userId: "user_owner", status: "COMPLETE" })]);
    expect(runs[0].parameters).toEqual({ date: "2026-11-11", model: "gpt-5.4" });

    // The first request, exactly as sent, and how many the run made.
    expect(record!.requests).toEqual([mockOpenAI.bodies[0]]);
    expect(record!.of).toBe(3);
    const body = mockOpenAI.bodies[0] as { messages: Array<{ role: string; content: string }>; tools: Array<{ function: { name: string } }> };
    expect(body.tools.map((t) => t.function.name)).toEqual(["web_search", "get_market_context", "get_stock_data", "get_theses", "write_market_digest"]);
    expect(body.messages[0].content).toMatch(/^You are the Market Intelligence Analyst for an autonomous stock trading system\./);
    expect(body.messages[0].content).toContain("Do not make trades.");
    expect(body.messages[0].content).toContain("search the economic calendar for the next two weeks (Fed decisions, CPI, PPI, PCE, the jobs report)");
    expect(body.messages[0].content).toContain("never read the whole book");
    // Its first message: the portfolio snapshot's own text, each stock's belief in a line, then its last digest. Nothing else.
    const snapshot = (await loadPortfolioSnapshot({ accountId: ACCOUNT, environment: "LIVE" })) as PortfolioSnapshot;
    expect(snapshotText(snapshot)).toContain("- MU: 10 shares at $650.00 = $6,500 (");
    expect(body.messages[1].content).toBe(
      [
        "Wed Nov 11, the LIVE book.",
        "",
        "## The portfolio",
        snapshotText(snapshot),
        "",
        "## Why we hold each, in a line",
        "- MU · Micron compounds for years as high-bandwidth memory stays scarce.",
        "",
        "## What we watch, and why",
        "- ASML · ASML compounds as High-NA EUV ramps.",
        "",
        "## Your last digest",
        "Written for Tue Nov 10:",
        "",
        "### Market overview",
        "",
        "Stocks slipped on Tuesday.",
      ].join("\n"),
    );

    // The panel shows what it started with: the instructions, its first message and its tool menu.
    const view = viewOfRecord(record!);
    expect(view.categories.map((c) => [c.name, c.part])).toEqual([["Instructions", "job"], ["Portfolio, watchlist and last digest", "read"], ["Tool menu", "tools"]]);
    expect(view.categories[2].sections.map((s) => s.label)).toEqual(["web_search", "get_market_context", "get_stock_data", "get_theses", "write_market_digest"]);
    expect(view.of).toBe(3);

    // The thread the page replays: the first message, then every call and result.
    expect(thread).toContain("get_market_context read");
    expect(thread).toContain("write_market_digest");

    // The digest: today's row, each section under its heading with its sources.
    const today = digests.find((d) => (d.date as Date).toISOString() === "2026-11-11T00:00:00.000Z")!;
    expect(today).toMatchObject({ accountId: ACCOUNT, environment: "LIVE", model: "gpt-5.4", runId: runs[0].id });
    expect([...String(today.digest).matchAll(/^### (.+)$/gm)].map((m) => m[1])).toEqual([
      "Market overview", "Sector developments", "Major developments", "Implications for your portfolio", "What deserves attention", "Upcoming events",
    ]);
    // Only the page a search returned is linked; the other two are dropped, and the tool says which.
    expect(String(today.digest)).toContain(`Sources: [Reuters: stocks rebound on AI demand](${SOURCE.url})`);
    expect(String(today.digest)).not.toMatch(/docs\.alpaca|internal:/);
    expect(thread).toContain("Dropped 2 links no search in this run returned: https://docs.alpaca.markets/reference/stocksnapshots-1, internal://get_theses/live-book.");
  });

  it("a digest past 5,000 characters is refused with the overage, and the shorter one is saved", async () => {
    const long = { ...SECTIONS, major_developments: section("x".repeat(5_000)) };
    mockOpenAI.replies.push(call(1, "write_market_digest", { sections: long }), call(2, "write_market_digest", { sections: SECTIONS }));
    const { thread, runs, digests } = await runTheJob();
    const over = Object.values(long).reduce((n, s) => n + s.text.length, 0);
    expect(thread).toContain(`Nothing saved: the six paragraphs are ${over.toLocaleString("en-US")} characters, 5,000 at most (cut ${(over - 5_000).toLocaleString("en-US")}). Aim for about 3,000, and send it again.`);
    expect(runs[0].status).toBe("COMPLETE");
    expect(digests).toHaveLength(2);
  });

  it("a run that ends without a digest closes FAILED, and its record says why", async () => {
    mockOpenAI.replies.push({ role: "assistant", content: "Nothing to add today." });
    const { record, runs, digests } = await runTheJob();
    expect(runs[0].status).toBe("FAILED");
    expect(record!.error).toBe("The run ended without saving a digest.");
    expect(record!.requests).toEqual([mockOpenAI.bodies[0]]);
    expect(digests).toHaveLength(1);
  });

  it("writes nothing on a market holiday", async () => {
    await runTheJob(new Date("2026-11-26T12:30:00Z")); // Thanksgiving
    expect(db.store.researchRun ?? []).toEqual([]);
    expect(mockOpenAI.bodies).toEqual([]);
  });

  it("in this run, get_theses takes tickers, at most 3 a call", async () => {
    const { getTheses } = await import("@/lib/agent/tools/get-theses");
    const { createToolContext } = await import("@/lib/agent/tool-context");
    const schemaOf = (runMode: string) => (getTheses(createToolContext({ runId: "r", userId: "user_owner", accountId: ACCOUNT, runMode })) as unknown as { inputSchema: { safeParse: (v: unknown) => { success: boolean } } }).inputSchema;
    const reviewer = schemaOf("MARKET_REVIEWER");
    expect(reviewer.safeParse({ tickers: ["MU", "NVDA", "ASML"] }).success).toBe(true);
    expect(reviewer.safeParse({}).success).toBe(false);
    expect(reviewer.safeParse({ tickers: ["MU", "NVDA", "ASML", "V"] }).success).toBe(false);
    expect(schemaOf("MORNING_PLAN").safeParse({}).success).toBe(true);
  });

  it("the digest tool saves only on the Market Reviewer's run", async () => {
    const { writeMarketDigest } = await import("@/lib/agent/tools/write-market-digest");
    const { createToolContext } = await import("@/lib/agent/tool-context");
    db.store.researchRun = [{ id: "run_morning", mode: "MORNING_PLAN", accountId: ACCOUNT, environment: "LIVE", startedAt: AT, parameters: {} }];
    const t = writeMarketDigest(createToolContext({ runId: "run_morning", userId: "user_owner", accountId: ACCOUNT })) as unknown as { execute: (a: unknown, o: unknown) => Promise<{ summary: string }> };
    expect((await t.execute({ sections: SECTIONS }, { toolCallId: "c", messages: [] })).summary).toBe("Only the Market Reviewer writes the market digest; nothing saved.");
    expect(db.store.marketDigest).toHaveLength(1);
  });
});
