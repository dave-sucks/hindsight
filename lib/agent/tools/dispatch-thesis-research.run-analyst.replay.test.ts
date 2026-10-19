/**
 * A daily run dispatches the writer for its own analyst. The Secular
 * Compounder's 2026-10-15 morning run sent analyst_id "secular-compounder", a
 * slug it made up; the tool looked that id up, found nothing and refused, so
 * ETN's write-up never ran. Only the chat with no analyst pinned names one.
 */
import fx from "@/lib/agent/__fixtures__/dispatch-etn-2026-10-15.json";
import { replayTool, agentConfigRow, REPLAY_ACCOUNT_ID } from "@/lib/replay";

const run = { id: fx.run.id, accountId: REPLAY_ACCOUNT_ID, status: "RUNNING", mode: fx.run.mode, agentConfigId: fx.run.analystId, parameters: {}, startedAt: new Date(fx.run.startedAt), completedAt: null };
const noEdgar = { "@/lib/market-data/sec-filings": () => ({ fetchBookFilings: async () => ({ byTicker: new Map() }) }) };

it("ETN 10-15: the verbatim call dispatches for the run's analyst, the made-up slug unread", async () => {
  expect(fx.call.analyst_id).toBe("secular-compounder");
  const { refused, result, db } = await replayTool("dispatch-thesis-research", "dispatchThesisResearch", {
    seed: { agentConfig: [agentConfigRow({ id: fx.run.analystId, name: "Secular Compounder" })], researchRun: [run] },
    args: fx.call,
    ctx: { runId: fx.run.id, analystId: fx.run.analystId, runMode: fx.run.mode, runEnvironment: "LIVE" },
    mocks: noEdgar,
  });
  expect(refused).toBe(false);
  expect(result.summary).toMatch(/^Dispatched thesis-writer for \$ETN \(refresh\)/);
  const writer = db.store.researchRun.find((r) => r.mode === "THESIS_WRITER");
  expect(writer).toMatchObject({ agentConfigId: fx.run.analystId, parentRunId: fx.run.id });
});

it("the field is offered to the chat with no analyst pinned, and to no one else", async () => {
  let tool: (ctx: never) => { inputSchema: unknown } = () => ({ inputSchema: null });
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { send: jest.fn() } }));
    tool = (await import("@/lib/agent/tools/dispatch-thesis-research")).dispatchThesisResearch as never;
  });
  const fields = (ctx: Record<string, unknown>) =>
    Object.keys((tool({ runId: "r", userId: "u", accountId: "a", groupId: (g: string) => g, ...ctx } as never).inputSchema as { shape: object }).shape);
  expect(fields({ runMode: "PRINCIPAL_CHAT" })).toContain("analyst_id");
  for (const ctx of [{ runMode: "PRINCIPAL_CHAT", analystId: "an" }, { runMode: "MORNING_PLAN", analystId: "an" }, { runMode: "INTRADAY_TACTICAL", analystId: "an" }, { runMode: "DISCOVERY", analystId: "an" }]) {
    expect(fields(ctx)).not.toContain("analyst_id");
  }
});
