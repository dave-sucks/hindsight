/**
 * manage-position.deleted-actions.replay.test.ts — update_targets and
 * move_stop_to_breakeven are gone from manage_position (step 12, part 3): a
 * level moves through update_thesis only.
 *
 * MU, 2026-10-08 12:02 UTC (morning run cmuzhkyt9001806l4kx7u5kap): the
 * morning run raised MU's stop with manage_position update_targets, and its
 * audit row said "from $969", the position's mirror, while the floor in
 * force was $1,048. That real call, sent verbatim through the SDK's loop to
 * the morning run's manage_position: the SDK refuses it as an unknown action
 * before the tool runs, hands the model the refusal, and the run goes on.
 * Seven update_targets calls ran between 10-05 and 10-08.
 */
import { generateText, stepCountIs, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { z } from "zod";

/** The morning run's manage_position call on MU, verbatim from the run's saved thread. */
const MU_CALL = {
  symbol: "MU",
  action: "update_targets",
  reason:
    "Holding Micron at $1088.00. The stock repaired the floor breach with a 4.1% rebound day and is back within 1.1% of the $1100 target, but this is an 82-day hold and a mature post-earnings drift, so I want the floor tighter under the reclaimed breakout area rather than adding size this late in the cycle.",
  new_target_price: 1100,
  new_stop_loss: 1060,
};

/** The morning run's real manage_position schema, read without a database. */
async function managePositionSchema(runMode: string): Promise<z.ZodTypeAny> {
  let schema: z.ZodTypeAny | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    const { managePosition } = await import("./manage-position");
    schema = (managePosition({ runId: "r", userId: "u", accountId: "a", runMode } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
  });
  return schema!;
}

describe("MU 10-08: manage_position update_targets, sent verbatim", () => {
  it.each(["MORNING_PLAN", "INTRADAY_TACTICAL", "PRINCIPAL_CHAT"])("%s: refused at the SDK as an unknown action; the tool never runs; the model reads the refusal and the run goes on", async (runMode) => {
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
    const prompts: unknown[] = [];
    let turn = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async (opts: { prompt: unknown }) => {
        prompts.push(opts.prompt);
        return ++turn === 1
          ? { content: [{ type: "tool-call", toolCallId: "c1", toolName: "manage_position", input: JSON.stringify(MU_CALL) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] }
          : { content: [{ type: "text", text: "Moving the floor through update_thesis instead." }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
      },
    } as never);
    const execute = jest.fn();
    const out = await generateText({
      model,
      prompt: "morning review",
      tools: { manage_position: tool({ inputSchema: (await managePositionSchema(runMode)) as never, execute }) },
      stopWhen: stepCountIs(3),
    });
    expect(execute).not.toHaveBeenCalled();
    const errors = out.steps[0].content.filter((p) => p.type === "tool-error") as Array<{ toolName: string; error: unknown }>;
    expect(errors).toHaveLength(1);
    expect(errors[0].toolName).toBe("manage_position");
    expect(String(errors[0].error)).toMatch(/update_targets|action/);
    // The run went on: a second model turn, carrying the refusal.
    expect(out.steps).toHaveLength(2);
    expect(JSON.stringify(prompts[1])).toContain("update_targets");
  });

  it("move_stop_to_breakeven is refused the same way; partial_close and add_to_position stay", async () => {
    const schema = await managePositionSchema("MORNING_PLAN");
    expect(schema.safeParse({ symbol: "SMMT", action: "move_stop_to_breakeven", reason: "Moving the stop up to what we paid now that it is working." }).success).toBe(false);
    expect(schema.safeParse({ symbol: "MU", action: "partial_close", reason: "Trimming a third into the target zone.", close_pct: 33 }).success).toBe(true);
    expect(schema.safeParse({ symbol: "MU", action: "add_to_position", reason: "Adding on the breakout the plan named." }).success).toBe(true);
  });
});
