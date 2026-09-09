/**
 * Market movers from Alpaca's stock screener — `/v1beta1/screener/stocks/movers`
 * (gainers + losers) and `/most-actives`. On the market-data plan we already
 * hold (verified 2026-09-08). Replaces the FMP movers, which the current FMP
 * tier no longer serves for the names this book trades.
 *
 * The raw screener is dominated by sub-dollar warrants and rights (RIV.RT
 * +700%, GFAIW +99%). `getAlpacaMovers` drops symbols with a "." (rights /
 * units) and anything priced under `minPrice` so the tool and the morning
 * sweep see tradeable common stock. Most-actives carries no price, so it is
 * passed through as ranked by volume.
 */

import type { AlpacaCredentials } from "@/lib/alpaca";

export type MoverKind = "gainers" | "losers" | "active";

export interface MoverRow {
  symbol: string;
  name?: string;
  price?: number;
  change?: number;
  percentChange?: number;
  volume?: number;
}

const DATA_BASE = "https://data.alpaca.markets/v1beta1/screener/stocks";

function headers(creds?: AlpacaCredentials): Record<string, string> | null {
  const keyId = creds?.keyId || process.env.ALPACA_API_KEY;
  const secretKey = creds?.secretKey || process.env.ALPACA_API_SECRET;
  if (!keyId || !secretKey) return null;
  return { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secretKey };
}

interface MoverItem {
  symbol: string;
  price?: number;
  change?: number;
  percent_change?: number;
}
interface ActiveItem {
  symbol: string;
  volume?: number;
  trade_count?: number;
}

export async function getAlpacaMovers(
  kind: MoverKind,
  opts: { top?: number; minPrice?: number; creds?: AlpacaCredentials; timeoutMs?: number } = {},
): Promise<{ data: MoverRow[] | null; error?: string }> {
  const top = Math.min(Math.max(opts.top ?? 50, 1), 50);
  const minPrice = opts.minPrice ?? 5;
  const h = headers(opts.creds);
  if (!h) return { data: null, error: "Alpaca credentials are not set" };

  const url =
    kind === "active"
      ? `${DATA_BASE}/most-actives?by=volume&top=${top}`
      : `${DATA_BASE}/movers?top=${top}`;

  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: h,
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    if (!res.ok) {
      const msg = `Alpaca screener ${kind} returned ${res.status}`;
      console.warn(`[alpaca-screener] ${msg} (${Date.now() - t0}ms)`);
      return { data: null, error: msg };
    }
    const body = (await res.json()) as {
      gainers?: MoverItem[];
      losers?: MoverItem[];
      most_actives?: ActiveItem[];
    };
    let rows: MoverRow[];
    if (kind === "active") {
      rows = (body.most_actives ?? []).map((a) => ({ symbol: a.symbol, volume: a.volume }));
    } else {
      const list = kind === "gainers" ? body.gainers : body.losers;
      rows = (list ?? [])
        .filter((m) => !m.symbol.includes(".") && (m.price ?? 0) >= minPrice)
        .map((m) => ({
          symbol: m.symbol,
          price: m.price,
          change: m.change,
          percentChange: m.percent_change,
        }));
    }
    if (rows.length === 0) {
      const msg = `Alpaca screener ${kind} returned an empty list`;
      console.warn(`[alpaca-screener] ${msg} (${Date.now() - t0}ms)`);
      return { data: [], error: msg };
    }
    return { data: rows };
  } catch (err) {
    const msg = `Alpaca screener ${kind} threw: ${err instanceof Error ? err.message : String(err)}`;
    console.warn(`[alpaca-screener] ${msg}`);
    return { data: null, error: msg };
  }
}
