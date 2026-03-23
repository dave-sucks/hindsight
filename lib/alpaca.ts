/**
 * Alpaca Paper Trading Client
 * Wraps @alpacahq/alpaca-trade-api with full TypeScript types.
 *
 * Supports two credential modes:
 * 1. Per-user credentials (AlpacaCredentials passed explicitly)
 * 2. Env-var fallback (ALPACA_API_KEY / ALPACA_API_SECRET / ALPACA_BASE_URL)
 *
 * All exported functions accept an optional `creds` parameter.
 * When omitted, falls back to env vars (backward-compatible).
 */

import AlpacaAPI from "@alpacahq/alpaca-trade-api";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AlpacaCredentials {
  keyId: string;
  secretKey: string;
  baseUrl?: string; // defaults to paper-api.alpaca.markets
}

export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  cash: string;
  portfolio_value: string;
  equity: string;
  buying_power: string;
  shorting_enabled: boolean;
  trade_suspended_by_user: boolean;
  trading_blocked: boolean;
  pattern_day_trader: boolean;
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  symbol: string;
  qty: string;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop" | "stop_limit";
  status: string;
  filled_qty: string;
  filled_avg_price: string | null;
  limit_price: string | null;
  stop_price: string | null;
  created_at: string;
  filled_at: string | null;
}

export interface AlpacaPosition {
  symbol: string;
  qty: string;
  side: "long" | "short";
  avg_entry_price: string;
  current_price: string;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  cost_basis: string;
}

export interface OrderParams {
  symbol: string;
  qty: number;
  side: "buy" | "sell";
  notional?: number; // dollar amount instead of qty
}

export interface LimitOrderParams extends OrderParams {
  limitPrice: number;
}

// ─── Client factory ──────────────────────────────────────────────────────────

const PAPER_BASE_URL = "https://paper-api.alpaca.markets";

function createClient(creds?: AlpacaCredentials): AlpacaAPI {
  if (creds) {
    return new AlpacaAPI({
      keyId: creds.keyId,
      secretKey: creds.secretKey,
      baseUrl: creds.baseUrl || PAPER_BASE_URL,
      paper: true,
    });
  }
  // Env-var fallback (backward-compatible for crons / single-user)
  return new AlpacaAPI({
    keyId: process.env.ALPACA_API_KEY!,
    secretKey: process.env.ALPACA_API_SECRET!,
    baseUrl: process.env.ALPACA_BASE_URL || PAPER_BASE_URL,
    paper: true,
  });
}

// Lazy singleton for env-var mode only — safe for serverless
let _envClient: AlpacaAPI | null = null;

function getClient(creds?: AlpacaCredentials): AlpacaAPI {
  if (creds) return createClient(creds);
  if (!_envClient) _envClient = createClient();
  return _envClient;
}

// ─── Account ──────────────────────────────────────────────────────────────────

