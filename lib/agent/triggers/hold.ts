/**
 * A sale the owner held: its trigger stays quiet until it re-arms.
 *
 * The owner's ruling, 2026-11-13: a sale a trigger proposes stays open while
 * the trigger holds, and Hold (a decline) means quiet. The trigger does not ask
 * again until the stock closes back past it (the 16:20 ET close pass releases
 * it, lib/proposals/sale-card.ts) and breaks it again, or until its condition
 * changes: a new line is a new trigger to the owner, so the hold keeps the
 * condition it was taken on and lets go the moment the stored one differs.
 *
 * Kept per stock in `Thesis.triggerState[id].held`, whichever level the
 * trigger lives at (the account's trail is shared by every stock), and merged
 * onto the resolved trigger as `heldAt` (./levels). Pure.
 */
import type { Trigger } from "./types";

export interface Hold {
  /** When the owner held the sale (ISO). */
  at: string;
  /** The trigger's action and condition when it was held (`holdKey`). */
  on: string;
}

/** JSON with its keys sorted, so a condition stored in another key order is the same condition. */
function sortedJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(sortedJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${sortedJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** What a hold is taken on: the trigger's action and condition. */
export const holdKey = (t: Pick<Trigger, "action" | "predicate">): string => sortedJson({ action: t.action, predicate: t.predicate });

/** When the trigger was held, if the hold is on its condition as stored now; a changed condition has none. */
export function heldAt(t: Pick<Trigger, "action" | "predicate">, hold: Hold | undefined): string | undefined {
  return hold && hold.on === holdKey(t) ? hold.at : undefined;
}
