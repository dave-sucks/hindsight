/**
 * earnings_this_week: the analyst's stocks reporting in the next 7 days, and
 * those that reported in the last 3 with their numbers (the earnings
 * calendar, lib/agent/triggers/earnings.ts). Fail-soft: a calendar that can't
 * be read is no reason to skip the run.
 */
import type { Fact } from "./fact";
import { bookTickersOf } from "./rows";

export interface EarningsWeek {
  reportingSoon: Array<{ ticker: string; date: string; hour: string | null }>;
  justReported: Array<{ ticker: string; date: string; summary: string }>;
}

/** The book's earnings this week under its heading, or null when there are none. */
export function earningsWeekText(earnings: EarningsWeek | null | undefined): string | null {
  const soon = earnings?.reportingSoon ?? [];
  const justReported = earnings?.justReported ?? [];
  if (soon.length > 0 || justReported.length > 0) {
    const lines: string[] = ["## Earnings on your book this week"];
    if (soon.length > 0) {
      lines.push(
        "Reporting: " +
          soon
            .map((e) => `${e.ticker} ${e.date}${e.hour === "bmo" ? " before open" : e.hour === "amc" ? " after close" : ""}`)
            .join(" · "),
      );
    }
    if (justReported.length > 0) {
      lines.push("Just reported: " + justReported.map((e) => `${e.ticker} ${e.date} — ${e.summary}`).join(" · "));
    }
    lines.push(
      "A held name reporting this week is a sizing question before the print; a name that just reported is re-underwritten on the numbers. The earnings triggers on these names handle the wake — this line is so you see the week whole.",
    );
    return lines.join("\n");
  }
  return null;
}

export const earningsThisWeek: Fact = {
  analyst: async (run) => {
    const book = new Set(await bookTickersOf(run, run.subject.analystId));
    if (!book.size) return null;
    try {
      const { describeEarningsReport, fetchEarningsWindow } = await import("@/lib/agent/triggers/earnings");
      const w = await fetchEarningsWindow({ now: run.now, lookaheadDays: 7 });
      return earningsWeekText({
        reportingSoon: [...w.upcoming.values()]
          .filter((r) => book.has(r.symbol))
          .sort((a, b) => a.reportDate.localeCompare(b.reportDate))
          .map((r) => ({ ticker: r.symbol, date: r.reportDate, hour: r.hour })),
        justReported: [...w.reported.values()]
          .filter((r) => book.has(r.symbol))
          .sort((a, b) => b.reportDate.localeCompare(a.reportDate))
          .map((r) => ({ ticker: r.symbol, date: r.reportDate, summary: describeEarningsReport(r) })),
      });
    } catch (err) {
      console.error("[context] earnings this week failed (non-fatal):", err);
      return null;
    }
  },
};
