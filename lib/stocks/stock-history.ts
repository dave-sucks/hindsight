/**
 * A stock's transactions — every fill on it (the owner's design, 2026-11-05):
 * the buy at the open, each add, each trim, each sale. A sell's gain is its
 * price against the average cost of the shares at that moment (buys and adds
 * move the average, sells don't), and the stock's total is the sum of its
 * sells plus what the open shares are worth today. Pure: the page or the
 * sheet route hands in the positions and their orders.
 */

import { fmtQty } from "@/lib/trade-statement";

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
  /** A sell's gain against the average cost at that moment (the position's result on an old sale with no fills of its own). */
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
    const wholeResult = p.status === "CLOSED" && p.realizedPnl != null ? { dollar: p.realizedPnl, pct: cost > 0 ? (p.realizedPnl / cost) * 100 : null } : null;
    const base = { positionId: p.id, thesisId: p.thesisId, analyst: p.analyst, direction: p.direction };
    const orders = p.orders
      .filter((o) => o.status === "FILLED" || o.status === "AWAITING_APPROVAL")
      .sort((x, y) => (x.filledAt ?? x.createdAt).getTime() - (y.filledAt ?? y.createdAt).getTime());
    const hasOpen = orders.some((o) => o.status === "FILLED" && o.side === "BUY" && (o.intent === "OPEN" || o.intent == null));
    const hasClose = orders.some((o) => o.status === "FILLED" && o.side === "SELL" && (o.intent === "CLOSE" || o.intent == null));
    // The position's own open and close stand in where the order rows are missing (positions from before they were kept).
    const synthOpen: FillOrder | null = !hasOpen && p.status !== "PENDING_APPROVAL"
      ? { id: `open-${p.id}`, side: "BUY", intent: "OPEN", status: "FILLED", quantity: p.quantity, filledQty: p.quantity, filledPrice: p.avgCost, filledAt: p.openedAt, createdAt: p.openedAt, rationale: null, closeReason: null }
      : null;
    const synthClose: FillOrder | null = !hasClose && p.status === "CLOSED" && p.closedAt
      ? { id: `close-${p.id}`, side: "SELL", intent: "CLOSE", status: "FILLED", quantity: p.quantity, filledQty: p.quantity, filledPrice: p.closePrice, filledAt: p.closedAt, createdAt: p.closedAt, rationale: null, closeReason: p.closeReason }
      : null;
    const all = [...(synthOpen ? [synthOpen] : []), ...orders, ...(synthClose ? [synthClose] : [])].sort(
      (x, y) => (x.filledAt ?? x.createdAt).getTime() - (y.filledAt ?? y.createdAt).getTime(),
    );
    // Replay: the running average cost of the shares held, moved by buys and adds only.
    let held = 0;
    let avg = 0;
    for (const o of all) {
      const filled = o.status === "FILLED";
      const qty = o.filledQty ?? o.quantity;
      const price = o.filledPrice;
      const sell = o.side === "SELL";
      const closing = filled && sell && p.status === "CLOSED" && (o.intent === "CLOSE" || o.intent == null);
      let result: FillFacts["result"] = null;
      if (filled && sell && price != null) {
        if (o.id === `close-${p.id}` || (held <= 0 && wholeResult)) {
          // No fills of its own to replay against: the position's result is the sale's.
          result = wholeResult;
        } else if (avg > 0) {
          const dollar = (price - avg) * qty * (p.direction === "SHORT" ? -1 : 1);
          result = { dollar, pct: (dollar / (avg * qty)) * 100 };
        }
      }
      out.push({
        ...base,
        id: o.id,
        side: sell ? "SELL" : "BUY",
        intent: o.intent ?? (sell ? (closing ? "CLOSE" : "PARTIAL_CLOSE") : "OPEN"),
        status: o.status,
        quantity: qty,
        price,
        at: (o.filledAt ?? o.createdAt).toISOString(),
        rationale: o.rationale,
        result,
        closeReason: closing ? (o.closeReason ?? p.closeReason) : null,
      });
      if (filled && price != null) {
        if (!sell) {
          avg = held + qty > 0 ? (avg * held + price * qty) / (held + qty) : price;
          held += qty;
        } else {
          held = Math.max(0, held - qty);
        }
      }
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** The stock's total: how many sells, what they realized, and what is still held. */
export function fillSummary(fills: FillFacts[]): { sells: number; realized: number } {
  const sold = fills.filter((f) => f.status === "FILLED" && f.side === "SELL");
  return { sells: sold.length, realized: sold.reduce((sum, f) => sum + (f.result?.dollar ?? 0), 0) };
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
