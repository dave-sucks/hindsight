/**
 * The Market Reviewer V1 is one model call with web search, a run Dave can
 * open: given its instructions, the book and its last digest, its reply is
 * the digest and its notes on the book's stocks, and the job saves both.
 * Through the job's own handler, with the real run and the doubled database;
 * OpenAI's Responses API is stood in. The notes it saves are then read by the
 * real readers: get_theses (a run's list and what it reads) and the Activity
 * tab's loader. Made-up book, stand-in amounts.
 */
import { prismaDouble, replayTool, thesisRow, REPLAY_USER_ID, type PrismaDouble } from "@/lib/replay";

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
// The market's vendors, stood in: stand-in closes for the index and sector funds and the book's two stocks, and a calendar with MU reporting.
jest.mock("@/lib/market-data/live-quote", () => {
  const { standinMarketQuotes } = jest.requireActual("@/lib/agent/__fixtures__/market-numbers-standin");
  const funds = standinMarketQuotes("2026-11-10T21:00:00Z");
  const close = (c: number) => ({ quote: { ...funds.SPY.quote, c, pc: c, d: 0, dp: 0, o: c, h: c, l: c } });
  const quotes = { ...funds, MU: close(650), ASML: close(1000) };
  return { getLiveQuotes: async (symbols: string[]) => Object.fromEntries(symbols.map((s) => [s, quotes[s] ?? { quote: null, error: "not stood in" }])) };
});
jest.mock("@/lib/agent/research-helpers", () => ({
  ...jest.requireActual("@/lib/agent/research-helpers"),
  finnhub: async (path: string) =>
    path.startsWith("/calendar/earnings") ? { data: jest.requireActual("@/lib/agent/__fixtures__/market-numbers-standin").STANDIN_CALENDAR } : { data: null, error: "not stood in" },
}));
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
import { writeMarketReview } from "@/lib/agent/market-reviewer/run";
import { viewOfRecord, type RequestRecord } from "@/lib/agent/run-requests";
import { loadActivityFeed } from "@/lib/thesis/activity-feed.server";
import { serializeFeedItem } from "@/lib/thesis/activity-feed";
import { titleSegments, type TimelineUpdate } from "@/components/agent/sheets/thesis-timeline-utils";
import { loadPortfolioSnapshot } from "@/lib/portfolio/load-snapshot";
import { snapshotText, type PortfolioSnapshot } from "@/lib/portfolio/snapshot";
import { STANDIN_SPY_ROW } from "@/lib/agent/__fixtures__/market-numbers-standin";

