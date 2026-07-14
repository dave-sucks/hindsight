'use server';

import { POPULAR_STOCK_SYMBOLS } from '@/lib/constants';
import { cache } from 'react';

// ─── Local helpers (previously imported from utils) ───────────────────────────

function getDateRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function validateArticle(article: RawNewsArticle): boolean {
  return Boolean(
    article &&
    article.headline &&
    article.url &&
    article.datetime &&
    article.source
  );
}

function formatArticle(
  article: RawNewsArticle,
  isCompany: boolean,
  sym: string | undefined,
  idx: number
): MarketNewsArticle {
  return {
    id: article.id ?? idx,
    headline: article.headline ?? '',
    summary: article.summary ?? '',
    url: article.url ?? '',
    image: article.image,
    datetime: article.datetime ?? 0,
    source: article.source ?? '',
    related: sym ?? article.related ?? '',
    category: isCompany ? 'company news' : article.category ?? 'general',
  };
}

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const NEXT_PUBLIC_FINNHUB_API_KEY = process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? '';

async function fetchJSON<T>(url: string, revalidateSeconds?: number): Promise<T> {
  const options: RequestInit & { next?: { revalidate?: number } } = revalidateSeconds
    ? { cache: 'force-cache', next: { revalidate: revalidateSeconds } }
    : { cache: 'no-store' };

  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Fetch failed ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export { fetchJSON };

export async function getNews(symbols?: string[]): Promise<MarketNewsArticle[]> {
  try {
    const range = getDateRange(5);
    const token = process.env.FINNHUB_API_KEY ?? NEXT_PUBLIC_FINNHUB_API_KEY;
    if (!token) {
      throw new Error('FINNHUB API key is not configured');
    }
    const cleanSymbols = (symbols || [])
      .map((s) => s?.trim().toUpperCase())
      .filter((s): s is string => Boolean(s));

    const maxArticles = 6;

    // If we have symbols, try to fetch company news per symbol and round-robin select
    if (cleanSymbols.length > 0) {
      const perSymbolArticles: Record<string, RawNewsArticle[]> = {};

      await Promise.all(
        cleanSymbols.map(async (sym) => {
          try {
            const url = `${FINNHUB_BASE_URL}/company-news?symbol=${encodeURIComponent(sym)}&from=${range.from}&to=${range.to}&token=${token}`;
            const articles = await fetchJSON<RawNewsArticle[]>(url, 300);
            perSymbolArticles[sym] = (articles || []).filter(validateArticle);
          } catch (e) {
            console.error('Error fetching company news for', sym, e);
            perSymbolArticles[sym] = [];
          }
        })
      );

      const collected: MarketNewsArticle[] = [];
      // Round-robin up to 6 picks
      for (let round = 0; round < maxArticles; round++) {
        for (let i = 0; i < cleanSymbols.length; i++) {
          const sym = cleanSymbols[i];
          const list = perSymbolArticles[sym] || [];
          if (list.length === 0) continue;
          const article = list.shift();
          if (!article || !validateArticle(article)) continue;
          collected.push(formatArticle(article, true, sym, round));
          if (collected.length >= maxArticles) break;
        }
        if (collected.length >= maxArticles) break;
      }

      if (collected.length > 0) {
        // Sort by datetime desc
        collected.sort((a, b) => (b.datetime || 0) - (a.datetime || 0));
        return collected.slice(0, maxArticles);
      }
      // If none collected, fall through to general news
    }

    // General market news fallback or when no symbols provided
    const generalUrl = `${FINNHUB_BASE_URL}/news?category=general&token=${token}`;
    const general = await fetchJSON<RawNewsArticle[]>(generalUrl, 300);

    const seen = new Set<string>();
    const unique: RawNewsArticle[] = [];
    for (const art of general || []) {
      if (!validateArticle(art)) continue;
      const key = `${art.id}-${art.url}-${art.headline}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(art);
      if (unique.length >= 20) break; // cap early before final slicing
    }

    const formatted = unique.slice(0, maxArticles).map((a, idx) => formatArticle(a, false, undefined, idx));
    return formatted;
  } catch (err) {
    console.error('getNews error:', err);
    throw new Error('Failed to fetch news');
  }
}

export const searchStocks = cache(async (query?: string): Promise<StockWithWatchlistStatus[]> => {
  try {
    const token = process.env.FINNHUB_API_KEY ?? NEXT_PUBLIC_FINNHUB_API_KEY;
    if (!token) {
      // If no token, log and return empty to avoid throwing per requirements
      console.error('Error in stock search:', new Error('FINNHUB API key is not configured'));
      return [];
    }

    const trimmed = typeof query === 'string' ? query.trim() : '';

    let results: FinnhubSearchResult[] = [];

    if (!trimmed) {
      // Fetch top 10 popular symbols' profiles
      const top = POPULAR_STOCK_SYMBOLS.slice(0, 10);
      const profiles = await Promise.all(
        top.map(async (sym) => {
          try {
            const url = `${FINNHUB_BASE_URL}/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${token}`;
            // Revalidate every hour
            const profile = await fetchJSON<any>(url, 3600);
            return { sym, profile } as { sym: string; profile: any };
          } catch (e) {
            console.error('Error fetching profile2 for', sym, e);
            return { sym, profile: null } as { sym: string; profile: any };
          }
        })
      );

      results = profiles
        .map(({ sym, profile }) => {
          const symbol = sym.toUpperCase();
          const name: string | undefined = profile?.name || profile?.ticker || undefined;
          const exchange: string | undefined = profile?.exchange || undefined;
          if (!name) return undefined;
          const r: FinnhubSearchResult = {
            symbol,
            description: name,
            displaySymbol: symbol,
            type: 'Common Stock',
          };
          // We don't include exchange in FinnhubSearchResult type, so carry via mapping later using profile
          // To keep pipeline simple, attach exchange via closure map stage
          // We'll reconstruct exchange when mapping to final type
          (r as any).__exchange = exchange; // internal only
          return r;
        })
        .filter((x): x is FinnhubSearchResult => Boolean(x));
    } else {
      const url = `${FINNHUB_BASE_URL}/search?q=${encodeURIComponent(trimmed)}&token=${token}`;
      const data = await fetchJSON<FinnhubSearchResponse>(url, 1800);
      results = Array.isArray(data?.result) ? data.result : [];
    }

    const mapped: StockWithWatchlistStatus[] = results
      .map((r) => {
        const upper = (r.symbol || '').toUpperCase();
        const name = r.description || upper;
        const exchangeFromDisplay = (r.displaySymbol as string | undefined) || undefined;
        const exchangeFromProfile = (r as any).__exchange as string | undefined;
        const exchange = exchangeFromDisplay || exchangeFromProfile || 'US';
        const type = r.type || 'Stock';
        const item: StockWithWatchlistStatus = {
          symbol: upper,
          name,
          exchange,
          type,
          isInWatchlist: false,
        };
        return item;
      })
      .slice(0, 15);

    return mapped;
  } catch (err) {
    console.error('Error in stock search:', err);
    return [];
  }
});


export type StockProfile = {
  name: string;
  ticker: string;
  logo: string;
  country: string;
  currency: string;
  exchange: string;
  ipo: string;
  marketCap: number;
  shareOutstanding: number;
  weburl: string;
  phone: string;
  finnhubIndustry: string;
};

export type StockQuote = {
  c: number;   // current price
  d: number;   // change
  dp: number;  // change percent
  h: number;   // high
  l: number;   // low
  o: number;   // open
  pc: number;  // prev close
  t: number;   // timestamp
};


export async function getStockProfile(symbol: string): Promise<StockProfile | null> {
  try {
    const token = process.env.FINNHUB_API_KEY ?? NEXT_PUBLIC_FINNHUB_API_KEY;
    if (!token) return null;
    const url = `${FINNHUB_BASE_URL}/stock/profile2?symbol=${encodeURIComponent(symbol.toUpperCase())}&token=${token}`;
    const data = await fetchJSON<StockProfile>(url, 3600);
    return data ?? null;
  } catch {
    return null;
  }
}

export async function getStockQuote(symbol: string): Promise<StockQuote | null> {
  try {
    const token = process.env.FINNHUB_API_KEY ?? NEXT_PUBLIC_FINNHUB_API_KEY;
    if (!token) return null;
    const url = `${FINNHUB_BASE_URL}/quote?symbol=${encodeURIComponent(symbol.toUpperCase())}&token=${token}`;
    const data = await fetchJSON<StockQuote>(url, 30);
    return data ?? null;
  } catch {
    return null;
  }
}

export async function getStockMetrics(symbol: string): Promise<Record<string, number> | null> {
  try {
    const token = process.env.FINNHUB_API_KEY ?? NEXT_PUBLIC_FINNHUB_API_KEY;
    if (!token) return null;
    const url = `${FINNHUB_BASE_URL}/stock/metric?symbol=${encodeURIComponent(symbol.toUpperCase())}&metric=all&token=${token}`;
    const data = await fetchJSON<{ metric: Record<string, number> }>(url, 3600);
    return data?.metric ?? null;
  } catch {
    return null;
  }
}

// ─── Stock candles (daily OHLCV) ────────────────────────────────────────────

export type StockCandle = {
  date: string;
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
};

type FinnhubCandleResponse = {
  c: number[];
  h: number[];
  l: number[];
  o: number[];
  v: number[];
  t: number[];
  s: string;
};

export async function getStockCandles(
  symbol: string,
  days = 365,
): Promise<StockCandle[]> {
  // Use Alpaca Data API (IEX feed) — Finnhub candles blocked on free tier,
  // FMP historical-price-full blocked on legacy plan.
  try {
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (!apiKey || !apiSecret) {
      console.warn('[getStockCandles] No Alpaca credentials configured');
      return [];
    }

    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const url = `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol.toUpperCase())}/bars?timeframe=1Day&start=${start}&end=${end}&limit=1000&feed=iex`;

    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': apiSecret,
      },
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      console.warn('[getStockCandles] Alpaca error', res.status, await res.text().catch(() => ''));
      return [];
    }

    const data = await res.json() as { bars?: { c: number; o: number; h: number; l: number; v: number; t: string }[] };
    if (!data.bars?.length) return [];

    return data.bars.map((bar) => ({
      date: bar.t.slice(0, 10),
      close: bar.c,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      volume: bar.v,
    }));
  } catch (err) {
    console.error('[getStockCandles] Error:', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Batched daily candles for a LIST of symbols in ONE request. Used by the
 * thesis-card feed so a list of N cards is a single cached call, not N live
 * hits. Backed by Alpaca's multi-symbol bars endpoint
 * (`/v2/stocks/bars?symbols=…`), the sibling of the single-symbol endpoint
 * `getStockCandles` uses. Returns a map keyed by uppercased symbol; symbols
 * Alpaca returns no bars for are simply absent (caller degrades to the gauge).
 *
 * No pagination: the card window is short (≤~1 month) so even ~20 symbols
 * stay well under the 1000-bar page cap. The single-symbol path (sheet /
 * trade page, up to 1Y) keeps using `getStockCandles`.
 */
export async function getStockCandlesBatch(
  symbols: string[],
  days = 30,
): Promise<Record<string, StockCandle[]>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))].filter(Boolean);
  if (unique.length === 0) return {};
  try {
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (!apiKey || !apiSecret) {
      console.warn('[getStockCandlesBatch] No Alpaca credentials configured');
      return {};
    }

    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const url = `https://data.alpaca.markets/v2/stocks/bars?symbols=${encodeURIComponent(unique.join(','))}&timeframe=1Day&start=${start}&end=${end}&limit=1000&feed=iex`;

    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': apiSecret,
      },
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      console.warn('[getStockCandlesBatch] Alpaca error', res.status, await res.text().catch(() => ''));
      return {};
    }

    const data = (await res.json()) as {
      bars?: Record<string, { c: number; o: number; h: number; l: number; v: number; t: string }[]>;
    };
    if (!data.bars) return {};

    const out: Record<string, StockCandle[]> = {};
    for (const [sym, bars] of Object.entries(data.bars)) {
      out[sym] = bars.map((bar) => ({
        date: bar.t.slice(0, 10),
        close: bar.c,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        volume: bar.v,
      }));
    }
    return out;
  } catch (err) {
    console.error('[getStockCandlesBatch] Error:', err instanceof Error ? err.message : err);
    return {};
  }
}

