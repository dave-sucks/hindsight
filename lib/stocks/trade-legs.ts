import type { FillFacts } from "./stock-history";

/** One side of a trade, all its fills as one: the shares, their average price and what they came to. */
export type TradeLeg = {
  /** The first buy on the way in, the last sale on the way out. */
  at: string;
  shares: number;
  price: number;
  total: number;
  /** How many fills made it: an open and its adds, or the trims and the close. */
  count: number;
};

export type TradeLegs = {
  entry: TradeLeg | null;
  exit: TradeLeg | null;
  /** What the sales made against the average cost, trims included; null when a sale has no result of its own. */
  realized: number | null;
};

/** The position as it stores itself, for a trade whose fills are not at hand. */
export type LegPosition = {
  id?: string;
  quantity: number;
  avgCost: number;
  openedAt: string;
  closed?: boolean;
  closedAt?: string | null;
  closePrice?: number | null;
  realizedPnl?: number | null;
};

function leg(fills: FillFacts[], at: "first" | "last"): TradeLeg | null {
  const priced = fills.filter((f) => f.price != null && f.quantity > 0);
  if (priced.length === 0) return null;
  const shares = priced.reduce((sum, f) => sum + f.quantity, 0);
  const total = priced.reduce((sum, f) => sum + (f.price as number) * f.quantity, 0);
  const times = priced.map((f) => f.at).sort();
  return { at: at === "first" ? times[0] : times[times.length - 1], shares, price: total / shares, total, count: priced.length };
}

/**
 * A trade's two sides from its fills: everything bought (the open and its
 * adds) and everything sold (its trims and its close). The position row alone
 * says less than this once a trade is trimmed: at the close it keeps the
 * shares that were left and the last sale's price and gain. With no fills at
 * hand the sides are read off the position.
 */
export function tradeLegs(position: LegPosition, fills: FillFacts[]): TradeLegs {
  const own = position.id ? fills.filter((f) => f.positionId === position.id && f.status === "FILLED") : [];
  const bought = own.filter((f) => f.intent === "OPEN" || f.intent === "ADD");
  const sold = own.filter((f) => f.intent === "PARTIAL_CLOSE" || f.intent === "CLOSE");
  const entry = leg(bought, "first");
  if (!entry) {
    const cost = position.avgCost * position.quantity;
    const sale = position.closed && position.closePrice != null && position.closedAt ? position.closePrice * position.quantity : null;
    return {
      entry: { at: position.openedAt, shares: position.quantity, price: position.avgCost, total: cost, count: 1 },
      exit: sale != null ? { at: position.closedAt as string, shares: position.quantity, price: position.closePrice as number, total: sale, count: 1 } : null,
      realized: position.closed ? (position.realizedPnl ?? null) : null,
    };
  }
  const exit = leg(sold, "last");
  const realized = exit && sold.every((f) => f.result != null) ? sold.reduce((sum, f) => sum + (f.result?.dollar ?? 0), 0) : null;
  return { entry, exit, realized };
}
