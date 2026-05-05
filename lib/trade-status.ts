/**
 * Shared display status for trades — keeps dot colors, labels, and tooltip
 * text consistent across every trade surface (dashboard sidebar, trades
 * table, thesis card, trade card, trade detail page).
 *
 * Derived from the two real entities:
 *   - Position.status  → OPEN | CLOSED | CANCELLED
 *   - latest Order.status → PENDING | FILLED | CANCELLED | REJECTED
 *
 * Status semantics:
 *   PENDING         Order submitted, not yet filled. Amber dot.
 *   HOLDING (OPEN)  Order filled, paper shares held. Muted solid dot.
 *   CLOSED_WIN      Sold at a profit. Green dot.
 *   CLOSED_LOSS     Sold at a loss. Red dot.
 *   CLOSED_EXPIRED  Closed, no W/L (breakeven / manual / time). Muted dot.
 *   CANCELLED       Position cancelled before any fill. Muted outline dot.
 *   REJECTED        Alpaca rejected the order. Red dot.
 */

import type { TradeStatus } from "@/lib/mock-data/trades";

export interface TradeStatusDisplay {
  label: string;
  /** Tailwind classes for the dot */
  dotClass: string;
  /** Primary tooltip line, e.g. "Filled Apr 3, 12:05 PM" */
  timeLabel: (ctx: TradeStatusTimeCtx) => string;
}

export interface TradeStatusTimeCtx {
  placedAt?: string | Date | null;
  filledAt?: string | Date | null;
  closedAt?: string | Date | null;
}

function fmt(d: string | Date | null | undefined): string {
  if (!d) return "unknown time";
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export const TRADE_STATUS_DISPLAY: Record<TradeStatus, TradeStatusDisplay> = {
  PENDING: {
    label: "Pending",
    dotClass: "bg-amber-500 animate-pulse",
    timeLabel: (c) => `Ordered ${fmt(c.placedAt)}`,
  },
  OPEN: {
    label: "Holding",
    // Green + pulse — same dot used by the trade detail page header and
    // the thesis sheet's status pill, so "Holding" reads identically
    // wherever it appears (dashboard rows, trades table, trade detail,
    // thesis sheet, read-theses table, carousel cards).
    dotClass: "bg-positive animate-pulse",
    timeLabel: (c) => (c.filledAt ? `Filled ${fmt(c.filledAt)}` : `Opened ${fmt(c.placedAt)}`),
  },
  CLOSED_WIN: {
    label: "Won",
    dotClass: "bg-positive",
    timeLabel: (c) => `Sold ${fmt(c.closedAt ?? c.filledAt)}`,
  },
  CLOSED_LOSS: {
    label: "Loss",
    dotClass: "bg-negative",
    timeLabel: (c) => `Sold ${fmt(c.closedAt ?? c.filledAt)}`,
  },
  CLOSED_EXPIRED: {
    label: "Closed",
    dotClass: "bg-muted-foreground/60",
    timeLabel: (c) => `Closed ${fmt(c.closedAt ?? c.filledAt)}`,
  },
  CANCELLED: {
    label: "Cancelled",
    dotClass: "border border-muted-foreground/60 bg-transparent",
    timeLabel: (c) => `Cancelled ${fmt(c.closedAt ?? c.placedAt)}`,
  },
  REJECTED: {
    label: "Rejected",
    dotClass: "bg-negative",
    timeLabel: (c) => `Rejected ${fmt(c.placedAt)}`,
  },
};

/** Short Alpaca order id for tooltip display. */
export function shortAlpacaId(id: string | null | undefined): string | null {
  if (!id) return null;
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

/**
 * Derive the display TradeStatus from raw Position.status + outcome.
 * Use this at every call site that hands a Position into TradeRow — the
 * raw enum has no win/loss split, so passing it directly makes every
 * closed row fall back to the OPEN default (blue pulse). Dashboard and
 * the analyst sidebar both go through this so the dot stays consistent.
 */
export function deriveTradeStatus(
  status: string,
  outcome?: string | null,
): TradeStatus {
  if (status === "OPEN") return "OPEN";
  if (status === "PENDING") return "PENDING";
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "REJECTED") return "REJECTED";
  if (outcome === "WIN") return "CLOSED_WIN";
  if (outcome === "LOSS") return "CLOSED_LOSS";
  return "CLOSED_EXPIRED";
}
