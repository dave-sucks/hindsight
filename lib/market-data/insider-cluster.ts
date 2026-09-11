/**
 * insider-cluster.ts — open-market insider buying, and whether it clusters.
 *
 * Three or more insiders buying their own stock on the open market within
 * about a month predicts positive returns over 6–12 months — roughly twice
 * the effect of a single buy (TRADING_PLAYBOOK.md D9, Lakonishok & Lee).
 * DAV-252.
 *
 * Source: Finnhub /stock/insider-transactions, filtered to transaction code
 * "P" (an open-market purchase), non-derivative, shares acquired. Grants,
 * option exercises and plan awards are not buying and are left out — the
 * SEC-XML insider tool counts any "acquired" row as a buy, which is why this
 * is its own read.
 *
 * Estimate revisions (D10) are NOT here: Finnhub's /stock/eps-estimate
 * answers "You don't have access to this resource" on our plan (probed
 * 2026-09-11), and a trigger kind that can't fire is not shipped.
 */

import { finnhub } from "@/lib/agent/research-helpers";

export interface InsiderBuy {
  name: string;
  /** YYYY-MM-DD, the transaction date. */
  date: string;
  shares: number;
  price: number;
}

/** How far back the snapshot keeps buys — the longest window a trigger may ask about. */
export const INSIDER_LOOKBACK_DAYS = 90;

interface FinnhubInsiderRow {
  name?: string;
  change?: number;
  transactionDate?: string;
  transactionCode?: string;
  transactionPrice?: number;
  isDerivative?: boolean;
  id?: string;
}

/** Keep only open-market purchases; one row per filing id. */
export function openMarketBuys(rows: FinnhubInsiderRow[]): InsiderBuy[] {
  const seen = new Set<string>();
  const out: InsiderBuy[] = [];
  for (const r of rows) {
    if (r.transactionCode !== "P" || r.isDerivative || !(Number(r.change) > 0) || !r.name || !r.transactionDate) continue;
    const key = r.id ?? `${r.name}|${r.transactionDate}|${r.change}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: r.name,
      date: r.transactionDate.slice(0, 10),
      shares: Number(r.change),
      price: Number(r.transactionPrice) || 0,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export async function fetchOpenMarketBuys(
  symbol: string,
  days = INSIDER_LOOKBACK_DAYS,
  now: Date = new Date(),
): Promise<InsiderBuy[] | null> {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const r = await finnhub(`/stock/insider-transactions?symbol=${symbol}&from=${from}&to=${to}`, 1).catch(() => null);
  const data = (r?.data as { data?: FinnhubInsiderRow[] } | null)?.data;
  return Array.isArray(data) ? openMarketBuys(data) : null;
}

export interface InsiderCluster {
  /** Distinct people who bought in the window. */
  buyers: number;
  names: string[];
  netShares: number;
  /** Lowest price paid in the window — the playbook's stop reference for D9. */
  lowestPrice: number | null;
  buys: InsiderBuy[];
  days: number;
}

export function insiderCluster(buys: InsiderBuy[], days: number, now: Date = new Date()): InsiderCluster {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const inWindow = buys.filter((b) => b.date >= since);
  const names = Array.from(new Set(inWindow.map((b) => b.name)));
  const prices = inWindow.map((b) => b.price).filter((p) => p > 0);
  return {
    buyers: names.length,
    names,
    netShares: inWindow.reduce((s, b) => s + b.shares, 0),
    lowestPrice: prices.length ? Math.min(...prices) : null,
    buys: inWindow,
    days,
  };
}

/** One sentence naming the buyers — the fired audit row and the writer's data block both use it. */
export function describeCluster(c: InsiderCluster): string {
  if (c.buyers === 0) return `No open-market insider buying in the last ${c.days} days.`;
  const list = c.buys
    .slice(0, 6)
    .map((b) => `${b.name} (${b.date.slice(5)}, ${b.shares.toLocaleString()} sh${b.price > 0 ? ` @ $${b.price.toFixed(2)}` : ""})`)
    .join("; ");
  return (
    `${c.buyers} insider${c.buyers === 1 ? "" : "s"} bought on the open market in the last ${c.days} days: ${list}` +
    (c.buys.length > 6 ? `; +${c.buys.length - 6} more` : "") +
    (c.lowestPrice != null ? `. Lowest price paid $${c.lowestPrice.toFixed(2)}.` : ".")
  );
}
