/**
 * The brief, and the link an idea came from, reach the writer.
 *
 * Replay: the chat's ESTC dispatch, 2026-10-30: its reason as sent (cut to
 * the first sentence) and what the chat had found, now one brief. The
 * idea's author here is made up. What the writer is shown from them is
 * pinned in run-thesis-writer.test.ts.
 */
import { replayTool, agentConfigRow, REPLAY_ACCOUNT_ID, REPLAY_ANALYST_ID, REPLAY_RUN_ID } from "@/lib/replay";

const parentRun = {
  id: REPLAY_RUN_ID,
  accountId: REPLAY_ACCOUNT_ID,
  status: "RUNNING",
  mode: "PRINCIPAL_CHAT",
  agentConfigId: REPLAY_ANALYST_ID,
  parameters: {},
  startedAt: new Date(),
  completedAt: null,
};

const BRIEF =
  "User-initiated pre-earnings discovery scan. ESTC reports Nov 16 after close — 17 days out. " +
  "Pulled get_stock_data: 8/8 trend, +95% vs SPY over 6 months, pulling back to the 20-day at $97 on 0.78x volume. " +
  "The idea is @example_author's on X: Elastic is the cheapest way to own enterprise AI search.";
const LINK = "https://x.com/example_author/status/1";

describe("dispatch_thesis_research — the hand-off to the writer", () => {
  it("the brief and the link ride on the writer's run", async () => {
    const { db } = await replayTool("dispatch-thesis-research", "dispatchThesisResearch", {
      seed: { agentConfig: [agentConfigRow()], researchRun: [parentRun] },
      args: { ticker: "ESTC", brief: BRIEF, source_link: LINK },
    });
    const writer = db.store.researchRun.find((r) => r.mode === "THESIS_WRITER");
    expect(writer).toBeDefined();
    const params = writer!.parameters as { mode: string; reason: string; ideaSource: unknown };
    expect(params.mode).toBe("mint");
    expect(params.reason.startsWith(BRIEF)).toBe(true);
    expect(params.ideaSource).toEqual({ url: LINK });
  });

  it("a send with no link has no idea source", async () => {
    const { db } = await replayTool("dispatch-thesis-research", "dispatchThesisResearch", {
      seed: { agentConfig: [agentConfigRow()], researchRun: [parentRun] },
      args: { ticker: "ESTC", brief: BRIEF },
    });
    const params = db.store.researchRun.find((r) => r.mode === "THESIS_WRITER")!.parameters as Record<string, unknown>;
    expect(params.ideaSource).toBeNull();
  });
});
