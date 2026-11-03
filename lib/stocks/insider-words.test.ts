import { insiderRows, insiderSummary } from "./insider-words";
import type { StockInsiderBuying } from "@/lib/market-data/stock-activity";

const buy = (date: string, name: string, shares: number, price: number) => ({ date, name, shares, price, lowPrice: price });

describe("insiderSummary — open-market buying in one sentence", () => {
  it("buys in the window: count, buyers, shares, the lowest price, and the last 30 days", () => {
    const d: StockInsiderBuying = {
      last90: { buyers: 2, names: ["A", "B"], netShares: 12500, lowestPrice: 41.2, days: 90, buys: [buy("2026-10-14", "A", 10000, 42.1), buy("2026-09-02", "B", 2500, 41.2)] },
      last30: { buyers: 1, names: ["A"], netShares: 10000, lowestPrice: 42.1, days: 30, buys: [buy("2026-10-14", "A", 10000, 42.1)] },
    };
    expect(insiderSummary(d)).toBe("2 open-market buys by 2 insiders in the last 90 days (12,500 shares, lowest $41.20). 1 insider bought in the last 30 days.");
    expect(insiderRows(d)).toEqual([
      { date: "2026-10-14", name: "A", text: "10,000 shares at $42.10" },
      { date: "2026-09-02", name: "B", text: "2,500 shares at $41.20" },
    ]);
  });

  it("none in the window, and a read that failed", () => {
    expect(insiderSummary({ last90: { buyers: 0, names: [], netShares: 0, lowestPrice: null, days: 90, buys: [] }, last30: null })).toBe("No open-market buys by insiders in the last 90 days.");
    expect(insiderSummary({ last90: null, last30: null, error: "Insider transactions unavailable" })).toBe("Insider transactions unavailable.");
    expect(insiderSummary(null)).toBe("Insider transactions unavailable.");
    expect(insiderRows(null)).toEqual([]);
  });
});
