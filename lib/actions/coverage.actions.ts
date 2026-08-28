"use server";

import { prisma } from "@/lib/prisma";
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
        // The proposal awaiting a decision on this holding (close / trim /
        // add). AWAITING_APPROVAL is NOT 'PENDING' — that one is "sent to
        // Alpaca, not yet filled".
        orders: {
          where: { status: "AWAITING_APPROVAL" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, intent: true, quantity: true, expiresAt: true },
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

  // Resolve a thesis per traded ticker so a trade row opens its thesis sheet
  // (the position's thesis may be HOLDING or, for a sold name, RETIRED).
  const tradeTickers = Array.from(new Set(positions.map((p) => p.symbol)));
  const thesisIdByTicker = new Map<string, string>();
  if (tradeTickers.length > 0) {
    const tradeTheses = await prisma.thesis
      .findMany({
        where: { accountId, ticker: { in: tradeTickers }, researchRun: { environment } },
        orderBy: { updatedAt: "desc" },
        select: { id: true, ticker: true },
      })
      .catch(() => [] as { id: string; ticker: string }[]);
    for (const t of tradeTheses) {
      if (!thesisIdByTicker.has(t.ticker)) thesisIdByTicker.set(t.ticker, t.id);
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

  const moves = new Map<string, { oneDayPct: number | null; fiveDayPct: number | null; thirtyDayPct: number | null }>();
  await Promise.all(
    tickers.map(async (tk) => {
      const current = prices[tk];
      if (current == null) {
        moves.set(tk, { oneDayPct: null, fiveDayPct: null, thirtyDayPct: null });
        return;
      }
      const candles = await getStockCandles(tk, 45).catch(() => []);
      const completed = candles.filter((c) => c.date < todayEt); // drop today's partial bar
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
      thesisId: thesisIdByTicker.get(p.symbol) ?? null,
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
          }
        : null,
    };
  });

  // ── Watching ───────────────────────────────────────────────────────────────
  const watching: CoverageRow[] = watchingTheses.map((t) => {
    const current = prices[t.ticker] ?? null;
    const anchor = t.entryPrice ?? null;
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
