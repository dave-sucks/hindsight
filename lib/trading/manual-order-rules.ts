/**
 * What a buy or sell placed by hand may do — pure, so every rule is tested.
 * `lib/trading/manual-order.ts` reads the account, then asks this.
 *
 * The rules are the ones the agent paths already obey, nothing new: a sale
 * sells only what is held and never races a sale already sent; an add stays
 * inside the analyst's "most in one stock"; a new holding needs a floor below
 * the price and a target above it, because those become its sell triggers.
 */

/** What a buy on this lane does. */
export type BuyLane =
  | { kind: "ADD"; maxShares: number; cap: number }
  | { kind: "OPEN"; thesisId: string; targetPrice: number | null; stopLoss: number | null }
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

export function planManualOrder(
  lane: TradeLane,
  input: ManualOrderInput,
  livePrice: number,
): ManualOrderPlan {
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

  if (!Number.isInteger(shares)) return { ok: false, error: "Buy whole shares." };
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

  // A new holding: its floor and target become the stock's sell triggers on
  // the fill, so both are required and must sit on the right side of the price.
  const { targetPrice, stopLoss } = input;
  if (stopLoss == null || !Number.isFinite(stopLoss) || stopLoss <= 0) return { ok: false, error: "Set a stop." };
  if (targetPrice == null || !Number.isFinite(targetPrice) || targetPrice <= 0) return { ok: false, error: "Set a target." };
  if (stopLoss >= livePrice) {
    return { ok: false, error: `The stop ($${stopLoss.toFixed(2)}) has to be below the price ($${livePrice.toFixed(2)}).` };
  }
  if (targetPrice <= livePrice) {
    return { ok: false, error: `The target ($${targetPrice.toFixed(2)}) has to be above the price ($${livePrice.toFixed(2)}).` };
  }
  return { ok: true, intent: "OPEN", shares };
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
