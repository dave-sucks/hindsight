// ── Alpaca Market Data Screener ─────────────────────────────────────────────
// Free on any Alpaca account (paper or live). Replaces the old FMP
// /stock_market/{gainers,losers,actives} calls that were paywalled/broken.
//
// Auth: same ALPACA_API_KEY / ALPACA_API_SECRET env vars already used by
// lib/alpaca.ts for paper trading — no new keys to configure.

const BASE_URL = "https://data.alpaca.markets";

export interface AlpacaMover {
  symbol: string;
  percent_change: number;
  change: number;
  price: number;
}

interface MoversResponse {
  gainers: AlpacaMover[];
  losers: AlpacaMover[];
  market_type: string;
  last_updated: string;
}

function authHeaders(): Record<string, string> {
  const keyId = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_API_SECRET;
  if (!keyId || !secret) {
    throw new Error(
      "ALPACA_API_KEY / ALPACA_API_SECRET not set — required for screener",
    );
  }
  return {
    "APCA-API-KEY-ID": keyId,
    "APCA-API-SECRET-KEY": secret,
  };
}

/**
 * Fetch top N gainers and losers in a single call.
 * Returns Alpaca's native response shape. Throws on HTTP error with body detail
 * so firm-market-sweep can surface it in the Inngest step output.
 */
export async function fetchMovers(top = 10): Promise<MoversResponse> {
  const url = `${BASE_URL}/v1beta1/screener/stocks/movers?top=${top}`;
  const res = await fetch(url, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Alpaca /screener/stocks/movers → HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
  }
  return (await res.json()) as MoversResponse;
}
