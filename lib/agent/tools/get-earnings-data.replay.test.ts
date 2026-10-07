/**
 * get-earnings-data.replay.test.ts — a report that already happened is not
 * the next one.
 *
 * Production, 2026-10-07: Finnhub's earnings calendar for JBL returned one
 * entry, the 2026-09-30 report, actuals included. get_earnings_data handed
 * it back as `nextEarnings` and its summary said "next earnings 2026-09-30",
 * so an agent read a report a week old as one still ahead. KMX was the same
 * (2026-09-29). The replies below are Finnhub's, as read that morning.
 */
import { replayTool } from "@/lib/replay";

const AT = new Date("2026-10-07T07:09:46Z");

const CALENDAR = {
  earningsCalendar: [
    { symbol: "JBL", date: "2026-09-30", hour: "bmo", quarter: 4, year: 2026, epsEstimate: 4.109, epsActual: 4.4, revenueEstimate: 9808790740, revenueActual: 10616000000 },
  ],
};
const HISTORY = [
  { symbol: "JBL", estimate: 4.109, actual: 4.4, period: "2026-09-30", surprise: 0.291, surprisePercent: 7.082, year: 2026, quarter: 4 },
  { symbol: "JBL", estimate: 3.1303, actual: 3.16, period: "2026-06-30", surprise: 0.0297, surprisePercent: 0.9488, year: 2026, quarter: 3 },
  { symbol: "JBL", estimate: 2.5329, actual: 2.69, period: "2026-03-31", surprise: 0.1571, surprisePercent: 6.2024, year: 2026, quarter: 2 },
  { symbol: "JBL", estimate: 2.7267, actual: 2.85, period: "2025-12-31", surprise: 0.1233, surprisePercent: 4.5219, year: 2026, quarter: 1 },
];

async function readJbl(calendar = CALENDAR) {
  jest.useFakeTimers({
    now: AT,
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  try {
    return await replayTool("get-earnings-data", "getEarningsData", {
      args: { ticker: "JBL" },
      // Finnhub as it answered for JBL that morning.
      mocks: {
        "@/lib/agent/research-helpers": () => ({
          ...jest.requireActual("@/lib/agent/research-helpers"),
          finnhub: jest.fn(async (path: string) =>
            path.startsWith("/calendar/earnings") ? { data: calendar } : path.startsWith("/stock/earnings") ? { data: HISTORY } : { data: null },
          ),
        }),
      },
    });
  } finally {
    jest.useRealTimers();
  }
}

describe("get_earnings_data — JBL as read on 2026-10-07", () => {
  it("does not call the 2026-09-30 report the next one", async () => {
    const { result, crashed } = await readJbl();
    expect(crashed).toBe(false);
    expect(result.data?.nextEarnings).toBeNull();
    expect(result.summary).toContain("last reported 2026-09-30; next date not yet announced");
    expect(result.summary).not.toMatch(/next earnings 2026-09-30/i);
  });

  it("a date still ahead is the next one, as before", async () => {
    const { result } = await readJbl({
      earningsCalendar: [{ ...CALENDAR.earningsCalendar[0], date: "2026-12-16", epsActual: null as unknown as number, revenueActual: null as unknown as number }],
    });
    expect(result.data?.nextEarnings).toEqual({ date: "2026-12-16", epsEstimate: 4.109 });
    expect(result.summary).toContain("next earnings 2026-12-16");
  });
});
