/**
 * A trigger set to Do it, with no analyst: the trade tool call the analyst would have made, from the
 * trigger alone. The tool sizes and gates it, and the approval switch decides whether it waits. Pure.
 */

import { sentenceOf } from "./condition/describe";
import { trimPctOf, type DoIt } from "./fire-mode";
import type { Trigger } from "./types";

export type DoItCall =
  | { tool: "place_trade"; args: { ticker: string; direction: "LONG" | "SHORT"; entry_price: number; thesis_id: string; entry_rationale: string } }
  | { tool: "manage_position"; args: { symbol: string; action: "add_to_position" | "partial_close"; close_pct?: number; reason: string } };

const DONE: Record<Exclude<DoIt, "SELL">, string> = { BUY: "buys", ADD: "adds", TRIM: "trims" };

export function doItCall(opts: {
  trade: Exclude<DoIt, "SELL">;
  trigger: Pick<Trigger, "action" | "predicate" | "rationale" | "trimPct">;
  thesis: { id: string; ticker: string; direction: string | null };
  /** The price the buy fired at. */
  price: number;
}): DoItCall {
  const { trade, trigger, thesis } = opts;
  const why = `"${sentenceOf(trigger)}" fired, and this trigger ${DONE[trade]} right away, with no analyst run. ${trigger.rationale}`.trim();
  if (trade === "BUY") {
    return {
      tool: "place_trade",
      args: { ticker: thesis.ticker, direction: thesis.direction === "SHORT" ? "SHORT" : "LONG", entry_price: opts.price, thesis_id: thesis.id, entry_rationale: why },
    };
  }
  if (trade === "ADD") return { tool: "manage_position", args: { symbol: thesis.ticker, action: "add_to_position", reason: why } };
  return { tool: "manage_position", args: { symbol: thesis.ticker, action: "partial_close", close_pct: trimPctOf(trigger), reason: why } };
}
