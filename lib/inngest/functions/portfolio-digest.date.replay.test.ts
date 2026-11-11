/**
 * The 8 PM digest covers the day it runs on, not the day before.
 *
 * The digest written Mon 2026-11-09 at 8 PM ET is dated Nov 9 and says "no
 * new runs executed". Its facts were built for Nov 8 (a Sunday, `facts.date`
 * "2026-11-08", zero runs) while Monday had 3 morning runs, 10 trigger runs
 * and a Writer run on the live book. The job took the day from
 * etTradingDayDate(), which is midnight UTC of the New York date, and printed
 * it in New York time: the evening before. Every digest since the job began
 * reported the previous calendar day's runs and trades.
 *
 * Through the job's own handler at the minute the Nov 9 row was written, on
 * that row and that day's runs (lib/agent/__fixtures__/portfolio-digest-2026-11-09.json).
 */
import day from "@/lib/agent/__fixtures__/portfolio-digest-2026-11-09.json";
import { SAMPLE_FACTS } from "@/lib/agent/__fixtures__/digest-facts-sample";

const ACCOUNT = "account_live";

type Handler = (ctx: { step: { run: (name: string, fn: () => unknown) => Promise<unknown> } }) => Promise<unknown>;

async function runTheJobAt(
  now: string,
  over: { facts?: unknown; orders?: () => Promise<unknown[]>; runUpdate?: () => Promise<unknown>; review?: () => Promise<unknown> } = {},
) {
  const buildDigestFacts = jest.fn(async () => over.facts ?? { date: "facts" });
  const upsert = jest.fn(async () => ({}));
  const runsQuery = jest.fn(async () => [{ accountId: ACCOUNT, environment: day.digest.environment }]);
  const runCreate = jest.fn(async () => ({ id: "run_review" }));
  const runUpdate = jest.fn(over.runUpdate ?? (async () => ({})));
  const saveRunThread = jest.fn(async () => {});
  const writePortfolioReview = jest.fn(
    over.review ??
      (async () => ({
        brief: "Stand-in brief.",
        narrative: "Stand-in digest.",
        model: "gpt-5.4",
        opening: [{ role: "user", content: "FACTS:\n…" }],
        messages: [{ role: "assistant", content: "## Brief\n…" }],
        usage: [],
      })),
  );
  let handler: Handler | null = null;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/inngest/client", () => ({
      inngest: { createFunction: (_c: unknown, _t: unknown, h: Handler) => ((handler = h), {}), send: jest.fn() },
    }));
    jest.doMock("@/lib/prisma", () => ({
      prisma: {
        researchRun: { findMany: runsQuery, create: runCreate, update: runUpdate },
        position: { findMany: jest.fn(async () => []) },
        order: { findMany: jest.fn(over.orders ?? (async () => [])) },
        agentConfig: { findMany: jest.fn(async () => [{ accountId: ACCOUNT, tradingEnvironment: day.digest.environment }]) },
        portfolioDigest: { upsert },
      },
    }));
    jest.doMock("@/lib/portfolio/digest-facts-builder", () => ({ buildDigestFacts }));
    jest.doMock("@/lib/agent/portfolio-reviewer", () => ({ ...jest.requireActual("@/lib/agent/portfolio-reviewer"), writePortfolioReview }));
    jest.doMock("@/lib/auth/account", () => ({ getOwnerUserId: async () => "user_owner" }));
    jest.doMock("@/lib/agent/run-thread", () => ({ saveRunThread }));
    jest.doMock("@/lib/agent/token-usage", () => ({ ...jest.requireActual("@/lib/agent/token-usage"), recordTokenUsage: jest.fn(async () => {}) }));
    await import("./portfolio-digest");
  });
  jest.useFakeTimers({ now: new Date(now) });
  try {
    await handler!({ step: { run: async (_name, fn) => fn() } });
  } finally {
    jest.useRealTimers();
  }
  for (const m of ["@/lib/inngest/client", "@/lib/prisma", "@/lib/portfolio/digest-facts-builder", "@/lib/agent/portfolio-reviewer", "@/lib/auth/account", "@/lib/agent/run-thread", "@/lib/agent/token-usage"]) jest.dontMock(m);
  return { buildDigestFacts, upsert, runsQuery, runCreate, runUpdate, saveRunThread, writePortfolioReview };
}

/** The New York calendar day an instant falls on. */
const nyDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

