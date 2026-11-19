/**
 * The cases' expectations name the tools as they were before 2026-11-18
 * (update_thesis, close_position, manage_position). A run on today's tools is
 * graded in that shape, so one case scores before and after the change alike:
 * a sale or an add as the old trade call, and a run's thesis calls on one
 * stock (the note, the trigger edits, the conviction, the catalyst date, a
 * watch change) as one update_thesis, the way one call carried them.
 */
import type { Call } from "./action";

const THESIS_DOORS = new Set(["write_note", "edit_triggers", "set_conviction", "set_catalyst_date", "stop_watching", "watch_again"]);

/** One of today's calls as the old tool's input. */
function oneInOldShape(c: Call): Call {
  const a = (c.input ?? {}) as Record<string, unknown>;
  const keep = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  switch (c.toolName) {
    case "sell":
      return typeof a.percent === "number" && a.percent < 100
        ? { toolName: "manage_position", input: keep({ symbol: a.ticker, action: "partial_close", close_pct: a.percent, reason: a.note }) }
        : { toolName: "close_position", input: keep({ ticker: a.ticker, belief_survived: a.belief_survived, notes: a.note }) };
    case "add":
      return { toolName: "manage_position", input: keep({ symbol: a.ticker, action: "add_to_position", add_notional: a.notional, reason: a.note }) };
    case "pass_on_stock":
      return { toolName: "record_thesis", input: keep({ ticker: a.ticker, direction: "PASS", reasoning_summary: a.reason }) };
    case "write_note":
      return { toolName: "update_thesis", input: keep({ thesis_id: a.thesis_id, rationale: a.note, verdict: a.verdict, verdict_line: a.verdict_line, answers_update_id: a.answers_update_id, trigger_id: a.trigger_id }) };
    case "edit_triggers":
      return { toolName: "update_thesis", input: keep({ thesis_id: a.thesis_id, trigger_id: a.trigger_id, add_triggers: a.add, edit_triggers: a.edit, remove_trigger_ids: a.remove, setup_id: a.setup_id }) };
    case "set_conviction":
      return { toolName: "update_thesis", input: keep({ thesis_id: a.thesis_id, conviction: a.conviction, conviction_rationale: a.conviction_rationale }) };
    case "set_catalyst_date":
      return { toolName: "update_thesis", input: keep({ thesis_id: a.thesis_id, catalyst_date: a.catalyst_date }) };
    case "stop_watching":
      return { toolName: "update_thesis", input: keep({ thesis_id: a.thesis_id, change_status: "ARCHIVED", rationale: a.reason }) };
    case "watch_again":
      return { toolName: "update_thesis", input: keep({ thesis_id: a.thesis_id, change_status: "WATCHING" }) };
    default:
      return c;
  }
}

/** A run's calls in the old shape: today's thesis calls on one stock merged into one update_thesis. The chat's write_note is the owner's note, as it was. */
export function inOldShape(calls: Call[], isChat = false): Call[] {
  const out: Call[] = [];
  const merged = new Map<string, Record<string, unknown>>();
  for (const c of calls) {
    const old = isChat && c.toolName === "write_note" ? c : oneInOldShape(c);
    if (!THESIS_DOORS.has(c.toolName) || old.toolName !== "update_thesis") {
      out.push(old);
      continue;
    }
    const a = old.input as Record<string, unknown>;
    const key = String(a.thesis_id ?? "");
    const into = merged.get(key);
    if (!into) {
      const fresh = { ...a };
      merged.set(key, fresh);
      out.push({ toolName: "update_thesis", input: fresh });
      continue;
    }
    for (const [k, v] of Object.entries(a)) {
      into[k] = Array.isArray(v) && Array.isArray(into[k]) ? [...(into[k] as unknown[]), ...v] : into[k] ?? v;
    }
  }
  return out;
}
