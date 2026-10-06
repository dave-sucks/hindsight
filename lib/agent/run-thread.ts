/**
 * run-thread.ts — the one way a run saves its conversation for /runs/[id].
 *
 * A saved run replays what the screen saw, not what the model read. A tool
 * with `forModel` (define-tool.ts) hands the model a slimmer result than the
 * screen gets: get_theses leaves out its cards. The SDK writes the model's
 * version into its messages, so saved as is, a finished run would lose the
 * cards the live chat showed. Every tool result is put back, by tool-call
 * id, from the steps' own tool results — the untouched outputs of execute().
 *
 * Every run type saves through here: the morning run, discovery, the trigger
 * run, the writer, the chat route and the podcast segment run.
 */
import type { ModelMessage } from "ai";
import { prisma } from "@/lib/prisma";

/** One step of a run: its tool results as execute() returned them, and its own messages. */
export interface RunStep {
  toolResults?: ReadonlyArray<{ toolCallId: string; output?: unknown }>;
  response?: { messages?: unknown[] };
}

function withScreenOutputs(messages: unknown[], steps: ReadonlyArray<RunStep>): unknown[] {
  const full = new Map<string, unknown>();
  for (const s of steps) for (const r of s.toolResults ?? []) if (r.output !== undefined) full.set(r.toolCallId, r.output);
  if (full.size === 0) return messages;
  return messages.map((raw) => {
    const m = raw as ModelMessage;
    if (m?.role !== "tool" || !Array.isArray(m.content)) return raw;
    let changed = false;
    const content = m.content.map((p) => {
      if (p.type !== "tool-result" || !full.has(p.toolCallId)) return p;
      changed = true;
      return { ...p, output: { type: "json" as const, value: full.get(p.toolCallId) } };
    });
    return changed ? { ...m, content } : raw;
  });
}

/**
 * Save a run's thread, replacing any saved before: `opening` as given (the
 * prompt the run started from, a note), then the model's messages with each
 * tool result as the screen got it. When the SDK handed back no messages (a
 * text-only tail), they are rebuilt from the steps. A failed save is logged,
 * never thrown: the run's work is already done.
 */
export async function saveRunThread(
  runId: string,
  thread: { opening: unknown[]; messages: unknown[] | null | undefined; steps: ReadonlyArray<RunStep> },
  label: string,
): Promise<void> {
  try {
    let messages = thread.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      messages = thread.steps.flatMap((s) => (Array.isArray(s.response?.messages) ? s.response.messages : []));
      if (messages.length > 0) console.warn(`[${label}] no messages from the SDK for run ${runId}; rebuilt ${messages.length} from ${thread.steps.length} steps`);
    }
    const all = [...thread.opening, ...withScreenOutputs(messages, thread.steps)];
    if (all.length === 0) {
      console.warn(`[${label}] nothing to save for run ${runId}`);
      return;
    }
    const content = JSON.stringify(all);
    await prisma.$transaction([
      prisma.runMessage.deleteMany({ where: { runId } }),
      prisma.runMessage.create({ data: { runId, role: "thread", content } }),
    ]);
    console.log(`[${label}] saved ${all.length} messages (${(content.length / 1024).toFixed(0)}KB) for run ${runId}`);
  } catch (err) {
    console.error(`[${label}] failed to save the thread for run ${runId}:`, err instanceof Error ? err.message : err);
  }
}
