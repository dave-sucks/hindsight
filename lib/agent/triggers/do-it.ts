/**
 * An Auto trigger, with no agent deciding: the trade tool call the agent would have made, from the
 * trigger alone. The tool sizes and gates it, and the approval switch decides whether it waits. The
 * trigger run then writes the trade up (tactical-run.ts). Pure.
 */

import { sentenceOf } from "./condition/describe";
import { fireModeWords, trimPctOf, type DoIt } from "./fire-mode";
import type { Trigger } from "./types";

/** An Auto trade's reason until the analyst's write-up replaces it (lib/proposals/auto-writeup.ts): what fired, and that it is set to Auto. */
export function autoTradeLine(trigger: Pick<Trigger, "action" | "predicate" | "trimPct">): string {
  return `Your "${sentenceOf(trigger)}" came true. It's set to ${fireModeWords({ ...trigger, fireMode: "DO_IT" })}.`;
}

export type DoItCall =
  | { tool: "place_trade"; args: { ticker: string; direction: "LONG" | "SHORT"; entry_price: number; thesis_id: string; entry_rationale: string } }
  | { tool: "add"; args: { ticker: string; note: string } }
  | { tool: "sell"; args: { ticker: string; percent: number; note: string } };

export function doItCall(opts: {
  trade: Exclude<DoIt, "SELL">;
  trigger: Pick<Trigger, "action" | "predicate" | "rationale" | "trimPct">;
  thesis: { id: string; ticker: string; direction: string | null };
  /** The price the buy fired at. */
  price: number;
}): DoItCall {
  const { trade, trigger, thesis } = opts;
  const why = autoTradeLine(trigger);
  // An Auto-buy names no sale: place_trade prices the playbook's floor, or refuses the buy when it can't.
  if (trade === "BUY") {
    return {
      tool: "place_trade",
      args: { ticker: thesis.ticker, direction: thesis.direction === "SHORT" ? "SHORT" : "LONG", entry_price: opts.price, thesis_id: thesis.id, entry_rationale: why },
    };
  }
  if (trade === "ADD") return { tool: "add", args: { ticker: thesis.ticker, note: why } };
  return { tool: "sell", args: { ticker: thesis.ticker, percent: trimPctOf(trigger), note: why } };
}
