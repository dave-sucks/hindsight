/**
 * The measures a trigger's condition watches ("price", "report", "repeat"
 * …), groups included. Pure. Copied from the step-6 attachment
 * (9e323ec9:lib/agent/trigger-measures.ts).
 */
import { isGroup, shapeOf, type When } from "@/lib/agent/triggers/condition";

export function measuresOf(predicate: unknown): string[] {
  const out: string[] = [];
  const walk = (w: When | null) => {
    if (!w) return;
    if (isGroup(w)) for (const c of w.conditions) walk(c);
    else out.push(w.watch);
  };
  walk(shapeOf(predicate));
  return out;
}
