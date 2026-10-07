/**
 * get-earnings-data.replay.test.ts — the next report is the scheduled one.
 *
 * Production, 2026-10-07: asked by symbol alone, Finnhub's earnings calendar
 * answered JBL with one entry, the 2026-09-30 report, actuals in.
 * get_earnings_data handed it back as `nextEarnings` and its summary said
 * "next earnings 2026-09-30". Asked for a window, the same calendar has
 * 2026-12-15 and 2027-03-16 scheduled. Both replies below are Finnhub's own,
 * read that morning; the double answers each query the way Finnhub did.
 */
import { replayTool } from "@/lib/replay";

const AT = new Date("2026-10-07T07:09:46Z");

const PAST = { symbol: "JBL", date: "2026-09-30", hour: "bmo", quarter: 4, year: 2026, epsEstimate: 4.109, epsActual: 4.4, revenueEstimate: 9808790740, revenueActual: 10616000000 };
/** By symbol alone. */
const SYMBOL_ONLY = { earningsCalendar: [PAST] };
/** With from/to, 100 days back to 180 ahead. */
const WINDOWED = {
  earningsCalendar: [
    { symbol: "JBL", date: "2027-03-16", hour: "", quarter: 2, year: 2027, epsEstimate: 3.8667, epsActual: null, revenueEstimate: 10252411191, revenueActual: null },
    { symbol: "JBL", date: "2026-12-15", hour: "", quarter: 1, year: 2027, epsEstimate: 3.6822, epsActual: null, revenueEstimate: 10143582802, revenueActual: null },
    PAST,
  ],
};
const HISTORY = [
  { symbol: "JBL", estimate: 4.109, actual: 4.4, period: "2026-09-30", surprise: 0.291, surprisePercent: 7.082, year: 2026, quarter: 4 },
  { symbol: "JBL", estimate: 3.1303, actual: 3.16, period: "2026-06-30", surprise: 0.0297, surprisePercent: 0.9488, year: 2026, quarter: 3 },
  { symbol: "JBL", estimate: 2.5329, actual: 2.69, period: "2026-03-31", surprise: 0.1571, surprisePercent: 6.2024, year: 2026, quarter: 2 },
  { symbol: "JBL", estimate: 2.7267, actual: 2.85, period: "2025-12-31", surprise: 0.1233, surprisePercent: 4.5219, year: 2026, quarter: 1 },
];

async function readJbl(windowed: Record<string, unknown> = WINDOWED, at: Date = AT) {
  jest.useFakeTimers({
    now: at,
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  try {
    return await replayTool("get-earnings-data", "getEarningsData", {
      args: { ticker: "JBL" },
      mocks: {
        "@/lib/agent/research-helpers": () => ({
          ...jest.requireActual("@/lib/agent/research-helpers"),
          finnhub: jest.fn(async (path: string) =>
            path.startsWith("/calendar/earnings")
              ? { data: path.includes("from=") ? windowed : SYMBOL_ONLY }
              : path.startsWith("/stock/earnings")
                ? { data: HISTORY }
                : { data: null },
          ),
        }),
      },
    });
  } finally {
    jest.useRealTimers();
  }
}

describe("get_earnings_data — JBL as read on 2026-10-07", () => {
  it("the next report is the scheduled 2026-12-15, not the 2026-09-30 one already reported", async () => {
    const { result, crashed } = await readJbl();
    expect(crashed).toBe(false);
    expect(result.data?.nextEarnings).toEqual({ date: "2026-12-15", epsEstimate: 3.6822 });
    expect(result.summary).toContain("next earnings 2026-12-15");
    expect(result.summary).not.toMatch(/next earnings 2026-09-30/);
  });

  it("today is Eastern: at 21:30 ET a report dated today and not yet out is still the next one", async () => {
    const tonight = { ...PAST, date: "2026-10-07", hour: "amc", epsActual: null, revenueActual: null };
    const { result } = await readJbl({ earningsCalendar: [tonight, PAST] }, new Date("2026-10-08T01:30:00Z"));
    expect(result.data?.nextEarnings).toEqual({ date: "2026-10-07", epsEstimate: 4.109 });
  });

  it("with nothing scheduled, it says when it last reported and that no date is out", async () => {
    const { result } = await readJbl({ earningsCalendar: [PAST] });
    expect(result.data?.nextEarnings).toBeNull();
    expect(result.summary).toContain("last reported 2026-09-30; next date not yet announced");
  });
});
