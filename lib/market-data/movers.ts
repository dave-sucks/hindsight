/**
 * The movers view — today's gainers, losers and most-active stocks, ready
 * for a person to read: company name, price, the day's move and volume.
 * Feeds /movers and the dashboard's movers card. Live, nothing stored.
 *
 * Each row also carries what the stock has done over 5 sessions, a month
 * and six months — the run, not just today. A one-day pop and a name that
 * has climbed for a month read identically without them (the playbook's D2
 * momentum-leader screen is "top 1-2% by 1-, 3- and 6-month return").
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
import { movePctOverSessions } from "./indicator-snapshot";
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
  /** % from the close 5 / 21 / 126 completed sessions back to the current price. */
  move5d: number | null;
  move1m: number | null;
  move6m: number | null;
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
/** Sessions back for the trailing columns: a week, a month, six months. */
export const TRAILING_SESSIONS = { move5d: 5, move1m: 21, move6m: 126 } as const;
const TRAILING_CALENDAR_DAYS = 300;

/**
 * Completed daily closes for many symbols in one call, oldest first. IEX
 * closes are fine here — this is percent moves, not volume — and the bar
 * cap is raised so 50 symbols × 6 months fit in one page.
 */
async function fetchClosesBatch(symbols: string[], now: Date): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  const keyId = process.env.ALPACA_API_KEY;
  const secretKey = process.env.ALPACA_API_SECRET;
  if (!keyId || !secretKey || symbols.length === 0) return out;
  const start = new Date(now.getTime() - TRAILING_CALENDAR_DAYS * 86_400_000).toISOString().slice(0, 10);
  const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  try {
    const url =
      `https://data.alpaca.markets/v2/stocks/bars?symbols=${encodeURIComponent(symbols.join(","))}` +
      `&timeframe=1Day&start=${start}&limit=10000&adjustment=split&feed=iex`;
    const res = await fetch(url, {
      headers: { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secretKey },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[movers] trailing bars returned ${res.status}`);
      return out;
    }
    const body = (await res.json()) as { bars?: Record<string, Array<{ c: number; t: string }>> };
    for (const [symbol, bars] of Object.entries(body.bars ?? {})) {
      // Today's bar is a partial session; the current price is the live end.
      const completed = bars.filter((b) => b.t.slice(0, 10) < todayEt);
      out.set(symbol.toUpperCase(), completed.map((b) => b.c));
    }
  } catch (err) {
    console.warn("[movers] trailing bars failed:", err instanceof Error ? err.message : err);
  }
  return out;
}

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
  const now = opts.now ?? new Date();
  const [snaps, bars, companies, closes] = await Promise.all([
    kind === "active" ? getMoverSnapshots(symbols) : Promise.resolve(null),
    getTodaySessionBars(symbols, undefined, opts.now),
    loadCompanyList(),
    fetchClosesBatch(symbols, now),
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
    // The same "% from the close N sessions back" the 5D/20D triggers use.
    const history = { closes: closes.get(symbol) ?? [] } as Parameters<typeof movePctOverSessions>[0];
    const move = (sessions: number) =>
      history.closes.length > sessions ? movePctOverSessions(history, price, sessions) : null;
    rows.push({
      symbol,
      name: company?.name ?? null,
      exchange: company?.exchange ?? null,
      price,
      change,
      changePct,
      volume: bars[symbol]?.volume ?? r.volume ?? null,
      move5d: move(TRAILING_SESSIONS.move5d),
      move1m: move(TRAILING_SESSIONS.move1m),
      move6m: move(TRAILING_SESSIONS.move6m),
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
