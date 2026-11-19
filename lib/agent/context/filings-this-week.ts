/**
 * filings_this_week: the serious and material filings on the analyst's
 * stocks in the last 7 days, from EDGAR (lib/agent/filings-on-book.ts). A
 * read that fails is said.
 */
import { filingsOnBook, type FilingsOnBook } from "@/lib/agent/filings-on-book";
import type { Fact } from "./fact";
import { bookTickersOf } from "./rows";

/** The book's filings this week under its heading, or null when there are none. */
export function filingsWeekText(filings: FilingsOnBook | null | undefined): string | null {
  const recent = filings?.recent ?? [];
  if (recent.length > 0 || filings?.error) {
    const lines: string[] = ["## Filings on your book this week"];
    if (filings?.error) lines.push(`Filings unavailable: ${filings.error}`);
    for (const f of recent) lines.push(`- ${f.ticker} ${f.date} — ${f.summary} · ${f.tier} · ${f.url}`);
    lines.push(
      "The filing triggers on these names handle the wake; this is so you see the week whole. A serious filing on a held name is read today, not at its next review.",
    );
    return lines.join("\n");
  }
  return null;
}

export const filingsThisWeek: Fact = {
  analyst: async (run) => {
    const book = await bookTickersOf(run, run.subject.analystId);
    if (!book.length) return null;
    try {
      const { fetchBookFilings } = await import("@/lib/market-data/sec-filings");
      return filingsWeekText(filingsOnBook(await fetchBookFilings({ tickers: book, now: run.now, lookbackDays: 7 })));
    } catch (err) {
      return filingsWeekText({ recent: [], error: `EDGAR couldn't be read: ${err instanceof Error ? err.message : String(err)}` });
    }
  },
};
