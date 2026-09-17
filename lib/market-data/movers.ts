/**
 * The movers view — today's gainers, losers and most-active stocks, ready
 * for a person to read: company name, price, the day's move and volume.
 * Feeds /movers and the dashboard's movers card. Live, nothing stored.
 *
 * Alpaca's screener names the symbols: gainers/losers come with price and
 * move; most-actives with volume only, so one snapshot call fills in their
 * price and move. Volume for every row is today's consolidated (SIP) bar,
 * ~16 minutes behind — the same read the trigger check uses; the plan
 * refuses SIP data newer than that. SEC's day-cached company list supplies
 * the names. Under-$5 names are dropped from all three lists, as the agent
 * tool does.
 */

import { getTodaySessionBars } from "@/lib/alpaca";
import { getAlpacaMovers, getMoverSnapshots, type MoverKind } from "./alpaca-screener";
import { loadCompanyList } from "./sec-filings";

export interface MoverEntry {
  symbol: string;
  name: string | null;
  exchange: string | null;
  price: number | null;
  change: number | null;
  changePct: number | null;
  /** Today's consolidated volume — null when only the partial feed answered. */
  volume: number | null;
  /** Analysts holding or watching this name. */
  analystIds: string[];
}

export interface MoversView {
  kind: MoverKind;
  rows: MoverEntry[];
  asOf: string;
  /** False when volume couldn't be read from the consolidated tape. */
  hasVolume: boolean;
  /** Why the list is empty or partial, in words. */
  error?: string;
}

const MIN_PRICE = 5;

export async function getMoversView(
  kind: MoverKind,
  opts: { coveredBy?: Map<string, string[]>; top?: number; now?: Date } = {},
): Promise<MoversView> {
  const asOf = (opts.now ?? new Date()).toISOString();
  const screen = await getAlpacaMovers(kind, { top: opts.top ?? 50, minPrice: MIN_PRICE });
  if (!screen.data || screen.data.length === 0) {
    return { kind, rows: [], asOf, hasVolume: false, error: screen.error ?? "The screener returned nothing" };
  }
  const symbols = screen.data.map((r) => r.symbol.toUpperCase());
  const [snaps, bars, companies] = await Promise.all([
    kind === "active" ? getMoverSnapshots(symbols) : Promise.resolve(null),
    getTodaySessionBars(symbols, undefined, opts.now),
    loadCompanyList(),
  ]);

  const rows: MoverEntry[] = [];
  for (const r of screen.data) {
    const symbol = r.symbol.toUpperCase();
    const snap = snaps?.bySymbol.get(symbol);
    const price = r.price ?? snap?.price ?? null;
    const prev = snap?.prevClose ?? null;
    const change = r.change ?? (price != null && prev ? price - prev : null);
    const changePct = r.percentChange ?? (price != null && prev ? ((price - prev) / prev) * 100 : null);
    if (price == null || price < MIN_PRICE) continue;
    const company = companies?.byTicker.get(symbol);
    rows.push({
      symbol,
      name: company?.name ?? null,
      exchange: company?.exchange ?? null,
      price,
      change,
      changePct,
      volume: bars[symbol]?.volume ?? r.volume ?? null,
      analystIds: opts.coveredBy?.get(symbol) ?? [],
    });
  }
  const hasVolume = rows.some((r) => r.volume != null);
  return {
    kind,
    rows,
    asOf,
    hasVolume,
    ...(snaps?.error ? { error: `Prices unavailable for most-actives — ${snaps.error}` } : {}),
  };
}

export type { MoverKind };
