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
import type { DailyBar } from "@/lib/market-data/price-structure";
import { noteAllowance, withAllowance, type QuoteCaller } from "@/lib/market-data/quote-budget";

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

/**
 * The consolidated tape (SIP), real time — every market-data call names it.
 *
 * The account took Algo Trader Plus on 2026-09-25. Probed 2026-09-29 with
 * SMMT, SRRK and IOT: the paper keys, the live keys and the env keys all get
 * SIP, at 10,000 calls a minute each. So market data is signed with whatever
 * keys the caller already holds — each environment keeps its own, and
 * trading keys are untouched. IEX is one exchange: ~5% of the volume, a last
 * print 50–90 seconds old on a mid-cap, and a quote nobody could trade
 * (SRRK $41.54 / $54.51 against $47.96 / $48.10 on the tape). It survives
 * only as getDailyBars' fallback.
 */
export const MARKET_DATA_FEED = "sip";
const MARKET_DATA_URL = "https://data.alpaca.markets/v2/stocks";

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
    feed: MARKET_DATA_FEED,
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
 * One GET against Alpaca's market data: the feed named, never the Next.js
 * Data Cache (CLAUDE.md recurring-bugs rule), and the caller's claim on the
 * minute's allowance checked first — the trigger check always goes through,
 * everyone else yields the reserve (lib/market-data/quote-budget).
 */
async function marketDataGet<T>(
  path: string,
  params: Record<string, string>,
  opts: { creds?: AlpacaCredentials; caller?: QuoteCaller; label: string },
): Promise<T> {
  const keyId = opts.creds?.keyId || process.env.ALPACA_API_KEY;
  const secretKey = opts.creds?.secretKey || process.env.ALPACA_API_SECRET;
  if (!keyId || !secretKey) throw new Error(`Alpaca ${opts.label}: no credentials`);
  const bucket = `alpaca:${keyId}`;
  const url = `${MARKET_DATA_URL}${path}?${new URLSearchParams({ ...params, feed: MARKET_DATA_FEED })}`;
  return withAllowance(bucket, opts.caller ?? "other", async () => {
    const res = await fetch(url, {
      headers: { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secretKey },
      cache: "no-store",
      signal: AbortSignal.timeout(ALPACA_TIMEOUT_MS),
    });
    noteAllowance(bucket, res.headers);
    if (!res.ok) {
      const said = await res.text().catch(() => "");
      throw new Error(
        `Alpaca ${opts.label} ${res.status}${res.status === 429 ? " (rate limited)" : ""}${said ? `: ${said.slice(0, 200)}` : ""}`,
      );
    }
    return (await res.json()) as T;
  });
}

export interface AlpacaSnapshotBar {
  /** Daily bars are stamped at midnight ET — the first ten characters are the session date. */
  t?: string;
  o?: number;
  h?: number;
  l?: number;
  c?: number;
  v?: number;
}

export interface AlpacaSnapshot {
  latestTrade?: { p?: number; t?: string };
  dailyBar?: AlpacaSnapshotBar;
  prevDailyBar?: AlpacaSnapshotBar;
}

/**
 * Latest trade, the latest daily bar and the one before it, for many symbols
 * in one call — the whole book (44 names) came back priced in 20 ms on
 * 2026-09-29. This is the raw vendor reply; lib/market-data/live-quote turns
 * it into a price with its age. Throws when the vendor refuses; a symbol it
 * does not know is simply absent.
 *
 * One malformed symbol refuses the whole request (400 "invalid symbol: ^VIX"
 * — an index, a crypto pair, BRK-B for BRK.B). That symbol is dropped and the
 * rest asked again, so one bad ticker can't leave the book unpriced.
 */