describe("the 8 PM digest on Mon 2026-11-09", () => {
  it("was saved with facts for the day before (the bug, as it landed)", () => {
    expect({ date: day.digest.date, factsDate: day.digest.factsDate, factsRuns: day.digest.factsRuns }).toEqual({ date: "2026-11-09", factsDate: "2026-11-08", factsRuns: 0 });
    expect(day.mondayRuns.map((r) => nyDay(r.startedAt))).toEqual(day.mondayRuns.map(() => "2026-11-09"));
    expect(day.mondayRuns.filter((r) => r.mode === "MORNING_PLAN")).toHaveLength(3);
    expect(day.mondayRuns.filter((r) => r.mode === "INTRADAY_TACTICAL")).toHaveLength(10);
  });

  it("builds its facts for Monday, the day all fourteen of its runs started", async () => {
    const { buildDigestFacts } = await runTheJobAt(day.digest.createdAt);
    expect(buildDigestFacts).toHaveBeenCalledWith(ACCOUNT, nyDay(day.mondayRuns[0].startedAt), day.digest.environment);
    expect(buildDigestFacts).toHaveBeenCalledWith(ACCOUNT, "2026-11-09", "LIVE");
  });

  it("keeps the row's date as it was: Nov 9, at midnight UTC", async () => {
    const { upsert } = await runTheJobAt(day.digest.createdAt);
    const where = (upsert.mock.calls[0] as unknown as [{ where: { accountId_environment_date: { date: Date } } }])[0].where;
    expect(where.accountId_environment_date.date.toISOString()).toBe(`${day.digest.date}T00:00:00.000Z`);
  });

  it("looks for the day's activity from before Monday's first run", async () => {
    const { runsQuery } = await runTheJobAt(day.digest.createdAt);
    const since = (runsQuery.mock.calls[0] as unknown as [{ where: { startedAt: { gte: Date } } }])[0].where.startedAt.gte;
    expect(since.getTime()).toBeLessThanOrEqual(new Date(day.mondayRuns[0].startedAt).getTime());
    expect(nyDay(since.toISOString()) >= "2026-11-08").toBe(true);
  });
});

describe("the Portfolio Reviewer's run", () => {
  it("each review is a run named Portfolio Reviewer, its thread saved, its brief stored with the digest", async () => {
    const { runCreate, runUpdate, saveRunThread, upsert } = await runTheJobAt(day.digest.createdAt);
    expect(runCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ mode: "PORTFOLIO_REVIEW", status: "RUNNING", source: "AGENT", accountId: ACCOUNT, environment: "LIVE", parameters: expect.objectContaining({ name: "Portfolio Reviewer", date: "2026-11-09" }) }),
      select: { id: true },
    });
    expect(saveRunThread).toHaveBeenCalledWith("run_review", expect.objectContaining({ opening: [{ role: "user", content: "FACTS:\n…" }] }), "portfolio-reviewer");
    expect(runUpdate).toHaveBeenCalledWith({ where: { id: "run_review" }, data: expect.objectContaining({ status: "COMPLETE" }) });
    const saved = (upsert.mock.calls[0] as unknown as [{ create: { brief: string; narrative: string } }])[0].create;
    expect(saved).toMatchObject({ brief: "Stand-in brief.", narrative: "Stand-in digest." });
  });
});

describe("the job never leaves a review half done", () => {
  beforeEach(() => jest.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it("when what's waiting can't be read, the run ends FAILED and the digest is the plain facts, with no brief", async () => {
    const { runUpdate, upsert, writePortfolioReview } = await runTheJobAt(day.digest.createdAt, { facts: SAMPLE_FACTS, orders: async () => Promise.reject(new Error("connection reset")) });
    expect(writePortfolioReview).not.toHaveBeenCalled();
    expect(runUpdate).toHaveBeenCalledWith({ where: { id: "run_review" }, data: expect.objectContaining({ status: "FAILED" }) });
    const saved = (upsert.mock.calls[0] as unknown as [{ create: { brief: string | null; narrative: string; model: string } }])[0].create;
    expect(saved).toMatchObject({ brief: null, model: "fallback" });
    expect(saved.narrative).toContain("Cash $25,000.");
  });

  it("when the run can't be marked done, the digest is still saved", async () => {
    const { upsert } = await runTheJobAt(day.digest.createdAt, { runUpdate: async () => Promise.reject(new Error("connection reset")) });
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("a rerun whose model fails leaves the written brief and digest as they were", async () => {
    const failed = async () => ({ brief: null, narrative: "Plain facts.", model: "fallback", opening: [], messages: [], usage: [] });
    const { upsert, runUpdate } = await runTheJobAt(day.digest.createdAt, { review: failed });
    const args = (upsert.mock.calls[0] as unknown as [{ create: { brief: string | null }; update: Record<string, unknown> }])[0];
    expect(args.update).toEqual({});
    expect(args.create.brief).toBeNull();
    expect(runUpdate).toHaveBeenCalledWith({ where: { id: "run_review" }, data: expect.objectContaining({ status: "FAILED" }) });
  });
});
