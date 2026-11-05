/**
 * A stock's transactions — every fill on it, one dated row each in the
 * homepage activity feed's shape (the owner's design, 2026-11-05): the buy
 * at the open, each add, each trim, and the sale with the position's result.
 * Pure: the page or the sheet route hands in the fills it loaded.
 */

import { fmtQty } from "@/lib/trade-statement";

export type StockHistoryItem =
  | {
      kind: "thesis";
      id: string;
      /** ISO timestamp the row sorts and groups by. */
      at: string;
      thesisId: string;
      status: string;
      sentence: string;
    }
  | {
      kind: "trade";
      id: string;
      at: string;
      href: string;
      /** The fill the row is: the Transactions tab opens its dialog on it. */
      fillId: string;
      label: string;
      dotClass: string;
      sentence: string;
      gain: { dollar: number; pct: number | null } | null;
    };

/**
 * One fill's facts, as every surface hands them in (ISO dates): a row of the
 * Transactions tab and the dialog it opens. An order still waiting for the
 * owner is a fill-to-be, shown as a Proposal row.
 */
export type FillFacts = {
  id: string;
  positionId: string;
  /** The thesis behind the position, when known: the dialog opens its sheet. */
  thesisId: string | null;
  analyst: { id: string; name: string } | null;
  side: "BUY" | "SELL";
  /** OPEN | ADD | PARTIAL_CLOSE | CLOSE; null on old rows. */
  intent: string | null;
  /** FILLED, or AWAITING_APPROVAL while the owner still has to answer. */
  status: string;
  quantity: number;
  /** The fill price; null while still proposed. */
  price: number | null;
  /** When it filled, or when it was proposed. */
  at: string;
  /** The reason the fill was proposed, the analyst's words. */
  rationale: string | null;
  /** LONG | SHORT, the position's. */
  direction: string;
  /** The position's result, carried on its closing fill only. */
  result: { dollar: number; pct: number | null } | null;
  /** The close reason, on the closing fill. */
  closeReason: string | null;
};

/** An order row as Prisma hands it back (Decimals already numbers). */
export type FillOrder = {
  id: string;
  side: string;
  intent: string | null;
  status: string;
  quantity: number;
  filledQty: number | null;
  filledPrice: number | null;
  filledAt: Date | null;
  createdAt: Date;
  rationale: string | null;
  closeReason: string | null;
};

/** A position with its filled and waiting orders, as the route and the stock page load it. */
export type FillPosition = {
  id: string;
  direction: string;
  status: string;
  avgCost: number;
  quantity: number;
  realizedPnl: number | null;
  closePrice: number | null;
  closeReason: string | null;
  openedAt: Date;
  closedAt: Date | null;
  analyst: { id: string; name: string } | null;
  thesisId: string | null;
  orders: FillOrder[];
};

/**
 * The fills of these positions, newest first. A position from before the
 * order rows were kept (or whose fill never landed as one) still shows: its
 * buy is made from the position's own open, and its sale from its close.
 * An old sell with no intent on a closed position is taken as its close.
 */
export function fillFacts(positions: FillPosition[]): FillFacts[] {
  const out: FillFacts[] = [];
  for (const p of positions) {
    const cost = p.avgCost * p.quantity;
    const result = p.status === "CLOSED" && p.realizedPnl != null ? { dollar: p.realizedPnl, pct: cost > 0 ? (p.realizedPnl / cost) * 100 : null } : null;
    const base = { positionId: p.id, thesisId: p.thesisId, analyst: p.analyst, direction: p.direction };
    const orders = p.orders.filter((o) => o.status === "FILLED" || o.status === "AWAITING_APPROVAL");
    let sawOpen = false;
    let sawClose = false;
    for (const o of orders) {
      const filled = o.status === "FILLED";
      const closing = filled && p.status === "CLOSED" && o.side === "SELL" && (o.intent === "CLOSE" || o.intent == null);
      const opening = filled && o.side === "BUY" && (o.intent === "OPEN" || o.intent == null);
      if (opening) sawOpen = true;
      if (closing) sawClose = true;
      out.push({
        ...base,
        id: o.id,
        side: o.side === "SELL" ? "SELL" : "BUY",
        intent: o.intent ?? (o.side === "SELL" ? (closing ? "CLOSE" : "PARTIAL_CLOSE") : "OPEN"),
        status: o.status,
        quantity: o.filledQty ?? o.quantity,
        price: o.filledPrice,
        at: (o.filledAt ?? o.createdAt).toISOString(),
        rationale: o.rationale,
        result: closing ? result : null,
        closeReason: closing ? (o.closeReason ?? p.closeReason) : null,
      });
    }
    if (!sawOpen && p.status !== "PENDING_APPROVAL") {
      out.push({ ...base, id: `open-${p.id}`, side: "BUY", intent: "OPEN", status: "FILLED", quantity: p.quantity, price: p.avgCost, at: p.openedAt.toISOString(), rationale: null, result: null, closeReason: null });
    }
    if (!sawClose && p.status === "CLOSED" && p.closedAt) {
      out.push({ ...base, id: `close-${p.id}`, side: "SELL", intent: "CLOSE", status: "FILLED", quantity: p.quantity, price: p.closePrice, at: p.closedAt.toISOString(), rationale: null, result, closeReason: p.closeReason });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

const money = (n: number) => `$${n.toFixed(2)}`;
const shares = (n: number) => `${fmtQty(n)} ${n === 1 ? "share" : "shares"}`;

/** The row's word for a fill: what was done. */
export function fillVerb(f: FillFacts): { label: string; dotClass: string } {
  if (f.status === "AWAITING_APPROVAL") return { label: "Proposal", dotClass: "bg-amber-500" };
  const short = f.direction === "SHORT";
  switch (f.intent) {
    case "ADD":
      return { label: "Added", dotClass: "bg-positive" };
    case "PARTIAL_CLOSE":
      return { label: "Trimmed", dotClass: "bg-muted-foreground/60" };
    case "CLOSE":
      return { label: short ? "Covered" : "Sold", dotClass: "bg-muted-foreground/60" };
    default:
      return f.side === "SELL"
        ? { label: short ? "Shorted" : "Sold", dotClass: short ? "bg-negative" : "bg-muted-foreground/60" }
        : { label: short ? "Shorted" : "Bought", dotClass: short ? "bg-negative" : "bg-positive" };
  }
}

/** One sentence for a fill: "Bought 17 shares at $531.01", "Buy 4 shares" while proposed. */
export function fillSentence(f: FillFacts): string {
  const { label } = fillVerb(f);
  if (f.status === "AWAITING_APPROVAL") {
    const verb = f.intent === "ADD" ? "Add" : f.intent === "PARTIAL_CLOSE" ? "Trim" : f.intent === "CLOSE" ? "Sell" : f.direction === "SHORT" ? "Short" : "Buy";
    return `${verb} ${shares(f.quantity)}${f.price != null ? ` at ${money(f.price)}` : ""}`;
  }
  return `${label} ${shares(f.quantity)}${f.price != null ? ` at ${money(f.price)}` : ""}`;
}

/** A stock's fills as rows, newest first. */
export function fillRows(fills: FillFacts[]): Extract<StockHistoryItem, { kind: "trade" }>[] {
  return fills
    .map((f) => {
      const { label, dotClass } = fillVerb(f);
      return {
        kind: "trade" as const,
        id: `fill-${f.id}`,
        at: f.at,
        href: `/trades/${f.positionId}`,
        fillId: f.id,
        label,
        dotClass,
        sentence: fillSentence(f),
        gain: f.result,
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}
