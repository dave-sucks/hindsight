/**
 * complete-run.replay.test.ts — the preflight that decides whether a run may
 * finish, through its real execute (DAV-311).
 *
 * `complete_run` had no test through its entry point. Its preflight is the
 * highest-stakes gate in the system by blast radius: it is the last thing
 * between a run that did nothing and a run recorded as COMPLETE. It is also
 * pure reachability — a stack of checks that only fire if the ones above
 * them let the call through, which is the shape that has gone dead four times.
 *
 * Every case runs the real preflight against real rows. Only the database and
 * the quote vendor are doubled.
 */
import {
  replayTool,
  thesisRow,
  thesisUpdateRow,
  REPLAY_ANALYST_ID,
  REPLAY_RUN_ID,
} from "@/lib/replay";

const runRow = (over: Record<string, unknown> = {}) => ({
  id: REPLAY_RUN_ID,
  status: "RUNNING",
  mode: "MORNING_PLAN",
  agentConfigId: REPLAY_ANALYST_ID,
  parameters: {},
  startedAt: new Date(),
  completedAt: null,
  ...over,
});

/** A run that did its work: a summary event on the record. */
const summaryEvent = () => ({
  id: "ev_summary",
  runId: REPLAY_RUN_ID,
  type: "run_summary",
  title: "Run summary",
  message: "Reviewed the book.",
  payload: {},
  createdAt: new Date(),
});

describe("complete_run's preflight runs for real", () => {
  it("a run with no work output is refused, not quietly completed", async () => {
    const { result, db } = await replayTool("complete-run", "completeRun", {
      seed: { researchRun: [runRow()], thesis: [], runEvent: [] },
      args: {},
    });

    expect(result.summary).toMatch(/refused/i);
    // The point of refusing in preflight: the run is still RUNNING, so the
    // agent can recover in-conversation instead of going terminal.
    expect(db.store.researchRun[0].status).toBe("RUNNING");
  });

  it("a run that recorded its summary is allowed to finish", async () => {
    const { result, db } = await replayTool("complete-run", "completeRun", {
      seed: {
        researchRun: [runRow()],
        runEvent: [summaryEvent()],
        thesis: [thesisRow({ id: "t1", ticker: "AAA" })],
        thesisUpdate: [thesisUpdateRow({ thesisId: "t1", runId: REPLAY_RUN_ID })],
      },
      args: {},
      quotes: { AAA: 101 },
    });

    expect(result.summary).not.toMatch(/refused/i);
    expect(db.store.researchRun[0].status).toBe("COMPLETE");
  });

  it("an unscoped run skips the preflight — there is no book to check", async () => {
    const { result } = await replayTool("complete-run", "completeRun", {
      seed: { researchRun: [runRow({ agentConfigId: null })] },
      args: {},
      ctx: { analystId: undefined },
    });
    expect(result.summary).not.toMatch(/refused/i);
  });

  // The summary-vs-execution check lives HERE, not in record_run_summary — it
  // moved on 2026-05-23 (P0-12) so an agent that self-corrects before the end
  // of the run is not marked FAILED for the attempt. Production: Secular
  // Theme/SMTC, 2026-05-22, check at 08:15:53, real close at 08:17:30.
  // Since DAV-309 it reads the pick's ACTION, not the prose.
  it("a run that narrated a close it never made does not finish clean", async () => {
    const { result, db } = await replayTool("complete-run", "completeRun", {
      seed: {
        researchRun: [runRow()],
        runEvent: [
          {
            ...summaryEvent(),
            payload: {
              decisionRationale:
                "I closed $AAA this morning — the floor tripped, so I exited the full position.",
              rankedPicks: [{ rank: 1, ticker: "AAA", action: "HOLD", direction: "LONG", confidence: 70 }],
            },
          },
        ],
        thesis: [thesisRow({ id: "t1", ticker: "AAA", status: "HOLDING" })],
        thesisUpdate: [thesisUpdateRow({ thesisId: "t1", runId: REPLAY_RUN_ID })],
      },
      args: {},
      quotes: { AAA: 91 },
    });

    const said = JSON.stringify(result).toLowerCase();
    const finishedClean = db.store.researchRun[0].status === "COMPLETE" && !/narrat|refused|fail/.test(said);
    expect(finishedClean).toBe(false);
  });
});
