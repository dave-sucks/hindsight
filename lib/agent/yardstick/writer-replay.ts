/**
 * A Writer case replayed on T1's flow (scripts/hero-case.ts): the save writes
 * the playbook's watch triggers from the chart the case was shown, the
 * Writer tailors them with edit_triggers, and the run is graded in the cases'
 * shape, one submit_thesis carrying the triggers it leaves (mint) or its
 * trigger edits (refresh), as before T1. Prices and invented numbers are
 * graded on what the Writer wrote itself. Pure; the production pieces it
 * runs are writerPlaybookWrites, priceAddsWith and applyTriggerOps.
 */
import { writerPlaybookWrites } from "@/lib/agent/run-thesis-writer";
import { priceAddsWith, priceEditsWith, type Add, type Edit } from "@/lib/agent/tools/edit-triggers";
import { applyTriggerOps, type TriggerOp } from "@/lib/agent/triggers/ops";
import { editNumber, triggerInputSchema } from "@/lib/agent/triggers/schema";
import { levelSlotOf, typedPriceOf } from "@/lib/agent/triggers/price-levels";
import { playbookTemplates } from "@/lib/agent/knowledge/playbooks";
import { isNamedSetup } from "@/lib/agent/knowledge/setups";
import { lookAgainTrigger, type DroppedItem } from "@/lib/agent/thesis-research/decision";
import type { PriceStructure } from "@/lib/market-data/price-structure";
import type { Trigger } from "@/lib/agent/triggers/types";
import type { Call } from "./action";

export interface WriterReplayCase {
  ticker: string;
  mode: "mint" | "refresh";
  existing: { status: string; direction: string | null; setupId?: string | null; triggers: Trigger[] } | null;
  chart: PriceStructure | null;
}

type Decision = { direction?: string; setup_id?: string };
const playbooks = (id: string) => playbookTemplates(null, id);

/** The stock as the save leaves it: its status and view, its triggers with replay ids, and what wasn't written. */
export function savedByWriter(decision: Decision, c: WriterReplayCase) {
  const d = decision as { direction: "LONG" | "SHORT" | "PASS"; setup_id?: never };
  const writes = writerPlaybookWrites(d, { priceStructure: c.chart }, c.mode === "mint" ? null : c.existing, playbooks);
  let n = 0;
  const stored = (t: Record<string, unknown>) => ({ ...(triggerInputSchema.parse(t) as Trigger), id: `saved-${++n}` });
  const kept = c.mode === "mint" || !c.existing ? [] : c.existing.triggers.filter((t) => !writes.remove.includes(t.id));
  const pass = d.direction === "PASS";
  const status = c.mode === "mint" ? (pass ? "PASSED" : "WATCHING") : c.existing?.direction == null && pass ? "PASSED" : c.existing?.status ?? "WATCHING";
  const direction = c.mode === "mint" || c.existing?.direction == null ? (pass ? null : d.direction) : c.existing.direction;
  const look = pass ? null : lookAgainTrigger((decision as { look_again?: never }).look_again);
  return { status, direction, triggers: pass && c.mode === "mint" ? [] : [...kept, ...writes.add.map(stored), ...(look ? [stored(look)] : [])], writes, notWritten: writes.notWritten as DroppedItem[] };
}

