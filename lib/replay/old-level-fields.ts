/**
 * A recorded call's level fields, written as the trigger edits they stood for.
 *
 * Until 2026-11-16 update_thesis took `entry_price`, `target_price` and
 * `stop_loss` (with `stop_basis` / `target_basis` / `entry_on_close`), each an
 * edit of one trigger. They are gone: a level is a trigger, edited by its id.
 * A replay of a call recorded before then sends the same intent the way a run
 * writes it now: an edit of the buy, floor or upside trigger on the stored
 * list, or an add when the stock has none. As the save did then, a level that
 * only repeats the stored one is no edit, and a buy level on a stock we hold
 * is none (the entry is the fill). Test-only.
 */
import { levelSlotOf, type LevelSlot } from "@/lib/agent/triggers/price-levels";
import { levelOf, shapeOf } from "@/lib/agent/triggers/condition";
import type { Trigger } from "@/lib/agent/triggers/types";

const FIELDS: Array<[string, LevelSlot, string | null]> = [
  ["entry_price", "ENTRY", null],
  ["stop_loss", "FLOOR", "stop_basis"],
  ["target_price", "TARGET", "target_basis"],
];

export function oldLevelFieldsAsTriggerOps(
  call: Record<string, unknown>,
  stored: Trigger[],
  direction: string | null,
  opts: { held?: boolean } = {},
): Record<string, unknown> {
  const { entry_price: _e, target_price: _t, stop_loss: _s, stop_basis: _sb, target_basis: _tb, entry_on_close: close, ...rest } = call;
  void _e; void _t; void _s; void _sb; void _tb;
  const edits = [...((rest.edit_triggers as Array<Record<string, unknown>> | undefined) ?? [])];
  const adds = [...((rest.add_triggers as Array<Record<string, unknown>> | undefined) ?? [])];
  const long = direction !== "SHORT";
  // A trigger the same call removes is not there to edit.
  const removed = new Set((rest.remove_trigger_ids as string[] | undefined) ?? []);
  const kept = stored.filter((t) => !removed.has(t.id));
  for (const [field, slot, basis] of FIELDS) {
    const value = call[field];
    if (typeof value !== "number" || (slot === "ENTRY" && opts.held)) continue;
    const said = basis && typeof call[basis] === "string" ? (call[basis] as string) : null;
    const own = kept.find((t) => levelSlotOf(t, direction) === slot);
    if (own) {
      const w = shapeOf(own.predicate);
      const current = w ? levelOf(w)?.value : undefined;
      if (current === value && (!said || said === own.rationale)) continue;
      edits.push({ id: own.id, value, rationale: said ?? (typeof call.rationale === "string" ? call.rationale : "Moved."), ...(slot === "ENTRY" && typeof close === "boolean" ? { close } : {}) });
    } else {
      const up = slot === "FLOOR" ? !long : long;
      adds.push({
        predicate: { watch: "price", is: up ? "above" : "below", value, ...(slot === "ENTRY" && close === true ? { settings: { close: true } } : {}) },
        action: slot === "ENTRY" ? "ENTER" : slot === "FLOOR" ? "EXIT" : "REVIEW",
        rationale: said ?? (typeof call.rationale === "string" ? call.rationale : "Set."),
      });
    }
  }
  return { ...rest, ...(edits.length ? { edit_triggers: edits } : {}), ...(adds.length ? { add_triggers: adds } : {}) };
}
