/**
 * refusals.ts — a refused call, as the run page and Activity show it. Pure:
 * no database, no clock.
 *
 * A refusal reaches the model once, as the tool's result, with what to do
 * instead; nothing carries it to a later run. Each one is recorded
 * (`GateRejection`, lib/agent/gate-rejections.ts), listed on its run when it
 * ends, and shown on the stock's Activity until the same tool lands there.
 */

/** One open refusal, as the run page reads it. */
export interface OpenRefusal {
  id: string;
  tool: string;
  ticker: string | null;
  thesisId: string | null;
  summary: string;
  detail: string | null;
  runId: string | null;
  createdAt: Date;
  gateCode?: string | null;
  /** How many identical refusals this line stands for (owedRefusals). */
  count?: number;
}

/**
 * Gates that refuse a field, not a call, since update_thesis became a patch
 * (#808): the rest of the call lands, so an open row with one of these codes
 * is history, not a call that failed.
 */
export const NO_LONGER_OWED: ReadonlySet<string> = new Set([
  "direction_change_only_from_pending",
  "watching_transition_from_non_promoted",
  "terminate_active_without_close",
  "conviction_rationale_required",
  "goalpost_moving_blocked",
  "no_live_price",
  "thesis_writer_cannot_change_promoted_status",
  "promoted_thesis_illegal_transition",
  "promoted_thesis_requires_resolution",
]);

/**
 * The refused calls still open, each once: rows whose gate refuses only a
 * field are dropped, and identical ones (same tool, same stock, same gate)
 * become one line carrying the count and the latest date.
 */
export function owedRefusals(rows: OpenRefusal[]): OpenRefusal[] {
  const byKey = new Map<string, OpenRefusal>();
  for (const r of rows) {
    if (r.gateCode && NO_LONGER_OWED.has(r.gateCode)) continue;
    const key = `${r.tool}|${r.thesisId ?? r.ticker ?? ""}|${r.gateCode ?? r.summary}`;
    const seen = byKey.get(key);
    byKey.set(key, seen ? { ...(r.createdAt >= seen.createdAt ? r : seen), count: (seen.count ?? 1) + 1 } : { ...r, count: 1 });
  }
  return [...byKey.values()];
}

/** The tool's name in product words. */
export function describeRefusalTool(tool: string): string {
  switch (tool) {
    case "place_trade": return "Buy";
    case "sell":
    case "close_position": return "Sale";
    case "add": return "Add";
    case "manage_position": return "Position change";
    case "update_thesis": return "Thesis edit";
    case "edit_triggers": return "Trigger edit";
    case "write_note": return "Note";
    case "set_conviction": return "Conviction";
    case "set_catalyst_date": return "Catalyst date";
    case "stop_watching": return "Stop watching";
    case "watch_again": return "Watch again";
    case "record_thesis": return "Thesis save";
    case "thesis_writer": return "Thesis research";
    case "complete_run": return "Run close";
    default: return tool;
  }
}
