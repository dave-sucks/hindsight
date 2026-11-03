/**
 * Open-market insider buying, in words, for the Data tab: what the
 * insider-buying trigger reads (lib/market-data/stock-activity), said once.
 * Pure.
 */

import type { StockInsiderBuying } from "@/lib/market-data/stock-activity";

const n = (v: number) => v.toLocaleString("en-US");
const plural = (count: number, word: string) => `${n(count)} ${word}${count === 1 ? "" : "s"}`;

/** One sentence on the last 90 and 30 days, or why there is none. */
export function insiderSummary(d: StockInsiderBuying | null): string {
  if (!d || !d.last90) return d?.error ? `${d.error}.` : "Insider transactions unavailable.";
  const { last90, last30 } = d;
  if (last90.buys.length === 0) return `No open-market buys by insiders in the last ${last90.days} days.`;
  const buyers = plural(last90.buyers, "insider");
  const shares = `${n(last90.netShares)} shares`;
  const lowest = last90.lowestPrice != null ? `, lowest $${last90.lowestPrice.toFixed(2)}` : "";
  const recent = last30 && last30.buyers > 0 ? ` ${plural(last30.buyers, "insider")} bought in the last ${last30.days} days.` : "";
  return `${plural(last90.buys.length, "open-market buy")} by ${buyers} in the last ${last90.days} days (${shares}${lowest}).${recent}`;
}

export interface InsiderRow {
  date: string;
  name: string;
  /** "2,000 shares at $41.20" */
  text: string;
}

/** The buys, newest first, up to `max`. */
export function insiderRows(d: StockInsiderBuying | null, max = 8): InsiderRow[] {
  const buys = d?.last90?.buys ?? [];
  return [...buys]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, max)
    .map((b) => ({ date: b.date, name: b.name, text: `${n(b.shares)} shares at $${b.price.toFixed(2)}` }));
}
