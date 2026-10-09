/**
 * get-theses.writer-run.replay.test.ts — the newest writer run on a stock
 * reaches the row, and the row's words say a missing or failed write-up
 * (step 12, part 1). Nothing silent: in the 30 days to 2026-10-09, 42 writer
 * runs started and 31 completed, and a failed one left no mark on its stock.
 *
 * Through the real get_theses execute against the doubled database, then the
 * one row builder, as the research-line test does. A seed whose clock is due
 * is a row in `theses` (FIRST_RESEARCH); one that is not due is one line in
 * `quiet_theses`; the fact rides on both.
 */
import { replayTool, thesisRow, REPLAY_ANALYST_ID, type Row } from "@/lib/replay";

/** get-theses's pure row builder, loaded without a database. */
async function rowForModel(row: Record<string, unknown>, size: "line" | "short" | "full"): Promise<string | Record<string, unknown>> {
  let out: string | Record<string, unknown> = "";
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    out = (await import("./get-theses")).rowForModel(row, { named: size === "full", size });
  });
  return out;
}

const DAY = 86_400_000;
const NOW = new Date("2026-10-09T13:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const SEED_ID = "cmum2tf9m000d04jfv0szuiap";

/** A seed as the chat mints one: no view, no claim, a wake and a 45-day clock (MA's shape, 2026-09-29). `createdAgo` decides whether the clock is due. */
const seed = (createdAgo: number) =>
  thesisRow({
    id: SEED_ID, ticker: "MA", status: "WATCHING", direction: null, horizon: "COMPOUNDER", setupId: null,
    coreBelief: null, keyAssumptions: [], invalidationConds: [], snapshot: null, bullCase: null, bearCase: null, scoring: null, conviction: null, convictionRationale: null,
    entryPrice: null, targetPrice: null, stopLoss: null, researchUpdatedAt: null, createdAt: ago(createdAgo), lastReviewedAt: null,
    triggers: [
      { id: "wake", action: "REVIEW", source: "AGENT", predicate: { watch: "strength", value: 0, settings: { window: "6M" } }, rationale: "r", cooldownDays: 7 },
      { id: "clock", action: "REVIEW", source: "AGENT", predicate: { watch: "repeat", value: 45 }, rationale: "r", cooldownDays: 45 },
    ],
  });

const writerRun = (id: string, status: string, startedAt: Date, parameters: Record<string, unknown>): Row => ({
  id, mode: "THESIS_WRITER", status, startedAt, completedAt: status === "RUNNING" ? null : startedAt, agentConfigId: REPLAY_ANALYST_ID, parameters, createdAt: startedAt,
});

type Read = { data: { theses: Array<Record<string, unknown>>; quiet_theses?: Array<Record<string, unknown>> } };

async function read(createdAgo: number, researchRun: Row[]): Promise<{ row: Record<string, unknown>; listed: boolean }> {
  const { result, crashed } = await replayTool("get-theses", "getTheses", {
    seed: { thesis: [seed(createdAgo)], researchRun } as never,
    args: { limit: 50 },
    ctx: { runMode: "MORNING_PLAN" },
    quotes: { MA: 560 },
  });
  if (crashed) throw new Error(`get_theses crashed: ${JSON.stringify(result).slice(0, 1500)}`);
  const data = (result as unknown as Read).data;
  const listed = data.theses.find((t) => t.id === SEED_ID);
  const quiet = (data.quiet_theses ?? []).find((t) => t.id === SEED_ID);
  if (!listed && !quiet) throw new Error("the seed is not on the read");
  return { row: (listed ?? quiet)!, listed: !!listed };
}

describe("the newest writer run on a stock, on its row", () => {
  beforeAll(() => jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask", "hrtime", "performance"] }));
  afterAll(() => jest.useRealTimers());

  const failedNewer = () => [
    writerRun("w_old", "COMPLETE", ago(9), { thesisId: SEED_ID, ticker: "MA", mode: "refresh" }),
    writerRun("w_new", "FAILED", ago(2), { existingThesisId: SEED_ID, ticker: "MA", mode: "refresh", error: "model produced no submit_thesis call" }),
    writerRun("w_other", "FAILED", ago(1), { existingThesisId: "someone_else", ticker: "V", mode: "refresh" }),
  ];

  it("a seed due its first research: a row, its research line says the write-up failed and when", async () => {
    const { row, listed } = await read(50, failedNewer());
    expect(listed).toBe(true);
    expect(row.situations).toEqual(["FIRST_RESEARCH"]);
    expect(row.writerRun).toEqual({ status: "FAILED", startedAt: ago(2).toISOString() });
    const short = (await rowForModel(row, "short")) as Record<string, unknown>;
    expect(short.stock).toBe("MA · watch · no view · COMPOUNDER");
    expect(short.research).toBe('No write-up yet; the last write-up failed 2026-10-07. Full row: get_theses(tickers: ["MA"]).');
  });

  it("a seed not yet due: one quiet line, with the failed write-up and its date", async () => {
    const { row, listed } = await read(5, failedNewer());
    expect(listed).toBe(false);
    expect(row.writerRun).toEqual({ status: "FAILED", startedAt: ago(2).toISOString() });
    expect(await rowForModel(row, "line")).toBe("MA · watch · no view · write-up failed 10-07 · COMPOUNDER · $560.00 · review 11-18 · id cmum2tf9m000d04jfv0szuiap");
  });

  it("no writer run at all: no write-up yet, on the line and on the row", async () => {
    const quiet = await read(5, []);
    expect(quiet.row.writerRun).toBeNull();
    expect(await rowForModel(quiet.row, "line")).toContain("no view · no write-up yet");
    const due = await read(50, []);
    expect(((await rowForModel(due.row, "full")) as Record<string, unknown>).research).toBe("No write-up yet.");
  });

  it("a completed run newer than the failed one: the failure is not said", async () => {
    const { row } = await read(5, [
      writerRun("w_fail", "FAILED", ago(3), { existingThesisId: SEED_ID, ticker: "MA", mode: "refresh" }),
      writerRun("w_ok", "COMPLETE", ago(1), { existingThesisId: SEED_ID, thesisId: SEED_ID, ticker: "MA", mode: "refresh" }),
    ]);
    expect(row.writerRun).toEqual({ status: "COMPLETE", startedAt: ago(1).toISOString() });
    expect(await rowForModel(row, "line")).toContain("no view · no write-up yet");
  });
});