const ACCOUNT = "account_live";
/** Wed Nov 11, 7:30 AM ET. */
const AT = new Date("2026-11-11T12:30:00Z");
const DIGEST = [
  "### Market overview",
  "Stocks rebounded, led by technology ([Reuters](https://www.reuters.com/markets/us/example-rebound/)). My interpretation is relief on AI demand.",
  "### Upcoming events",
  "The producer price index is due Friday at 8:30 AM ET ([BLS](https://www.bls.gov/schedule/)).",
].join("\n\n");
/** Its notes: a high one on two stocks, a low one on one. */
const NOTES = [
  {
    tickers: ["MU", "ASML"],
    text: "New export rules cover memory tools sold to China ([Reuters](https://www.reuters.com/technology/example-export-rules/)). That cuts into the demand both stories rest on.",
    impact: "high",
    effect: "weaker",
  },
  { tickers: ["MU"], text: "A peer said memory prices held through October ([Bloomberg](https://www.bloomberg.com/news/example-memory-prices/)).", impact: "low", effect: "neutral" },
];
const REPLY = JSON.stringify({ digest: DIGEST, notes: NOTES });
/** A finished reply: two searches, then the digest and its notes as one JSON object. */
const reply = (over: Record<string, unknown> = {}) => ({
  status: "completed",
  output: [
    { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: "stock market today", queries: ["why stocks rose Nov 11 2026"] } },
    { type: "web_search_call", id: "ws_2", status: "completed", action: { type: "search", query: "economic calendar November 2026 CPI PPI" } },
    { type: "message", id: "m_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: REPLY, annotations: [] }] },
  ],
  output_text: REPLY,
  usage: { input_tokens: 41_230, output_tokens: 3_118 },
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
  return {
    record,
    thread: threadRow ? String(threadRow.content) : "",
    runs: (db.store.researchRun ?? []) as Array<Record<string, unknown>>,
    digests: (db.store.marketDigest ?? []) as Array<Record<string, unknown>>,
    notes: (db.store.sharedNote ?? []) as Array<Record<string, unknown>>,
  };
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
    tickerIndicators: [STANDIN_SPY_ROW],
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
    const { record, thread, runs, digests, notes } = await runTheJob();

    // One call, nothing else.
    expect(mockOpenAI.bodies).toHaveLength(1);
    const body = mockOpenAI.bodies[0] as {
      model: string;
      input: Array<{ role: string; content: string }>;
      tools: unknown[];
      text: { format: { type: string; strict: boolean; schema: { properties: { notes: { items: { properties: { tickers: { items: { enum: string[] } } } } } } } } };
    };
    expect(body.model).toBe("gpt-5.4");
    expect(body.tools).toEqual([{ type: "web_search" }]);
    // Its reply is one JSON object, and a note may name only the stocks in its first message.
    expect(body.text.format).toMatchObject({ type: "json_schema", name: "market_review", strict: true });
    expect([...body.text.format.schema.properties.notes.items.properties.tickers.items.enum].sort()).toEqual(["ASML", "MU"]);
    expect(body.input[0].content).toContain("## Notes\nYour reply's \"notes\" are saved on the stocks they name");
    expect(body.input.map((m) => m.role)).toEqual(["system", "user"]);
    expect(body.input[0].content).toMatch(/^You are the Market Intelligence Analyst for an autonomous stock trading system\./);
    expect(body.input[0].content).toContain("Do not make trades.");
    expect(body.input[0].content).toContain("The Market numbers in your first message are the index, sector and earnings numbers to use: search the web for what moved them, not for the numbers.");
    expect(body.input[0].content).toContain("search the economic calendar for the next two weeks (Fed decisions, CPI, PPI, PCE, the jobs report)");
    // Its first message: the market numbers, the portfolio snapshot's own text, each stock's belief in a line, its notes (none yet), then its last digest. Nothing else.
    const snapshot = (await loadPortfolioSnapshot({ accountId: ACCOUNT, environment: "LIVE" })) as PortfolioSnapshot;
    expect(body.input[1].content).toBe(
      [
        "Wed Nov 11, the LIVE book.",
        "",
        // The same numbers every agent's block prints: the stand-in closes, the regime from SPY's snapshot row, the book's coming report.
        "## Market numbers",
        "- S&P 500 (SPY) $600.00 −0.50% · Nasdaq 100 (QQQ) $500.00 −0.99%, at Tuesday's close, Nov 10.",
        "- Market risk-on: SPY $603.00, above its 50-day ($590.00) and above its 200-day ($560.00), so full size (as of Tuesday's close, Nov 10).",
        "- Sectors on the day, best to worst: XLU utilities +1.20%, XLE energy +0.80%, XLV health care +0.50%, XLP staples +0.30%, XLRE real estate +0.10%, XLB materials −0.10%, XLI industrials −0.30%, XLF financials −0.40%, XLC communications −0.60%, XLY discretionary −0.90%, XLK tech −1.40%.",
        "- VIXY, a fund of VIX futures (not the VIX itself): +3.09% on the day.",
        "- Our stocks reporting in the next 14 days: MU (held) Tue, Nov 17 after the close.",
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
        "## Your notes in the last 5 days",
        "- none",
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
    expect(view.categories.map((c) => [c.name, c.part])).toEqual([["Instructions", "job"], ["Market numbers, portfolio, watchlist, notes and last digest", "read"], ["Tool menu", "tools"]]);
    // The numbers are their own section in Context.
    expect(view.categories[1].sections.map((s) => s.label)).toEqual(["Opening", "Market numbers", "The portfolio", "Why we hold each, in a line", "What we watch, and why", "Your notes in the last 5 days", "Your last digest", "Market overview"]);
    expect(view.categories[2].sections.map((s) => s.label)).toEqual(["web_search"]);

    // The run page: the first message, then what it searched and the tokens, the digest, and each note under a title.
    expect(thread).toContain("Searched the web 2 times: “why stocks rose Nov 11 2026” · “economic calendar November 2026 CPI PPI”. Tokens: 41,230 in, 3,118 out.");
    expect(thread).toContain("Stocks rebounded, led by technology");
    expect(thread).toContain("**Note on MU, ASML · high · weaker · flagged for review**");
    expect(thread).toContain("**Note on MU · low · neutral**");

    // Today's digest is the digest, as written, linked to its run.
    const today = digests.find((d) => (d.date as Date).toISOString() === "2026-11-11T00:00:00.000Z")!;
    expect(today).toMatchObject({ accountId: ACCOUNT, environment: "LIVE", model: "gpt-5.4", runId: runs[0].id, digest: DIGEST });

    // Each note is saved on its stocks by the Market Reviewer, with its run, its two fields and each stock's price then; the high one pinned three days.
    expect(notes).toEqual([
      expect.objectContaining({ userId: "user_owner", author: "MARKET_REVIEWER", runId: runs[0].id, audience: "STOCKS", tickers: ["MU", "ASML"], body: NOTES[0].text, impact: "high", effect: "weaker", pinnedUntil: new Date("2026-11-14T12:30:00Z"), prices: { MU: 650, ASML: 1000 } }),
      expect.objectContaining({ userId: "user_owner", author: "MARKET_REVIEWER", runId: runs[0].id, audience: "STOCKS", tickers: ["MU"], body: NOTES[1].text, impact: "low", effect: "neutral", pinnedUntil: null, prices: { MU: 650 } }),
    ]);
  });

  it("its first message carries its own notes of the last 5 days, newest first, each in a line", async () => {
    const reviewerNote = (id: string, daysAgo: number, over: Record<string, unknown>) => ({
      id, userId: "user_owner", author: "MARKET_REVIEWER", runId: "run_earlier", audience: "STOCKS", analystId: null, eventDate: null, pinnedUntil: null,
      createdAt: new Date(AT.getTime() - daysAgo * 86_400_000), ...over,
    });
    db.store.sharedNote = [
      reviewerNote("n_mon", 2, { tickers: ["MU", "ASML"], impact: "high", effect: "weaker", body: `New export rules cover memory tools sold to China, ${"and the list of tools named in the rule runs long ".repeat(3)}. The rest.` }),
      reviewerNote("n_tue", 1, { tickers: ["MU"], impact: "low", effect: "neutral", body: "A peer said memory prices held through October. More detail." }),
      reviewerNote("n_old", 6, { tickers: ["MU"], impact: "medium", effect: "stronger", body: "Older than five days." }),
      reviewerNote("n_owner", 1, { author: "OWNER", tickers: ["MU"], impact: null, effect: null, body: "The owner's own note." }),
      reviewerNote("n_other", 1, { userId: "someone_else", tickers: ["MU"], impact: "high", effect: "weaker", body: "Another user's book." }),
    ];
    const review = await writeMarketReview({ accountId: ACCOUNT, environment: "LIVE", userId: "user_owner" }, { now: AT });
    const first = (review.request.requests[0] as { input: Array<{ content: string }> }).input[1].content;
    expect(first.split("## Your notes in the last 5 days\n")[1].split("\n\n## Your last digest")[0]).toBe(
      [
        "- Tue Nov 10 · MU · low · neutral · A peer said memory prices held through October.",
        `- Mon Nov 9 · MU, ASML · high · weaker · ${`New export rules cover memory tools sold to China, ${"and the list of tools named in the rule runs long ".repeat(3)}`.slice(0, 160).trimEnd()}…`,
      ].join("\n"),
    );
    expect((review.request.requests[0] as { input: Array<{ content: string }> }).input[0].content).toContain(
      "Write a note on a story you already noted only when something new happened since, and say what is new.",
    );
  });

  it("a high note puts its stocks on the next run's list, and every note is a titled line in each stock's Activity and in what a run reads", async () => {
    const { notes } = await runTheJob();
    // The database stamps createdAt on insert; the double doesn't, so the save time is set here, a second apart.
    notes.forEach((n, i) => (n.createdAt = new Date(AT.getTime() + i * 1000)));

    // The Activity tab's loader, titled by the tab's own grammar: newest first, the paragraph the model's text, the price MU's when written.
    const feed = await loadActivityFeed({ id: "t_mu", ticker: "MU", createdAt: new Date("2026-10-01T00:00:00Z"), closedAt: null, invalidatedAt: null, analystId: "analyst_1" }, 40);
    const lines = feed.filter((i) => i.type === "SHARED_NOTE");
    expect(lines.map((i) => [titleSegments(serializeFeedItem(i) as unknown as TimelineUpdate), i.rationale, i.priceAtTime])).toEqual([
      [expect.objectContaining({ primary: "Agent note", secondary: "to MU · low impact · neutral" }), NOTES[1].text, 650],
      [expect.objectContaining({ primary: "Agent note", secondary: "to MU, ASML · high impact · weaker" }), NOTES[0].text, 650],
    ]);
    // On ASML's Activity the same note carries ASML's price.
    const asml = await loadActivityFeed({ id: "t_asml", ticker: "ASML", createdAt: new Date("2026-10-01T00:00:00Z"), closedAt: null, invalidatedAt: null, analystId: "analyst_1" }, 40);
    expect(asml.filter((i) => i.type === "SHARED_NOTE").map((i) => i.priceAtTime)).toEqual([1000]);

    // The next run's read (get_theses), on the same two stocks as quiet watches.
    jest.useFakeTimers({ now: new Date(AT.getTime() + 60_000), doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask", "hrtime", "performance"] });
    const watch = (id: string, ticker: string) =>
      thesisRow({
        id, ticker, status: "WATCHING", direction: null, horizon: "COMPOUNDER", setupId: null,
        coreBelief: null, keyAssumptions: [], invalidationConds: [], snapshot: null, bullCase: null, bearCase: null, scoring: null, conviction: null, convictionRationale: null,
        entryPrice: null, targetPrice: null, stopLoss: null, researchUpdatedAt: null, createdAt: new Date("2026-10-01T00:00:00Z"), lastReviewedAt: null,
        triggers: [{ id: `wake_${ticker}`, action: "REVIEW", source: "AGENT", predicate: { watch: "price", is: "below", value: 1 }, rationale: "r", cooldownDays: 7 }],
      });
    const seed = { thesis: [watch("t_mu", "MU"), watch("t_asml", "ASML")], sharedNote: notes.map((n) => ({ ...n, userId: REPLAY_USER_ID })) };
    // This file's own database mock (for the job) answers before the replay's, so it holds the replay's seed.
    db = prismaDouble(seed as never);
    const { result, crashed } = await replayTool("get-theses", "getTheses", { seed: seed as never, args: { limit: 50 }, ctx: { runMode: "MORNING_PLAN" }, quotes: { MU: 650, ASML: 1000 } });
    expect(crashed).toBe(false);
    const rows = (result as unknown as { data: { theses: Array<{ id: string; situations: string[]; context: string }> } }).data.theses;
    const mu = rows.find((t) => t.id === "t_mu")!;
    // Both stocks the high note names are on the list, in PINNED_NOTE.
    expect(mu.situations).toContain("PINNED_NOTE");
    expect(rows.find((t) => t.id === "t_asml")?.situations).toContain("PINNED_NOTE");
    // The high note reads pinned above the stock's lines; the low one is one of its newest 8, in `said`.
    const [pinned, said] = mu.context.split("WHAT'S BEEN SAID ON $MU");
    expect(pinned).toContain(`PINNED ON $MU: notes read before its Activity lines:\n  11-11 07:30 · Agent note to MU, ASML · high impact · weaker, pinned until 11-14 — "${NOTES[0].text}"`);
    expect(said).toContain(`11-11 07:30 · $650.00 · Agent note to MU · low impact · neutral — "${NOTES[1].text}"`);
  });

  it("a note that doesn't save leaves the digest saved and the run COMPLETE", async () => {
    const notesTable = db.sharedNote as { create: (a: Record<string, unknown>) => Promise<unknown> };
    const create = notesTable.create;
    notesTable.create = async (a) => {
      if ((a.data as { impact?: string }).impact === "high") throw new Error("connection reset");
      return create(a);
    };
    const { runs, digests, notes } = await runTheJob();
    expect(runs[0].status).toBe("COMPLETE");
    expect(digests.map((d) => d.digest)).toContain(DIGEST);
    expect(notes.map((n) => n.impact)).toEqual(["low"]);
  });

  it("a reply that isn't the digest and its notes saves nothing, and says so", async () => {
    mockOpenAI.reply = reply({ output_text: DIGEST });
    const { record, runs, digests, notes } = await runTheJob();
    expect(runs[0].status).toBe("FAILED");
    expect(record!.error).toBe("The reply wasn't the digest and its notes.");
    expect(digests).toHaveLength(1);
    expect(notes).toEqual([]);
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
