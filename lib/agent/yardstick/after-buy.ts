/**
 * How a run after a buy is graded (lib/agent/engine/agents/after-buy.md):
 * the playbook's holding triggers go on by reference, or are named as left
 * off; every change of its own has a reason; it types no price (a price is a
 * chart key or a line, never a number); it makes no trade; it writes the
 * trade's note only when none existed. Graded on what production saves: the
 * floor guard (FLOOR_LEFT, edit-triggers.ts) drops any edit, removal or add
 * that would replace the floor, so those are dropped here too and counted as
 * floor attempts. Pure.
 */
import type { Call } from "./action";

export interface AfterBuyExpect {
  /** The playbook's holding triggers to put on by reference (the floor's template is on already). */
  refs: string[];
  /** Those already on the stock (the same slot, the playbook's mark): present, so not owed. */
  present?: string[];
  /** The floor on the stock, by id: it is the buy's and stays as it is. */
  floorId: string | null;
  /** The playbook's own floor trigger, by reference (H1): adding it would replace the floor. */
  floorRef?: string | null;
  /** Each chart key's number at the fill, to name the key a typed price stood in for. */
  keys: Record<string, number>;
  /** The stock's price triggers at the fill, by id: an edit that types a number on one types a price. */
  priceTriggerIds: string[];
  /** The trade had no note, so the run writes one. */
  noteWanted: boolean;
}

const TRADES = new Set(["place_trade", "sell", "add", "close_position", "manage_position"]);
const said = (s: unknown) => typeof s === "string" && s.trim().length > 0;

/** Every price a condition names as a number. */
function pricesIn(p: unknown): number[] {
  const c = (p ?? {}) as { match?: string; conditions?: unknown[]; watch?: string; value?: unknown };
  if (c.match === "all" && Array.isArray(c.conditions)) return c.conditions.flatMap(pricesIn);
  return c.watch === "price" && typeof c.value === "number" ? [c.value] : [];
}

/** A typed price, with the key it stood in for when it is within half a percent of one. */
function typedPrice(price: number, keys: Record<string, number>): string {
  const key = Object.entries(keys).find(([, v]) => v > 0 && Math.abs(price - v) / v <= 0.005)?.[0];
  return key ? `$${price} (${key})` : `$${price}`;
}

/** `invalid`: the calls its schema refused (a typed price comes back that way); an edit_triggers among them fails the run. */
/** An add that lands on the floor's slot: the floor's reference, or a sale of its own below a price. */
function onTheFloor(a: Record<string, unknown>, floorRef: string | null | undefined): boolean {
  if (typeof a.playbook_trigger === "string") return !!floorRef && a.playbook_trigger.trim().toUpperCase() === floorRef;
  const p = (a.predicate ?? {}) as { watch?: string; is?: string };
  return a.action === "EXIT" && p.watch === "price" && p.is === "below";
}

export function scoreAfterBuy(ex: AfterBuyExpect, sent: Call[], text: string, invalid: Array<{ tool: string; error: string }> = []): { pass: boolean; why: string; floorAttempts: string[] } {
  const why: string[] = [];
  // What the floor guard drops: each one a floor attempt, and graded as not sent.
  const floorAttempts: string[] = [];
  const calls = sent.map((c) => {
    if (c.toolName !== "edit_triggers") return c;
    const i = (c.input ?? {}) as { add?: Array<Record<string, unknown>>; edit?: Array<Record<string, unknown>>; remove?: Array<Record<string, unknown>> };
    const add = (i.add ?? []).filter((a) => !(onTheFloor(a, ex.floorRef) && floorAttempts.push(`add ${typeof a.playbook_trigger === "string" ? a.playbook_trigger : "a sale below a price"}`)));
    const edit = (i.edit ?? []).filter((e) => !(e.id === ex.floorId && floorAttempts.push(`edit${e.fire_mode ? ` (On fire ${e.fire_mode})` : ""}${e.price ? ` to ${e.price}` : ""}`)));
    const remove = (i.remove ?? []).filter((r) => !(r.id === ex.floorId && floorAttempts.push("remove")));
    return { ...c, input: { ...i, add, edit, remove } };
  });
  const refusedEdits = invalid.filter((c) => c.tool === "edit_triggers");
  if (refusedEdits.length) why.push(`edit_triggers refused by its schema (${refusedEdits.length})`);
  const traded = calls.filter((c) => TRADES.has(c.toolName));
  if (traded.length) why.push(`a trade call (${traded.map((c) => c.toolName).join(", ")})`);

  const edits = calls.filter((c) => c.toolName === "edit_triggers").map((c) => (c.input ?? {}) as { add?: unknown[]; edit?: unknown[]; remove?: unknown[] });
  const adds = edits.flatMap((e) => (Array.isArray(e.add) ? e.add : [])) as Array<Record<string, unknown>>;
  const byRef = new Set(adds.flatMap((a) => (typeof a.playbook_trigger === "string" ? [a.playbook_trigger.trim().toUpperCase()] : [])));
  // A holding trigger not put on is left off only with its reference named in the closing line.
  const missing = ex.refs.filter((r) => !byRef.has(r) && !ex.present?.includes(r) && !new RegExp(`\\b${r}\\b`).test(text));
  if (missing.length) why.push(`${missing.join(", ")} neither put on by reference nor named as left off`);

  const own = adds.filter((a) => typeof a.playbook_trigger !== "string");
  if (own.some((a) => !said(a.rationale))) why.push("a trigger of its own with no reason");
  const changes = edits.flatMap((e) => (Array.isArray(e.edit) ? e.edit : [])) as Array<{ id?: string; value?: unknown; rationale?: unknown }>;
  if (changes.some((e) => !said(e.rationale))) why.push("an edit with no reason");
  const removes = edits.flatMap((e) => (Array.isArray(e.remove) ? e.remove : [])) as Array<{ id?: string; reason?: unknown }>;
  if (removes.some((r) => !said(r.reason))) why.push("a removal with no reason");

  const typed = [...own.flatMap((a) => pricesIn(a.predicate)), ...changes.flatMap((e) => (typeof e.value === "number" && ex.priceTriggerIds.includes(String(e.id)) ? [e.value] : []))].map((p) => typedPrice(p, ex.keys));
  if (typed.length) why.push(`a typed price: ${typed.join(", ")}`);


  const notes = calls.filter((c) => c.toolName === "write_note").length;
  if (ex.noteWanted && notes === 0) why.push("no note, and the trade had none");
  if (!ex.noteWanted && notes > 0) why.push("a note, and the trade had one");
  return { pass: why.length === 0, why: why.join("; "), floorAttempts };
}
