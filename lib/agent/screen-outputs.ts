/**
 * screen-outputs.ts — a saved run replays what the screen saw, not what the
 * model read.
 *
 * A tool with `forModel` (define-tool.ts) hands the model a slimmer result
 * than the screen gets: get_theses leaves out its cards. The SDK writes the
 * model's version into `response.messages`, and those messages are what a
 * server-side run saves as its `thread` for /runs/[id] to replay. Saved as
 * is, a finished run would lose the cards the live chat showed.
 *
 * This puts the full result back, by tool-call id, from the steps' own
 * tool results — the untouched outputs of execute(). Messages without a
 * match are left exactly as they were.
 */
import type { ModelMessage } from "ai";

interface StepWithResults {
  toolResults?: ReadonlyArray<{ toolCallId: string; output?: unknown }>;
}

export function withScreenOutputs<M extends ModelMessage>(messages: M[], steps: ReadonlyArray<StepWithResults>): M[] {
  const full = new Map<string, unknown>();
  for (const s of steps) for (const r of s.toolResults ?? []) if (r.output !== undefined) full.set(r.toolCallId, r.output);
  if (full.size === 0) return messages;
  return messages.map((m) => {
    if (m.role !== "tool" || !Array.isArray(m.content)) return m;
    let changed = false;
    const content = m.content.map((p) => {
      if (p.type !== "tool-result" || !full.has(p.toolCallId)) return p;
      changed = true;
      return { ...p, output: { type: "json" as const, value: full.get(p.toolCallId) } };
    });
    return changed ? ({ ...m, content } as M) : m;
  });
}
