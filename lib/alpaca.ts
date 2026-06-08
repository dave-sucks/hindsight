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
import type { FundingEvent } from "@/lib/portfolio/contributions";

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
  /** Previous trading day's closing equity. `equity − last_equity` is the
   *  day's change (net of any same-day deposit) — drives "Day's P&L". */
  last_equity?: string;
  buying_power: string;
  /** Long side market value. Present on margin/paper accounts; may be absent on cash accounts. */
  long_market_value?: string;
  /** Short side market value — NEGATIVE number (positions you're short on). Present when shorting is enabled. */
  short_market_value?: string;
  /** Regulation-T buying power. Usually equals buying_power on margin accounts. */
  regt_buying_power?: string;
  /** Initial margin required for current positions. */
  initial_margin?: string;
  /** Maintenance margin — how much equity must remain to avoid a margin call. */
  maintenance_margin?: string;
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
  qty?: number;
  side: "buy" | "sell";
  notional?: number; // dollar amount instead of qty
  /**
   * Optional idempotency token. Forwarded to Alpaca as `client_order_id`,
   * which Alpaca uses to dedupe a re-submission of the same order — and
   * which we use as the join key when reconciling a PENDING DB row whose
   * Alpaca call may or may not have landed (a crash between the DB tx
   * commit and the Alpaca response). Generate once per intent (cuid is
   * fine), persist on `Order.idempotencyKey`, then pass it here.
   */
  clientOrderId?: string;
}

export interface LimitOrderParams extends OrderParams {
  limitPrice: number;
}

// ─── Client factory ──────────────────────────────────────────────────────────

const PAPER_BASE_URL = "https://paper-api.alpaca.markets";
const LIVE_BASE_URL = "https://api.alpaca.markets";

function createClient(creds?: AlpacaCredentials): AlpacaAPI {
  const baseUrl =
    creds?.baseUrl ?? process.env.ALPACA_BASE_URL ?? PAPER_BASE_URL;
  // The SDK's `paper` flag must mirror baseUrl. With per-user credentials
  // we may target either host on the same process, so derive instead of
  // hardcoding. Anything that isn't the live host is treated as paper.
  const paper = baseUrl !== LIVE_BASE_URL;
  return new AlpacaAPI({
    keyId: creds?.keyId ?? process.env.ALPACA_API_KEY!,
    secretKey: creds?.secretKey ?? process.env.ALPACA_API_SECRET!,
    baseUrl,
    paper,
  });
}