export async function getSnapshots(
  symbols: string[],
  opts: { creds?: AlpacaCredentials; caller?: QuoteCaller } = {},
): Promise<Record<string, AlpacaSnapshot>> {
  const out: Record<string, AlpacaSnapshot> = {};
  for (let i = 0; i < symbols.length; i += 100) {
    let chunk = symbols.slice(i, i + 100);
    while (chunk.length > 0) {
      try {
        const body = await marketDataGet<Record<string, AlpacaSnapshot>>(
          "/snapshots",
          { symbols: chunk.join(",") },
          { ...opts, label: `getSnapshots(${chunk.length} symbols)` },
        );
        for (const [symbol, snap] of Object.entries(body ?? {})) out[symbol.toUpperCase()] = snap;
        break;
      } catch (err) {
        const bad = /invalid symbol: ([^\s"}]+)/.exec(err instanceof Error ? err.message : "")?.[1];
        if (!bad || !chunk.includes(bad)) throw err;
        console.warn(`[alpaca] getSnapshots: ${bad} is not a symbol Alpaca prices — asked again without it`);
        chunk = chunk.filter((s) => s !== bad);
      }
    }
  }
  return out;
}

/** The latest trade on the tape for each symbol — any hour, pre-market and after-hours prints included. */
async function getLatestTrades(
  symbols: string[],
  creds?: AlpacaCredentials,
): Promise<Record<string, { p?: number; t?: string }>> {
  const out: Record<string, { p?: number; t?: string }> = {};
  for (let i = 0; i < symbols.length; i += 100) {
    const chunk = symbols.slice(i, i + 100);
    const body = await marketDataGet<{ trades?: Record<string, { p?: number; t?: string }> }>(
      "/trades/latest",
      { symbols: chunk.join(",") },
      { creds, label: `getLatestPrices(${chunk.length} symbols)` },
    );
    Object.assign(out, body.trades ?? {});
  }
  return out;
}

/** Returns the latest trade price for a US equity symbol. */
export async function getLatestPrice(symbol: string, creds?: AlpacaCredentials): Promise<number> {
  const price = (await getLatestTrades([symbol.toUpperCase()], creds))[symbol.toUpperCase()]?.p;
  if (typeof price !== "number" || !(price > 0)) {
    throw new Error(`No price available for ${symbol}`);
  }
  return price;
}

/**
 * Returns latest prices for multiple symbols in one call.
 *
 *  1. Alpaca's latest trades for the whole list, one request.
 *  2. For any symbol that didn't get a price, `getStockQuote` — a different
 *     Alpaca endpoint first, then Finnhub `/quote`.
 *  3. Anything still missing is left unset — caller must handle.
 *
 * Returns a `PriceLookup`: the price map, where each price came from, and
 * when it printed (`asOf`) so a caller can say how old it is
 * (lib/market-data/quote-age).
 */

export type PriceSource = "alpaca" | "finnhub" | "missing";

export interface PriceLookup {
  prices: Record<string, number>;
  sources: Record<string, PriceSource>;
  /** When each price printed (ISO). Absent for a symbol with no price. */
  asOf: Record<string, string>;
  fetchedAt: string; // ISO timestamp
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
  const asOf: Record<string, string> = {};
  const fetchedAt = new Date().toISOString();

  if (symbols.length === 0) {
    return { prices: result, sources, asOf, fetchedAt };
  }

  // ── 1. Alpaca latest trades, the whole list ────────────────────────────────
  try {
    const trades = await getLatestTrades(symbols, creds);
    for (const [symbol, trade] of Object.entries(trades)) {
      if (typeof trade?.p === "number" && Number.isFinite(trade.p) && trade.p > 0) {
        result[symbol] = trade.p;
        sources[symbol] = "alpaca";
        if (trade.t) asOf[symbol] = trade.t;
      }
    }
  } catch (err) {
    console.warn(
      `[alpaca] latest trades failed (${symbols.length} symbols), falling back to getStockQuote: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // ── 2. getStockQuote for anything the batch missed ─────────────────────────
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
          if (typeof quote?.t === "number" && quote.t > 0) asOf[sym] = new Date(quote.t * 1000).toISOString();
        }
      }
    } catch (err) {
      console.warn(
        `[alpaca] getStockQuote fallback failed: ${err instanceof Error ? err.message : String(err)}`,
      );
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

  return { prices: result, sources, asOf, fetchedAt };
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
 * Returns daily bars for a symbol using Alpaca Data API v2 — the primary
 * candle source since 2026-05-19 (Finnhub `/stock/candle` is paid-only and
 * FMP is gone). Consolidated (SIP) bars by default; until the plan changed
 * on 2026-09-25 this had to be IEX, whose volume is a sliver of the tape.
 * A caller may still name a feed.
 */
export async function getBars(
  symbol: string,
  options: { start: string; end: string; timeframe?: string; limit?: number; feed?: string },
  creds?: AlpacaCredentials,
): Promise<{ close: number; volume: number; low?: number; high?: number }[]> {
  const bars: { close: number; volume: number; low?: number; high?: number }[] = [];

  // Wrap entire iteration in a timeout since Alpaca SDK async iterators can hang
  const collectBars = async () => {
    const barIterator = getClient(creds).getBarsV2(symbol, {
      start: options.start,
      end: options.end,
      timeframe: options.timeframe || "1Day",
      limit: options.limit || 90,
      feed: options.feed ?? MARKET_DATA_FEED,
    });

    for await (const bar of barIterator) {
      const b = bar as {
        ClosePrice?: number;
        c?: number;
        Volume?: number;
        v?: number;
        LowPrice?: number;
        l?: number;
        HighPrice?: number;
        h?: number;
      };
      const close = b.ClosePrice ?? b.c;
      const volume = b.Volume ?? b.v;
      if (close !== undefined) {
        bars.push({
          close,
          volume: volume ?? 0,
          low: b.LowPrice ?? b.l,
          high: b.HighPrice ?? b.h,
        });
      }
    }
    return bars;
  };

  return withTimeout(collectBars(), `getBars(${symbol})`);
}

/**
 * A year of COMPLETED daily sessions, full OHLCV, for the chart module
 * (lib/market-data/price-structure.ts, DAV-243).
 *
 * SIP first: our plan serves the consolidated tape for any window that ends
 * 15+ minutes ago, and only SIP volume is real — IEX carries ~2% of it
 * (MSFT 2026-09-01: SIP 21.1M shares, IEX 483k). A volume ratio off IEX is a
 * ratio of a sliver. IEX is the fallback when SIP comes back empty, and the
 * result says which feed it is so a caller never presents IEX volume as the
 * market's.
 *
 * Today's bar is dropped until 4:20 PM ET: before then it is a partial
 * session (and on SIP, 15 minutes stale), and the chart is built from
 * finished days — the live price is passed separately.
 */
export async function getDailyBars(
  symbol: string,
  sessions: number,
  creds?: AlpacaCredentials,
  now: Date = new Date(),
): Promise<{ feed: "sip" | "iex"; bars: DailyBar[] }> {
  // ~1.45 calendar days per session covers weekends + holidays.
  const start = new Date(now.getTime() - Math.ceil(sessions * 1.45 + 10) * 86400_000)
    .toISOString()
    .slice(0, 10);
  const et = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const part = (t: string) => et.find((p) => p.type === t)?.value ?? "";
  const todayEt = `${part("year")}-${part("month")}-${part("day")}`;
  const minutesEt = Number(part("hour")) * 60 + Number(part("minute"));
  const todayFinished = minutesEt >= 16 * 60 + 20;

  const pull = async (feed: "sip" | "iex") => {
    const end = feed === "sip" ? new Date(now.getTime() - 16 * 60_000).toISOString() : now.toISOString();
    const out: DailyBar[] = [];
    const it = getClient(creds).getBarsV2(symbol, {
      start,
      end,
      timeframe: "1Day",
      limit: sessions + 20,
      feed,
    });
    for await (const bar of it) {
      const b = bar as {
        Timestamp?: string; t?: string;
        OpenPrice?: number; o?: number;
        HighPrice?: number; h?: number;
        LowPrice?: number; l?: number;
        ClosePrice?: number; c?: number;
        Volume?: number; v?: number;
      };
      const ts = b.Timestamp ?? b.t;
      const open = b.OpenPrice ?? b.o;
      const high = b.HighPrice ?? b.h;
      const low = b.LowPrice ?? b.l;
      const close = b.ClosePrice ?? b.c;
      if (!ts || open == null || high == null || low == null || close == null) continue;
      // Daily bars are stamped at midnight ET (04:00/05:00Z) — the UTC date is the session date.
      const date = String(ts).slice(0, 10);
      if (date === todayEt && !todayFinished) continue;
      out.push({ date, open, high, low, close, volume: b.Volume ?? b.v ?? 0 });
    }
    return out.slice(-sessions);
  };

  try {
    const sip = await withTimeout(pull("sip"), `getDailyBars(${symbol}, sip)`);
    if (sip.length > 0) return { feed: "sip", bars: sip };
  } catch (err) {
    console.warn(`[alpaca] getDailyBars: SIP failed for ${symbol}, falling back to IEX:`, err instanceof Error ? err.message : err);
  }
  return { feed: "iex", bars: await withTimeout(pull("iex"), `getDailyBars(${symbol}, iex)`) };
}

/**
 * Today's session bar for many symbols in one call — consolidated (SIP)
 * volume through ~16 minutes ago, and at 16:20 ET the day's close. Read by
 * the trigger evaluator for VOLUME_RATIO / GAP_UP and by its close pass
 * (DAV-247). Finnhub quotes carry no volume; IEX volume is ~2% of the tape.
 *
 * Only a bar dated today (ET) is returned — before the open the "today" bar
 * holds overnight prints and must not be read as the session. Fail-open:
 * any error returns what was gathered, logged.
 */
export async function getTodaySessionBars(
  symbols: string[],
  creds?: AlpacaCredentials,
  now: Date = new Date(),
  caller: QuoteCaller = "other",
): Promise<Record<string, { close: number; high: number; low: number; volume: number }>> {
  const out: Record<string, { close: number; high: number; low: number; volume: number }> = {};
  if (symbols.length === 0) return out;
  const todayEt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const end = new Date(now.getTime() - 16 * 60_000).toISOString();
  for (let i = 0; i < symbols.length; i += 100) {
    const chunk = symbols.slice(i, i + 100);
    try {
      const body = await marketDataGet<{
        bars?: Record<string, { t: string; c: number; h: number; l: number; v: number }[]>;
      }>(
        "/bars",
        { symbols: chunk.join(","), timeframe: "1Day", start: todayEt, end, limit: "10000" },
        { creds, caller, label: `getTodaySessionBars(${chunk.length} symbols)` },
      );
      for (const [symbol, rows] of Object.entries(body.bars ?? {})) {
        const today = rows.find((r) => String(r.t).slice(0, 10) === todayEt);
        if (today) out[symbol.toUpperCase()] = { close: today.c, high: today.h, low: today.l, volume: today.v };
      }
    } catch (err) {
      console.warn(
        `[getTodaySessionBars] lookup failed (${chunk.length} symbols):`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return out;
}

/**
 * Batched daily-range lookup for the plan-sanity noise check (DAV-188).
 *
 * One REST call to /v2/stocks/snapshots for the whole symbol list; per
 * symbol, the range proxy is the WIDER of today's bar and the previous
 * session's bar (today's bar is partial in the morning — exactly when the
 * daily run reads it), expressed as a percent of the latest close.
 *
 * The proxy answers one question: "is this plan's stop closer to its entry
 * than the stock's ordinary daily wiggle?" (the MNKD case: $4.04 entry,
 * $4.00 stop, ~5% daily range — guaranteed to stop out on noise). It is
 * deliberately a single-session measure, not ATR — a linter input, not a
 * trading signal.
 *
 * Fail-open: any error or missing bar simply omits the symbol; callers
 * treat absence as "no noise check possible."
 */
export async function getDailyRangePcts(
  symbols: string[],
  creds?: AlpacaCredentials,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (symbols.length === 0) return out;

  try {
    const res = await getSnapshots(symbols, { creds });
    for (const [symbol, snap] of Object.entries(res)) {
      const price =
        snap?.latestTrade?.p ?? snap?.dailyBar?.c ?? snap?.prevDailyBar?.c;
      if (typeof price !== "number" || price <= 0) continue;
      const ranges = [snap?.dailyBar, snap?.prevDailyBar]
        .map((b) =>
          b && typeof b.h === "number" && typeof b.l === "number" && b.h >= b.l
            ? b.h - b.l
            : null,
        )
        .filter((r): r is number => r != null && r > 0);
      if (ranges.length === 0) continue;
      out[symbol.toUpperCase()] = (Math.max(...ranges) / price) * 100;
    }
  } catch (err) {
    console.warn(
      `[getDailyRangePcts] snapshot lookup failed (${symbols.length} symbols):`,
      err instanceof Error ? err.message : err,
    );
  }
  return out;
}
