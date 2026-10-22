/**
 * What a buy or sell placed by hand may do — pure, so every rule is tested.
 * `lib/trading/manual-order.ts` reads the account, then asks this.
 *
 * The rules are the ones the agent paths already obey, nothing new: a sale
 * sells only what is held and never races a sale already sent; an add stays
 * inside the analyst's "most in one stock". One is the account's own: a buy is
 * paid from cash, never margin. A stop or target is optional (the analyst sets
 * what's missing); one given sits below / above the price, as a sell trigger.
 */

/** What a buy on this lane does. */
export type BuyLane =
  | { kind: "ADD"; maxShares: number; cap: number }
  | {
      kind: "OPEN";
      /** The WATCHING thesis the buy lands on; null when the analyst doesn't watch the stock yet. */
      thesisId: string | null;
      /** No view yet (a seed, or not watched): the buy makes it LONG and the writer is sent to research it. */
      needsResearch: boolean;
      targetPrice: number | null;
      stopLoss: number | null;
    }
  | { kind: "NONE"; reason: string };

/** One analyst's side of a stock: what it holds and what a buy would do. */
export interface TradeLane {
  analystId: string;
  analystName: string;
  position: { id: string; shares: number; avgCost: number } | null;
  /** Why a sale can't go now; null when it can (or there's nothing to sell). */
  sellBlocked: string | null;
  buy: BuyLane;
}

export interface ManualOrderInput {
  side: "BUY" | "SELL";
  shares: number;
  /** The price on the review screen — the order is refused if the market has moved off it. */
  reviewedPrice: number;
  /** A new holding only. */
  targetPrice?: number | null;
  stopLoss?: number | null;
}

export type ManualOrderPlan =
  | { ok: true; intent: "OPEN" | "ADD" | "CLOSE" | "PARTIAL_CLOSE"; shares: number }
  | { ok: false; error: string };

/** How far the price may move between the review screen and the click. */
export const MAX_PRICE_MOVE = 0.02;

const sameShares = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** What the market and the account say right now. */
export interface MarketNow {
  price: number;
  /** The market is open and the quote isn't from the last 15 minutes. */
  stale: boolean;
  /** The account's cash (Alpaca `cash`, never `buying_power`); null when it couldn't be read. */
  cash: number | null;
}

export function planManualOrder(
  lane: TradeLane,
  input: ManualOrderInput,
  market: MarketNow,
): ManualOrderPlan {
  const livePrice = market.price;
  const priceStale = market.stale;
  const { side, shares, reviewedPrice } = input;
  if (!Number.isFinite(shares) || shares <= 0) return { ok: false, error: "Enter how many shares." };
  if (!Number.isFinite(livePrice) || livePrice <= 0) return { ok: false, error: "There's no price for this stock right now." };
  if (!Number.isFinite(reviewedPrice) || reviewedPrice <= 0) return { ok: false, error: "Review the order again." };
  const move = Math.abs(livePrice - reviewedPrice) / reviewedPrice;
  if (move > MAX_PRICE_MOVE) {
    return {
      ok: false,
      error: `The price moved from $${reviewedPrice.toFixed(2)} to $${livePrice.toFixed(2)} since you reviewed it. Review the order again.`,
    };
  }

  if (side === "SELL") {
    const pos = lane.position;
    if (!pos) return { ok: false, error: `${lane.analystName} holds no shares of this stock.` };
    if (lane.sellBlocked) return { ok: false, error: lane.sellBlocked };
    // All of it: the share count held, fractional or not.
    if (sameShares(shares, pos.shares)) return { ok: true, intent: "CLOSE", shares: pos.shares };
    if (!Number.isInteger(shares)) return { ok: false, error: "Sell whole shares, or all of them." };
    if (shares > pos.shares) {
      return { ok: false, error: `You hold ${pos.shares} shares — you can't sell ${shares}.` };
    }
    return { ok: true, intent: "PARTIAL_CLOSE", shares };
  }

  // A buy never acts on a stale quote (DAV-261): at 09:30 yesterday's close
  // can be served as "now", and the stop would be checked against it.
  if (priceStale) return { ok: false, error: "The price isn't live right now — try again in a minute." };
  if (!Number.isInteger(shares)) return { ok: false, error: "Buy whole shares." };
  const short = cashShortfall(shares * livePrice, market.cash);
  if (short) return { ok: false, error: short };
  const buy = lane.buy;
  if (buy.kind === "NONE") return { ok: false, error: buy.reason };
  if (buy.kind === "ADD") {
    if (buy.maxShares < 1) {
      return { ok: false, error: `This stock is already at ${lane.analystName}'s most in one stock ($${buy.cap.toFixed(0)}).` };
    }
    if (shares > buy.maxShares) {
      return {
        ok: false,
        error: `Only ${buy.maxShares} more share${buy.maxShares === 1 ? "" : "s"} fit ${lane.analystName}'s most in one stock ($${buy.cap.toFixed(0)}).`,
      };
    }
    return { ok: true, intent: "ADD", shares };
  }

  // A new holding: a level given becomes a sell trigger on the fill, so it
  // sits on the right side of the price; one left out is the analyst's to set.
  const { targetPrice, stopLoss } = input;
  if (stopLoss != null && (!Number.isFinite(stopLoss) || stopLoss <= 0)) return { ok: false, error: "The stop isn't a price." };
  if (targetPrice != null && (!Number.isFinite(targetPrice) || targetPrice <= 0)) return { ok: false, error: "The target isn't a price." };
  if (stopLoss != null && stopLoss >= livePrice) {
    return { ok: false, error: `The stop ($${stopLoss.toFixed(2)}) has to be below the price ($${livePrice.toFixed(2)}).` };
  }
  if (targetPrice != null && targetPrice <= livePrice) {
    return { ok: false, error: `The target ($${targetPrice.toFixed(2)}) has to be above the price ($${livePrice.toFixed(2)}).` };
  }
  return { ok: true, intent: "OPEN", shares };
}

/** A buy is paid from cash, never margin: why this one can't be, or null. The Trade button and a trigger set to Do it ask this. */
export function cashShortfall(cost: number, cash: number | null): string | null {
  if (cash == null) return "Couldn't read the account's cash — try again.";
  return cost > cash ? `You have ${usd(cash)} in cash; this buy is ${usd(cost)}.` : null;
}

/**
 * Shares an add may buy and stay inside the analyst's "most in one stock" —
 * the same arithmetic approveProposal runs under the position lock: held
 * shares at cost, shares already being bought at the price now.
 */
export function addRoom(opts: {
  cap: number;
  heldShares: number;
  avgCost: number;
  sentShares: number;
  price: number;
}): number {
  const room = opts.cap - opts.heldShares * opts.avgCost - opts.sentShares * opts.price;
  return opts.price > 0 ? Math.max(0, Math.floor(room / opts.price)) : 0;
}