/** The tailoring's edit_triggers calls applied to the saved triggers as the save applies them. */
export function afterTailoring(saved: ReturnType<typeof savedByWriter>, decision: Decision, c: WriterReplayCase, tailor: Call[]): Trigger[] {
  let triggers = saved.triggers;
  const held = saved.status === "HOLDING";
  const setupId = isNamedSetup(decision.setup_id) ? decision.setup_id : c.existing?.setupId ?? null;
  let id = 0;
  for (const call of tailor.filter((t) => t.toolName === "edit_triggers")) {
    const a = (call.input ?? {}) as { add?: Add[]; edit?: Edit[]; remove?: Array<{ id: string }> };
    const floor = triggers.find((t) => levelSlotOf(t, saved.direction) === "FLOOR" && t.action === "EXIT");
    const at = { chart: c.chart, buy: null, sale: floor ? typedPriceOf(floor) : null };
    const priced = priceAddsWith(a.add ?? [], { ticker: c.ticker, held, setupId, templates: isNamedSetup(setupId) ? playbooks(setupId) : null, at });
    const edits = priceEditsWith(a.edit ?? [], { at }, triggers, true).edits;
    const ops: TriggerOp[] = [
      ...priced.adds.map((t) => ({ op: "add" as const, trigger: t as Trigger })),
      ...edits.map((e) => ({ op: "edit" as const, id: e.id, ...editNumber(e), action: e.action as never, fireMode: e.fire_mode as never, rationale: e.rationale as string | undefined, close: e.close as boolean | undefined })),
      ...(a.remove ?? []).map((r) => ({ op: "remove" as const, id: r.id })),
    ];
    triggers = applyTriggerOps({ stored: triggers, ops, direction: saved.direction, status: saved.status, actor: "AGENT", currentPrice: (c.chart as { price?: number } | null)?.price ?? undefined, mintId: () => `tailored-${++id}` }).triggers;
  }
  return triggers;
}

/**
 * The run in the cases' shape: one submit_thesis. A mint carries the triggers
 * the stock is left with; a refresh, the save's playbook writes and the
 * tailoring's adds, edits and removals, as its own trigger fields were.
 */
export function writerInOldShape(submit: Call, saved: ReturnType<typeof savedByWriter>, final: Trigger[], c: WriterReplayCase, tailor: Call[]): Call {
  const input = { ...((submit.input ?? {}) as Record<string, unknown>) };
  if (c.mode === "mint") return { toolName: "submit_thesis", input: { ...input, ...(saved.status === "PASSED" ? {} : { triggers: final }) } };
  const edits = tailor.filter((t) => t.toolName === "edit_triggers").map((t) => (t.input ?? {}) as { add?: unknown[]; edit?: unknown[]; remove?: Array<{ id: string }> });
  const before = new Set((c.existing?.triggers ?? []).map((t) => t.id));
  const added = final.filter((t) => !before.has(t.id));
  const removed = [...saved.writes.remove, ...edits.flatMap((e) => (e.remove ?? []).map((r) => r.id))];
  const edited = edits.flatMap((e) => e.edit ?? []);
  return {
    toolName: "submit_thesis",
    input: { ...input, ...(added.length ? { add_triggers: added } : {}), ...(edited.length ? { edit_triggers: edited } : {}), ...(removed.length ? { remove_trigger_ids: removed } : {}) },
  };
}

/** What the Writer wrote itself, for the grades: its decision, and its trigger edits with their keys and references unpriced. */
export function writerOwnCalls(submit: Call, tailor: Call[]): Call[] {
  return [
    submit,
    ...tailor
      .filter((t) => t.toolName === "edit_triggers")
      .map((t) => {
        const a = (t.input ?? {}) as { add?: unknown[]; edit?: unknown[]; remove?: Array<{ id: string }> };
        return { toolName: "update_thesis", input: { add_triggers: a.add, edit_triggers: a.edit, remove_trigger_ids: a.remove?.map((r) => r.id) } };
      }),
  ];
}

/** The tailoring with each price moved by a key written as code writes it: the sale-loosened grade reads the number, not the key. */
export function withKeysPriced(saved: ReturnType<typeof savedByWriter>, c: WriterReplayCase, tailor: Call[]): Call[] {
  const floor = saved.triggers.find((t) => levelSlotOf(t, saved.direction) === "FLOOR" && t.action === "EXIT");
  const at = { chart: c.chart, buy: null, sale: floor ? typedPriceOf(floor) : null };
  return tailor.map((t) => {
    if (t.toolName !== "edit_triggers") return t;
    const a = (t.input ?? {}) as { edit?: Edit[] };
    return { ...t, input: { ...a, edit: priceEditsWith(a.edit ?? [], { at }, [], false).edits } };
  });
}
