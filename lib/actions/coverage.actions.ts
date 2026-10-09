"use server";

import { prisma } from "@/lib/prisma";
import { thesisForTradeRow } from "@/lib/thesis/row-thesis";
import { watchAnchorPrice } from "@/lib/thesis/watch-anchor";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import { getLatestPrices } from "@/lib/alpaca";
import { getStockCandles } from "@/lib/actions/finnhub.actions";
import {
  resolveAlpacaCredentials,
  type AlpacaEnvironment,
} from "@/lib/actions/api-keys.actions";

// ─── Coverage Table data (Feature B — docs/plans/PORTFOLIO_DIGEST.md) ─────────
//
// The principal's main stock-overview, three tabs:
//   Trades   — open positions + recently-closed (sold) positions. The held book
//              + recent realized results. "Since" = unrealized P&L (open) /
//              realized P&L (closed, "Sold …").
//   Watching — WATCHING theses. "Since" = move since the watch-add.
//   Passed   — recently PASSED theses (last 14d, deduped). "Since" = move since
//              the pass; raw green/red is backwards (a passed stock rising is
//              regret) so the verdict (Dodged/Missed) carries the meaning.
//
// Each row also shows the stock's OWN momentum (1D / 5D / 30D) from daily
// candles — independent of the decision anchor.

/** Days back to surface PASSED theses + recently-closed trades. */
const RECENT_DAYS = 14;
/** Cap recently-closed trades shown inline (the rest live on /trades). */
const CLOSED_CAP = 12;

export type CoverageVerdict = "DODGED" | "MISSED" | "FLAT";
/** The verb in a row's "Since" subhead. */
export type CoverageAnchorVerb = "Entered" | "Sold" | "Watching since" | "Passed";

export interface CoverageRow {
  /** Unique per row (positionId or thesisId). */
  key: string;
  /** The thesis to open on row-click (the sheet fetches the rest by id). null
   *  when no thesis exists for the ticker — row falls back to the stock page. */
  thesisId: string | null;
  ticker: string;
  /** "LONG" | "SHORT" | null — seeds the thesis sheet header. */
  direction: string | null;
  analystName: string | null;
  /** Live (or last-resolved) quote. */
  currentPrice: number | null;
  // ── The stock's own momentum (daily candles), independent of the anchor ──
  oneDayPct: number | null;
  fiveDayPct: number | null;
  thirtyDayPct: number | null;
  // ── "Since [anchor]" — move vs entry / watch / pass, or realized for sold ──
  sinceDollar: number | null;
  sincePct: number | null;
  anchorPrice: number | null;
  anchorAt: string; // ISO — entry / watch-add / pass / sold date
  anchorVerb: CoverageAnchorVerb;
  // ── Trades only (null otherwise) ──
  tradeState: "OPEN" | "CLOSED" | null;
  shares: number | null;
  /** avgCost × shares — the "$X — N shares" subhead. */
  costBasis: number | null;
  // ── Passed only (null otherwise) ──
  verdict: CoverageVerdict | null;
  /**
   * The unapproved proposal sitting on this ticker, if any. Rides on whatever
   * row the ticker already has — a CLOSE/TRIM/ADD lands on its held Trades
   * row, a new buy (OPEN) lands on the Watching row for the same ticker — so
   * every pending action is skimmable next to that name's 1D/5D/30D move
   * instead of only in the "Pending approval" rail.
   */
  pendingProposal: CoveragePendingProposal | null;
}

export interface CoveragePendingProposal {
  orderId: string;
  intent: "OPEN" | "ADD" | "CLOSE" | "PARTIAL_CLOSE";
  /** Shares THIS proposal moves — the Order's quantity, not the position's. */
  quantity: number;
  /** ISO — when the proposal lapses; drives the Expired state on the Review control. */
  expiresAt?: string;
  /**
   * Approved and sent to Alpaca, waiting on the fill (Order.status PENDING).
   * The row keeps the proposal subhead but reads "Executing: Sell 20 shares"
   * and drops the Review control — there's nothing left to decide.
   */
  executing?: boolean;
}

