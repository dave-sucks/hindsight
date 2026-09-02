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

/**
 * ── Naming a trade awaiting your decision ──────────────────────────────────
 * Three independent facts get confused for one another. Keep them apart:
 *
 *   STATE   what the row IS. Always `getTradeStatusDisplay(...).label` —
 *           "Pending", a peer of Holding / Won / Loss (and of the thesis
 *           vocabulary: Watching / Holding / Passed / Retired). NEVER
 *           "Pending review", "Pending approval" or "Proposed" — those were
 *           six labels for one state, which is what this note exists to stop.
 *
 *   ACTION  what is being proposed. Always a sentence from
 *           `buildTradeSentence()` / `proposalSentence()` below:
 *           "Proposed: Buy 28 shares at $352.79". The verb comes from the
 *           Order's intent, never from the position.
 *
 *   FILL    whether the ORDER reached Alpaca. Detail surfaces only, and it
 *           never reuses the word "pending": "Not ordered" (nothing sent —
 *           Order.status AWAITING_APPROVAL) vs "Awaiting fill" (sent,
 *           unfilled — Order.status PENDING).
 *
 * The control is always the "Review" button (ProposalActions).
 *
 * ── The moment after you approve ──────────────────────────────────────────
 * An approved order sits in Order.status PENDING until the fill lands (the
 * reconcile cron sweeps every 5 min). That used to be a hole: the proposal
 * left the pending list the instant it was approved and NOTHING took its
 * place, so an approved sell looked like the app had dropped the trade
 * (PRAX, 2026-08-31 — filled four minutes later). The same row now stays put
 * and reads EXECUTING_LABEL where its Buy / Sell verb was, until the fill
 * lands and it moves on by itself.
 */

/** The word for "approved, sent to Alpaca, not filled yet". One string so
 *  every surface says the same thing. */
export const EXECUTING_LABEL = "Executing";

/** Tooltip line for a row in that state. */
export const EXECUTING_TOOLTIP = "Sent to Alpaca — waiting for the fill";

/**
 * Which order a trade-shaped row should describe, and whether it is already
 * in flight. An unapproved proposal outranks a submitted one: if the agent
 * proposed a trim while an earlier buy is still filling, the decision you owe
 * is the more urgent thing to show. Returns null when neither exists.
 *
 * Pure so the row's two states are testable without a database.
 */
export function pickProposalOrder<T extends { status: string }>(
  orders: readonly T[],
): { order: T; executing: boolean } | null {
  const awaiting = orders.find((o) => o.status === "AWAITING_APPROVAL");
  if (awaiting) return { order: awaiting, executing: false };
  const submitted = orders.find((o) => o.status === "PENDING");
  if (submitted) return { order: submitted, executing: true };
  return null;
}

const PROPOSAL_VERB: Record<string, string> = {
  OPEN: "Buy",
  ADD: "Add",
  CLOSE: "Sell",
  PARTIAL_CLOSE: "Trim",
};

/**
 * Compact proposal sentence for row subheads — same grammar and verbs as
 * `buildTradeSentence`, minus the price (rows show it in their own column).
 * `executing` swaps the lead-in once the order has been approved and sent:
 * "Executing: Sell 20 shares".
 */
export function proposalSentence(
  intent: string,
  quantity: number,
  executing = false,
): string {
  const verb = PROPOSAL_VERB[intent] ?? "Review";
  const lead = executing ? EXECUTING_LABEL : "Proposed";
  return `${lead}: ${verb} ${quantity} share${quantity === 1 ? "" : "s"}`;
}

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
