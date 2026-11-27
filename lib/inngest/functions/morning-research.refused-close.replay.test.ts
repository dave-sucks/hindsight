/**
 * A morning run whose close-out complete_run refused, and that then stopped, did not complete.
 *
 * Secular Compounder, LIVE, 2026-10-30 (run cmvuxaux6001d08idqc7djj5q): the run reviewed five stocks
 * and recorded its summary, then complete_run refused twice: first two stocks owed (FTNT, NOW), then
 * FTNT alone. The model stopped there (the old 30-step cap). The run was saved COMPLETE with no line
 * saying it hadn't finished. In the 75 days to 2026-11-27 that is one of the three morning runs saved
 * COMPLETE without complete_run closing them (Oct 14, 19 and 30), and complete_run refused each one twice.
 * The job's own handler, with the database, Inngest, the clock and the model doubled; the refusals are
 * the run's real ones.
 */
import { prismaDouble, agentConfigRow, REPLAY_ACCOUNT_ID, REPLAY_USER_ID, type PrismaDouble, type Row } from "@/lib/replay";

const SECULAR = "cmmqxola3000004lbj7c11bfn";
const MORNING = new Date("2026-10-30T12:03:01Z");
const FIRST = "complete_run refused: 2 thesises need action";
const SECOND = "complete_run refused: 1 thesis need action";

/** complete_run's reply as the run saw it: a refusal, or the close. */
const closeOut = (summary: string | null) => ({
  toolCalls: [{ toolName: "complete_run", input: {} }],
  toolResults: [
    {
      toolName: "complete_run",
      output: summary
        ? { ok: true, ui: "tool-ui", summary, data: { ok: false, briefing: "skipped", error: summary, preflight: "needs_action" } }
        : { ok: true, ui: "tool-ui", summary: "Run complete", data: { ok: true } },
    },
  ],
});

/** The run's own work, written the way its tools write it: notes on five stocks, a summary, its decisions. */
async function theRunsWork(db: PrismaDouble, runId: string) {
  const make = (m: string, data: Row) => (db as unknown as Record<string, { create: (a: unknown) => Promise<unknown> }>)[m].create({ data });
  for (const ticker of ["CEG", "GEV", "NOW", "FTNT", "VRT"]) {
    await make("thesisUpdate", { thesisId: `thesis_${ticker}`, type: "REVIEWED", summary: "Reviewed", rationale: "The run's note.", runId, timestamp: new Date() });
  }
  await make("runEvent", { runId, type: "run_summary", title: "Run Summary — WATCH", message: null, payload: {} });
  await make("tradeDecision", { runId, ticker: "CEG", decision: "HOLD" });
}

/** One manual morning run of the Secular Compounder; `steps` is what the model's loop ended with. */
async function morning(steps: Array<ReturnType<typeof closeOut>>, closes = false) {
  const db = prismaDouble({
    agentConfig: [agentConfigRow({ id: SECULAR, name: "Secular Compounder", userId: REPLAY_USER_ID, accountId: REPLAY_ACCOUNT_ID, tradingEnvironment: "LIVE", maxOpenPositions: 10 })],
  });
  jest.useFakeTimers({ now: MORNING, doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  try {
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: async () => undefined } }));
      jest.doMock("ai", () => ({
        generateText: jest.fn(async () => {
          const run = (db.store.researchRun as Row[]).find((r) => r.status === "RUNNING")!;
          await theRunsWork(db, String(run.id));
          // A close complete_run let through marks the run COMPLETE itself, as the tool does.
          if (closes) run.status = "COMPLETE";
          return { text: "", steps, response: { messages: [] } };
        }),
        stepCountIs: () => () => false,
      }));
      jest.doMock("@/lib/agent/model", () => ({ modelFor: () => ({}) }));
      jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
      jest.doMock("@/lib/agent/run-input", () => ({ buildRunInput: async () => ({}) }));
      jest.doMock("@/lib/agent/system-prompt", () => ({ morningRunRequest: async () => ({ instructions: "STAND-IN", message: "STAND-IN", parts: [], agent: "morning_run" }) }));
      jest.doMock("@/lib/agent/context/the-book", () => ({ bookOnScreen: async () => null }));
      jest.doMock("@/lib/agent/book-card", () => ({ bookCardInThread: () => [] }));
      jest.doMock("@/lib/agent/engine/engine", () => ({ openingOf: () => "STAND-IN" }));
      jest.doMock("@/lib/agent/run-thread", () => ({ saveRunThread: async () => undefined }));
      jest.doMock("@/lib/agent/tools", () => ({ createResearchTools: () => ({}) }));
      jest.doMock("@/lib/agent/triggers/seed-account", () => ({ seedAccountTriggers: async () => false }));
      jest.doMock("@/lib/agent/watchlist-symbols", () => ({ getWatchlistSymbols: async () => [] }));
      await import("@/lib/inngest/functions/morning-research");
      await handler!({
        event: { name: "app/research.run.manual", data: { accountId: REPLAY_ACCOUNT_ID, agentConfigId: SECULAR } },
        step: { run: async (_id: string, fn: () => Promise<unknown>) => JSON.parse(JSON.stringify((await fn()) ?? null)) },
      });
    });
  } finally {
    jest.useRealTimers();
  }
  // The run is the job's one row (its mode is the schema's default, which the double leaves unset).
  const run = (db.store.researchRun as Row[])[0];
  const failedLines = ((db.store.runEvent ?? []) as Row[]).filter((e) => e.type === "run_failed");
  return { run, failedLines };
}

describe("Secular Compounder 2026-10-30: complete_run refused the close twice and the run stopped", () => {
  it("the run is FAILED, with a line saying it did not complete and why", async () => {
    const { run, failedLines } = await morning([closeOut(FIRST), closeOut(SECOND)]);
    expect(run.status).toBe("FAILED");
    expect(failedLines).toHaveLength(1);
    expect(failedLines[0]).toMatchObject({ title: "Run did not complete" });
    expect(String(failedLines[0].message)).toContain(`the run stopped after ${SECOND}`);
  });

  it("made up: refused once, then closed: the run is COMPLETE and says nothing more", async () => {
    const { run, failedLines } = await morning([closeOut(FIRST), closeOut(null)], true);
    expect(run.status).toBe("COMPLETE");
    expect(failedLines).toHaveLength(0);
  });

  it("made up: a run that did its work and never called complete_run is COMPLETE, as before", async () => {
    const { run, failedLines } = await morning([]);
    expect(run.status).toBe("COMPLETE");
    expect(failedLines).toHaveLength(0);
  });
});
