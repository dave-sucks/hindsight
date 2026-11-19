/**
 * The chat with no analyst pinned passes on a stock itself, naming the
 * analyst, as its watch_stock does.
 *
 * P (Everpure), the owner's chat of 2026-11-19 (run cmwnorgxo000907jmldpk92up):
 * unpinned, the chat had no pass_on_stock, so it sent P to the PEAD
 * Specialist's Writer only to record a pass (child run
 * cmwnosqeu000h07jmwo3e6w1m), with the verdict already in the brief.
 */
import type { z } from "zod";
import { replayTool, agentConfigRow, REPLAY_ANALYST_ID } from "@/lib/replay";

const REASON =
  "The print was solid, but the margin on sales missed, Barclays cut its target on pricing, and it piles onto the AI-storage bet the book already holds.";

async function schemaFor(ctx: Record<string, unknown>): Promise<z.ZodTypeAny> {
  let schema!: z.ZodTypeAny;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    const { passOnStock } = await import("./pass-on-stock");
    schema = (passOnStock({ runId: "r", userId: "u", accountId: "a", ...ctx } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
  });
  return schema;
}

const pass = (args: Record<string, unknown>) =>
  replayTool("pass-on-stock", "passOnStock", {
    seed: { agentConfig: [agentConfigRow({ name: "PEAD Specialist", tradingEnvironment: "LIVE" })] },
    // Unpinned: the Master Chat's run has no analyst.
    ctx: { runMode: "PRINCIPAL_CHAT", analystId: undefined, calledTickers: new Map([["P", new Set(["get_stock_data"])]]) },
    args,
    quotes: { P: 112.51 },
    mocks: { "@/lib/actions/api-keys.actions": () => ({ resolveAlpacaCredentials: async () => null }) },
  });

describe("pass_on_stock on the chat with no analyst pinned", () => {
  it("takes the analyst by id there, and not when the chat is pinned", async () => {
    expect((await schemaFor({ runMode: "PRINCIPAL_CHAT" })).safeParse({ ticker: "P", reason: REASON }).success).toBe(false);
    expect((await schemaFor({ runMode: "PRINCIPAL_CHAT" })).safeParse({ ticker: "P", reason: REASON, analyst_id: REPLAY_ANALYST_ID }).success).toBe(true);
    expect((await schemaFor({ runMode: "PRINCIPAL_CHAT", analystId: REPLAY_ANALYST_ID })).safeParse({ ticker: "P", reason: REASON, analyst_id: "x" }).data).toEqual({ ticker: "P", reason: REASON });
  });

  it("P is saved as Passed on the named analyst, with no Writer run", async () => {
    const r = await pass({ ticker: "P", reason: REASON, analyst_id: REPLAY_ANALYST_ID });
    expect(r.crashed).toBe(false);
    expect(r.refused).toBe(false);
    const t = r.db.store.thesis.find((x) => x.ticker === "P") as Record<string, unknown> | undefined;
    expect(t).toMatchObject({ status: "PASSED" });
    // It belongs to the analyst: its run is the analyst's manual run.
    const run = r.db.store.researchRun.find((x) => x.id === t!.researchRunId) as Record<string, unknown> | undefined;
    expect(run?.agentConfigId).toBe(REPLAY_ANALYST_ID);
    expect(r.db.store.researchRun.some((x) => (x as { mode?: string }).mode === "THESIS_WRITER")).toBe(false);
  }, 30_000);

  it("an analyst not on the account is refused, saying what to send", async () => {
    const r = await pass({ ticker: "P", reason: REASON, analyst_id: "someone_elses" });
    expect(r.result.summary).toBe("Not passed: no analyst someone_elses on this account.");
    expect(r.db.store.thesis.some((x) => x.ticker === "P")).toBe(false);
  }, 30_000);
});
