/**
 * update-thesis-trigger-run.test.ts — the trigger run's closing save
 * (Roadmap step 10): update_thesis with the trigger run's twelve fields.
 *
 * The four trigger runs that failed (ASML 10-07; NVDA, CEG, MU 10-08) each
 * sent the whole 22-field form in every call, change_status WATCHING among it.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { generateText, stepCountIs, tool, zodSchema } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { z } from "zod";
import fixture from "@/lib/agent/__fixtures__/close-out-restated-2026-10-08.json";
import docuTrigger from "../../../scripts/hero-cases/docu-trigger.json";
import nvdaDeclinedSale from "../../../scripts/hero-cases/nvda-declined-sale.json";
import { createResearchTools } from "@/lib/agent/tools";
import { updateThesis } from "./update-thesis";

const DOOR = [
  "add_triggers", "change_status", "edit_triggers", "entry_price", "rationale", "remove_trigger_ids",
  "stop_basis", "stop_loss", "target_basis", "target_price", "thesis_id", "trigger_id",
];
const ctx = (runMode: string) => ({ runId: "r", userId: "u", accountId: "a", analystId: "an", runMode }) as never;
const schemaOf = (runMode: string) => (updateThesis(ctx(runMode)) as unknown as { inputSchema: z.ZodObject<z.ZodRawShape> }).inputSchema;
const CALLS = (["ASML", "NVDA", "CEG", "MU"] as const).map((t) => [t, fixture[t].call as Record<string, unknown>] as const);

describe("the trigger run's save", () => {
  it("offers exactly twelve fields, and change_status only INVALIDATED or ARCHIVED", () => {
    const schema = schemaOf("INTRADAY_TACTICAL");
    expect(Object.keys(schema.shape).sort()).toEqual(DOOR);
    const json = zodSchema(schema as never).jsonSchema as { properties: Record<string, { enum?: string[] }> };
    expect(json.properties.change_status.enum).toEqual(["INVALIDATED", "ARCHIVED"]);
  });

  it("leaves the other doors' saves as they were", () => {
    const morning = Object.keys(schemaOf("MORNING_PLAN").shape);
    expect(morning).toEqual(expect.arrayContaining(["direction", "horizon", "conviction", "setup_id", "catalyst_date"]));
    const json = zodSchema(schemaOf("MORNING_PLAN") as never).jsonSchema as { properties: Record<string, { enum?: string[] }> };
    expect(json.properties.change_status.enum).toEqual(["INVALIDATED", "ARCHIVED", "WATCHING"]);
  });

  it.each(CALLS)("%s's real call: WATCHING is not a value, and the fields this save lacks are stripped", (_t, call) => {
    const schema = schemaOf("INTRADAY_TACTICAL");
    const verbatim = schema.safeParse(call);
    expect(verbatim.success).toBe(false);
    expect(verbatim.error?.issues.map((i) => i.path.join("."))).toEqual(["change_status"]);
    const { change_status: _cs, ...rest } = call;
    void _cs;
    const parsed = schema.parse(rest) as Record<string, unknown>;
    expect(Object.keys(parsed).every((k) => DOOR.includes(k))).toBe(true);
    for (const gone of ["direction", "horizon", "price_at_time", "snapshot", "core_belief", "scoring", "entry_on_close", "catalyst_date"]) {
      expect(parsed).not.toHaveProperty(gone);
    }
    expect(parsed.rationale).toBe(call.rationale);
  });

  it("through the SDK's loop, the save is handed only its own fields", async () => {
    const real = updateThesis(ctx("INTRADAY_TACTICAL")) as unknown as { description: string; inputSchema: never };
    const { change_status: _cs, ...call } = fixture.NVDA.call as Record<string, unknown>;
    void _cs;
    const received: Array<Record<string, unknown>> = [];
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
    let turn = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () =>
        turn++ === 0
          ? { content: [{ type: "tool-call", toolCallId: "c1", toolName: "update_thesis", input: JSON.stringify(call) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] }
          : { content: [{ type: "text", text: "done" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] },
    } as never);
    await generateText({
      model,
      prompt: "close out",
      tools: { update_thesis: tool({ description: real.description, inputSchema: real.inputSchema, execute: async (input: Record<string, unknown>) => (received.push(input), { ok: true }) }) },
      stopWhen: stepCountIs(2),
    });
    expect(received).toHaveLength(1);
    expect(Object.keys(received[0]).every((k) => DOOR.includes(k))).toBe(true);
    expect(received[0]).not.toHaveProperty("direction");
  });

  it.each([["docu-trigger", docuTrigger], ["nvda-declined-sale", nvdaDeclinedSale]])("the %s case offers the trigger run's save", (_name, c) => {
    const tools = createResearchTools({ runId: "hero-case", userId: "hero", accountId: "hero", runMode: c.runMode, runEnvironment: "PAPER", ...(c.toolCtx as object) } as never) as unknown as Record<string, { inputSchema: z.ZodObject<z.ZodRawShape> }>;
    expect(Object.keys(tools.update_thesis.inputSchema.shape).sort()).toEqual(DOOR);
  });
});
