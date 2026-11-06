/**
 * What the sender found, and whose thesis a stock came from, reach the writer.
 *
 * Replay: the chat's ESTC dispatch, 2026-10-30, its reason as sent (cut to the
 * first sentence). Before this the writer got the reason, a setup and one
 * 400-character numbers line: the chat's own reads and a pasted post never
 * reached it. The idea's author here is made up. What the writer is shown
 * from them is pinned in run-thesis-writer.test.ts.
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

const ESTC_REASON = "User-initiated pre-earnings discovery scan. ESTC reports Nov 16 after close — 17 days out.";
const NOTES = "Pulled get_stock_data: 8/8 trend, +95% vs SPY over 6 months, pulling back to the 20-day at $97 on 0.78x volume. Kept it over the other four reporting that week because it is the only one above a rising 50-day.";
const IDEA = {
  author: "@example_author on X",
  url: "https://x.com/example_author/status/1",
  posted_on: "2026-10-28",
  text: "Elastic is the cheapest way to own enterprise AI search: vector workloads are moving onto it, and the next print shows it in cloud revenue.",
};

describe("dispatch_thesis_research — the hand-off to the writer", () => {
  it("the notes and the idea ride on the writer's run and its event", async () => {
    const { db } = await replayTool("dispatch-thesis-research", "dispatchThesisResearch", {
      seed: { agentConfig: [agentConfigRow()], researchRun: [parentRun] },
      args: { ticker: "ESTC", mode: "mint", reason: ESTC_REASON, research_notes: NOTES, idea_source: IDEA },
    });
    const writer = db.store.researchRun.find((r) => r.mode === "THESIS_WRITER");
    expect(writer).toBeDefined();
    const params = writer!.parameters as { reason: string; researchNotes: string; ideaSource: typeof IDEA };
    expect(params.reason.startsWith(ESTC_REASON)).toBe(true);
    expect(params.researchNotes).toBe(NOTES);
    expect(params.ideaSource).toEqual(IDEA);
  });

  it("a dispatch with neither is unchanged: both are null", async () => {
    const { db } = await replayTool("dispatch-thesis-research", "dispatchThesisResearch", {
      seed: { agentConfig: [agentConfigRow()], researchRun: [parentRun] },
      args: { ticker: "ESTC", mode: "mint", reason: ESTC_REASON },
    });
    const params = db.store.researchRun.find((r) => r.mode === "THESIS_WRITER")!.parameters as Record<string, unknown>;
    expect(params.researchNotes).toBeNull();
    expect(params.ideaSource).toBeNull();
  });

});
