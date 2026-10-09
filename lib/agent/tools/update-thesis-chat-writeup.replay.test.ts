/**
 * update-thesis-chat-writeup.replay.test.ts — the chat's save takes no part
 * of the write-up (step 12, part 2): the cited snapshot, the score, the
 * variant view and the price the caller read are the writer's.
 *
 * HPE, 2026-10-02 18:41 ET (chat run cmurb5wyn000d04jqc8k1xgx4): the chat
 * rewrote HPE's snapshot uncited and sent four new scores, the composite
 * 9 → 7. In the 60 days to 2026-10-09, 14 of the chat's 25 update_thesis
 * calls carried one of the four. That real call, sent verbatim through the
 * SDK's loop to today's chat save, on HPE's row as the chat's own read
 * carried it (lib/agent/__fixtures__/hpe-chat-writeup-2026-10-02.json).
 */
import { generateText, stepCountIs, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { statSync } from "fs";
import fixture from "@/lib/agent/__fixtures__/hpe-chat-writeup-2026-10-02.json";
import { replayTool, thesisRow, type Replay, type Row } from "@/lib/replay";
import type { z } from "zod";

const FIXTURE = "lib/agent/__fixtures__/hpe-chat-writeup-2026-10-02.json";

/** The chat's real save schema, read without a database. */
async function chatSchema(): Promise<z.ZodTypeAny> {
  let schema: z.ZodTypeAny | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    const { updateThesis } = await import("./update-thesis");
    schema = (updateThesis({ runId: "r", userId: "u", accountId: "a", runMode: "PRINCIPAL_CHAT" } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
  });
  return schema!;
}

type Entry = { call: Record<string, unknown>; thesis: Row };
const entry = fixture as unknown as Entry;

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
    prompt: "earnings discovery",
    tools: {
      update_thesis: tool({
        inputSchema: (await chatSchema()) as never,
        execute: async (input: Record<string, unknown>) => {
          out.received = input;
          out.save = await replayTool("update-thesis", "updateThesis", {
            seed: { thesis: [thesisRow({ ...entry.thesis })] },
            args: input,
            ctx: { runMode: "PRINCIPAL_CHAT" },
            quotes: { HPE: 25 },
          });
          return out.save.result;
        },
      }),
    },
    stopWhen: stepCountIs(2),
  });
  if (!out.save || !out.received) throw new Error("HPE: the SDK never reached the save");
  return { received: out.received, save: out.save };
}

describe("HPE 10-02: the chat's save that rewrote the snapshot and the score", () => {
  it("the snapshot and the scores never reach the save; the note lands as a review; the writer's snapshot and composite stay", async () => {
    const { received, save } = await sentVerbatim();
    for (const f of ["snapshot", "scoring"]) expect([f, f in entry.call, f in received]).toEqual([f, true, false]);
    expect(received).toEqual({ thesis_id: entry.call.thesis_id, rationale: entry.call.rationale });
    expect(save.crashed).toBe(false);
    expect(save.refused).toBe(false);
    const row = save.db.store.thesis[0];
    expect(row.snapshot).toEqual(entry.thesis.snapshot);
    expect((row.scoring as { composite: number }).composite).toBe(9);
    const written = (save.db.store.thesisUpdate ?? []).filter((u) => u.type !== "TRIGGER_FIRED");
    expect(written.map((u) => [u.type, u.rationale])).toEqual([["REVIEWED", entry.call.rationale]]);
  });

  it("the fixture holds only the fields the save reads, under the cap", () => {
    expect(statSync(FIXTURE).size).toBeLessThan(40 * 1024);
  });
});
