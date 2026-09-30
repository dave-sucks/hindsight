/**
 * floor-risk.ts — what a holding loses if its floor is hit, against the
 * account (DAV-344, QB ruling — Dave delegated).
 *
 * A new buy is sized so the floor loses about 1% of the account
 * (`sizeByRisk`: equity × riskPct × conviction ÷ |entry − stop|). Nothing
 * checked it again after the buy. CEG, Secular Compounder: priced in June at
 * $250 with a $220 floor; bought 2026-08-13 at $280.33, 10% above the plan,
 * the floor left at June's $220 — 21.5% under the fill. An add on 09-14 took
 * it to 39 shares at $276.90. On 09-30 the floor would have lost $2,219,
 * 2.0% of a $113,065 account, and twenty review fires in two weeks were each
 * answered "hold, business intact" — not one moved the floor.
 *
 * The rule: a holding whose floor would lose more than `FLOOR_RISK_MAX_PCT`
 * of the account is flagged, and the next run answers it: move the floor
 * under real structure, trim so the loss fits, or say why this floor stands.
 * A flag, never a refusal — nothing here sells or moves a level.
 *
 * Measured from what we paid (Position.avgCost × quantity), the way the buy
 * was sized — not from today's price. Every fill, the first buy or an add,
 * rewrites the cost and the share count, so the first read after a fill is
 * checked against that fill.
 *
 * Pure. The floor is the tightest protective exit the ladder holds
 * (ladder-health), inherited sell rules included.
 */

/** A holding's floor may risk at most this % of the account. */
export const FLOOR_RISK_MAX_PCT = 1.5;

/** The chart numbers the flag names as places a floor could go. */
export interface FloorStructure {
  low20?: number | null;
  sma20?: number | null;
  sma50?: number | null;
  sma200?: number | null;
}

export interface FloorRisk {
  floorPrice: number;
  avgCost: number;
  quantity: number;
  /** Dollars lost from cost if the floor is hit. Never negative. */
  lossAtFloor: number;
  equity: number;
  /** lossAtFloor ÷ equity, percent, one decimal. */
  pctOfAccount: number;
  /** Structure between the floor and the price, nearest the price first. */
  structureBelow: Array<{ label: string; price: number }>;
  /** The flag in one sentence, with the numbers. */
  line: string;
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usd0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * The flag, or null when the floor's loss fits (or there is not enough to
 * measure: no floor, no position size, no equity).
 */
export function floorTooFar(input: {
  ticker?: string;
  direction: string | null;
  avgCost: number | null;
  quantity: number | null;
  floorPrice: number | null;
  equity: number | null;
  currentPrice: number | null;
  structure?: FloorStructure | null;
}): FloorRisk | null {
  const { avgCost, quantity, floorPrice, equity } = input;
  if (avgCost == null || !(avgCost > 0) || quantity == null || !(quantity > 0)) return null;
  if (floorPrice == null || !(floorPrice > 0) || equity == null || !(equity > 0)) return null;

  const short = input.direction === "SHORT";
  const lossAtFloor = Math.max(0, short ? floorPrice - avgCost : avgCost - floorPrice) * quantity;
  const pct = (lossAtFloor / equity) * 100;
  if (pct <= FLOOR_RISK_MAX_PCT) return null;
  const pctOfAccount = Math.round(pct * 10) / 10;

  // Where a floor could go: structure between the floor and the price, on
  // the side the floor sits. The swing low is not in the daily snapshot —
  // get_stock_data has it.
  const price = input.currentPrice ?? avgCost;
  const s = input.structure ?? {};
  const candidates: Array<{ label: string; price: number | null | undefined }> = [
    { label: "20-day low", price: s.low20 },
    { label: "20-day average", price: s.sma20 },
    { label: "50-day average", price: s.sma50 },
    { label: "200-day average", price: s.sma200 },
  ];
  const structureBelow = candidates
    .filter((c): c is { label: string; price: number } => c.price != null && c.price > 0)
    .filter((c) => (short ? c.price > price && c.price < floorPrice : c.price < price && c.price > floorPrice))
    .map((c) => ({ label: c.label, price: Math.round(c.price * 100) / 100 }))
    .sort((a, b) => (short ? a.price - b.price : b.price - a.price));

  const line =
    `${input.ticker ? `$${input.ticker}: at` : "At"} the ${usd(floorPrice)} floor, ${quantity} shares bought at an average ${usd(avgCost)} lose ${usd0(lossAtFloor)} — ` +
    `${pctOfAccount.toFixed(1)}% of the ${usd0(equity)} account, over the ${FLOOR_RISK_MAX_PCT}% a floor may risk (a buy is sized to about 1%). ` +
    (structureBelow.length
      ? `Structure ${short ? "above" : "below"} the ${usd(price)} price: ${structureBelow.map((x) => `${x.label} ${usd(x.price)}`).join(", ")}. `
      : "") +
    `Answer it: move the floor under real structure, trim so the loss at the floor fits, or say why this floor stands — "hold, business intact" alone does not answer it.`;

  const cents = (n: number) => Math.round(n * 100) / 100;
  return { floorPrice: cents(floorPrice), avgCost: cents(avgCost), quantity, lossAtFloor: cents(lossAtFloor), equity, pctOfAccount, structureBelow, line };
}
