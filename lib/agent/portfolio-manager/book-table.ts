/**
 * The Portfolio Manager's read of the book: one line per stock held or
 * watched, written by code. What we own first, biggest first, then what we
 * watch. A stock's full case is a get_theses call away; this is the glance.
 */
import type { IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";
import type { PortfolioSnapshot } from "@/lib/portfolio/snapshot";

export interface BookThesis {
  ticker: string;
  status: string;
  conviction: string | null;
  coreBelief: string | null;
  lastReviewedAt: Date | null;
  catalystDate: Date | null;
  analyst: string | null;
}

const BELIEF_CHARS = 160;
const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`);
const belief = (text: string | null) => {
  const t = text?.replace(/\s+/g, " ").trim();
  const first = t?.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? t;
  return !first ? "no belief written" : first.length > BELIEF_CHARS ? `${first.slice(0, BELIEF_CHARS).trimEnd()}…` : first;
};
/** The move over the last `days` completed sessions, from the daily closes. */
const moveOver = (closes: number[] | undefined, days: number) => {
  const last = closes?.[closes.length - 1];
  const then = closes?.[closes.length - 1 - days];
  return last && then ? (last / then - 1) * 100 : null;
};
const shortDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** One line per stock: its holding's thesis when two analysts cover it. */
export function bookTable(theses: BookThesis[], snapshot: PortfolioSnapshot | null, charts: Map<string, IndicatorSnapshot>, now: Date): string {
  const rows = new Map<string, BookThesis>();
  for (const t of theses) {
    const k = t.ticker.toUpperCase();
    if (!rows.has(k) || (t.status === "HOLDING" && rows.get(k)!.status !== "HOLDING")) rows.set(k, t);
  }
  const held = new Map((snapshot?.holdings ?? []).map((h) => [h.ticker.toUpperCase(), h]));
  const line = (ticker: string, t: BookThesis) => {
    const h = held.get(ticker);
    const chart = charts.get(ticker);
    const looked = t.lastReviewedAt ? Math.floor((now.getTime() - t.lastReviewedAt.getTime()) / 86_400_000) : null;
    const moves = [h ? ["today", pct(h.move)] : null, ["5 days", pct(moveOver(chart?.closes, 5))], ["20 days", pct(moveOver(chart?.closes, 20))]]
      .filter((m): m is [string, string] => Boolean(m?.[1]))
      .map(([label, v]) => `${label} ${v}`);
    const strength = chart?.rsVsSpy["1M"];
    return [
      `- ${ticker}`,
      h ? `held, ${h.share != null ? `${h.share.toFixed(1)}% of the account` : "share unknown"}` : "watched",
      h?.sinceBought ? `since bought ${pct(h.sinceBought.pct)}` : null,
      moves.length ? moves.join(", ") : "no chart numbers",
      strength != null ? `against the S&P over a month ${strength >= 0 ? "+" : "−"}${Math.abs(strength).toFixed(1)} points` : null,
      `conviction ${t.conviction ?? "not set"}`,
      t.analyst,
      looked != null ? `last look ${looked === 0 ? "today" : `${looked} day${looked === 1 ? "" : "s"} ago`}` : "never reviewed",
      t.catalystDate && t.catalystDate.getTime() > now.getTime() ? `catalyst ${shortDay(t.catalystDate)}` : null,
      belief(t.coreBelief),
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const all = [...rows.entries()];
  const isHeld = ([k, t]: [string, BookThesis]) => held.has(k) || t.status === "HOLDING";
  const own = all.filter(isHeld).sort((a, b) => (held.get(b[0])?.value ?? 0) - (held.get(a[0])?.value ?? 0));
  const watch = all.filter((r) => !isHeld(r)).sort((a, b) => a[0].localeCompare(b[0]));
  const list = (rs: typeof all) => (rs.length ? rs.map(([k, t]) => line(k, t)) : ["- none"]);
  return ["## What we own, biggest first", ...list(own), "", "## What we watch", ...list(watch)].join("\n");
}
