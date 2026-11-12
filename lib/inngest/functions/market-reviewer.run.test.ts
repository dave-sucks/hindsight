/**
 * The Market Reviewer V1 is one model call with web search, a run Dave can
 * open: given its instructions, the book and its last digest, its reply is
 * the digest, and the job saves it. Through the job's own handler, with the
 * real run and the doubled database; OpenAI's Responses API is stood in.
 * Made-up book, stand-in amounts.
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
/** OpenAI's Responses API, stood in: the bodies it was sent, and its one reply (or a failure). */
const mockOpenAI = { bodies: [] as unknown[], reply: null as unknown, fails: null as Error | null };
jest.mock("openai", () => ({
  __esModule: true,
  default: class {
    responses = {
      create: async (body: unknown) => {
        mockOpenAI.bodies.push(JSON.parse(JSON.stringify(body)));
        if (mockOpenAI.fails) throw mockOpenAI.fails;
        return mockOpenAI.reply;
      },
    };
  },
}));

import "./market-reviewer";
import { viewOfRecord, type RequestRecord } from "@/lib/agent/run-requests";
import { loadPortfolioSnapshot } from "@/lib/portfolio/load-snapshot";
import { snapshotText, type PortfolioSnapshot } from "@/lib/portfolio/snapshot";

const ACCOUNT = "account_live";
/** Wed Nov 11, 7:30 AM ET. */
const AT = new Date("2026-11-11T12:30:00Z");
const DIGEST = [
  "### Market overview",
  "Stocks rebounded, led by technology ([Reuters](https://www.reuters.com/markets/us/example-rebound/)). My interpretation is relief on AI demand.",
  "### Upcoming events",
  "The producer price index is due Friday at 8:30 AM ET ([BLS](https://www.bls.gov/schedule/)).",
].join("\n\n");
/** A finished reply: two searches, then the digest. */
const reply = (over: Record<string, unknown> = {}) => ({
  status: "completed",
  output: [
    { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: "stock market today", queries: ["why stocks rose Nov 11 2026"] } },
    { type: "web_search_call", id: "ws_2", status: "completed", action: { type: "search", query: "economic calendar November 2026 CPI PPI" } },
    { type: "message", id: "m_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: DIGEST, annotations: [] }] },
  ],
  output_text: DIGEST,
  ...over,
});
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
  mockOpenAI.reply = reply();
  mockOpenAI.fails = null;
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
  it("sends one request (its instructions, the book and its last digest, web search) and saves the reply as today's digest", async () => {
    const { record, thread, runs, digests } = await runTheJob();

    // One call, nothing else.
    expect(mockOpenAI.bodies).toHaveLength(1);
    const body = mockOpenAI.bodies[0] as { model: string; input: Array<{ role: string; content: string }>; tools: unknown[] };
    expect(body.model).toBe("gpt-5.4");
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.input.map((m) => m.role)).toEqual(["system", "user"]);
    expect(body.input[0].content).toMatch(/^You are the Market Intelligence Analyst for an autonomous stock trading system\./);
    expect(body.input[0].content).toContain("Do not make trades.");
    expect(body.input[0].content).toContain("search the economic calendar for the next two weeks (Fed decisions, CPI, PPI, PCE, the jobs report)");
    // Its first message: the portfolio snapshot's own text, each stock's belief in a line, then its last digest. Nothing else.
    const snapshot = (await loadPortfolioSnapshot({ accountId: ACCOUNT, environment: "LIVE" })) as PortfolioSnapshot;
    expect(body.input[1].content).toBe(
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

    // A read-only run for the account, closed COMPLETE, its request kept exactly as sent.
    expect(runs).toEqual([expect.objectContaining({ mode: "MARKET_REVIEWER", accountId: ACCOUNT, environment: "LIVE", userId: "user_owner", status: "COMPLETE" })]);
    expect(runs[0].parameters).toEqual({ date: "2026-11-11", model: "gpt-5.4" });
    expect(record!.requests).toEqual([mockOpenAI.bodies[0]]);
    expect(record!.error).toBeUndefined();

    // Context shows the instructions, the first message and its one tool.
    const view = viewOfRecord(record!);
    expect(view.categories.map((c) => [c.name, c.part])).toEqual([["Instructions", "job"], ["Portfolio, watchlist and last digest", "read"], ["Tool menu", "tools"]]);
    expect(view.categories[2].sections.map((s) => s.label)).toEqual(["web_search"]);

    // The run page: the first message, then what it searched and the digest.
    expect(thread).toContain("Searched the web 2 times: “why stocks rose Nov 11 2026” · “economic calendar November 2026 CPI PPI”");
    expect(thread).toContain("Stocks rebounded, led by technology");

    // Today's digest is the reply, as written, linked to its run.
    const today = digests.find((d) => (d.date as Date).toISOString() === "2026-11-11T00:00:00.000Z")!;
    expect(today).toMatchObject({ accountId: ACCOUNT, environment: "LIVE", model: "gpt-5.4", runId: runs[0].id, digest: DIGEST });
  });

  it("a reply cut off at its limit saves nothing, and the run closes FAILED saying why", async () => {
    mockOpenAI.reply = reply({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } });
    const { record, runs, digests } = await runTheJob();
    expect(runs[0].status).toBe("FAILED");
    expect(record!.error).toBe("The reply was cut off: max_output_tokens.");
    expect(digests).toHaveLength(1);
  });

  it("a call that fails saves nothing, and its record keeps the request and the error", async () => {
    mockOpenAI.fails = new Error("Request timed out.");
    const { record, runs, digests } = await runTheJob();
    expect(runs[0].status).toBe("FAILED");
    expect(record!.error).toBe("Request timed out.");
    expect(record!.requests).toEqual([mockOpenAI.bodies[0]]);
    expect(digests).toHaveLength(1);
  });

  it("writes nothing on a market holiday", async () => {
    await runTheJob(new Date("2026-11-26T12:30:00Z")); // Thanksgiving
    expect(db.store.researchRun ?? []).toEqual([]);
    expect(mockOpenAI.bodies).toEqual([]);
  });
});
