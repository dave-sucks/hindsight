'use server';

import { POPULAR_STOCK_SYMBOLS } from '@/lib/constants';
import { getLiveQuote } from '@/lib/market-data/live-quote';
import { MARKET_DATA_FEED } from '@/lib/alpaca';
import { INTRADAY_WINDOW_ET, etDateOf, etInstant, etMinutesOf } from '@/lib/market-data/intraday-window';
import { isTradingDay } from '@/lib/market-hours';
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

async function fetchJSON<T>(
  url: string,
  revalidateSeconds?: number,
  timeoutMs?: number,
): Promise<T> {
  const options: RequestInit & { next?: { revalidate?: number } } = revalidateSeconds
    ? { cache: 'force-cache', next: { revalidate: revalidateSeconds } }
    : { cache: 'no-store' };
  if (timeoutMs) options.signal = AbortSignal.timeout(timeoutMs);

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

// ── Live-quote cache ────────────────────────────────────────────────────────
// A quote must NEVER go in the Next.js Data Cache. That cache is
// stale-while-revalidate AND persists across invocations and deploys on
// Vercel, so its staleness is bounded by how often a surface is hit, not by
// the `revalidate` value. `getStockQuote` used `force-cache` + `revalidate:30`
// and on 2026-08-14 served the *prior session's close* ($337.38 +1.54%) on a
// sheet opened at 11:38 AM ET while SNOW was live at $329.43 −2.36%.
//
// The defect was the STORE, not caching as such. This module-level map is the
// right shape: per-instance, seconds-long, dropped on cold start — it damps
// bursts without any way to survive to the next morning. It also collapses
// concurrent callers for the same symbol (the in-flight map), which matters
// because `/api/quotes` is hit by every open tab and quote row, and the two
// `Promise.all` fan-outs over `getStockQuote` (lib/alpaca.ts, complete-run.ts)
// are unthrottled. Keep this TTL in SECONDS. See CLAUDE.md → recurring bugs.
//
// Since 2026-09-29 the price behind it is Alpaca's, with Finnhub `/quote` as
// the fallback. The name and the shape stay so every reader moved at once.
const QUOTE_TTL_MS = 10_000;
const QUOTE_TIMEOUT_MS = 8_000;
const quoteCache = new Map<string, { quote: StockQuote | null; ts: number }>();
const quoteInFlight = new Map<string, Promise<StockQuote | null>>();

export async function getStockQuote(symbol: string): Promise<StockQuote | null> {
  const key = symbol.toUpperCase();

  const hit = quoteCache.get(key);
  if (hit && Date.now() - hit.ts < QUOTE_TTL_MS) return hit.quote;

  // Coalesce concurrent callers for the same symbol onto one request.
  const pending = quoteInFlight.get(key);
  if (pending) return pending;

  const task = (async (): Promise<StockQuote | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Alpaca's tape first, Finnhub `/quote` behind it — both `no-store`
      // (lib/market-data/live-quote). Pages and write prices yield to the
      // trigger check when a vendor's minute runs low. The timeout is
      // required, not cosmetic: callers are coalesced onto this one promise,
      // so a hung request without it would stall every waiter for the symbol.
      const { quote: live } = await Promise.race([
        getLiveQuote(key, { caller: "other" }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("quote timeout")), QUOTE_TIMEOUT_MS);
        }),
      ]);
      // Don't cache a miss — the next caller should retry rather than be
      // pinned to a null for the whole TTL.
      if (!live) return null;
      // This legacy shape has no "unknown": an absent figure is 0, as Finnhub sends it.
      const quote: StockQuote = {
        c: live.c,
        d: live.d ?? 0,
        dp: live.dp ?? 0,
        h: live.h ?? 0,
        l: live.l ?? 0,
        o: live.o ?? 0,
        pc: live.pc ?? 0,
        t: live.t,
      };
      quoteCache.set(key, { quote, ts: Date.now() });
      return quote;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      quoteInFlight.delete(key);
    }
  })();

  quoteInFlight.set(key, task);
  return task;
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
  // Alpaca daily bars on the feed the app reads (lib/alpaca.ts
  // MARKET_DATA_FEED) — Finnhub candles are paid-only, FMP is gone.
  try {
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (!apiKey || !apiSecret) {
      console.warn('[getStockCandles] No Alpaca credentials configured');
      return [];
    }

    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    // adjustment=split back-adjusts historical bars for stock splits, matching
    // the price line every other source shows (Finnhub, Perplexity, Yahoo).
    // Without it Alpaca defaults to `raw`, so a split renders as a phantom
    // plateau→cliff→plateau (e.g. a 3:1 split shows pre-split bars ~3x higher).
    // `split` (not `all`) keeps dividend-unadjusted prices so non-splitting
    // dividend payers stay pixel-identical to those same sources.
    const url = `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol.toUpperCase())}/bars?timeframe=1Day&start=${start}&end=${end}&limit=1000&adjustment=split&feed=${MARKET_DATA_FEED}`;

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
    // adjustment=split — see getStockCandles: back-adjust for splits so the
    // chart matches Finnhub/Perplexity and a split doesn't show as a cliff.
    const url = `https://data.alpaca.markets/v2/stocks/bars?symbols=${encodeURIComponent(unique.join(','))}&timeframe=1Day&start=${start}&end=${end}&limit=1000&adjustment=split&feed=${MARKET_DATA_FEED}`;

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
 * Intraday 1-minute candles for the MOST RECENT trading session — the data
 * behind the sheet chart's "1D" tab. Each candle's `date` carries the FULL ISO
 * (UTC) timestamp (not a YYYY-MM-DD day) so the chart can render time-of-day.
 *
 * Source: Alpaca's consolidated tape (MARKET_DATA_FEED), pre-market and
 * after-hours included — for display. What the agents and triggers act on is
 * decided elsewhere (lib/market-data/live-quote: regular hours only). Until
 * 2026-09-29 this read the free IEX feed: one exchange, ~2–3% of volume,
 * missing minutes on a mid-cap (SMMT 2026-09-29: 384 of 391 session bars, a
 * high of $19.07 against the tape's $19.09) and no off-hours prints at all.
 *
 * The line always runs from the window's left edge to now: where the day has
 * no minute bars, the tape's round-lot trades stand in (see below), and the
 * left edge starts from the last round-lot price before the window opened.
 *
 * 2026-08-19 (DAV-191) — this used to try FMP `/api/v3/historical-chart/1min`
 * first. FMP retired the whole /api/v3 namespace on 2025-08-31; the call
 * returned 403 on EVERY 30s poll of the most-polled surface in the app
 * before falling through to here. Removed.
 */
export async function getIntradayCandles(symbol: string, now: Date = new Date()): Promise<StockCandle[]> {
  return getIntradayCandlesAlpaca(symbol, now);
}

type AlpacaTrade = { t: string; p: number; s: number };

/**
 * A trade under 100 shares is an odd lot. The consolidated tape leaves odd
 * lots out of the last sale and the day's high and low, which is why a
 * minute holding only odd lots never becomes a bar — so the chart leaves
 * them out too. DOCU 2026-09-30, 8:49 AM: five shares at $65.48 drew a 2%
 * pre-market drop the market never counted.
 */
const ROUND_LOT = 100;
const roundLots = (trades: AlpacaTrade[]) => trades.filter((t) => t.s >= ROUND_LOT);

/** Every trade on the tape between two instants, any size, oldest first. A few pages at most. */
async function getTradesBetween(
  symbol: string,
  headers: Record<string, string>,
  start: string,
  end: string,
  opts: { sort?: 'asc' | 'desc'; limit?: number; pages?: number } = {},
): Promise<AlpacaTrade[]> {
  const out: AlpacaTrade[] = [];
  let token: string | undefined;
  for (let page = 0; page < (opts.pages ?? 3); page++) {
    const url =
      `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/trades?start=${start}&end=${end}` +
      `&feed=${MARKET_DATA_FEED}&limit=${opts.limit ?? 10000}&sort=${opts.sort ?? 'asc'}${token ? `&page_token=${token}` : ''}`;
    const res = await fetch(url, { headers, cache: 'no-store' });
    if (!res.ok) {
      console.warn('[getIntradayCandles] Alpaca trades error', res.status, await res.text().catch(() => ''));
      break;
    }
    const body = (await res.json()) as { trades?: AlpacaTrade[]; next_page_token?: string | null };
    out.push(...(body.trades ?? []));
    token = body.next_page_token ?? undefined;
    if (!token) break;
  }
  return out;
}

/** Trades folded into one point per minute: first, high, low, last, shares. */
function minutePoints(trades: AlpacaTrade[]): StockCandle[] {
  const byMinute = new Map<string, StockCandle>();
  for (const t of trades) {
    const minute = `${t.t.slice(0, 16)}:00Z`;
    const have = byMinute.get(minute);
    if (!have) byMinute.set(minute, { date: minute, open: t.p, high: t.p, low: t.p, close: t.p, volume: t.s });
    else {
      have.high = Math.max(have.high, t.p);
      have.low = Math.min(have.low, t.p);
      have.close = t.p;
      have.volume += t.s;
    }
  }
  return Array.from(byMinute.values());
}

async function getIntradayCandlesAlpaca(symbol: string, now: Date): Promise<StockCandle[]> {
  try {
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (!apiKey || !apiSecret) {
      console.warn('[getIntradayCandles] No Alpaca credentials configured');
      return [];
    }
    const headers = { 'APCA-API-KEY-ID': apiKey, 'APCA-API-SECRET-KEY': apiSecret };
    const S = symbol.toUpperCase();

    const end = now.toISOString();
    const start = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();
    const url = `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(S)}/bars?timeframe=1Min&start=${start}&end=${end}&limit=10000&feed=${MARKET_DATA_FEED}`;

    const res = await fetch(url, {
      headers,
      // Current-session bars are live price data — no Data Cache. The chart
      // polls this every 30s, and a 30s `revalidate` meant every poll sat
      // exactly on the staleness boundary, so the tab rendered one cycle
      // behind rather than live. Poll rate (and upstream volume) is unchanged.
      cache: 'no-store',
    });

    if (!res.ok) {
      console.warn('[getIntradayCandles] Alpaca error', res.status, await res.text().catch(() => ''));
      return [];
    }

    const data = (await res.json()) as {
      bars?: { c: number; o: number; h: number; l: number; v: number; t: string }[];
    };
    const stamped = (data.bars ?? []).map((bar) => ({ bar, etDate: etDateOf(bar.t), etMinutes: etMinutesOf(bar.t) }));

    // Which day the chart shows. On a trading day, once the window opens at
    // 7:00 AM ET, it is today — even before a single trade — so the morning
    // reads as today against yesterday's close. Otherwise the latest day with
    // bars (Friday on a weekend).
    const todayEt = etDateOf(now);
    const showToday = isTradingDay(now) && etMinutesOf(now) >= INTRADAY_WINDOW_ET.start;
    const latest = showToday ? todayEt : stamped.reduce((max, s) => (s.etDate > max ? s.etDate : max), '');
    if (!latest) return [];
    const windowStart = etInstant(latest, INTRADAY_WINDOW_ET.start);
    const windowEnd = etInstant(latest, INTRADAY_WINDOW_ET.end);
    // The line runs to the right edge of what has happened: now, or the
    // window's end for a finished day.
    const lineEnd = new Date(Math.min(now.getTime(), windowEnd.getTime()));

    // The day's one-minute bars inside the window (7:00 AM to 6:30 PM ET).
    // The tape's 4:00 AM and 8:00 PM prints stay out: the chart sizes its
    // scale from every point it is given.
    const points: StockCandle[] = stamped
      .filter((s) => s.etDate === latest && s.etMinutes >= INTRADAY_WINDOW_ET.start && s.etMinutes <= INTRADAY_WINDOW_ET.end)
      .map(({ bar }) => ({ date: bar.t, close: bar.c, open: bar.o, high: bar.h, low: bar.l, volume: bar.v }));

    // Any line is better than no line. A minute bar needs a trade of 100
    // shares or more, so a quiet pre-market — DOCU on 2026-09-30: eleven
    // trades, 110 shares, no bar until 9:30 — drew nothing. Where the day
    // has no bars yet (before the first, after the last), the tape's
    // round-lot trades stand in, one point per minute, so the line always
    // runs from the window's left edge; a stretch with only odd lots (DOCU
    // that morning) adds nothing and the line holds flat. Only those
    // stretches are read: by construction they hold few trades.
    const firstBar = points.length ? new Date(points[0].date) : null;
    const lastBar = points.length ? new Date(points[points.length - 1].date) : null;
    const stretches: [Date, Date][] = [];
    if (!firstBar) stretches.push([windowStart, lineEnd]);
    else {
      if (firstBar > windowStart) stretches.push([windowStart, firstBar]);
      const afterLast = new Date(lastBar!.getTime() + 60_000);
      if (afterLast < lineEnd) stretches.push([afterLast, lineEnd]);
    }
    for (const [from, to] of stretches) {
      if (to <= from) continue;
      const trades = await getTradesBetween(S, headers, from.toISOString(), to.toISOString());
      points.push(...minutePoints(roundLots(trades)));
    }
    points.sort((a, b) => a.date.localeCompare(b.date));

    // Where the line starts: the last round-lot price before the window
    // opened — last night's last real trade, or yesterday's close — so the
    // left edge is never blank. One page of the newest trades, newest first,
    // reaches back past the overnight odd lots to the session's closing
    // prints (DOCU 09-30: fifteen odd lots, then 18,999 shares at the close).
    // Skipped when the first minute already has a point.
    if (!points.length || new Date(points[0].date) > windowStart) {
      const prior = await getTradesBetween(
        S,
        headers,
        new Date(windowStart.getTime() - 7 * 86_400_000).toISOString(),
        windowStart.toISOString(),
        { sort: 'desc', limit: 1000, pages: 1 },
      );
      const p = roundLots(prior)[0]?.p;
      if (typeof p === 'number' && p > 0) {
        points.unshift({ date: windowStart.toISOString(), open: p, high: p, low: p, close: p, volume: 0 });
      }
    }
    // And it reaches now while the window is open: a quiet stretch carries
    // the last price forward.
    if (showToday && now < windowEnd && points.length) {
      const last = points[points.length - 1];
      if (lineEnd.getTime() - new Date(last.date).getTime() > 60_000) {
        points.push({ date: lineEnd.toISOString(), open: last.close, high: last.close, low: last.close, close: last.close, volume: 0 });
      }
    }
    return points;
  } catch (err) {
    console.error('[getIntradayCandles] Alpaca error:', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Hourly candles over the last ~month — powers the sheet chart's 1W and 1M
 * tabs. Daily candles make 1W ~3 dots and 1M ~22; hourly makes them read like
 * a real finance chart (Perplexity uses intraday bars for its short ranges
 * too). Consolidated tape (MARKET_DATA_FEED) since 2026-09-29, regular hours
 * only — an hourly bar per off-hours hour would add nine thin points a day to
 * a range meant to read at a glance.
 *
 * `timeframe` — hourly bars for 1M; 15-minute bars for 1W (2026-09-30), so a
 * week reads as ~130 points rather than ~35.
 *
 * `date` carries the FULL ISO timestamp so the chart keys each hour uniquely;
 * the categorical axis then collapses overnight/weekend gaps (no flat spans),
 * matching Perplexity. adjustment=split so a split doesn't render as a cliff.
 */
export type IntradayTimeframe = '1Hour' | '15Min';

export async function getHourlyCandles(
  symbol: string,
  days = 31,
  timeframe: IntradayTimeframe = '1Hour',
): Promise<StockCandle[]> {
  try {
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (!apiKey || !apiSecret) {
      console.warn('[getHourlyCandles] No Alpaca credentials configured');
      return [];
    }

    const end = new Date().toISOString();
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const url = `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol.toUpperCase())}/bars?timeframe=${timeframe}&start=${start}&end=${end}&limit=10000&adjustment=split&feed=${MARKET_DATA_FEED}`;

    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': apiSecret,
      },
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      console.warn('[getHourlyCandles] Alpaca error', res.status, await res.text().catch(() => ''));
      return [];
    }

    const data = (await res.json()) as {
      bars?: { c: number; o: number; h: number; l: number; v: number; t: string }[];
    };
    if (!data.bars?.length) return [];

    // Regular-hours bars only (9:00–16:00 ET = minutes 540–960); the loose
    // lower bound keeps the opening bar whatever the hour alignment.
    const timeFmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/New_York',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
    return data.bars
      .filter((bar) => {
        const [hh, mm] = timeFmt.format(new Date(bar.t)).split(':').map(Number);
        const etMinutes = hh * 60 + mm;
        return etMinutes >= 540 && etMinutes <= 960;
      })
      .map((bar) => ({
        date: bar.t, // full ISO timestamp — unique per hour, collapses gaps
        close: bar.c,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        volume: bar.v,
      }));
  } catch (err) {
    console.error('[getHourlyCandles] Error:', err instanceof Error ? err.message : err);
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
