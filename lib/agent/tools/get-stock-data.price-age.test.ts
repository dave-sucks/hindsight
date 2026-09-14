/**
 * get-stock-data.price-age.test.ts — replayed from the 2026-09-14 chat
 * "review my pending sells".
 *
 * All four get_stock_data calls in that chat came back with the Finnhub quote
 * rate-limited ("Finnhub /quote rate limited (429) after 2 retries", verbatim
 * from the saved result). The tool measured NVDA's chart from Friday's
 * $218.29 close — 2.7% above its 50-day — while NVDA was trading ~$210.59,
 * below it, and nothing in the result or the row said so. The chat then
 * reasoned about NVDA as if above its 50-day.
 *
 * On main this test fails: no warning in the result, none in the row.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/agent/research-helpers", () => ({
  finnhub: jest.fn(async (path: string) => {
    if (path.startsWith("/quote")) return { data: null, error: "Finnhub /quote rate limited (429) after 2 retries" };
    if (path.startsWith("/stock/profile2")) {
      return { data: { name: "NVIDIA Corp", finnhubIndustry: "Semiconductors", marketCapitalization: 5_300_000, exchange: "NASDAQ", country: "US" } };
    }
    return { data: null };
  }),
}));
jest.mock("@/lib/alpaca", () => {
  // 260 sessions ending on NVDA's real Friday close: $218.29 on 2026-09-11.
  const bars = Array.from({ length: 260 }, (_, i) => {
    const d = new Date(Date.UTC(2025, 8, 12) + i * 86_400_000 * (365 / 260));
    const close = i === 259 ? 218.29 : 190 + (i % 40);
    return { date: i === 259 ? "2026-09-11" : d.toISOString().slice(0, 10), open: close, high: close + 2, low: close - 2, close, volume: 120_000_000 };
  });
  return {
    getDailyBars: jest.fn(async () => ({ feed: "sip", bars })),
    getTodaySessionBars: jest.fn(async () => ({ NVDA: { volume: 52_588_160 } })),
  };
});
jest.mock("@/lib/market-data/benchmark-bars", () => ({
  CHART_SESSIONS: 260,
  getBenchmarkBars: jest.fn(async () => undefined),
}));
jest.mock("@/lib/agent/context-bundle", () => ({
  getTickerHistory: jest.fn(async () => null),
  formatTickerHistory: jest.fn(() => null),
  formatTickerHistoryShort: jest.fn(() => null),
}));

import { getStockData } from "./get-stock-data";
import type { ToolContext } from "@/lib/agent/tool-context";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (): Promise<any> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (getStockData({ runId: "chat_0914", userId: "u", accountId: "a", groupId: (p: string) => p } as unknown as ToolContext) as any).execute({ ticker: "NVDA" });

describe("NVDA, 2026-09-14 chat — the live quote was rate-limited", () => {
  it("the result tells the agent, in words, that the price is Friday's close", async () => {
    const out = await run();
    expect(out.ok).toBe(true);
    expect(out.data.priceWarning).toBe(
      "Live price for $NVDA unavailable (the quote was rate-limited) — using the last close $218.29 (Fri, 09/11). " +
        "Distances to averages and levels are measured from that close, not today's price.",
    );
    // The model reads the summary first — the warning leads it.
    expect(out.summary.startsWith("⚠ Live price for $NVDA unavailable")).toBe(true);
  });

  it("the row shows the same line", async () => {
    const out = await run();
    expect(out.data.tickers[0].summary.startsWith("⚠ Live price unavailable — using Fri, 09/11 close $218.29")).toBe(true);
  });
});
