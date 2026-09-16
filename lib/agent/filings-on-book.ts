/**
 * filings-on-book.ts — the serious and material filings from a book read,
 * in words, for the daily run's "Filings on your book this week" (DAV-269).
 * Pure; the run input calls it, the test reads it directly.
 */
import { describeFilingEvent } from "@/lib/market-data/sec-events";

export interface FilingsOnBook {
  recent: Array<{ ticker: string; date: string; tier: "serious" | "material"; summary: string; url: string }>;
  error?: string;
}

/**
 * The serious and material filings from a book read, newest first, in
 * words. Pure — exported for the test. A failed read keeps its error.
 */
export function filingsOnBook(read: {
  byTicker: Map<string, Array<{ ticker: string; filedDate: string; tier: string; url: string; form: string; rootForm: string; items: string[] }>>;
  error?: string;
}): FilingsOnBook {
  const recent: FilingsOnBook["recent"] = [];
  for (const list of read.byTicker.values()) {
    for (const f of list) {
      if (f.tier !== "RED" && f.tier !== "MATERIAL") continue;
      recent.push({
        ticker: f.ticker,
        date: f.filedDate,
        tier: f.tier === "RED" ? "serious" : "material",
        summary: describeFilingEvent(f),
        url: f.url,
      });
    }
  }
  recent.sort((a, b) => b.date.localeCompare(a.date) || a.ticker.localeCompare(b.ticker));
  return read.error ? { recent, error: read.error } : { recent };
}
