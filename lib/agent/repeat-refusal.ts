/**
 * repeat-refusal.ts — the run loop's net under a refused call sent again.
 *
 * ASML (2026-10-07) and NVDA (2026-10-08) sent the same refused
 * update_thesis eleven times each, until their runs ran out of steps. The
 * cause is fixed in the tool (a save is a patch); this is the net under
 * every tool. A call identical to one refused earlier in the run gets, from
 * its second refusal on, one line telling the model not to send it again.
 * A third identical refusal ends the loop, and the run closes FAILED with
 * the reason named. The morning run and the trigger run share it.
 */
import type { ModelMessage } from "ai";
import { detectGateRejection, detailFromData } from "@/lib/agent/gate-rejections";

type Step = { toolResults?: ReadonlyArray<{ toolName: string; input?: unknown; output?: unknown }> };

const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`
      : JSON.stringify(v ?? null);

/** The refused call sent most often so far, with its count and the refusal's words. */
export function repeatedRefusal(steps: ReadonlyArray<Step>): { count: number; tool: string; reason: string } | null {
  const seen = new Map<string, { count: number; tool: string; reason: string }>();
  let worst: { count: number; tool: string; reason: string } | null = null;
  for (const step of steps) {
    for (const r of step.toolResults ?? []) {
      const out = r.output as { summary?: string; data?: unknown } | undefined;
      if (!detectGateRejection(out?.data)) continue;
      const key = `${r.toolName}:${stable(r.input)}`;
      const entry = seen.get(key) ?? { count: 0, tool: r.toolName, reason: (detailFromData(out?.data) ?? out?.summary ?? "refused").slice(0, 300) };
      entry.count += 1;
      seen.set(key, entry);
      if (!worst || entry.count > worst.count) worst = entry;
    }
  }
  return worst;
}

/** The two hooks a run's generateText takes: the nudge before each step, and the stop. */
export const repeatRefusalGuard = {
  prepareStep: ({ steps, messages }: { steps: ReadonlyArray<Step>; messages: ModelMessage[] }) => {
    const r = repeatedRefusal(steps);
    if (!r || r.count < 2) return undefined;
    const nudge = `That ${r.tool} call was refused twice with the same reason. Do not send it again; write your note without the refused field.`;
    return { messages: [...messages, { role: "user" as const, content: nudge }] };
  },
  stopWhen: ({ steps }: { steps: ReadonlyArray<Step> }) => (repeatedRefusal(steps)?.count ?? 0) >= 3,
};

/** Why the guard ended the loop, or null when it did not. */
export function repeatRefusalStop(steps: ReadonlyArray<Step>): string | null {
  const r = repeatedRefusal(steps);
  return r && r.count >= 3 ? `${r.tool} was refused three times with the same call: ${r.reason}` : null;
}
