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

const ACCOUNT = "account_live";

type Handler = (ctx: { step: { run: (name: string, fn: () => unknown) => Promise<unknown> } }) => Promise<unknown>;

/** The job's own handler at an instant, with the database, the facts and the writer stood in for. */
async function runTheJobAt(now: string) {
  const loadPortfolioSnapshot = jest.fn(async () => ({ day: "snapshot" }));
  const upsert = jest.fn(async () => ({}));
  const runsQuery = jest.fn(async () => [{ accountId: ACCOUNT, environment: day.digest.environment }]);
  let handler: Handler | null = null;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, h: Handler) => ((handler = h), {}) } }));
    jest.doMock("@/lib/prisma", () => ({
      prisma: {
        researchRun: { findMany: runsQuery },
        position: { findMany: jest.fn(async () => []) },
        agentConfig: { findMany: jest.fn(async () => [{ accountId: ACCOUNT, tradingEnvironment: day.digest.environment }]) },
        portfolioDigest: { upsert },
      },
    }));
    jest.doMock("@/lib/portfolio/load-snapshot", () => ({ loadPortfolioSnapshot }));
    jest.doMock("@/lib/agent/digest-writer", () => ({ writeDigestNarrative: async () => ({ narrative: "Stand-in digest.", model: "gpt-4o" }) }));
    jest.doMock("@/lib/runs/account-run", () => ({ runAccountCall: (_run: unknown, call: () => Promise<unknown>) => call() }));
    await import("./portfolio-digest");
  });
  jest.useFakeTimers({ now: new Date(now) });
  try {
    await handler!({ step: { run: async (_name, fn) => fn() } });
  } finally {
    jest.useRealTimers();
  }
  for (const m of ["@/lib/inngest/client", "@/lib/prisma", "@/lib/portfolio/load-snapshot", "@/lib/agent/digest-writer", "@/lib/runs/account-run"]) jest.dontMock(m);
  return { loadPortfolioSnapshot, upsert, runsQuery };
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

  it("reads the snapshot of the book it is writing about", async () => {
    const { loadPortfolioSnapshot } = await runTheJobAt(day.digest.createdAt);
    expect(loadPortfolioSnapshot).toHaveBeenCalledWith({ accountId: ACCOUNT, environment: "LIVE" });
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
