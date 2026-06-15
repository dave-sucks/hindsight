/**
 * Shared display map for trades — keeps dot colors, labels, and tooltip
 * text consistent across every trade surface (dashboard sidebar, trades
 * table, thesis card, trade card, trade detail page).
 *
 * This is the trivial display-key → label/color map only. Callers derive
 * the display key from the real entities (`Position.status` + `outcome`)
 * at the call site — there is no combined-status mapper here. The old
 * `deriveTradeStatus` Position×Order conflation was removed in the P1-24
 * UI-cleanup PR; render the real `Position.status` directly.
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

/**
 * Safe accessor — returns the OPEN display config when the input isn't a
 * known TradeStatus. Use this everywhere instead of direct
 * `TRADE_STATUS_DISPLAY[x]` indexing, which was the source of a
 * production crash ("Cannot read properties of undefined (reading
 * 'dotClass')") that took down every run-detail page when a row was
 * rendered with a missing or unexpected status string. The runtime type
 * is `string | null | undefined`; TypeScript's index-into-Record is too
 * permissive to catch it. OPEN is the safest fallback because it
 * matches the dot-render shape callers already expect (blue pulse).
 */
export function getTradeStatusDisplay(
  status: string | null | undefined,
): TradeStatusDisplay {
  if (status && status in TRADE_STATUS_DISPLAY) {
    return TRADE_STATUS_DISPLAY[status as TradeStatus];
  }
  return TRADE_STATUS_DISPLAY.OPEN;
}

export const TRADE_STATUS_DISPLAY: Record<TradeStatus, TradeStatusDisplay> = {
  PENDING: {
    label: "Pending",
    dotClass: "bg-amber-500 animate-pulse",
    timeLabel: (c) => `Ordered ${fmt(c.placedAt)}`,
  },
  OPEN: {
    label: "Holding",
    // Blue pulse — the canonical "live, open" indicator. Reserved for
    // active positions; green is for CLOSED_WIN (terminal profit) and
    // red is for CLOSED_LOSS / INVALIDATED. Same dot used by the trade
    // detail header, the thesis sheet, the carousel cards, the
    // read-theses table.
    dotClass: "bg-blue-500 animate-pulse",
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
