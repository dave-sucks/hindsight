/**
 * get_stock_data says what today's volume is: a count so far, N minutes into
 * the session, against a full day's 20-day average; and the last session's,
 * labelled as that day's.
 *
 * Replayed from the owner's chat of 2026-11-19 (run cmwnorgxo000907jmldpk92up),
 * which called get_stock_data at 10:09:24 ET, 39 minutes after the bell:
 * - P (Everpure): 1,516,014 shares so far, 0.48× a full day's average; the
 *   last session (Nov 18) 2.29×. The chat passed on it: "volume today is only
 *   0.48× … a hard no".
 * - PANW: 5,021,367 so far, 0.73×; the last session 2.74×. The chat bought it
 *   on "volume today is 2.74×", the day before's.
 * The row said "volume 0.48× normal today". The bars below are built so the
 * tool's own arithmetic gives those ratios.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/agent/research-helpers", () => ({
  finnhub: jest.fn(async (path: string) => (path.startsWith("/stock/profile2") ? { data: { name: "Everpure Inc", finnhubIndustry: "Technology", exchange: "NYSE", country: "US" } } : { data: null })),
}));
jest.mock("@/lib/market-data/live-quote", () => ({
  getLiveQuote: jest.fn(async () => ({ quote: { c: 112.51, t: Math.floor(Date.parse("2026-11-19T15:09:24Z") / 1000), pc: 100.74, d: 11.77, dp: 11.68, o: 106.3, h: 113.8, l: 103.5, source: "alpaca" } })),
}));
const SESSION = { soFar: 0, lastRatio: 0, ratio: 0 };
jest.mock("@/lib/alpaca", () => ({
  // 260 sessions to Nov 18: 259 at one volume, the last at lastRatio× it, so the
  // tool's 20-day average (the last 20, Nov 18 in it) makes today's ratio.
  getDailyBars: jest.fn(async () => {
    const v = SESSION.soFar / (SESSION.ratio * ((19 + SESSION.lastRatio) / 20));
    const bars = Array.from({ length: 260 }, (_, i) => {
      const date = new Date(Date.UTC(2025, 10, 19) + i * 86_400_000 * (365 / 260)).toISOString().slice(0, 10);
      const close = 100 + (i % 30);
      return { date: i === 259 ? "2026-11-18" : date, open: close, high: close + 2, low: close - 2, close, volume: i === 259 ? Math.round(v * SESSION.lastRatio) : Math.round(v) };
    });
    return { feed: "sip", bars };
  }),
  getTodaySessionBars: jest.fn(async (syms: string[]) => ({ [syms[0]]: { volume: SESSION.soFar } })),
}));
jest.mock("@/lib/market-data/benchmark-bars", () => ({ CHART_SESSIONS: 260, getBenchmarkBars: jest.fn(async () => undefined) }));
jest.mock("@/lib/agent/context-bundle", () => ({
  getTickerHistory: jest.fn(async () => null),
  formatTickerHistory: jest.fn(() => null),
  formatTickerHistoryShort: jest.fn(() => null),
}));

import { getStockData } from "./get-stock-data";
import type { ToolContext } from "@/lib/agent/tool-context";

const at = (iso: string) => jest.useFakeTimers({ now: new Date(iso), doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "queueMicrotask", "hrtime", "performance"] });
afterEach(() => jest.useRealTimers());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const read = async (ticker: string, soFar: number, ratio: number, lastRatio: number): Promise<any> => {
  Object.assign(SESSION, { soFar, ratio, lastRatio });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (getStockData({ runId: "chat_1119", userId: "u", accountId: "a", groupId: (p: string) => p } as unknown as ToolContext) as any).execute({ ticker });
};

describe("today's volume says it is part of a day (the owner's chat, 2026-11-19 10:09 ET)", () => {
  it("P: 0.48× after 39 minutes is a count so far, with the last session's 2.29× labelled as Nov 18's", async () => {
    at("2026-11-19T15:09:24Z");
    const out = await read("P", 1_516_014, 0.48, 2.29);
    const today = out.data.technicals.today;
    expect(today).toMatchObject({ volumeSoFar: 1_516_014, volumeVsAvg20: 0.48, minutesIntoSession: 39, sessionMinutes: 390 });
    expect(today.volumeRead).toBe("so far today, 39 minutes into the 390-minute session: 0.48× a full day's 20-day average; the last full session (2026-11-18) was 2.29×");
    const row: string = out.data.tickers[0].summary;
    expect(row).toContain("volume so far today, 39 minutes into the 390-minute session: 0.48× a full day's 20-day average");
    expect(row).not.toContain("normal today");
  });

  it("PANW: today's 0.73× so far and the Nov 18 session's 2.74× read as two different days", async () => {
    at("2026-11-19T15:09:24Z");
    const out = await read("PANW", 5_021_367, 0.73, 2.74);
    expect(out.data.technicals.today.volumeRead).toBe("so far today, 39 minutes into the 390-minute session: 0.73× a full day's 20-day average; the last full session (2026-11-18) was 2.74×");
  });

  it("after the bell the day is whole, and says so", async () => {
    at("2026-11-19T21:30:00Z");
    const out = await read("P", 1_516_014, 0.48, 2.29);
    expect(out.data.technicals.today).toMatchObject({ minutesIntoSession: 390, sessionMinutes: 390 });
    expect(out.data.technicals.today.volumeRead).toBe("today's full session 0.48× its 20-day average; the last full session (2026-11-18) was 2.29×");
  });
});
