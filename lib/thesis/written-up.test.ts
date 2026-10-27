/**
 * written-up.test.ts — the price under the belief is what the stock cost when
 * the writer wrote it up. From production: IOT's mint on 2026-09-13 stamped
 * its CREATED row at $39.55 (the buy level); the writer's pull read $38.38.
 */
import { writtenUpPrice } from "./written-up";

describe("the write-up's price", () => {
  it("IOT, 2026-09-13: the writer's pull, $38.38, not the $39.55 buy level on the CREATED row", () => {
    expect(writtenUpPrice({ type: "CREATED", priceAtTime: 39.55 }, { ticker: "IOT", pullErrors: [], currentPrice: 38.38 })).toBe(38.38);
  });

  it("a mint with no pull on record shows the date alone", () => {
    expect(writtenUpPrice({ type: "CREATED", priceAtTime: 39.55 }, null)).toBeNull();
    expect(writtenUpPrice({ type: "CREATED", priceAtTime: 39.55 }, { currentPrice: null })).toBeNull();
  });

  it("a refresh with no pull on record falls back to its row, which stamps the pulled price", () => {
    expect(writtenUpPrice({ type: "UPDATED", priceAtTime: 42.1 }, null)).toBe(42.1);
  });

  it("no writer row: no price", () => {
    expect(writtenUpPrice(null, null)).toBeNull();
  });
});
