/**
 * get_earnings_data — canary migration using defineTool().
 *
 * Migrated from the inline tool in lib/agent/tools.ts.
 * No logic changes — same Finnhub calls, same data shape.
 * The defineTool() factory provides timing, logging, and error wrapping.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { getEarningsForSymbol } from "@/lib/market-data/earnings-calendar";

export const getEarningsData = defineTool({
  description:
    "Get earnings estimates, historical beat rate, and upcoming earnings date for a stock.",
  schema: z.object({
    ticker: z.string().describe("Stock ticker symbol, e.g. AAPL"),
  }),
  ui: "tool-ui" as const,
  groupId: "Researching",

  progressLabel: (args) => `Pulling $${args.ticker.toUpperCase()} earnings`,

  execute: async ({ ticker }) => {
    // One source for a stock's reports: lib/market-data/earnings-calendar,
    // which the stock page reads too. It asks the calendar for a window, 100
    // days back to 180 ahead: a quarter is about 91 days, so a stock that
    // reports in 13 weeks is inside it, and Finnhub lists the quarter after
    // as well. Asked by symbol alone, Finnhub answers with the last report
    // only — JBL on 2026-10-07 came back as its 2026-09-30 report, which this
    // tool called "next", while 2026-12-15 was scheduled. The next report is
    // the earliest one dated today or later, Eastern, not yet reported.
    const { next, latest, recent: history } = await getEarningsForSymbol(ticker);
    const beats = history.filter((e) => e.actual != null && e.estimate != null && e.actual > e.estimate);

    const nextEarnings = next ? { date: next.reportDate, epsEstimate: next.epsEstimate } : null;
    const lastReported = latest?.reportDate ?? null;

    const beatRate =
      history.length > 0
        ? (() => {
            const periods = history.map((e) => e.period).filter(Boolean);
            const range =
              periods.length >= 2
                ? `${periods[periods.length - 1]}–${periods[0]}`
                : periods[0] || "recent";
            return `${Math.round((beats.length / history.length) * 100)}% (${beats.length}/${history.length} quarters, ${range})`;
          })()
        : "no history";

    const recentQuarters = history.slice(0, 4).map((e) => ({
      period: e.period,
      actualEps: e.actual,
      estimatedEps: e.estimate,
      surprise: e.actual != null && e.estimate != null ? Math.round((e.actual - e.estimate) * 10_000) / 10_000 : null,
      surprisePct: e.surprisePct,
    }));

    const sParts: string[] = [ticker];
    if (nextEarnings) {
      sParts.push(
        `next earnings ${nextEarnings.date}${
          nextEarnings.epsEstimate != null ? ` (est. $${nextEarnings.epsEstimate})` : ""
        }`,
      );
    } else if (lastReported) {
      sParts.push(`last reported ${lastReported}; next date not yet announced`);
    }
    if (beatRate !== "no history") sParts.push(`Beat rate: ${beatRate}`);

    const tickerSummary = nextEarnings
      ? `Next earnings ${nextEarnings.date}. Beat rate: ${beatRate}`
      : lastReported
        ? `Last reported ${lastReported}; next date not yet announced. Beat rate: ${beatRate}`
        : `No upcoming earnings. Beat rate: ${beatRate}`;

    return {
      summary: sParts.join(" — ") + ".",
      data: {
        nextEarnings,
        beatRate,
        recentQuarters,
        // data.tickers feeds ToolUIRenderer via the legacy-tickers fallback path
        tickers: [{ ticker, tag: "Research", summary: tickerSummary }],
      },
      sources: [
        { provider: "Finnhub", title: `${ticker} Earnings Calendar`, url: "https://finnhub.io/docs/api/earnings-calendar" },
        { provider: "Finnhub", title: `${ticker} Earnings History`, url: "https://finnhub.io/docs/api/company-earnings" },
      ],
    };
  },
});