/**
 * Intraday 5-minute candles for the MOST RECENT trading session — the data
 * behind the sheet chart's "1D" tab. Same Alpaca IEX feed / creds as the daily
 * `getStockCandles`, just `timeframe=5Min`. Queries a 7-day window so the tab is
 * never empty even across a long closure (a mid-week holiday + weekend can put
 * the last session >4 calendar days back): intraday it shows today so far,
 * outside hours it shows the prior full session. Only the bars from the latest
 * ET session date are returned.
 *
 * Unlike the daily fetchers, each candle's `date` carries the FULL ISO
 * timestamp (not a YYYY-MM-DD day) so the chart can render time-of-day labels.
 * IEX is slightly delayed / thinner than the consolidated tape — fine for a
 * paper-trading intraday direction read.
 */
export async function getIntradayCandles(symbol: string): Promise<StockCandle[]> {
  try {
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (!apiKey || !apiSecret) {
      console.warn('[getIntradayCandles] No Alpaca credentials configured');
      return [];
    }

    const end = new Date().toISOString();
    const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const url = `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol.toUpperCase())}/bars?timeframe=5Min&start=${start}&end=${end}&limit=10000&feed=iex`;

    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': apiSecret,
      },
      next: { revalidate: 30 },
    });

    if (!res.ok) {
      console.warn('[getIntradayCandles] Alpaca error', res.status, await res.text().catch(() => ''));
      return [];
    }

    const data = (await res.json()) as {
      bars?: { c: number; o: number; h: number; l: number; v: number; t: string }[];
    };
    if (!data.bars?.length) return [];

    // Keep only the latest ET session. Compute each bar's ET date ONCE
    // (Intl formatting isn't free, and this runs on a 30s poll); en-CA gives a
    // string-sortable YYYY-MM-DD.
    const etFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
    const stamped = data.bars.map((bar) => ({
      bar,
      etDate: etFmt.format(new Date(bar.t)),
    }));
    const latest = stamped.reduce((max, s) => (s.etDate > max ? s.etDate : max), '');

    return stamped
      .filter((s) => s.etDate === latest)
      .map(({ bar }) => ({
        date: bar.t, // full ISO timestamp — chart renders time-of-day for 1D
        close: bar.c,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        volume: bar.v,
      }));
  } catch (err) {
    console.error('[getIntradayCandles] Error:', err instanceof Error ? err.message : err);
    return [];
  }
}

// ─── Analyst recommendation trends ──────────────────────────────────────────

export type RecommendationTrend = {
  buy: number;
  hold: number;
  sell: number;
  strongBuy: number;
  strongSell: number;
  period: string;
};

export async function getRecommendationTrends(
  symbol: string,
): Promise<RecommendationTrend[] | null> {
  try {
    const token = process.env.FINNHUB_API_KEY ?? NEXT_PUBLIC_FINNHUB_API_KEY;
    if (!token) return null;
    const url = `${FINNHUB_BASE_URL}/stock/recommendation?symbol=${encodeURIComponent(symbol.toUpperCase())}&token=${token}`;
    const data = await fetchJSON<RecommendationTrend[]>(url, 3600);
    return Array.isArray(data) && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}
