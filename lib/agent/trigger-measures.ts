/**
 * The measures a trigger's condition watches ("price", "report", "repeat"
 * …), groups included. Pure; read by the playbook attachment and the
 * plan flags.
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
