/**
 * ensure-snapshots.test.ts — a ticker added since 06:30 gets its snapshot
 * computed on the spot instead of reading false until tomorrow.
 */

const upsert = jest.fn().mockResolvedValue({});
jest.mock("@/lib/prisma", () => ({ prisma: { tickerIndicators: { upsert: (...a: unknown[]) => upsert(...a) } } }));
jest.mock("@/lib/market-data/benchmark-bars", () => ({
  CHART_SESSIONS: 260,
  getBenchmarkBars: jest.fn().mockResolvedValue([]),
}));
const bars = Array.from({ length: 260 }, (_, i) => ({
  date: new Date(Date.UTC(2025, 0, 1) + i * 86400_000).toISOString().slice(0, 10),
  open: 100 + i,
  high: 101 + i,
  low: 99 + i,
  close: 100 + i,
  volume: 1_000_000,
}));
const getDailyBars = jest.fn().mockResolvedValue({ feed: "sip", bars });
jest.mock("@/lib/alpaca", () => ({ getDailyBars: (...a: unknown[]) => getDailyBars(...a) }));
jest.mock("@/lib/market-data/load-indicators", () => ({
  loadIndicatorSnapshots: jest.fn().mockResolvedValue(new Map([["HAVE", { asOf: "2026-09-10" }]])),
}));

import { ensureIndicatorSnapshots } from "./ensure-snapshots";

describe("ensureIndicatorSnapshots", () => {
  beforeEach(() => {
    upsert.mockClear();
    getDailyBars.mockClear();
  });

  it("returns the stored snapshots and fills only the missing ones", async () => {
    const out = await ensureIndicatorSnapshots(["HAVE", "NEW"]);
    expect(getDailyBars).toHaveBeenCalledTimes(1);
    expect(getDailyBars.mock.calls[0][0]).toBe("NEW");
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(out.get("NEW")?.sma[50]).toBeGreaterThan(0);
    expect(out.has("HAVE")).toBe(true);
  });

  it("fills at most maxFills per pass", async () => {
    await ensureIndicatorSnapshots(["A", "B", "C"], { maxFills: 2 });
    expect(getDailyBars).toHaveBeenCalledTimes(2);
  });

  it("a failed fill leaves the ticker out, not the pass broken", async () => {
    getDailyBars.mockRejectedValueOnce(new Error("vendor down"));
    const out = await ensureIndicatorSnapshots(["BAD"]);
    expect(out.has("BAD")).toBe(false);
  });
});
