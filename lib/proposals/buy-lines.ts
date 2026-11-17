/**
 * buy-lines.ts — the lines a buy comes with besides its sale: the stock's
 * playbook's With the buy lines, filled by the run that proposes it
 * (place_trade's `with_buy`), kept on the position (`Position.buyLines`) and
 * written at the fill. The take-profit is the one that trims or sells at a
 * typed price; its price is `Position.targetPrice`, which Edit & Approve
 * changes. Pure.
 */

import { parseTriggersResilient } from "@/lib/agent/triggers/schema";
import { typedPriceOf } from "@/lib/agent/triggers/price-levels";
import { isGroup, sentenceOf } from "@/lib/agent/triggers/condition";
import type { Trigger } from "@/lib/agent/triggers/types";

export function parseBuyLines(raw: unknown): Trigger[] {
  return Array.isArray(raw) ? (parseTriggersResilient(raw).triggers as Trigger[]) : [];
}

/** The take-profit: the line that trims or sells at a typed price. */
export function takeProfitOf(lines: readonly Trigger[]): Trigger | undefined {
  return lines.find((t) => (t.action === "TRIM" || t.action === "EXIT") && typedPriceOf(t) != null);
}

/** The line at another price (the one approved in Edit & Approve). */
export function atPrice(t: Trigger, price: number): Trigger {
  return isGroup(t.predicate) ? t : { ...t, predicate: { ...t.predicate, value: price } };
}

/** What the proposal card shows: the sale, then each line the buy comes with, the take-profit at its approved price. */
export function buySentences(p: { direction: string; stopLoss: number | null; targetPrice: number | null; buyLines: unknown }): string[] {
  const lines = parseBuyLines(p.buyLines);
  const take = takeProfitOf(lines);
  const sale = p.stopLoss != null ? [sentenceOf({ action: "EXIT", predicate: { watch: "price", is: p.direction === "SHORT" ? "above" : "below", value: p.stopLoss } })] : [];
  return [...sale, ...lines.map((t) => sentenceOf(t === take && p.targetPrice != null ? atPrice(t, p.targetPrice) : t))];
}
