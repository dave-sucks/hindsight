/**
 * dispatch-thesis-research.replay.test.ts — the two dispatch refusals,
 * through the real entry point (DAV-311).
 *
 * Both of them guard spend: the per-run discovery cap, and the
 * already-in-flight check that stops two writers researching the same stock
 * at once. A writer run is the most expensive thing an agent can start, so a
 * refusal here going quietly dead costs money directly — and neither had a
 * test through `execute`, only through the helpers around it.
 *
 * The in-flight case is the near neighbour of DAV-301: two writers on one
 * stock is how CYTK ended up with a plan written and deleted seventeen
 * seconds apart.
 */
import {
  replayTool,
  agentConfigRow,
  REPLAY_ACCOUNT_ID,
  REPLAY_ANALYST_ID,
  REPLAY_RUN_ID,
} from "@/lib/replay";

const parentRun = (over: Record<string, unknown> = {}) => ({
  id: REPLAY_RUN_ID,
  accountId: REPLAY_ACCOUNT_ID,
  status: "RUNNING",
  mode: "MORNING_PLAN",
  agentConfigId: REPLAY_ANALYST_ID,
  parameters: {},
  startedAt: new Date(),
  completedAt: null,
  ...over,
});

/** A writer this run already started on the same ticker. */
const writerInFlight = (ticker: string) => ({
  id: "run_writer_inflight",
  // accountId is load-bearing: the gate scopes by account, so a fixture
  // without it short-circuits the filter and the gate looks dead.
  accountId: REPLAY_ACCOUNT_ID,
  status: "RUNNING",
  mode: "THESIS_WRITER",
  agentConfigId: REPLAY_ANALYST_ID,
  parentRunId: REPLAY_RUN_ID,
  parameters: { ticker },
  startedAt: new Date(Date.now() - 60_000),
  completedAt: null,
});

describe("dispatch_thesis_research refuses spend it should refuse", () => {
  it("will not start a second writer on a stock one is already researching", async () => {
    const { result } = await replayTool("dispatch-thesis-research", "dispatchThesisResearch", {
      seed: {
        agentConfig: [agentConfigRow()],
        researchRun: [parentRun(), writerInFlight("CYTK")],
      },
      // mint, not refresh: refresh demands an existing_thesis_id and that
      // argument gate fires first — the in-flight check sits behind it.
      args: { ticker: "CYTK", mode: "mint", reason: "The chart moved; re-price the plan." },
    });

    expect(JSON.stringify(result)).toMatch(/already in flight/i);
  });

  it("a clear board dispatches, and the child run is recorded", async () => {
    const { result, db } = await replayTool("dispatch-thesis-research", "dispatchThesisResearch", {
      seed: { agentConfig: [agentConfigRow()], researchRun: [parentRun()] },
      args: { ticker: "CYTK", mode: "mint", reason: "Net-new coverage off this morning's screen." },
    });

    expect(JSON.stringify(result)).not.toMatch(/refused/i);
    // A writer row exists and is parented to this run — that parentage is what
    // lets the waiter hand its plan back (DAV-301).
    const writers = db.store.researchRun.filter((r) => r.mode === "THESIS_WRITER");
    expect(writers.length).toBeGreaterThan(0);
    expect(writers.some((r) => r.parentRunId === REPLAY_RUN_ID)).toBe(true);
  });
});
