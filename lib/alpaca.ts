/**
 * Alpaca Paper Trading Client
 * Wraps @alpacahq/alpaca-trade-api with full TypeScript types.
 * All operations target paper-api.alpaca.markets (fake money, real prices).
 */

import AlpacaAPI from "@alpacahq/alpaca-trade-api";

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Client singleton ─────────────────────────────────────────────────────────

function createClient(): AlpacaAPI {
  return new AlpacaAPI({
    keyId: process.env.ALPACA_API_KEY!,
    secretKey: process.env.ALPACA_API_SECRET!,
    baseUrl: process.env.ALPACA_BASE_URL!, // https://paper-api.alpaca.markets
    paper: true,
  });
}

// Lazy singleton — safe for serverless (each invocation creates one)
let _client: AlpacaAPI | null = null;
function getClient(): AlpacaAPI {
  if (!_client) _client = createClient();
  return _client;
}

// ─── Account ──────────────────────────────────────────────────────────────────

export async function getAccount(): Promise<AlpacaAccount> {
  return (await getClient().getAccount()) as AlpacaAccount;
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export async function placeMarketOrder(
  params: OrderParams
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

  return (await getClient().createOrder(order)) as AlpacaOrder;
}

export async function placeLimitOrder(
  params: LimitOrderParams
): Promise<AlpacaOrder> {
  return (await getClient().createOrder({
    symbol: params.symbol,
    qty: params.qty,
    side: params.side,
    type: "limit",
    time_in_force: "gtc",
    limit_price: params.limitPrice,
  })) as AlpacaOrder;
}

export async function getOrder(orderId: string): Promise<AlpacaOrder> {
  return (await getClient().getOrder(orderId)) as AlpacaOrder;
}

// ─── Positions ────────────────────────────────────────────────────────────────

export async function getPosition(
  symbol: string
): Promise<AlpacaPosition | null> {
  try {
    return (await getClient().getPosition(symbol)) as AlpacaPosition;
  } catch (err: unknown) {
    // Alpaca returns 404 when no position exists
    const e = err as { statusCode?: number };
    if (e?.statusCode === 404) return null;
    throw err;
  }
}

export async function getAllPositions(): Promise<AlpacaPosition[]> {
  return (await getClient().getPositions()) as AlpacaPosition[];
}

export async function closePosition(symbol: string): Promise<AlpacaOrder> {
  return (await getClient().closePosition(symbol)) as AlpacaOrder;
}

// ─── Market data ──────────────────────────────────────────────────────────────

/**
 * Returns the latest trade price for a US equity symbol.
 * Uses Alpaca Data API v2 — real-time during market hours, last close after.
 */
export async function getLatestPrice(symbol: string): Promise<number> {
  const trade = await getClient().getLatestTrade(symbol);
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
  symbols: string[]
): Promise<Record<string, number>> {
  const trades = await getClient().getLatestTrades(symbols);
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
): Promise<{ close: number; volume: number }[]> {
  const bars: { close: number; volume: number }[] = [];

  const barIterator = getClient().getBarsV2(symbol, {
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
}