export interface CoverageData {
  trades: CoverageRow[];
  watching: CoverageRow[];
  passed: CoverageRow[];
}

const EMPTY: CoverageData = { trades: [], watching: [], passed: [] };

/** A pass only counts as right/wrong once the stock has moved meaningfully —
 *  inside this band since the pass it's just FLAT (no verdict). */
const PASS_FLAT_BAND_PCT = 5;

/** Verdict for a PASSED thesis. Pass on a LONG idea is right (DODGED) if the
 *  stock fell, wrong (MISSED) if it rose; SHORT inverts; no direction → treat a
 *  rise-since-pass as regret (the long-bias default). Small moves → FLAT. */
function passVerdict(direction: string | null, sincePct: number | null): CoverageVerdict {
  if (sincePct == null || Math.abs(sincePct) < PASS_FLAT_BAND_PCT) return "FLAT";
  const rose = sincePct > 0;
  if (direction === "SHORT") return rose ? "DODGED" : "MISSED";
  return rose ? "MISSED" : "DODGED";
}

export async function getCoverageData(
  environment: AlpacaEnvironment = "PAPER",
): Promise<CoverageData> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return EMPTY;

  const accountId = await getAccountId(user.id);
  if (!accountId) return EMPTY;

  const recentSince = new Date(Date.now() - RECENT_DAYS * 86_400_000);

  // ── DB reads (parallel) ────────────────────────────────────────────────────
  const [positions, watchingTheses, passedTheses, alpacaCreds, pendingBuyPositions] = await Promise.all([
    // Open positions + recently-closed (sold) positions — the Trades tab.
    prisma.position.findMany({
      where: {
        accountId,
        environment,
        OR: [{ status: "OPEN" }, { status: "CLOSED", closedAt: { gte: recentSince } }],
      },
      orderBy: { openedAt: "desc" },
      select: {
        id: true,
        symbol: true,
        direction: true,
        quantity: true,
        avgCost: true,
        status: true,
        closePrice: true,
        realizedPnl: true,
        outcome: true,
        openedAt: true,
        closedAt: true,
        analyst: { select: { name: true } },
        // The proposal on this holding (close / trim / add) — either awaiting
        // your decision (AWAITING_APPROVAL) or approved and sitting at Alpaca
        // waiting to fill (PENDING). Both keep the row's proposal subhead;
        // only the first one still offers a Review control.
        orders: {
          where: { status: { in: ["AWAITING_APPROVAL", "PENDING"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true, intent: true, quantity: true, expiresAt: true },
        },
        // The thesis this position was bought on. Fallback for when the
        // by-ticker lookup below finds none in this environment — a LIVE
        // position whose thesis was written by a PAPER run (CEG, 2026-09-11)
        // otherwise had no thesis and its row opened /trades instead.
        decisions: {
          where: { thesisId: { not: null } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { thesisId: true },
        },
      },
    }).catch(() => [] as never[]),
    prisma.thesis.findMany({
      where: { accountId, status: "WATCHING", researchRun: { environment } },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: {
        id: true, ticker: true, direction: true, entryPrice: true,
        createdAt: true, updatedAt: true,
        researchRun: { select: { agentConfig: { select: { name: true } } } },
        // The EARLIEST event carrying a price — what the stock cost when the
        // watch opened. Passed rows take the LATEST for the same reason: the
        // price at the moment the state began. See lib/thesis/watch-anchor.ts.
        updates: {
          where: { priceAtTime: { not: null } },
          orderBy: { timestamp: "asc" },
          take: 1,
          select: { timestamp: true, priceAtTime: true },
        },
      },
    }).catch(() => [] as never[]),
    prisma.thesis.findMany({
      where: { accountId, status: "PASSED", researchRun: { environment }, updatedAt: { gte: recentSince } },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: {
        id: true, ticker: true, direction: true, entryPrice: true, updatedAt: true,
        researchRun: { select: { agentConfig: { select: { name: true } } } },
        updates: {
          where: { type: { in: ["STATUS_CHANGED", "UPDATED", "REVIEWED"] } },
          orderBy: { timestamp: "desc" },
          take: 1,
          select: { timestamp: true, priceAtTime: true },
        },
      },
    }).catch(() => [] as never[]),
    resolveAlpacaCredentials(user.id, environment).then((c) => c ?? undefined).catch(() => undefined),
    // Unapproved NEW buys. These positions are PENDING_APPROVAL, so they're
    // deliberately excluded from the trades query above (nothing is held yet)
    // — their proposal is attached to the ticker's Watching row instead.
    prisma.position.findMany({
      where: { accountId, environment, status: "PENDING_APPROVAL" },
      select: {
        symbol: true,
        orders: {
          where: { status: "AWAITING_APPROVAL" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, intent: true, quantity: true, expiresAt: true },
        },
      },
    }).catch(() => [] as never[]),
  ]);

  if (positions.length === 0 && watchingTheses.length === 0 && passedTheses.length === 0) {
    return EMPTY;
  }

  // symbol → the unapproved buy on it, for decorating Watching rows.
  const pendingBuyBySymbol = new Map<string, CoveragePendingProposal>();
  for (const p of pendingBuyPositions) {
    const o = p.orders[0];
    if (!o) continue;
    pendingBuyBySymbol.set(p.symbol, {
      orderId: o.id,
      intent: (o.intent ?? "OPEN") as CoveragePendingProposal["intent"],
      quantity: o.quantity,
      expiresAt: o.expiresAt?.toISOString(),
    });
  }

  // Every thesis on each traded ticker, newest-updated first. Which one a row
  // opens is `thesisForTradeRow` — see lib/thesis/row-thesis.ts.
  const tradeTickers = Array.from(new Set(positions.map((p) => p.symbol)));
  const thesesByTicker = new Map<string, { id: string; status: string }[]>();
  if (tradeTickers.length > 0) {
    const tradeTheses = await prisma.thesis
      .findMany({
        where: { accountId, ticker: { in: tradeTickers }, researchRun: { environment } },
        orderBy: { updatedAt: "desc" },
        select: { id: true, ticker: true, status: true },
      })
      .catch(() => [] as { id: string; ticker: string; status: string }[]);
    for (const t of tradeTheses) {
      const seen = thesesByTicker.get(t.ticker);
      if (seen) seen.push(t);
      else thesesByTicker.set(t.ticker, [t]);
    }
  }

  // ── Prices + 1D/5D/30D candle moves for every ticker on the board ───────────
  const tickers = Array.from(
    new Set([
      ...positions.map((p) => p.symbol),
      ...watchingTheses.map((t) => t.ticker),
      ...passedTheses.map((t) => t.ticker),
    ]),
  );
  const prices = await getLatestPrices(tickers, alpacaCreds).catch(
    () => ({}) as Record<string, number>,
  );
  const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const d30 = new Date(`${todayEt}T00:00:00Z`);
  d30.setUTCDate(d30.getUTCDate() - 30);
  const target30 = d30.toISOString().slice(0, 10);

  // The day each watch opened — the Watching rows are measured from the price
  // on that day (lib/thesis/watch-anchor.ts). The same daily bars the 1D/5D/30D
  // columns already pull carry it, so this costs no extra call: only the
  // lookback grows, from 45 days to far enough back to reach the oldest watch.
  // The day is the EASTERN one. A mint at 02:47 UTC is 22:47 the previous
  // evening in New York, so reading the UTC date would anchor on the NEXT
  // session's close — a whole day of movement we were not watching for.
  const etDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const watchStartByTicker = new Map<string, string>();
  for (const t of watchingTheses) {
    const day = etDay(t.createdAt);
    const prev = watchStartByTicker.get(t.ticker);
    if (!prev || day < prev) watchStartByTicker.set(t.ticker, day);
  }
  const oldestWatch = [...watchStartByTicker.values()].sort()[0];
  const candleDays = oldestWatch
    ? Math.max(45, Math.ceil((Date.now() - Date.parse(`${oldestWatch}T00:00:00Z`)) / 86_400_000) + 5)
    : 45;

  const moves = new Map<string, { oneDayPct: number | null; fiveDayPct: number | null; thirtyDayPct: number | null }>();
  /** ticker → the close on the day its watch opened. */
  const watchStartClose = new Map<string, number>();
  await Promise.all(
    tickers.map(async (tk) => {
      const current = prices[tk];
      if (current == null) {
        moves.set(tk, { oneDayPct: null, fiveDayPct: null, thirtyDayPct: null });
        return;
      }
      const candles = await getStockCandles(tk, candleDays).catch(() => []);
      const completed = candles.filter((c) => c.date < todayEt); // drop today's partial bar

      // The close on the watch's first day — or the last one before it, so a
      // watch opened on a weekend or a holiday still has an anchor.
      const startedOn = watchStartByTicker.get(tk);
      if (startedOn) {
        let close: number | null = null;
        for (const c of candles) {
          if (c.date <= startedOn) close = c.close;
          else break;
        }
        if (close != null && Number.isFinite(close) && close > 0) watchStartClose.set(tk, close);
      }
      const prevClose = completed[completed.length - 1]?.close ?? null;
      const close5 = completed[completed.length - 5]?.close ?? null;
      let close30: number | null = null; // last completed close on/before 30 cal. days ago
      for (const c of completed) {
        if (c.date <= target30) close30 = c.close;
        else break;
      }
      const pct = (den: number | null) =>
        den != null && den !== 0 ? ((current - den) / den) * 100 : null;
      moves.set(tk, { oneDayPct: pct(prevClose), fiveDayPct: pct(close5), thirtyDayPct: pct(close30) });
    }),
  );
  const mv = (tk: string) =>
    moves.get(tk) ?? { oneDayPct: null, fiveDayPct: null, thirtyDayPct: null };

  // ── Trades (open + recently sold) ──────────────────────────────────────────
  const trades: CoverageRow[] = positions.map((p) => {
    const current = prices[p.symbol] ?? null;
    const dirSign = p.direction === "SHORT" ? -1 : 1;
    const isOpen = p.status === "OPEN";
    const costBasis = p.avgCost * p.quantity;
    // Open → unrealized vs avgCost; Closed → realized P&L from the DB.
    const sinceDollar = isOpen
      ? current != null ? (current - p.avgCost) * p.quantity * dirSign : null
      : p.realizedPnl ?? null;
    const sincePct =
      costBasis !== 0 && sinceDollar != null ? (sinceDollar / costBasis) * 100 : null;
    return {
      key: p.id,
      thesisId: thesisForTradeRow({
        decisionThesisId: p.decisions[0]?.thesisId,
        tickerTheses: thesesByTicker.get(p.symbol) ?? [],
      }),
      ticker: p.symbol,
      direction: p.direction ?? null,
      analystName: p.analyst?.name ?? null,
      currentPrice: isOpen ? current : (p.closePrice ?? current),
      ...mv(p.symbol),
      sinceDollar,
      sincePct,
      anchorPrice: p.avgCost,
      anchorAt: (isOpen ? p.openedAt : (p.closedAt ?? p.openedAt)).toISOString(),
      anchorVerb: isOpen ? "Entered" : "Sold",
      tradeState: isOpen ? "OPEN" : "CLOSED",
      shares: p.quantity,
      costBasis,
      verdict: null,
      pendingProposal: p.orders[0]
        ? {
            orderId: p.orders[0].id,
            intent: (p.orders[0].intent ?? "CLOSE") as CoveragePendingProposal["intent"],
            quantity: p.orders[0].quantity,
            expiresAt: p.orders[0].expiresAt?.toISOString(),
            executing: p.orders[0].status === "PENDING",
          }
        : null,
    };
  });

  // ── Watching ───────────────────────────────────────────────────────────────
  const watching: CoverageRow[] = watchingTheses.map((t) => {
    const current = prices[t.ticker] ?? null;
    // The price when the watch opened — NOT `entryPrice`, which is the planned
    // buy level (a cache of the ENTER trigger) and is absent on 22 of 28
    // watched names, because most carry only REVIEW triggers. This column is
    // "what have I missed since I started watching", so it measures from a
    // price someone observed. See lib/thesis/watch-anchor.ts.
    const stampedRow = t.updates?.[0];
    const anchor = watchAnchorPrice({
      startedOn: etDay(t.createdAt),
      stamped:
        stampedRow?.priceAtTime != null
          ? { on: etDay(stampedRow.timestamp), price: Number(stampedRow.priceAtTime) }
          : null,
      closeOnStart: watchStartClose.get(t.ticker) ?? null,
    });
    const sinceDollar = current != null && anchor != null ? current - anchor : null;
    const sincePct =
      sinceDollar != null && anchor != null && anchor !== 0 ? (sinceDollar / anchor) * 100 : null;
    return {
      key: t.id,
      thesisId: t.id,
      ticker: t.ticker,
      direction: t.direction ?? null,
      analystName: t.researchRun?.agentConfig?.name ?? null,
      currentPrice: current,
      ...mv(t.ticker),
      sinceDollar,
      sincePct,
      anchorPrice: anchor,
      anchorAt: t.createdAt.toISOString(),
      anchorVerb: "Watching since",
      tradeState: null,
      shares: null,
      costBasis: null,
      verdict: null,
      pendingProposal: pendingBuyBySymbol.get(t.ticker) ?? null,
    };
  });

  // ── Passed (recent, deduped by ticker → most-recent) ───────────────────────
  const seenPass = new Set<string>();
  const passed: CoverageRow[] = [];
  for (const t of passedTheses) {
    if (seenPass.has(t.ticker)) continue; // dedup: keep the most-recent pass
    seenPass.add(t.ticker);
    const current = prices[t.ticker] ?? null;
    const last = t.updates[0];
    const anchor = last?.priceAtTime ?? t.entryPrice ?? null;
    const sinceDollar = current != null && anchor != null ? current - anchor : null;
    const sincePct =
      sinceDollar != null && anchor != null && anchor !== 0 ? (sinceDollar / anchor) * 100 : null;
    passed.push({
      key: t.id,
      thesisId: t.id,
      ticker: t.ticker,
      direction: t.direction ?? null,
      analystName: t.researchRun?.agentConfig?.name ?? null,
      currentPrice: current,
      ...mv(t.ticker),
      sinceDollar,
      sincePct,
      anchorPrice: anchor,
      anchorAt: (last?.timestamp ?? t.updatedAt).toISOString(),
      anchorVerb: "Passed",
      tradeState: null,
      shares: null,
      costBasis: null,
      verdict: passVerdict(t.direction ?? null, sincePct),
      pendingProposal: null,
    });
  }

  // Open trades first, then most-recent sales; cap the closed list (rest → /trades).
  const openTrades = trades.filter((r) => r.tradeState === "OPEN");
  const closedTrades = trades
    .filter((r) => r.tradeState === "CLOSED")
    .sort((a, b) => (a.anchorAt < b.anchorAt ? 1 : -1))
    .slice(0, CLOSED_CAP);

  return { trades: [...openTrades, ...closedTrades], watching, passed };
}
