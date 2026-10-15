/**
 * Every Agent Watch gets its write-up (DAV-349). The live book's six no-view watches on 2026-10-14: ABBV, MA and
 * COGT have a review clock and are sent; CRWD, FTNT and NDAQ are plain watches and are not.
 * Runs the morning job's own handler with the database, Inngest and the clock doubled; the writer never runs.
 * The analysts are scheduled for Mondays and the clock is a Thursday, so the handler stops after the step.
 */
import raw from "@/lib/agent/__fixtures__/agent-watch-no-view-2026-10-14.json";
import {
  prismaDouble,
  thesisRow,
  agentConfigRow,
  daysAgo,
  REPLAY_ACCOUNT_ID,
  REPLAY_ANALYST_ID,
  type PrismaDouble,
  type Row,
} from "@/lib/replay";

const fx = raw as unknown as {
  analysts: Array<{ id: string; name: string; enabled: boolean }>;
  watches: Array<{
    id: string;
    ticker: string;
    status: string;
    direction: string | null;
    createdAt: string;
    agentConfigId: string;
    triggers: unknown[];
  }>;
  cogtWriterRun: Row & { startedAt: string; completedAt: string };
};

/** Thursday 2026-10-15, 08:00 ET — the first morning after the read. */
const MORNING = new Date("2026-10-15T12:00:05Z");

/** COGT's real 2026-09-28 refresh: it completed and left the row with no view. `startedAt` moves it in time. */
const cogtRun = (startedAt = new Date(fx.cogtWriterRun.startedAt)): Row => ({
  ...fx.cogtWriterRun,
  accountId: REPLAY_ACCOUNT_ID,
  startedAt,
  completedAt: new Date(startedAt.getTime() + 211_683),
});

const watchRows = (): Row[] =>
  fx.watches.map((w) =>
    thesisRow({ ...w, createdAt: new Date(w.createdAt), analystId: w.agentConfigId, coreBelief: null }),
  );
const idOf = (ticker: string) => fx.watches.find((w) => w.ticker === ticker)!.id;

interface Morning {
  db: PrismaDouble;
  sent: Array<{ name: string; data: Record<string, unknown> }>;
  steps: string[];
  /** What the write-up step returned: the stocks sent and the ones held back, with why. */
  writeups: { sent: string[]; skipped: string[] } | null;
  result: Record<string, unknown>;
}

/** One 8 AM run of the morning job over these rows. */
async function morning(seed: { thesis: Row[]; researchRun?: Row[]; analysts?: Row[] }): Promise<Morning> {
  const db = prismaDouble({
    agentConfig:
      seed.analysts ??
      fx.analysts.map((a) =>
        agentConfigRow({ id: a.id, name: a.name, enabled: a.enabled, tradingEnvironment: "LIVE", runDaysOfWeek: [1] }),
      ),
    thesis: seed.thesis,
    researchRun: seed.researchRun ?? [],
  });
  const sent: Morning["sent"] = [];
  const steps: string[] = [];
  let writeups: Morning["writeups"] = null;
  let result: Record<string, unknown> = {};

  // Only the clock is faked; timers and microtasks run for real.
  jest.useFakeTimers({
    now: MORNING,
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  try {
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<Record<string, unknown>>) | undefined;
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => ({
        inngest: {
          createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => {
            handler = fn;
            return {};
          },
          send: async (e: Morning["sent"][number]) => {
            sent.push(e);
          },
        },
      }));
      await import("@/lib/inngest/functions/morning-research");
      result = await handler!({
        event: { name: "inngest/scheduled.timer", data: {} },
        step: {
          run: async (id: string, fn: () => Promise<unknown>) => {
            steps.push(id);
            const out = await fn();
            if (id === "agent-watch-writeups") writeups = out as Morning["writeups"];
            return out;
          },
        },
      });
    });
  } finally {
    jest.useRealTimers();
  }
  return { db, sent, steps, writeups, result };
}

const writers = (m: Morning) =>
  (m.db.store.researchRun as Row[]).filter((r) => r.mode === "THESIS_WRITER" && r.status === "RUNNING" && (r.parameters as Row).dispatchedBy === "agent-watch-writeup");
const sentTickers = (m: Morning) => writers(m).map((r) => (r.parameters as Row).ticker);