// Construct fresh per call. The previous lazy env-client singleton was
// unsafe once multiple environments could share the same process — a
// cached client would silently route a per-user request to the wrong
// account if the user's baseUrl differed from the env default.
function getClient(creds?: AlpacaCredentials): AlpacaAPI {
  return createClient(creds);
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

  if (params.clientOrderId) {
    order.client_order_id = params.clientOrderId;
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

/**
 * Look up an order by `client_order_id` (the idempotency token we sent on
 * submission). Returns null when Alpaca has no record of it.
 *
 * Used by reconcile-orders to recover from the (DB tx commit) → (Alpaca call)
 * crash gap: if our DB has a PENDING Order whose Alpaca call may not have
 * landed, we ask Alpaca "do you have anything with this client_order_id?"
 * If yes, we adopt it. If no, the call never reached the broker — safe to
 * mark our row REJECTED.
 *
 * Alpaca exposes this via GET /v2/orders:by_client_order_id?client_order_id=...
 * The SDK's `getOrderByClientOrderId` wraps it; we call REST directly so we
 * can return null on 404 instead of throwing.
 */
export async function getOrderByClientOrderId(
  clientOrderId: string,
  creds?: AlpacaCredentials,
): Promise<AlpacaOrder | null> {
  const baseUrl = (creds?.baseUrl || process.env.ALPACA_BASE_URL || PAPER_BASE_URL).replace(/\/$/, "");
  const keyId = creds?.keyId || process.env.ALPACA_API_KEY!;
  const secretKey = creds?.secretKey || process.env.ALPACA_API_SECRET!;

  const url = `${baseUrl}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`;
  return withTimeout(
    fetch(url, {
      headers: {
        "APCA-API-KEY-ID": keyId,
        "APCA-API-SECRET-KEY": secretKey,
      },
    }).then(async (res) => {
      if (res.status === 404) return null;
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Alpaca getOrderByClientOrderId ${res.status}: ${body.slice(0, 200)}`);
      }
      return (await res.json()) as AlpacaOrder;
    }),
    `getOrderByClientOrderId(${clientOrderId.slice(0, 8)})`,
  );
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

/**
 * Partially close a position by submitting a market sell/buy for a specific qty.
 * Alpaca paper trading supports this via a market order for the subset quantity.
 */
export async function closePositionPartial(
  symbol: string,
  qty: number,
  side: "sell" | "buy",
  creds?: AlpacaCredentials,
  clientOrderId?: string,
): Promise<AlpacaOrder> {
  const order: Record<string, unknown> = {
    symbol,
    qty: qty.toString(),
    side,
    type: "market",
    time_in_force: "day",
  };
  if (clientOrderId) order.client_order_id = clientOrderId;
  return (await getClient(creds).createOrder(
    order as Parameters<ReturnType<typeof getClient>["createOrder"]>[0],
  )) as AlpacaOrder;
}

export async function cancelOrder(orderId: string, creds?: AlpacaCredentials): Promise<void> {
  await getClient(creds).cancelOrder(orderId);
}

export async function getOpenOrders(creds?: AlpacaCredentials): Promise<AlpacaOrder[]> {
  return (await getClient(creds).getOrders({
    status: "open",
    until: null,
    after: null,
    limit: 500,
    direction: "desc",
    nested: false,
    symbols: null,
  } as Parameters<ReturnType<typeof getClient>["getOrders"]>[0])) as AlpacaOrder[];
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
 *
 * Resilient design (free Alpaca plans use the IEX feed which has very spotty
 * coverage outside RTH and for many tickers):
 *  1. Try Alpaca `getLatestTrades` — handles Map / object / array return
 *     shapes from SDK v3 and tries multiple price field names.
 *  2. For any symbol that didn't get a price, fall back to Finnhub `/quote`
 *     in parallel (free tier covers ~all US equities).
 *  3. For any symbol *still* missing, fall back to single-symbol Alpaca
 *     `getLatestTrade` (uses a different SDK code path that we know works).
 *  4. Anything still missing is left unset — caller must handle.
 *
 * Returns a `PriceLookup` containing the price map plus per-symbol source
 * metadata so the UI can show "live" vs "stale" indicators.
 */

export type PriceSource = "alpaca" | "finnhub" | "missing";

export interface PriceLookup {
  prices: Record<string, number>;
  sources: Record<string, PriceSource>;
  fetchedAt: string; // ISO timestamp
}

function extractPrice(trade: unknown): number | undefined {
  if (trade == null || typeof trade !== "object") return undefined;
  const t = trade as Record<string, unknown>;
  const candidates = [t.Price, t.price, t.p, t.tp, t.tradePrice, t.ClosePrice, t.c];
  for (const v of candidates) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return undefined;
}

export async function getLatestPrices(
  symbols: string[],
  creds?: AlpacaCredentials,
): Promise<Record<string, number>> {
  // Backwards-compatible wrapper — many callers only need the price map.
  const lookup = await getLatestPricesWithMeta(symbols, creds);
  return lookup.prices;
}

export async function getLatestPricesWithMeta(
  symbols: string[],
  creds?: AlpacaCredentials,
): Promise<PriceLookup> {
  const result: Record<string, number> = {};
  const sources: Record<string, PriceSource> = {};
  const fetchedAt = new Date().toISOString();

  if (symbols.length === 0) {
    return { prices: result, sources, fetchedAt };
  }

  // ── 1. Alpaca batch trades (works on free IEX feed for liquid US equities) ──
  try {
    const trades = await withTimeout(
      getClient(creds).getLatestTrades(symbols),
      `getLatestPrices(${symbols.length} symbols)`,
    );

    if (trades instanceof Map) {
      trades.forEach((trade, symbol) => {
        const price = extractPrice(trade);
        if (price !== undefined) {
          result[symbol] = price;
          sources[symbol] = "alpaca";
        }
      });
    } else if (Array.isArray(trades)) {
      for (const entry of trades as Array<{ Symbol?: string; symbol?: string; S?: string } & Record<string, unknown>>) {
        const sym = entry.Symbol ?? entry.symbol ?? entry.S;
        if (typeof sym !== "string") continue;
        const price = extractPrice(entry);
        if (price !== undefined) {
          result[sym] = price;
          sources[sym] = "alpaca";
        }
      }
    } else if (trades && typeof trades === "object") {
      for (const [sym, trade] of Object.entries(trades as Record<string, unknown>)) {
        const price = extractPrice(trade);
        if (price !== undefined) {
          result[sym] = price;
          sources[sym] = "alpaca";
        }
      }
    }
  } catch (err) {
    console.warn(
      `[alpaca] getLatestTrades batch failed (${symbols.length} symbols), falling back to Finnhub: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // ── 2. Finnhub fallback for anything Alpaca missed ─────────────────────────
  const missing = symbols.filter((s) => result[s] === undefined);
  if (missing.length > 0) {
    try {
      const { getStockQuote } = await import("@/lib/actions/finnhub.actions");
      const quotes = await Promise.allSettled(
        missing.map(async (sym) => ({ sym, quote: await getStockQuote(sym) })),
      );
      for (const r of quotes) {
        if (r.status !== "fulfilled") continue;
        const { sym, quote } = r.value;
        const c = quote?.c;
        if (typeof c === "number" && Number.isFinite(c) && c > 0) {
          result[sym] = c;
          sources[sym] = "finnhub";
        }
      }
    } catch (err) {
      console.warn(
        `[alpaca] Finnhub fallback failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── 3. Single-symbol Alpaca for anything still missing ────────────────────
  const stillMissing = symbols.filter((s) => result[s] === undefined);
  if (stillMissing.length > 0) {
    const single = await Promise.allSettled(
      stillMissing.map(async (sym) => ({ sym, price: await getLatestPrice(sym, creds) })),
    );
    for (const r of single) {
      if (r.status !== "fulfilled") continue;
      const { sym, price } = r.value;
      if (Number.isFinite(price) && price > 0) {
        result[sym] = price;
        sources[sym] = "alpaca";
      }
    }
  }

  // Mark anything still missing
  for (const sym of symbols) {
    if (result[sym] === undefined) sources[sym] = "missing";
  }

  const okCount = Object.values(sources).filter((s) => s !== "missing").length;
  if (okCount < symbols.length) {
    console.warn(
      `[alpaca] getLatestPrices resolved ${okCount}/${symbols.length} symbols. Missing: ${symbols
        .filter((s) => sources[s] === "missing")
        .join(", ")}`,
    );
  }

  return { prices: result, sources, fetchedAt };
}

// ─── Portfolio history ────────────────────────────────────────────────────────

export interface PortfolioHistoryPoint {
  date: string; // YYYY-MM-DD
  equity: number; // Total portfolio value including unrealized P&L
  profitLoss: number; // P&L for this data point
}

/**
 * Returns daily portfolio history from Alpaca's Portfolio History API.
 * equity[] = total account value including both realized and unrealized P&L.
 * This is the most accurate source for the equity curve — one call, server-side.
 */
export async function getPortfolioHistory(
  options: { period?: string; timeframe?: string } = {},
  creds?: AlpacaCredentials,
): Promise<PortfolioHistoryPoint[]> {
  const baseUrl = (creds?.baseUrl || process.env.ALPACA_BASE_URL || PAPER_BASE_URL).replace(/\/$/, "");
  const keyId = creds?.keyId || process.env.ALPACA_API_KEY!;
  const secretKey = creds?.secretKey || process.env.ALPACA_API_SECRET!;

  const params = new URLSearchParams({
    period: options.period ?? "5A",
    timeframe: options.timeframe ?? "1D",
  });

  const url = `${baseUrl}/v2/account/portfolio/history?${params}`;

  const raw = await withTimeout(
    fetch(url, {
      headers: {
        "APCA-API-KEY-ID": keyId,
        "APCA-API-SECRET-KEY": secretKey,
      },
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Alpaca portfolio history ${res.status}: ${body.slice(0, 200)}`);
      }
      return res.json() as Promise<{
        timestamp: number[];
        equity: (number | null)[];
        profit_loss: (number | null)[];
        base_value: number;
      }>;
    }),
    "getPortfolioHistory",
  );

  if (!Array.isArray(raw.timestamp) || !Array.isArray(raw.equity)) {
    throw new Error("Alpaca portfolio history: unexpected response shape");
  }

  const points: PortfolioHistoryPoint[] = [];
  for (let i = 0; i < raw.timestamp.length; i++) {
    const equity = raw.equity[i];
    if (equity == null || !Number.isFinite(equity) || equity <= 0) continue;
    points.push({
      date: new Date(raw.timestamp[i] * 1000).toISOString().slice(0, 10),
      equity,
      profitLoss: raw.profit_loss?.[i] ?? 0,
    });
  }

  return points;
}

// ─── Funding activities (deposits / withdrawals) ───────────────────────────────

/** Raw shape of a non-trade account activity (CSD/CSW) from Alpaca. */
interface AlpacaAccountActivity {
  id: string;
  activity_type: string; // "CSD" (cash deposit) | "CSW" (cash withdrawal) | …
  date?: string; // YYYY-MM-DD — present on non-trade activities
  transaction_time?: string; // ISO fallback for `date`
  net_amount?: string; // signed dollars
}

/**
 * Returns every cash deposit (CSD) and withdrawal (CSW) on the account as
 * signed `FundingEvent`s (deposit positive, withdrawal negative). This is the
 * external-cash-flow ledger used to strip deposits out of reported P&L — see
 * `lib/portfolio/contributions.ts`.
 *
 * Only meaningful on LIVE accounts: paper accounts are seeded out of thin air
 * and have no CSD/CSW activities, so this returns []. Paginates via the
 * documented `page_token` cursor (last id of the prior page), capped so a
 * pathological account can't loop forever.
 */
export async function getFundingActivities(
  creds?: AlpacaCredentials,
): Promise<FundingEvent[]> {
  const baseUrl = (creds?.baseUrl || process.env.ALPACA_BASE_URL || PAPER_BASE_URL).replace(/\/$/, "");
  const keyId = creds?.keyId || process.env.ALPACA_API_KEY!;
  const secretKey = creds?.secretKey || process.env.ALPACA_API_SECRET!;

  const PAGE_SIZE = 100; // Alpaca's max page size for activities
  const MAX_PAGES = 50; // safety cap — a personal account has a handful of transfers
  const events: FundingEvent[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      activity_types: "CSD,CSW",
      page_size: String(PAGE_SIZE),
    });
    if (pageToken) params.set("page_token", pageToken);

    const url = `${baseUrl}/v2/account/activities?${params}`;
    const rows = await withTimeout(
      fetch(url, {
        headers: {
          "APCA-API-KEY-ID": keyId,
          "APCA-API-SECRET-KEY": secretKey,
        },
      }).then(async (res) => {
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Alpaca activities ${res.status}: ${body.slice(0, 200)}`);
        }
        return res.json() as Promise<AlpacaAccountActivity[]>;
      }),
      "getFundingActivities",
    );

    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const a of rows) {
      const raw = parseFloat(a.net_amount ?? "");
      if (!Number.isFinite(raw)) continue;
      // Normalize by activity_type rather than trusting net_amount's sign:
      // CSD is a deposit (+), CSW a withdrawal (−), regardless of how Alpaca
      // happens to sign the field.
      const amount = a.activity_type === "CSW" ? -Math.abs(raw) : Math.abs(raw);
      const date = a.date ?? a.transaction_time?.slice(0, 10);
      if (!date) continue;
      events.push({ date, amount });
    }

    if (rows.length < PAGE_SIZE) break;
    pageToken = rows[rows.length - 1]?.id;
    if (!pageToken) break;
  }

  return events;
}

// ─── Historical bars ─────────────────────────────────────────────────────────

/**
 * Returns daily bars for a symbol using Alpaca Data API v2.
 *
 * Promoted from "fallback for Finnhub/FMP" to "primary candle source"
 * 2026-05-19: Finnhub `/stock/candle` returns 403 on the basic plan
 * (paid tier only) and FMP `/historical-price-full` is fully deprecated
 * since 2025-08-31 ("Legacy endpoint, no longer supported"). Without
 * `feed: "iex"`, Alpaca defaults to the SIP feed which requires a paid
 * market-data subscription — silently returning zero bars on the free
 * plan. The whole `get_stock_data.technicals` block was null on 128/128
 * tactical runs and 10/10 morning runs in the 14d window ending
 * 2026-05-19 because of this default. IEX is the right feed for free-plan
 * paper accounts and is consistent with how Alpaca's own tutorials
 * recommend defaulting for non-paid users.
 */
export async function getBars(
  symbol: string,
  options: { start: string; end: string; timeframe?: string; limit?: number; feed?: string },
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
      feed: options.feed ?? "iex",
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
