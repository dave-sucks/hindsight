/**
 * What a playbook attaches by, read off a row or a fire: the lead flag's
 * trigger, and the measures a trigger's condition watches.
 */
import type { StockRow } from "@/lib/agent/stock-brief";
import { measuresOf } from "@/lib/agent/trigger-measures";

export { measuresOf };

/** The lead flag's trigger, when the row carries it as stored. */
export function leadTrigger(row: StockRow): { action?: string; predicate?: unknown } | null {
  const id = (row.needsAction as { triggerId?: unknown } | null | undefined)?.triggerId;
  if (typeof id !== "string") return null;
  const all = [...(row.triggers ?? []), ...(row.inheritedTriggers ?? [])] as Array<{ id?: string; action?: string; predicate?: unknown }>;
  return all.find((t) => t?.id === id && t.predicate != null) ?? null;
}

/** Whether the row's lead flag is a fire or match of a trigger watching one of these measures. */
export function leadWatches(row: StockRow, measures: readonly string[]): boolean {
  const kind = (row.needsAction as { kind?: string } | null | undefined)?.kind;
  if (kind !== "TRIGGER_FIRED" && kind !== "TRIGGER_MATCHING_NOW") return false;
  const t = leadTrigger(row);
  return !!t && measuresOf(t.predicate).some((m) => measures.includes(m));
}
