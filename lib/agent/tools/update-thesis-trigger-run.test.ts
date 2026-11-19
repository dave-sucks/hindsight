/**
 * update-thesis-trigger-run.test.ts — the trigger run's closing save
 * (Roadmap step 10): its note (write_note: the note and the review's three)
 * and its trigger edits (edit_triggers), one job each since 2026-11-18. Its
 * stock and the trigger that fired are code's (ToolContext.runStock), never
 * the model's.
 *
 * The four trigger runs that failed (ASML 10-07; NVDA, CEG, MU 10-08) each
 * sent the whole 22-field form in every call, change_status WATCHING among it.
 * The run fills every field it is given, so neither tool offers a status change.
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
import { writeNoteTool } from "./write-note";
import { editTriggers } from "./edit-triggers";

const NOTE_DOOR = ["answers_update_id", "note", "verdict", "verdict_line"];
const EDIT_DOOR = ["add", "edit", "remove"];
const runStock = { ticker: "NVDA", thesisId: "thesis_run", triggerId: "trig_fired" };
const ctx = (runMode: string) => ({ runId: "r", userId: "u", accountId: "a", analystId: "an", runMode, ...(runMode === "INTRADAY_TACTICAL" ? { runStock } : {}) }) as never;
const noteSchema = (runMode: string) => (writeNoteTool(ctx(runMode)) as unknown as { inputSchema: z.ZodObject<z.ZodRawShape> }).inputSchema;
const editSchema = (runMode: string) => (editTriggers(ctx(runMode)) as unknown as { inputSchema: z.ZodObject<z.ZodRawShape> }).inputSchema;
/** A restated close-out as the note it is now: the old call's rationale is the note. */
const asNote = (call: Record<string, unknown>): Record<string, unknown> => ({ ...call, note: call.rationale });
const CALLS = (["ASML", "NVDA", "CEG", "MU"] as const).map((t) => [t, asNote(fixture[t].call as Record<string, unknown>)] as const);

describe("the trigger run's save", () => {
  it("offers its note's four fields and its trigger edits' three: no change_status, and no thesis or trigger id", () => {
    expect(Object.keys(noteSchema("INTRADAY_TACTICAL").shape).sort()).toEqual(NOTE_DOOR);
    expect(Object.keys(editSchema("INTRADAY_TACTICAL").shape).sort()).toEqual(EDIT_DOOR);
    for (const s of [noteSchema("INTRADAY_TACTICAL"), editSchema("INTRADAY_TACTICAL")]) {
      expect((zodSchema(s as never).jsonSchema as { properties: Record<string, unknown> }).properties).not.toHaveProperty("change_status");
    }
  });

  it("is handed its thesis and the trigger that fired by code, and saves under them", async () => {
    const real = writeNoteTool(ctx("INTRADAY_TACTICAL")) as unknown as { execute: (a: unknown, o: unknown) => Promise<{ summary?: string; progressLabel?: string }> };
    // No such thesis in the stub database: the save reads the one it was handed and stops there.
    const { prisma } = jest.requireMock("@/lib/prisma") as { prisma: Record<string, unknown> };
    prisma.thesis = { findUnique: async () => null, findFirst: async () => null };
    const result = await real.execute({ note: "The note." }, { toolCallId: "c1", messages: [] });
    expect(result.summary).toBe("Thesis thesis_run not found.");
    expect(result.progressLabel).toBe("Writing a note");
  });

  it("leaves the morning run its status tools and the playbook", () => {
    expect(Object.keys(editSchema("MORNING_PLAN").shape)).toContain("setup_id");
    const all = createResearchTools({ runId: "r", userId: "u", accountId: "a", runMode: "MORNING_PLAN", runEnvironment: "PAPER" } as never) as Record<string, unknown>;
    for (const t of ["set_conviction", "set_catalyst_date", "stop_watching", "watch_again"]) expect(all[t]).toBeDefined();
  });

  it.each(CALLS)("%s's real call: its change_status WATCHING and the other fields this save lacks are stripped", (_t, call) => {
    const parsed = noteSchema("INTRADAY_TACTICAL").parse(call) as Record<string, unknown>;
    expect(Object.keys(parsed).every((k) => NOTE_DOOR.includes(k))).toBe(true);
    for (const gone of ["change_status", "direction", "horizon", "price_at_time", "snapshot", "core_belief", "scoring", "entry_on_close", "catalyst_date", "thesis_id", "trigger_id"]) {
      expect(parsed).not.toHaveProperty(gone);
    }
    expect(parsed.note).toBe(call.rationale);
  });

  it("through the SDK's loop, the note is handed only its own fields", async () => {
    const real = writeNoteTool(ctx("INTRADAY_TACTICAL")) as unknown as { description: string; inputSchema: never };
    const { change_status: _cs, ...call } = asNote(fixture.NVDA.call as Record<string, unknown>);
    void _cs;
    const received: Array<Record<string, unknown>> = [];
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
    let turn = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () =>
        turn++ === 0
          ? { content: [{ type: "tool-call", toolCallId: "c1", toolName: "write_note", input: JSON.stringify(call) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] }
          : { content: [{ type: "text", text: "done" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] },
    } as never);
    await generateText({
      model,
      prompt: "close out",
      tools: { write_note: tool({ description: real.description, inputSchema: real.inputSchema, execute: async (input: Record<string, unknown>) => (received.push(input), { ok: true }) }) },
      stopWhen: stepCountIs(2),
    });
    expect(received).toHaveLength(1);
    expect(Object.keys(received[0]).every((k) => NOTE_DOOR.includes(k))).toBe(true);
    expect(received[0]).not.toHaveProperty("direction");
  });

  it.each([["docu-trigger", docuTrigger], ["nvda-declined-sale", nvdaDeclinedSale]])("the %s case offers the trigger run's note and trigger edits", (_name, c) => {
    const tools = createResearchTools({ runId: "hero-case", userId: "hero", accountId: "hero", runMode: c.runMode, runEnvironment: "PAPER", runStock, ...(c.toolCtx as object) } as never) as unknown as Record<string, { inputSchema: z.ZodObject<z.ZodRawShape> }>;
    expect(Object.keys(tools.write_note.inputSchema.shape).sort()).toEqual(NOTE_DOOR);
    expect(Object.keys(tools.edit_triggers.inputSchema.shape).sort()).toEqual(EDIT_DOOR);
  });
});