export async function getAccount(creds?: AlpacaCredentials): Promise<AlpacaAccount> {
  return (await getClient(creds).getAccount()) as AlpacaAccount;
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export async function placeMarketOrder(
  params: OrderParams,
  creds?: AlpacaCredentials,
): Promise<AlpacaOrder> {
  const order: Record<string, unknown> = {
    symbol: params.symbol,
    side: params.side,
    type: "market",
    time_in_force: "day",
  };

  if (params.notional !== undefined) {
    order.notional = params.notional.toFixed(2);
  } else {
    order.qty = params.qty;
  }

  return (await withTimeout(getClient(creds).createOrder(order), `placeMarketOrder(${params.symbol})`)) as AlpacaOrder;
}

export async function placeLimitOrder(
  params: LimitOrderParams,
  creds?: AlpacaCredentials,
): Promise<AlpacaOrder> {
  return (await getClient(creds).createOrder({
    symbol: params.symbol,
    qty: params.qty,
    side: params.side,
    type: "limit",
    time_in_force: "gtc",
    limit_price: params.limitPrice,
  })) as AlpacaOrder;
}

export async function getOrder(orderId: string, creds?: AlpacaCredentials): Promise<AlpacaOrder> {
  return (await withTimeout(getClient(creds).getOrder(orderId), `getOrder(${orderId.slice(0, 8)})`)) as AlpacaOrder;
}

// ─── Positions ────────────────────────────────────────────────────────────────

export async function getPosition(
  symbol: string,
  creds?: AlpacaCredentials,
): Promise<AlpacaPosition | null> {
  try {
    return (await getClient(creds).getPosition(symbol)) as AlpacaPosition;
  } catch (err: unknown) {
    // Alpaca returns 404 when no position exists
    const e = err as { statusCode?: number };
    if (e?.statusCode === 404) return null;
    throw err;
  }
}

export async function getAllPositions(creds?: AlpacaCredentials): Promise<AlpacaPosition[]> {
  return (await getClient(creds).getPositions()) as AlpacaPosition[];
}

export async function closePosition(symbol: string, creds?: AlpacaCredentials): Promise<AlpacaOrder> {
  return (await getClient(creds).closePosition(symbol)) as AlpacaOrder;
}

export async function cancelOrder(orderId: string, creds?: AlpacaCredentials): Promise<void> {
  await getClient(creds).cancelOrder(orderId);
}

export async function getOpenOrders(creds?: AlpacaCredentials): Promise<AlpacaOrder[]> {
  return (await getClient(creds).getOrders({ status: "open" })) as AlpacaOrder[];
}

// ─── Timeout helper (Alpaca SDK doesn't support AbortSignal) ─────────────────

const ALPACA_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Alpaca ${label} TIMEOUT after ${ALPACA_TIMEOUT_MS}ms`)), ALPACA_TIMEOUT_MS)
    ),
  ]);
}

// ─── Market data ──────────────────────────────────────────────────────────────

/**
 * Returns the latest trade price for a US equity symbol.
 * Uses Alpaca Data API v2 — real-time during market hours, last close after.
 */
export async function getLatestPrice(symbol: string, creds?: AlpacaCredentials): Promise<number> {
  const trade = await withTimeout(getClient(creds).getLatestTrade(symbol), `getLatestPrice(${symbol})`);
  // SDK v3 returns PascalCase fields: { Price, Size, Timestamp, ... }
  const t = trade as { Price?: number; p?: number };
  const price = t.Price ?? t.p;
  if (price === undefined) {
    throw new Error(`No price available for ${symbol}`);
  }
  return price;
}

/**
 * Returns latest prices for multiple symbols in one call.
 */
export async function getLatestPrices(
  symbols: string[],
  creds?: AlpacaCredentials,
): Promise<Record<string, number>> {
  const trades = await withTimeout(getClient(creds).getLatestTrades(symbols), `getLatestPrices(${symbols.length} symbols)`);
  const result: Record<string, number> = {};
  (trades as Map<string, { Price?: number; p?: number }>).forEach(
    (trade, symbol) => {
      const price = trade.Price ?? trade.p;
      if (price !== undefined) result[symbol] = price;
    }
  );
  return result;
}

// ─── Historical bars ─────────────────────────────────────────────────────────

/**
 * Returns daily bars for a symbol using Alpaca Data API v2.
 * Useful as a fallback when Finnhub/FMP lack candle data (micro-caps, ADRs).
 */
export async function getBars(
  symbol: string,
  options: { start: string; end: string; timeframe?: string; limit?: number },
  creds?: AlpacaCredentials,
): Promise<{ close: number; volume: number }[]> {
  const bars: { close: number; volume: number }[] = [];

  // Wrap entire iteration in a timeout since Alpaca SDK async iterators can hang
  const collectBars = async () => {
    const barIterator = getClient(creds).getBarsV2(symbol, {
      start: options.start,
      end: options.end,
      timeframe: options.timeframe || "1Day",
      limit: options.limit || 90,
    });

    for await (const bar of barIterator) {
      const b = bar as { ClosePrice?: number; c?: number; Volume?: number; v?: number };
      const close = b.ClosePrice ?? b.c;
      const volume = b.Volume ?? b.v;
      if (close !== undefined) {
        bars.push({ close, volume: volume ?? 0 });
      }
    }
    return bars;
  };

  return withTimeout(collectBars(), `getBars(${symbol})`);
}
