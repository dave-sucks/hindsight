/**
 * update-thesis-morning-claim.replay.test.ts — a morning save that sends the
 * claim is stripped by the door's schema and lands (step 12, part 1).
 *
 * No morning thread of the 30 days to 2026-10-09 (0 of 45) carried an
 * update_thesis with core_belief: the morning run had already stopped writing
 * claims. The newest that did is MNKD, 2026-07-27 12:00 ET (run
 * cms36e9lj000904l5b08231bp): a held CATALYST stock re-planned after its
 * event, with a new belief, new assumptions and new what-proves-it-wrong. That
 * real call, sent verbatim through the SDK's loop to today's morning save, on
 * MNKD's row as that run's own read carried it
 * (lib/agent/__fixtures__/morning-claim-2026-07-27.json). The call also
 * carries fields the save no longer has at all (structural_unchanged_reason,
 * max_hold_days, next_review_at, a whole trigger list); the SDK drops those
 * the same way.
 */
import { generateText, stepCountIs, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { statSync } from "fs";
import fixture from "@/lib/agent/__fixtures__/morning-claim-2026-07-27.json";
import { replayTool, thesisRow, positionRow, type Replay, type Row } from "@/lib/replay";
import type { z } from "zod";

const FIXTURE = "lib/agent/__fixtures__/morning-claim-2026-07-27.json";
const THE_CLAIM = ["core_belief", "key_assumptions", "invalidation_conditions"];
const GONE_BEFORE = ["price_at_time", "structural_unchanged_reason", "max_hold_days", "next_review_at", "triggers"];

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
            seed: { thesis: [thesisRow({ ...entry.thesis })], position: [positionRow({ symbol: "MNKD", avgCost: entry.position.avgCost })] },
            args: input,
            ctx: { runMode: "MORNING_PLAN" },
            quotes: { MNKD: entry.price },
          });
          return out.save.result;
        },
      }),
    },
    stopWhen: stepCountIs(2),
  });
  if (!out.save || !out.received) throw new Error("MNKD: the SDK never reached the save");
  return { received: out.received, save: out.save };
}

describe("MNKD 07-27: the newest morning call that sent the claim", () => {
  it("the claim never reaches the save; the note and the horizon land; the stored claim is the writer's still", async () => {
    const { received, save } = await sentVerbatim();
    for (const f of [...THE_CLAIM, ...GONE_BEFORE]) expect([f, f in entry.call, f in received]).toEqual([f, true, false]);
    expect(received).toMatchObject({ thesis_id: entry.call.thesis_id, rationale: entry.call.rationale, horizon: "TARGET", stop_loss: 4, target_price: 5.5 });
    expect(save.crashed).toBe(false);
    expect(save.refused).toBe(false);
    const row = save.db.store.thesis[0];
    expect(row.coreBelief).toBe(entry.thesis.coreBelief);
    expect(row.keyAssumptions).toEqual(entry.thesis.keyAssumptions);
    expect(row.invalidationConds).toEqual(entry.thesis.invalidationConds);
    expect(row.horizon).toBe("TARGET");
    const written = (save.db.store.thesisUpdate ?? []).filter((u) => u.type !== "TRIGGER_FIRED");
    expect(written.map((u) => u.rationale)).toEqual([entry.call.rationale]);
    expect((written[0].fieldChanges as Record<string, unknown>).horizon).toEqual({ from: "CATALYST", to: "TARGET" });
    for (const k of ["coreBelief", "keyAssumptions", "invalidationConds"]) expect(written[0].fieldChanges).not.toHaveProperty(k);
  });

  it("the fixture holds only the fields the save reads, under the cap", () => {
    expect(statSync(FIXTURE).size).toBeLessThan(40 * 1024);
  });
});
