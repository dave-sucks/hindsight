/**
 * One stock's history on this account, sorted for the stock page: the open
 * position, a proposal waiting on you, the trades that closed, the theses
 * watching now, and the ones that never led to a buy.
 *
 * Pure. The loader is lib/actions/stock-history.ts; the card is
 * components/domain/stock-history-card.tsx.
 */

import type { TradeStatus } from "@/lib/mock-data/trades";

export interface HistoryThesis {
  id: string;
  /** WATCHING | HOLDING | PROMOTED | PASSED | RETIRED */
  status: string;
  direction: string | null;
  retiredReason: string | null;
  createdAt: string;
  analystId: string | null;
  analystName: string | null;
}

export interface HistoryPosition {
  id: string;
  thesisId: string | null;
  /** PENDING_APPROVAL | OPEN | CLOSED | CANCELLED */
  status: string;
  direction: string;
  quantity: number;
  avgCost: number;
  closePrice: number | null;
  realizedPnl: number | null;
  outcome: string | null;
  closeReason: string | null;
  openedAt: string;
  closedAt: string | null;
  analystId: string;
  analystName: string | null;
  /** A buy order filled: shares were really bought. */
  buyFilled: boolean;
}

export interface StockHistory {
  theses: HistoryThesis[];
  positions: HistoryPosition[];
}

export interface Gain {
  dollar: number;
  pct: number | null;
}

export interface ClosedTrade extends HistoryPosition {
  gain: Gain | null;
  won: boolean | null;
}

export interface StockHistorySummary {
  /** Shares held now (or a buy sent to the broker and not yet filled). */
  open: HistoryPosition | null;
  /** A buy proposed and waiting on you. */
  proposed: HistoryPosition | null;
  /** Trades that bought and sold, newest first. */
  closed: ClosedTrade[];
  /** Proposals that lapsed or were cancelled before a fill. Never trades. */
  unfilled: HistoryPosition[];
  /** The thesis behind the open position. */
  holding: HistoryThesis | null;
  /** On the watchlist now, newest first. */
  watching: HistoryThesis[];
  /** Every finished thesis, newest first. */
  past: HistoryThesis[];
  /** Finished theses that never led to a buy. */
  neverBought: number;
  stats: { buys: number; won: number; lost: number; realized: number };
}

const byNewest = (a: string, b: string) => new Date(b).getTime() - new Date(a).getTime();

/** The display key a position renders with, from its real status and fills. */
export function tradeStatusKey(p: {
  status: string;
  outcome: string | null;
  realizedPnl: number | null;
  buyFilled: boolean;
}): TradeStatus {
  if (p.status === "PENDING_APPROVAL") return "PENDING";
  if (p.status === "CANCELLED") return "CANCELLED";
  if (!p.buyFilled) return p.status === "OPEN" ? "PENDING" : "CANCELLED";
  if (p.status === "OPEN") return "OPEN";
  if (p.outcome === "WIN") return "CLOSED_WIN";
  if (p.outcome === "LOSS") return "CLOSED_LOSS";
  if (p.realizedPnl != null && p.realizedPnl > 0) return "CLOSED_WIN";
  if (p.realizedPnl != null && p.realizedPnl < 0) return "CLOSED_LOSS";
  return "CLOSED_EXPIRED";
}

/** The gain on a position: realized once closed, else against the live price. */
export function positionGain(p: HistoryPosition, livePrice: number | null): Gain | null {
  const cost = p.avgCost * p.quantity;
  if (p.status === "CLOSED") {
    if (p.realizedPnl == null) return null;
    return { dollar: p.realizedPnl, pct: cost > 0 ? (p.realizedPnl / cost) * 100 : null };
  }
  if (livePrice == null || !p.buyFilled) return null;
  const dollar =
    p.direction === "SHORT" ? (p.avgCost - livePrice) * p.quantity : (livePrice - p.avgCost) * p.quantity;
  return { dollar, pct: cost > 0 ? (dollar / cost) * 100 : null };
}

/** One word for how a finished thesis ended. */
export function pastThesisWord(t: Pick<HistoryThesis, "status" | "retiredReason">): string {
  if (t.status === "PASSED") return "Passed";
  if (t.status === "RETIRED") {
    switch (t.retiredReason) {
      case "SOLD":
        return "Sold";
      case "DROPPED":
        return "Dropped";
      case "INVALIDATED":
        return "Proven wrong";
      case "REPLACED":
        return "Replaced";
      default:
        return "Retired";
    }
  }
  if (t.status === "HOLDING") return "Holding";
  if (t.status === "WATCHING") return "Watching";
  if (t.status === "PROMOTED") return "Promoted";
  return t.status;
}

export function summarizeStockHistory(h: StockHistory, livePrice: number | null = null): StockHistorySummary {
  const positions = [...h.positions].sort((a, b) => byNewest(a.openedAt, b.openedAt));
  const theses = [...h.theses].sort((a, b) => byNewest(a.createdAt, b.createdAt));

  const open = positions.find((p) => p.status === "OPEN") ?? null;
  const proposed = positions.find((p) => p.status === "PENDING_APPROVAL") ?? null;
  const closed: ClosedTrade[] = positions
    .filter((p) => p.status === "CLOSED" && p.buyFilled)
    .sort((a, b) => byNewest(a.closedAt ?? a.openedAt, b.closedAt ?? b.openedAt))
    .map((p) => {
      const key = tradeStatusKey(p);
      return {
        ...p,
        gain: positionGain(p, livePrice),
        won: key === "CLOSED_WIN" ? true : key === "CLOSED_LOSS" ? false : null,
      };
    });
  const unfilled = positions.filter(
    (p) => p.status === "CANCELLED" || (p.status === "CLOSED" && !p.buyFilled),
  );

  const holding =
    (open?.thesisId ? theses.find((t) => t.id === open.thesisId) : null) ??
    theses.find((t) => t.status === "HOLDING") ??
    null;
  const watching = theses.filter((t) => t.status === "WATCHING");
  const past = theses.filter(
    (t) => t.status !== "WATCHING" && t.status !== "HOLDING" && t.status !== "PROMOTED",
  );

  const bought = new Set(positions.filter((p) => p.buyFilled).map((p) => p.thesisId));
  const neverBought = past.filter((t) => t.retiredReason !== "SOLD" && !bought.has(t.id)).length;

  const won = closed.filter((c) => c.won === true).length;
  const lost = closed.filter((c) => c.won === false).length;
  const realized = closed.reduce((sum, c) => sum + (c.realizedPnl ?? 0), 0);

  return {
    open,
    proposed,
    closed,
    unfilled,
    holding,
    watching,
    past,
    neverBought,
    stats: { buys: closed.length + (open && open.buyFilled ? 1 : 0), won, lost, realized },
  };
}

/** Where a position's page is: its thesis, or the trade when it has none. */
export function positionHref(p: Pick<HistoryPosition, "id" | "thesisId">): string {
  return p.thesisId ? `/theses/${p.thesisId}` : `/trades/${p.id}`;
}
