/**
 * A stock this analyst's Writer finished in the last half hour is not sent to
 * the Writer again: its result is the answer.
 *
 * 2026-11-19, the Mergers and Index Events Analyst (PAPER):
 * - 08:00:20 the morning job sent its three no-view watches to the Writer
 *   (no parent run): BEEM finished 08:02:03, CPA 08:02:14, DOYU 08:02:40.
 *   BEEM and DOYU were saved as Passed; CPA kept its watch.
 * - 08:01:09 the analyst's morning run started, read the three as "no view,
 *   review due", and sent each; the check saw only RUNNING Writers.
 * - 08:02:18 the run sent BEEM again: a second Writer, a second PASSED row.
 * - 08:02:59 the cron's retry, with no history, sent DOYU and CPA again:
 *   a second PASSED DOYU, and CPA's second write-up in three minutes.
 * The rows below are those runs. On main each send here starts a Writer.
 */
import { replayTool, agentConfigRow, thesisRow, REPLAY_ACCOUNT_ID } from "@/lib/replay";

const ANALYST = "cmwminrks000408l7nr63zaqj";
const MORNING_RUN = "cmwnk6nh1000j08jj98pjtptw";
const at = (hms: string) => new Date(`2026-11-19T${hms}Z`);

/** The morning job's Writer on a stock, as it ran (no parent run). */
const morningJobWriter = (id: string, ticker: string, started: string, finished: string, over: Record<string, unknown> = {}) => ({
  id,
  accountId: REPLAY_ACCOUNT_ID,
  status: "COMPLETE",
  mode: "THESIS_WRITER",
  agentConfigId: ANALYST,
  parentRunId: null,
  parameters: { ticker, mode: "refresh", dispatchedBy: "agent-watch-writeup" },
  startedAt: at(started),
  completedAt: at(finished),
  ...over,
});
const WRITERS = [
  morningJobWriter("cmwnk5lnx000208jj4suc6jg5", "BEEM", "13:00:20", "13:02:03"),
  morningJobWriter("cmwnk5lyb000308jj8cypu2mc", "CPA", "13:00:20", "13:02:14"),
  morningJobWriter("cmwnk5m1d000408jjfcjmbc7p", "DOYU", "13:00:21", "13:02:40"),
];
const morningRun = { id: MORNING_RUN, accountId: REPLAY_ACCOUNT_ID, status: "RUNNING", mode: "MORNING_PLAN", agentConfigId: ANALYST, parameters: {}, startedAt: at("13:01:09"), completedAt: null };
// Each stock as the Writer left it: BEEM and DOYU passed, CPA still watched.
const THESES = [
  thesisRow({ id: "beem_seed", ticker: "BEEM", status: "PASSED", direction: null, analystId: ANALYST }),
  thesisRow({ id: "cpa_watch", ticker: "CPA", status: "WATCHING", direction: "LONG", analystId: ANALYST }),
  thesisRow({ id: "doyu_seed", ticker: "DOYU", status: "PASSED", direction: null, analystId: ANALYST }),
];
const noEdgar = { "@/lib/market-data/sec-filings": () => ({ fetchBookFilings: async () => ({ byTicker: new Map() }) }) };

const MORNING_CTX = { runId: MORNING_RUN, analystId: ANALYST, runMode: "MORNING_PLAN", runEnvironment: "PAPER" };
async function sendAt(time: string, ticker: string, writers: Record<string, unknown>[] = WRITERS, ctx: Record<string, unknown> = MORNING_CTX) {
  jest.useFakeTimers({ now: at(time), doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "queueMicrotask", "hrtime", "performance"] });
  try {
    return await replayTool("dispatch-thesis-research", "dispatchThesisResearch", {
      seed: { agentConfig: [agentConfigRow({ id: ANALYST, name: "Mergers and Index Events Analyst" })], researchRun: [morningRun, ...writers], thesis: THESES },
      args: { ticker, brief: `Seed watch is review due with no write-up yet; ${ticker} needs a first real underwrite.` },
      ctx,
      mocks: noEdgar,
    });
  } finally {
    jest.useRealTimers();
  }
}
const writersStarted = (r: Awaited<ReturnType<typeof sendAt>>) => r.db.store.researchRun.filter((x) => x.mode === "THESIS_WRITER" && x.parentRunId === MORNING_RUN).length;

describe("a stock just written for this analyst is not written again (BEEM, CPA, DOYU, 2026-11-19)", () => {
  it.each([
    ["13:02:18", "BEEM", "cmwnk5lnx000208jj4suc6jg5", 2],
    ["13:02:59", "DOYU", "cmwnk5m1d000408jjfcjmbc7p", 3],
    ["13:02:59", "CPA", "cmwnk5lyb000308jj8cypu2mc", 3],
  ])("at %s the run's send of %s is refused, pointing at the Writer that wrote it", async (time, ticker, writer, ageMin) => {
    const r = await sendAt(time as string, ticker as string);
    expect(r.crashed).toBe(false);
    expect(r.result.summary).toBe(`Dispatch refused for $${ticker}: Mergers and Index Events Analyst's Writer wrote it ${ageMin}m ago (run ${writer}).`);
    expect(r.result.data).toMatchObject({ childRunId: null, status: "FAILED", writtenBy: writer });
    expect(writersStarted(r)).toBe(0);
  });

  it("another analyst's finished Writer blocks nothing: it may write its own thesis", async () => {
    const r = await sendAt("13:02:18", "BEEM", [morningJobWriter("other_writer", "BEEM", "13:00:20", "13:02:03", { agentConfigId: "other_analyst" })]);
    expect(writersStarted(r)).toBe(1);
    expect(r.result.summary).toMatch(/^Dispatched thesis-writer for \$BEEM/);
  });

  it("the owner's chat asking for BEEM at 08:02:18 gets its Writer, told when the last one wrote it", async () => {
    const chatRun = { id: "chat_run", accountId: REPLAY_ACCOUNT_ID, status: "RUNNING", mode: "PRINCIPAL_CHAT", agentConfigId: ANALYST, parameters: {}, startedAt: at("13:01:30"), completedAt: null };
    const r = await sendAt("13:02:18", "BEEM", [...WRITERS, chatRun], { runId: "chat_run", analystId: ANALYST, runMode: "PRINCIPAL_CHAT", runEnvironment: "PAPER" });
    expect(r.crashed).toBe(false);
    expect(r.db.store.researchRun.filter((x) => x.mode === "THESIS_WRITER" && x.parentRunId === "chat_run")).toHaveLength(1);
    expect(r.result.summary).toMatch(/^Dispatched thesis-writer for \$BEEM .* \$BEEM was last written up for this analyst 2m ago \(run cmwnk5lnx000208jj4suc6jg5\)\.$/);
    expect(r.result.data).toMatchObject({ writtenLately: "$BEEM was last written up for this analyst 2m ago (run cmwnk5lnx000208jj4suc6jg5)." });
  });

  it("a Writer that failed blocks nothing, and neither does one older than the half hour", async () => {
    expect((await sendAt("13:02:18", "BEEM", [morningJobWriter("failed_writer", "BEEM", "13:00:20", "13:02:03", { status: "FAILED" })])).result.summary).toMatch(/^Dispatched thesis-writer for \$BEEM/);
    expect((await sendAt("13:31:00", "BEEM")).result.summary).toMatch(/^Dispatched thesis-writer for \$BEEM/);
  });
});
