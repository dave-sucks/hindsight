/**
 * buy-triggers.ts — the triggers that come with a buy besides its "Sell if
 * below": the ones in the stock's playbook, each price from the chart, named
 * by the run that proposes the buy (place_trade's `triggers_with_buy`), saved
 * as they are on the position (`Position.buyTriggers`) and written on the
 * stock at the fill. Pure.
 */

import { parseTriggersResilient } from "@/lib/agent/triggers/schema";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import type { Trigger } from "@/lib/agent/triggers/types";

export function parseBuyTriggers(raw: unknown): Trigger[] {
  return Array.isArray(raw) ? (parseTriggersResilient(raw).triggers as Trigger[]) : [];
}

/** What the proposal card shows: "Sell if below $X", then each trigger that comes with the buy, as its sentence. */
export function buyTriggerSentences(p: { direction: string; stopLoss: number | null; buyTriggers: unknown }): string[] {
  const sale = p.stopLoss != null ? [sentenceOf({ action: "EXIT", predicate: { watch: "price", is: p.direction === "SHORT" ? "above" : "below", value: p.stopLoss } })] : [];
  return [...sale, ...parseBuyTriggers(p.buyTriggers).map(sentenceOf)];
}
