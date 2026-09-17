/**
 * stock-activity.test.ts — the stock page's volume and insider-buying reads.
 *
 * Insider buying replays Finnhub's real reply for AMH (fetched 2026-09-17):
 * 13 purchase lines from 2 people in 90 days, on 4 filing-days.
 */

import insiders from "./__fixtures__/finnhub-insiders-AMH-2026-09-17.json";

const bars = Array.from({ length: 21 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, "0")}`, open: 1, high: 1, low: 1, close: 1, volume: 1_000_000 + i * 100_000 }));
const dailyBars = jest.fn();
const sessionBars = jest.fn();
jest.mock("@/lib/alpaca", () => ({
  getDailyBars: (...a: unknown[]) => dailyBars(...a),
  getTodaySessionBars: (...a: unknown[]) => sessionBars(...a),
}));
const finnhub = jest.fn();
jest.mock("@/lib/agent/research-helpers", () => ({ finnhub: (...a: unknown[]) => finnhub(...a) }));

import { getInsiderBuying, getStockVolume } from "./stock-activity";

const NOW = new Date("2026-09-17T01:30:00Z");

describe("volume", () => {
  it("today against the last 20 completed sessions — the VOLUME_RATIO comparison", async () => {
    dailyBars.mockResolvedValue({ feed: "sip", bars });
    sessionBars.mockResolvedValue({ AMH: { close: 1, high: 1, low: 1, volume: 5_000_000 } });
    const v = await getStockVolume("amh", NOW);
    // Last 20 of 21 bars: volumes 1.1M … 3.0M, mean 2.05M.
    expect(v).toEqual({ today: 5_000_000, avg20: 2_050_000, ratio: 5_000_000 / 2_050_000, feed: "sip" });
  });

  it("never shows the partial IEX feed as the market's volume", async () => {
    dailyBars.mockResolvedValue({ feed: "iex", bars });
    sessionBars.mockResolvedValue({});
    const v = await getStockVolume("AMH", NOW);
    expect(v.today).toBeNull();
    expect(v.error).toBe("Only the partial (IEX) feed answered — no market volume");
  });
});

describe("insider buying", () => {
  it("AMH: two insiders, four purchase days, 15,000 shares in 90 days", async () => {
    finnhub.mockResolvedValue({ data: insiders });
    const r = await getInsiderBuying("AMH", NOW);
    expect(r.last90?.buyers).toBe(2);
    expect(r.last90?.buys).toHaveLength(4);
    expect(r.last90?.netShares).toBe(15_000);
    expect(r.last30?.buyers).toBeLessThanOrEqual(2);
  });

  it("a failed read says so", async () => {
    finnhub.mockResolvedValue({ data: null, error: "rate limited" });
    const r = await getInsiderBuying("AMH", NOW);
    expect(r.error).toBe("Insider transactions unavailable");
  });
});
