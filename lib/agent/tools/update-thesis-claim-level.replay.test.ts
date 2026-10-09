/**
 * update-thesis-claim-level.replay.test.ts — a save that moves a level the
 * claim still names says so in one sentence (step 12, part 1).
 *
 * MU, 2026-09-23 12:01 ET: the morning run raised the floor $969 → $1,041
 * with its reason, and "MU closes below the $969 stop-loss" stayed in
 * what-proves-it-wrong. By 10-09 the floor was $1,005 and the line still
 * said $969. The real call, sent verbatim through the SDK's loop to the
 * morning run's save, on MU's row as that run's own read carried it
 * (lib/agent/__fixtures__/mu-floor-off-969-2026-09-23.json).
 */
import { generateText, stepCountIs, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { statSync } from "fs";
import fixture from "@/lib/agent/__fixtures__/mu-floor-off-969-2026-09-23.json";
import { replayTool, thesisRow, positionRow, type Replay, type Row } from "@/lib/replay";
import type { z } from "zod";

const FIXTURE = "lib/agent/__fixtures__/mu-floor-off-969-2026-09-23.json";
const LINE = "Your what-proves-it-wrong line still names $969; the floor is now $1,041.";

/** The morning run's real save schema, read without a database. */
async function morningRunSchema(): Promise<z.ZodTypeAny> {
  let schema: z.ZodTypeAny | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    const { updateThesis } = await import("./update-thesis");
    schema = (updateThesis({ runId: "r", userId: "u", accountId: "a", runMode: "MORNING_PLAN" } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
  });
  return schema!;
}

type Entry = { call: Record<string, unknown>; price: number; position: { avgCost: number }; thesis: Row };
const entry = fixture as unknown as Entry;

/** The call as the model sent it, through the SDK's loop, to the real save on MU's row. */
async function sentVerbatim(): Promise<{ received: Record<string, unknown>; save: Replay }> {
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
  let turn = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () =>
      ++turn === 1
        ? { content: [{ type: "tool-call", toolCallId: "c1", toolName: "update_thesis", input: JSON.stringify(entry.call) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] }
        : { content: [{ type: "text", text: "done" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] },
  } as never);
  const out: { received?: Record<string, unknown>; save?: Replay } = {};
  await generateText({
    model,
    prompt: "review",
    tools: {
      update_thesis: tool({
        inputSchema: (await morningRunSchema()) as never,
        execute: async (input: Record<string, unknown>) => {
          out.received = input;
          out.save = await replayTool("update-thesis", "updateThesis", {
            seed: { thesis: [thesisRow({ ...entry.thesis })], position: [positionRow({ symbol: "MU", avgCost: entry.position.avgCost })] },
            args: input,
            ctx: { runMode: "MORNING_PLAN" },
            quotes: { MU: entry.price },
          });
          return out.save.result;
        },
      }),
    },
    stopWhen: stepCountIs(2),
  });
  if (!out.save || !out.received) throw new Error("MU: the SDK never reached the save");
  return { received: out.received, save: out.save };
}

describe("MU 09-23: the floor leaves $969 while what-proves-it-wrong still names it", () => {
  it("the save lands the move and the reply says the claim still names the old number", async () => {
    const { received, save } = await sentVerbatim();
    expect(received.stop_loss).toBe(1041);
    expect(save.crashed).toBe(false);
    expect(save.refused).toBe(false);
    const row = save.db.store.thesis[0];
    expect(row.stopLoss).toBe(1041);
    expect((row.triggers as Array<{ id: string; predicate: { value: number } }>).find((x) => x.id === "t4")?.predicate.value).toBe(1041);
    // The claim is not this door's to change, so it is still the old text.
    expect(row.invalidationConds).toEqual(entry.thesis.invalidationConds);
    expect(save.result.summary).toContain(LINE);
    expect(save.result.data?.what_this_means).toEqual(expect.arrayContaining([LINE]));
  });

  it("the fixture holds only the fields the save reads, under the cap", () => {
    expect(statSync(FIXTURE).size).toBeLessThan(40 * 1024);
    expect(Object.keys(entry.thesis)).not.toEqual(expect.arrayContaining(["snapshot", "bullCase", "bearCase", "history", "resolved"]));
  });
});
