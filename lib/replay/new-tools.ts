/**
 * An update_thesis call saved before 2026-11-18, as the one-job calls a run
 * makes now: the status (watch_again first, stop_watching last, carrying the
 * note), the trigger edits, the conviction, the catalyst date, then the note.
 * `replayCalls` runs them in order on one database; `sendAsTheRunWould` sends
 * them through the SDK's loop too, each parsed by its tool's real schema, so a
 * production call replays through the tools that replaced the one it was sent to.
 */
import { generateText, stepCountIs, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { z } from "zod";
import { replayTool, type Replay, type ReplayOptions } from "@/lib/replay/replay";
import type { StoreSeed } from "@/lib/replay/prisma-double";

export interface ToolCall {
  module: string;
  exportName: string;
  args: Record<string, unknown>;
}

/** The tools each run mode has for a thesis (lib/agent/modes.ts); the trigger run's thesis and trigger are code's. */
const HAS: Record<string, readonly string[]> = {
  INTRADAY_TACTICAL: ["write_note", "edit_triggers"],
  MORNING_PLAN: ["write_note", "edit_triggers", "set_conviction", "set_catalyst_date", "stop_watching", "watch_again"],
  PRINCIPAL_CHAT: ["edit_triggers", "set_conviction", "set_catalyst_date", "stop_watching", "watch_again"],
};

export function asTheNewTools(call: Record<string, unknown>, runMode = "MORNING_PLAN"): ToolCall[] {
  const has = (t: string) => (HAS[runMode] ?? HAS.MORNING_PLAN).includes(t);
  const own = runMode === "INTRADAY_TACTICAL" ? {} : { thesis_id: call.thesis_id };
  const out: ToolCall[] = [];
  const status = call.change_status as string | undefined;
  if (status === "WATCHING" && has("watch_again")) out.push({ module: "watch-again", exportName: "watchAgain", args: { thesis_id: call.thesis_id } });
  const edits = { add: call.add_triggers, edit: call.edit_triggers, remove: call.remove_trigger_ids, ...(runMode === "INTRADAY_TACTICAL" ? {} : { setup_id: call.setup_id }) };
  if (Object.values(edits).some((v) => v !== undefined) && has("edit_triggers")) out.push({ module: "edit-triggers", exportName: "editTriggers", args: { ...own, ...edits } });
  if (call.conviction !== undefined && has("set_conviction")) out.push({ module: "set-conviction", exportName: "setConviction", args: { ...own, conviction: call.conviction, conviction_rationale: call.conviction_rationale } });
  if (call.catalyst_date !== undefined && has("set_catalyst_date")) out.push({ module: "set-catalyst-date", exportName: "setCatalystDate", args: { ...own, catalyst_date: call.catalyst_date } });
  if ((status === "ARCHIVED" || status === "INVALIDATED") && has("stop_watching")) {
    out.push({ module: "stop-watching", exportName: "stopWatching", args: { thesis_id: call.thesis_id, reason: call.rationale } });
  } else if (call.rationale !== undefined && has("write_note")) {
    const review = { verdict: call.verdict, verdict_line: call.verdict_line, answers_update_id: call.answers_update_id };
    out.push({ module: "write-note", exportName: "writeNoteTool", args: { ...own, note: call.rationale, ...review, ...(runMode === "INTRADAY_TACTICAL" ? {} : { trigger_id: call.trigger_id }) } });
  }
  return out;
}

/** Each call through its real tool, in order, on one database: each call starts from the rows the last one left. */
export async function replayCalls(calls: ToolCall[], opts: ReplayOptions = {}): Promise<Replay[]> {
  const out: Replay[] = [];
  let seed: StoreSeed | undefined = opts.seed;
  for (const c of calls) {
    const r = await replayTool(c.module, c.exportName, { ...opts, seed, args: c.args });
    out.push(r);
    seed = r.db.store as StoreSeed;
  }
  return out;
}

/** A tool's real schema for a run, read without a database. */
async function schemaOf(c: ToolCall, ctx: Record<string, unknown>): Promise<z.ZodTypeAny> {
  let schema: z.ZodTypeAny | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    const mod = (await import(`@/lib/agent/tools/${c.module}`)) as Record<string, (x: unknown) => { inputSchema: z.ZodTypeAny }>;
    schema = mod[c.exportName]({ runId: "r", userId: "u", accountId: "a", ...ctx }).inputSchema;
  });
  return schema!;
}

/**
 * The old call as the run makes it now, through the SDK's loop: one call a
 * turn, each parsed by its tool's schema and handed to the real tool on the
 * rows the last left. `received` is what the tools were handed, together;
 * `save` is the last call's replay with every call's refusals, trigger edits
 * and changed fields.
 */
export async function sendAsTheRunWould(
  call: Record<string, unknown>,
  opts: ReplayOptions & { ctx: { runMode: string } & Record<string, unknown> },
): Promise<{ received: Record<string, unknown>; calls: string[]; save: Replay }> {
  const calls = asTheNewTools(call, opts.ctx.runMode);
  const name = (m: string) => m.replace(/-/g, "_");
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
  let turn = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      const c = calls[turn++];
      return c
        ? { content: [{ type: "tool-call", toolCallId: `c${turn}`, toolName: name(c.module), input: JSON.stringify(c.args) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] }
        : { content: [{ type: "text", text: "done" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
    },
  } as never);
  const received: Record<string, unknown> = {};
  const saves: Replay[] = [];
  let seed = opts.seed;
  const tools: Record<string, unknown> = {};
  for (const c of calls) {
    tools[name(c.module)] = tool({
      inputSchema: (await schemaOf(c, opts.ctx)) as never,
      execute: async (input: Record<string, unknown>) => {
        Object.assign(received, input);
        const r = await replayTool(c.module, c.exportName, { ...opts, seed, args: input });
        saves.push(r);
        seed = r.db.store as StoreSeed;
        return r.result;
      },
    });
  }
  const out = await generateText({ model, prompt: "review", tools: tools as never, stopWhen: stepCountIs(calls.length + 1) });
  const errors = out.steps.flatMap((x) => x.content.filter((p) => p.type === "tool-error"));
  if (errors.length || saves.length !== calls.length) throw new Error(`the SDK reached ${saves.length} of ${calls.length} tools: ${JSON.stringify(errors).slice(0, 600)}`);
  const last = saves[saves.length - 1];
  const all = <T,>(k: string) => saves.flatMap((x) => ((x.result.data as Record<string, unknown> | undefined)?.[k] as T[] | undefined) ?? []);
  const refused = all<{ field: string }>("refused_fields");
  const save = {
    ...last,
    refused: saves.some((x) => x.refused),
    crashed: saves.some((x) => x.crashed),
    result: { ...last.result, data: { ...last.result.data, trigger_ops: all("trigger_ops"), refused_fields: refused.length ? refused : undefined, changed_fields: all("changed_fields") } },
  } as Replay;
  return { received, calls: calls.map((c) => name(c.module)), save };
}
