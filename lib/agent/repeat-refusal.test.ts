/**
 * repeat-refusal.test.ts — the run loop's net under a refused call sent
 * again, run through the SDK's own loop with a model that keeps sending it.
 *
 * The shape is ASML's and NVDA's (2026-10-07/08): the same update_thesis,
 * refused with the same reason, eleven times, until the run ran out.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { generateText, stepCountIs, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { repeatRefusalGuard, repeatRefusalStop } from "./repeat-refusal";

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const REFUSED = { summary: "Refused.", data: { ok: false, error: "watching_transition_from_non_promoted", message: "This thesis is HOLDING." } };
const LANDED = { summary: "Reviewed.", data: { ok: true } };

/** A model that sends `inputs[i]` on its i-th turn (the last one again after that). */
async function run(inputs: Array<Record<string, unknown>>, answer: unknown) {
  const prompts: string[] = [];
  let turn = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async (opts: { prompt: unknown }) => {
      prompts.push(JSON.stringify(opts.prompt));
      const input = inputs[Math.min(turn, inputs.length - 1)];
      turn++;
      return { content: [{ type: "tool-call", toolCallId: `c${turn}`, toolName: "update_thesis", input: JSON.stringify(input) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] };
    },
  } as never);
  const out = await generateText({
    model,
    prompt: "close out",
    tools: { update_thesis: tool({ inputSchema: z.object({}).passthrough(), execute: async () => answer }) },
    stopWhen: [stepCountIs(10), repeatRefusalGuard.stopWhen],
    prepareStep: repeatRefusalGuard.prepareStep,
  });
  return { out, prompts };
}

const NUDGE = "That update_thesis call was refused twice with the same reason. Do not send it again; write your note without the refused field.";
const call = { thesis_id: "t_asml", direction: "LONG", change_status: "WATCHING", rationale: "The floor fired." };

it("the same refused call: told not to resend from the second refusal, stopped on the third", async () => {
  const { out, prompts } = await run([call], REFUSED);
  expect(out.steps).toHaveLength(3);
  expect(prompts[1]).not.toContain(NUDGE);
  expect(prompts[2]).toContain(NUDGE);
  expect(repeatRefusalStop(out.steps)).toBe("update_thesis was refused three times with the same call: This thesis is HOLDING.");
});

it("the same call with its keys in another order is the same call", async () => {
  const reordered = Object.fromEntries(Object.entries(call).reverse());
  const { out } = await run([call, reordered, call], REFUSED);
  expect(out.steps).toHaveLength(3);
});

it("a refused call changed each time is not stopped", async () => {
  const { out } = await run([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ ...call, rationale: `try ${n}` })), REFUSED);
  expect(out.steps).toHaveLength(10);
  expect(repeatRefusalStop(out.steps)).toBeNull();
});

it("a call that lands, sent again, is not a refusal", async () => {
  const { out, prompts } = await run([call], LANDED);
  expect(out.steps).toHaveLength(10);
  expect(prompts.some((p) => p.includes(NUDGE))).toBe(false);
});