describe("the live book on 2026-10-14 — the morning sends every Agent Watch to the writer", () => {
  it("sends ABBV, COGT and MA, and not CRWD, FTNT or NDAQ", async () => {
    // COGT's real 09-28 write-up is in the store, 17 days old: past the week, so COGT goes again.
    const m = await morning({ thesis: watchRows(), researchRun: [cogtRun()] });
    // On main the morning sent nothing: no writer row, no event.
    // Oldest watch first: COGT (09-25), ABBV, MA (both 09-29).
    expect(sentTickers(m)).toEqual(["COGT", "ABBV", "MA"]);
    expect(m.sent.map((e) => e.data.ticker)).toEqual(["COGT", "ABBV", "MA"]);
    // The handler stopped after the step; no analyst ran.
    expect(m.steps).toEqual(["load-agent-configs", "agent-watch-writeups"]);
    expect(m.result).toMatchObject({ ran: 0, reason: "none-scheduled-today" });
  });

  it("sends each as a refresh of its own row, for its own analyst, so the writer commits the view", async () => {
    const m = await morning({ thesis: watchRows() });
    for (const ticker of ["ABBV", "COGT", "MA"]) {
      const w = fx.watches.find((x) => x.ticker === ticker)!;
      const run = writers(m).find((r) => (r.parameters as Row).ticker === ticker)!;
      expect(run).toMatchObject({ agentConfigId: w.agentConfigId, accountId: REPLAY_ACCOUNT_ID, source: "AGENT", environment: "LIVE" });
      expect(run.parameters).toMatchObject({ mode: "refresh", existingThesisId: w.id });
      const event = m.sent.find((e) => e.data.ticker === ticker)!;
      expect(event).toMatchObject({
        name: "app/thesis.write.requested",
        data: { childRunId: run.id, analystId: w.agentConfigId, mode: "refresh", existingThesisId: w.id, forceWatchingMint: false },
      });
    }
  });

  it("leaves the rows themselves alone — the writer does the writing", async () => {
    const before = watchRows();
    const m = await morning({ thesis: before });
    expect(m.db.store.thesis).toEqual(before);
  });
});

describe("a stock is not sent twice", () => {
  const running = (ticker: string): Row => ({
    id: "run_writer_running",
    accountId: REPLAY_ACCOUNT_ID,
    status: "RUNNING",
    mode: "THESIS_WRITER",
    parameters: { ticker, mode: "refresh", existingThesisId: idOf(ticker) },
    startedAt: new Date(MORNING.getTime() - 2 * 60_000),
  });
  const failed = (ticker: string, at: Date): Row => ({
    id: `run_writer_failed_${ticker}`,
    accountId: REPLAY_ACCOUNT_ID,
    status: "FAILED",
    mode: "THESIS_WRITER",
    parameters: { ticker, mode: "refresh", existingThesisId: idOf(ticker) },
    startedAt: at,
  });

  it("skips a stock with a writer in flight, and one whose writer failed 2 hours ago; sends one that failed 2 days ago", async () => {
    const m = await morning({
      thesis: watchRows(),
      researchRun: [
        running("COGT"),
        failed("ABBV", new Date(MORNING.getTime() - 2 * 3_600_000)),
        failed("MA", new Date(MORNING.getTime() - 2 * 86_400_000)),
      ],
    });
    expect(sentTickers(m)).toEqual(["MA"]);
  });

  it("a write-up that failed at yesterday's 8 AM send is tried again this morning", async () => {
    // Yesterday's step ran a few seconds later than today's, so the failure is just under 24 hours old.
    const m = await morning({
      thesis: watchRows(),
      researchRun: [failed("ABBV", new Date("2026-10-14T12:00:07Z"))],
    });
    expect(sentTickers(m).sort()).toEqual(["ABBV", "COGT", "MA"]);
  });
});

describe("a write-up that completed but left no view is paid for once a week, not every morning", () => {
  it("COGT's run, completed 2 days ago: COGT waits, and the log says it needs a look", async () => {
    const m = await morning({ thesis: watchRows(), researchRun: [cogtRun(daysAgo(2, MORNING))] });
    expect(sentTickers(m)).toEqual(["ABBV", "MA"]);
    expect(m.writeups?.skipped).toContain("COGT (written up 2026-10-13 but no view — needs a look)");
  });

  it("COGT's run, completed 8 days ago: COGT is sent again", async () => {
    const m = await morning({ thesis: watchRows(), researchRun: [cogtRun(daysAgo(8, MORNING))] });
    expect(sentTickers(m)).toEqual(["COGT", "ABBV", "MA"]);
  });
});

describe("at most three a morning", () => {
  it("four Agent Watches waiting: the three oldest are sent", async () => {
    const clock = [{ id: "c", action: "REVIEW", predicate: { watch: "repeat", value: 7 } }];
    const seed = (ticker: string, age: number) =>
      thesisRow({ id: `thesis_${ticker}`, ticker, direction: null, coreBelief: null, triggers: clock, createdAt: daysAgo(age, MORNING) });
    const m = await morning({
      thesis: [seed("NEWEST", 10), seed("OLDEST", 40), seed("THIRD", 20), seed("SECOND", 30)],
      analysts: [agentConfigRow({ id: REPLAY_ANALYST_ID, tradingEnvironment: "PAPER", runDaysOfWeek: [1] })],
    });
    expect(sentTickers(m)).toEqual(["OLDEST", "SECOND", "THIRD"]);
  });
});
