/**
 * The chat hears why a writer failed (2026-09-24).
 *
 * Five writers were dispatched from the discovery chat; IBRX, BBIO and DYN
 * died in the writer and CORT timed out. The chat had said "all five
 * dispatched" and moved on, and wait_for_thesis_refresh — the only tool that
 * could have told it — said "refresh FAILED" with no reason, and described
 * itself as a refresh-only tool. Rows are the real IBRX and CORT child runs.
 */
import { replayTool, REPLAY_RUN_ID } from "@/lib/replay";

const ibrx = {
  id: "cmugfung5000504jtclq53vki", mode: "THESIS_WRITER", status: "FAILED", parentRunId: REPLAY_RUN_ID,
  parameters: { ticker: "IBRX", mode: "mint", agentSteps: 1, submitAttempts: 1, error: "submit_thesis never passed validation (1 attempt)" },
};
const cort = {
  id: "cmugfuqks000604jtv9qm1ja3", mode: "THESIS_WRITER", status: "FAILED", parentRunId: REPLAY_RUN_ID,
  parameters: { ticker: "CORT", mode: "mint", agentSteps: 0, error: "The operation was aborted due to timeout" },
};
const running = { id: "child_running", mode: "THESIS_WRITER", status: "RUNNING", parentRunId: REPLAY_RUN_ID, parameters: { ticker: "BBIO", mode: "mint" } };

describe("wait_for_thesis_refresh with timeout_seconds: 0 — a status check, with the reason", () => {
  it("IBRX: FAILED, and the writer's own reason is in the summary and the data", async () => {
    // The tool reports the CHILD's failure in the refusal shape (status
    // FAILED), so the harness reads it as refused; that is the report, not
    // a gate on this call. Assert the report.
    const { result } = await replayTool("wait-for-thesis-refresh", "waitForThesisRefresh", {
      seed: { researchRun: [ibrx] },
      args: { child_run_id: ibrx.id, timeout_seconds: 0 },
    });
    expect(result.summary).toBe("Writer FAILED for IBRX: submit_thesis never passed validation (1 attempt)");
    expect(result.data?.status).toBe("FAILED");
    expect(result.data?.reason).toBe("submit_thesis never passed validation (1 attempt)");
  });

  it("CORT: the timeout is named as the reason", async () => {
    const { result } = await replayTool("wait-for-thesis-refresh", "waitForThesisRefresh", {
      seed: { researchRun: [cort] },
      args: { child_run_id: cort.id, timeout_seconds: 0 },
    });
    expect(result.data?.reason).toBe("The operation was aborted due to timeout");
  });

  it("a run with no recorded error falls back to its run_failed event", async () => {
    const { result } = await replayTool("wait-for-thesis-refresh", "waitForThesisRefresh", {
      seed: {
        researchRun: [{ ...ibrx, id: "child_x", parameters: { ticker: "DYN", mode: "mint" } }],
        runEvent: [{ id: "e1", runId: "child_x", type: "run_failed", title: "Thesis-writer did not produce a thesis", message: "persist phase failed: boom", createdAt: new Date() }],
      },
      args: { child_run_id: "child_x", timeout_seconds: 0 },
    });
    expect(result.data?.reason).toBe("persist phase failed: boom");
  });

  it("still running: answers at once instead of waiting", async () => {
    const t0 = Date.now();
    const { result } = await replayTool("wait-for-thesis-refresh", "waitForThesisRefresh", {
      seed: { researchRun: [running] },
      args: { child_run_id: running.id, timeout_seconds: 0 },
    });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(result.data?.status).toBe("TIMEOUT");
    expect(String(result.data?.note)).toContain("still RUNNING");
  });
});
