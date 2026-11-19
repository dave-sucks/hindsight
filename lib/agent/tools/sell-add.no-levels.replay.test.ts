/**
 * sell-add.no-levels.replay.test.ts — a level never moves through a trade
 * tool: it is a trigger (edit_triggers).
 *
 * MU, 2026-10-08 12:02 UTC (morning run cmuzhkyt9001806l4kx7u5kap): the
 * morning run raised MU's stop with manage_position update_targets, and its
 * audit row said "from $969", the position's mirror, while the floor in
 * force was $1,048. That action went in step 12, part 3, and manage_position
 * itself on 2026-11-18: the same call sent verbatim now names no tool the run
 * has, so the SDK refuses it before anything runs, hands the model the
 * refusal, and the run goes on. sell and add carry no level field.
 */
import { generateText, stepCountIs, tool, zodSchema } from "ai";
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

/** A run's real sell and add schemas, read without a database. */
async function schemasFor(runMode: string): Promise<{ sell: z.ZodTypeAny; add: z.ZodTypeAny }> {
  let out: { sell: z.ZodTypeAny; add: z.ZodTypeAny } | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    const { sell } = await import("./sell");
    const { add } = await import("./add");
    const ctx = { runId: "r", userId: "u", accountId: "a", runMode } as never;
    out = {
      sell: (sell(ctx) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema,
      add: (add(ctx) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema,
    };
  });
  return out!;
}

describe("MU 10-08: the stop move sent to the trade tools, verbatim", () => {
  it.each(["MORNING_PLAN", "INTRADAY_TACTICAL", "PRINCIPAL_CHAT"])("%s: manage_position is no tool the run has; nothing runs; the model reads the refusal and the run goes on", async (runMode) => {
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
    const prompts: unknown[] = [];
    let turn = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async (opts: { prompt: unknown }) => {
        prompts.push(opts.prompt);
        return ++turn === 1
          ? { content: [{ type: "tool-call", toolCallId: "c1", toolName: "manage_position", input: JSON.stringify(MU_CALL) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] }
          : { content: [{ type: "text", text: "Moving the floor with edit_triggers instead." }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
      },
    } as never);
    const schemas = await schemasFor(runMode);
    const execute = jest.fn();
    const out = await generateText({
      model,
      prompt: "morning review",
      tools: { sell: tool({ inputSchema: schemas.sell as never, execute }), add: tool({ inputSchema: schemas.add as never, execute }) },
      stopWhen: stepCountIs(3),
    });
    expect(execute).not.toHaveBeenCalled();
    const errors = out.steps[0].content.filter((p) => p.type === "tool-error") as Array<{ toolName: string; error: unknown }>;
    expect(errors).toHaveLength(1);
    expect(errors[0].toolName).toBe("manage_position");
    // The run went on: a second model turn, carrying the refusal.
    expect(out.steps).toHaveLength(2);
    expect(JSON.stringify(prompts[1])).toContain("manage_position");
  });

  it.each(["MORNING_PLAN", "INTRADAY_TACTICAL", "PRINCIPAL_CHAT"])("%s: sell and add carry no level and no action", async (runMode) => {
    const schemas = await schemasFor(runMode);
    for (const s of [schemas.sell, schemas.add]) {
      const props = Object.keys((zodSchema(s as never).jsonSchema as { properties?: Record<string, unknown> }).properties ?? {});
      for (const f of ["action", "new_stop_loss", "new_target_price", "close_reason", "reason"]) expect(props).not.toContain(f);
    }
  });
});
