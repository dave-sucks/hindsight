/**
 * manage-position.add-sizing.test.ts — an add buys the dollars it was asked
 * for, at today's price.
 *
 * Found by an adversarial audit, 2026-09-18. `add_to_position` sized its
 * order with `notional ÷ position.avgCost` — the price we PAID, not the
 * price we are about to pay. On the approval path that share count is what
 * Alpaca is sent, so the error lands on exactly the positions worth adding
 * to: a winner up 30% buys 30% more stock than the dollar figure on the
 * card, and the most-in-one-stock check is measured at the old price too.
 *
 * Real shapes from the book, 2026-09-18: SMMT cost $14.35 and trades near
 * $18.00 (+25%); MU cost $895.94 and trades near $927.60 (+3.5%).
 */
import { addShareCount, addPositionValue } from "./add-sizing";

describe("$5,000 added to SMMT, bought at $14.35, trading at $18.00", () => {
  it("buys 277 shares at today's price — $4,986, the dollars asked for", () => {
    expect(addShareCount(5000, 18.0)).toBe(277);
    expect(277 * 18.0).toBeCloseTo(4986, 0);
  });

  it("the old sizing bought 348 shares — $6,264, a quarter more than asked", () => {
    expect(addShareCount(5000, 14.35)).toBe(348);
    expect(348 * 18.0).toBeCloseTo(6264, 0);
  });
});

describe("the most-in-one-stock check", () => {
  it("values what we already hold at today's price, not what we paid", () => {
    // 348 SMMT shares are worth $6,264 today, not the $4,994 they cost.
    expect(addPositionValue(348, 18.0)).toBeCloseTo(6264, 0);
    expect(addPositionValue(348, 14.35)).toBeCloseTo(4993.8, 0);
  });
});

describe("when the quote fails", () => {
  it("falls back to the average cost — the old behaviour, never zero shares", () => {
    expect(addShareCount(5000, null, 14.35)).toBe(348);
    expect(addShareCount(5000, 0, 14.35)).toBe(348);
    // MU: a $10,000 add at $927.60 is 10 shares, not the 11 the old sizing bought.
    expect(addShareCount(10000, 927.6, 895.935)).toBe(10);
    expect(addShareCount(10000, null, 895.935)).toBe(11);
  });
  it("never sizes below one share", () => {
    expect(addShareCount(50, 927.6, 895.935)).toBe(1);
  });
});
