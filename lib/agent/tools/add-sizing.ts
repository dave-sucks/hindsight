/**
 * add-sizing.ts — the two numbers an add is measured with, as one place.
 *
 * Both were computed off `position.avgCost`, the price we PAID. On the
 * approval path the order's share count is what Alpaca is sent, so a winner
 * bought more stock than the dollar figure the principal approved, and the
 * most-in-one-stock check compared today's add against yesterday's value.
 * Both use the live price, falling back to the average cost when the quote
 * fails — the old behaviour, and no worse.
 */

/** The shares a dollar add buys at the price it will actually pay. */
export function addShareCount(notional: number, livePrice: number | null | undefined, avgCost = 0): number {
  const price = livePrice != null && livePrice > 0 ? livePrice : avgCost;
  if (!(price > 0)) return 1;
  return Math.max(1, Math.floor(notional / price));
}

/** What the position is worth now, for the most-in-one-stock check. */
export function addPositionValue(quantity: number, price: number): number {
  return quantity * price;
}
