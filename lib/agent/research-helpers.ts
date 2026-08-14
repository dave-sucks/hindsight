/**
 * Shared research helpers — Finnhub API client + technical indicators.
 *
 * Used by both the main agent tools (lib/agent/tools.ts) and the
 * run-followup chat (api/chat/run-followup/route.ts) to avoid duplication.
 */

const FINNHUB_KEY = process.env.FINNHUB_API_KEY!;
const API_TIMEOUT_MS = 10_000;

// ── 5-minute in-memory cache ────────────────────────────────────────────────

const finnhubCache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

// Live quotes get their own (much shorter) TTL and skip the Next.js Data
// Cache entirely — see `isLiveQuote` below. 30s is short enough that a
// trigger evaluating a stop is never acting on a materially old price, but
// long enough to absorb the per-tick burst (the trigger evaluator fans out
// over up to 200 tickers) without tripping Finnhub's 60/min limit.
const QUOTE_CACHE_TTL = 30 * 1000;

/**
 * A price that must reflect the market RIGHT NOW, not "recently".
 *
 * Quotes must never enter the Next.js Data Cache. That cache is
 * stale-while-revalidate and persists across invocations and deploys on
 * Vercel, so the first read after any idle gap is served an arbitrarily old
 * value — the previous session's close after an overnight gap. For the
 * trigger evaluator that means the first evaluation after a quiet period can
 * score GAIN_FROM_ENTRY / TRAILING_FROM_HIGH against yesterday's price, which
 * is precisely when a gap move makes a protective stop matter most.
 * Slow-moving endpoints (profile, metrics, financials) keep the normal cache.
 */
function isLiveQuote(path: string): boolean {
  return path.startsWith("/quote");
}

// ── Soft concurrency limit (60/min Finnhub rate limit) ──────────────────────

let finnhubInFlight = 0;
const FINNHUB_MAX_CONCURRENT = 5;

async function finnhubThrottle(): Promise<void> {
  while (finnhubInFlight >= FINNHUB_MAX_CONCURRENT) {
    await new Promise(r => setTimeout(r, 100));
  }
  finnhubInFlight++;
}

function finnhubRelease(): void {
  finnhubInFlight--;
}

// ── API call stats (optional — pass defaultStats if you don't need tracking) ─

export interface ApiCallStats {
  finnhub: number;
  fmp: number;
  errors: number;
}

export const defaultStats: ApiCallStats = { finnhub: 0, fmp: 0, errors: 0 };

// ── Finnhub fetch with cache, throttle, retries ─────────────────────────────

export async function finnhub(
  path: string,
  retries = 2,
  stats: ApiCallStats = defaultStats,
): Promise<{ data: unknown; error?: string }> {
  // Check cache first. Live quotes use the short TTL; everything else keeps
  // the 5-minute one.
  const liveQuote = isLiveQuote(path);
  const ttl = liveQuote ? QUOTE_CACHE_TTL : CACHE_TTL;
  const cached = finnhubCache.get(path);
  if (cached && Date.now() - cached.ts < ttl) {
    return { data: cached.data };
  }

  const url = `https://finnhub.io/api/v1${path}${path.includes("?") ? "&" : "?"}token=${FINNHUB_KEY}`;
  const endpoint = path.split("?")[0];
  stats.finnhub++;

  await finnhubThrottle();
  try {
    let t0 = Date.now();
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        t0 = Date.now();
        const res = await fetch(url, {
          // Quotes bypass the Data Cache outright; slower endpoints keep it.
          ...(liveQuote
            ? { cache: "no-store" as const }
            : { next: { revalidate: 300 } }),
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        });
        const elapsed = Date.now() - t0;
        if (res.status === 429) {
          if (attempt < retries) {
            console.warn(`[finnhub] 429 on ${endpoint}, retry ${attempt + 1}/${retries} after 1s`);
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          stats.errors++;
          const msg = `Finnhub ${endpoint} rate limited (429) after ${retries} retries`;
          console.warn(`[finnhub] ${msg}`);
          return { data: null, error: msg };
        }
        if (!res.ok) {
          stats.errors++;
          const msg = `Finnhub ${endpoint} returned ${res.status} (${elapsed}ms)`;
          console.warn(`[finnhub] ${msg}`);
          return { data: null, error: msg };
        }
        if (elapsed > 3000) {
          console.warn(`[finnhub] SLOW ${endpoint} took ${elapsed}ms`);
        }
        const json = await res.json();
        finnhubCache.set(path, { data: json, ts: Date.now() });
        return { data: json };
      } catch (err) {
        if (attempt < retries) {
          console.warn(`[finnhub] ${endpoint} fetch error, retry ${attempt + 1}/${retries}`);
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        stats.errors++;
        const elapsed = Date.now() - t0;
        const isTimeout = err instanceof Error && err.name === "TimeoutError";
        const msg = isTimeout
          ? `Finnhub ${endpoint} TIMEOUT after ${elapsed}ms`
          : `Finnhub ${endpoint} fetch failed (${elapsed}ms): ${err instanceof Error ? err.message : "unknown"}`;
        console.error(`[finnhub] ${msg}`);
        return { data: null, error: msg };
      }
    }
    return { data: null, error: `Finnhub ${endpoint} exhausted retries` };
  } finally {
    finnhubRelease();
  }
}

// ── Quote freshness ─────────────────────────────────────────────────────────

/**
 * Age of a Finnhub quote in milliseconds, from its `t` field (unix seconds),
 * or null when the payload carries no usable timestamp.
 *
 * Every Finnhub /quote response has carried `t` all along and nothing read it,
 * which is why the 2026-08-14 stale-price bug was invisible for weeks: a
 * day-old quote is structurally identical to a live one. Callers on the
 * trading path should log (or refuse to act on) an implausible age rather
 * than silently scoring triggers against it.
 */
export function quoteAgeMs(
  quote: { t?: unknown } | null | undefined,
  now = Date.now(),
): number | null {
  const t = quote?.t;
  if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) return null;
  return now - t * 1000;
}

/** Quotes older than this during market hours mean something is wrong. */
export const STALE_QUOTE_THRESHOLD_MS = 15 * 60 * 1000;

// ── Technical indicator calculations ────────────────────────────────────────

export function calcRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 10) / 10;
}

export function calcSMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return Math.round((slice.reduce((a, b) => a + b, 0) / period) * 100) / 100;
}
