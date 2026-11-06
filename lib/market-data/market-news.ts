/**
 * The market's own headlines: Finnhub's general news (CNBC, Reuters,
 * MarketWatch), on the plan we already pay for. Until now news reached an
 * agent only inside one stock's research, and nothing read the market's.
 * One call on the shared key, through `finnhub()` (5-minute cache).
 */

import { finnhub } from "@/lib/agent/research-helpers";

export interface Headline {
  /** When it was published, ISO. */
  at: string;
  source: string;
  headline: string;
  url: string;
}

interface FinnhubNewsRow {
  datetime?: number;
  source?: string;
  headline?: string;
  url?: string;
}

/** The newest headlines from the last 36 hours, newest first, each said once. */
export function newestHeadlines(raw: unknown, now: Date, limit = 8): Headline[] {
  if (!Array.isArray(raw)) return [];
  const since = now.getTime() / 1000 - 36 * 3600;
  const seen = new Set<string>();
  return (raw as FinnhubNewsRow[])
    .filter((r): r is Required<FinnhubNewsRow> =>
      typeof r.datetime === "number" && r.datetime >= since && typeof r.headline === "string" && r.headline.trim() !== "",
    )
    .sort((a, b) => b.datetime - a.datetime)
    .filter((r) => {
      const key = r.headline.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((r) => ({ at: new Date(r.datetime * 1000).toISOString(), source: r.source || "Finnhub", headline: r.headline.trim(), url: r.url ?? "" }));
}

export async function loadMarketHeadlines(now: Date, limit = 8): Promise<{ headlines: Headline[]; error?: string }> {
  const res = await finnhub("/news?category=general", 1);
  if (res.error || res.data == null) return { headlines: [], error: res.error ?? "Finnhub's market news came back empty" };
  const headlines = newestHeadlines(res.data, now, limit);
  return headlines.length > 0 ? { headlines } : { headlines, error: "Finnhub's market news had nothing from the last 36 hours" };
}

/** "Thu Nov 5, 9:41 PM ET": with the day, because the 5-minute cache can hand a morning run last night's list. */
export function etTime(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" }).replace(",", "");
  return `${day}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET`;
}
