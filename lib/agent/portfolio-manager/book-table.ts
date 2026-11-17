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

const BELIEF_CHARS = 110;
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

export interface BookOrder { symbol: string; side: string; intent: string | null; status: string; createdAt: Date }
export interface BookNote { author: string; tickers: string[]; body: string; impact: string | null; effect: string | null; createdAt: Date }

/** How far back a declined or lapsed trade and a note stay on the line. */
export const FLAG_DAYS = 21;
const NOTE_CHARS = 140;
const tradeWord = (o: BookOrder) => (o.side === "SELL" ? (o.intent === "PARTIAL_CLOSE" ? "trim" : "sale") : o.intent === "ADD" ? "add" : "buy");

/**
 * What has already been asked and said on each stock, for its line: a trade
 * waiting for the owner, the trades they declined or let lapse, the Market
 * Reviewer's newest note and the owner's newest note.
 */
export function bookFlags(orders: BookOrder[], notes: BookNote[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (ticker: string, flag: string) => out.set(ticker.toUpperCase(), [...(out.get(ticker.toUpperCase()) ?? []), flag]);
  const groups = new Map<string, BookOrder[]>();
  for (const o of [...orders].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    const outcome = o.status === "AWAITING_APPROVAL" ? "waits" : o.status === "REJECTED" ? "declined" : o.status === "EXPIRED" ? "lapsed" : null;
    if (!outcome) continue;
    const k = `${o.symbol.toUpperCase()}|${tradeWord(o)}|${outcome}`;
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  for (const [k, os] of groups) {
    const [ticker, word, outcome] = k.split("|");
    const a = word === "add" ? "an add" : `a ${word}`;
    const times = os.length > 1 ? `${os.length} times, last ` : "";
    add(ticker, outcome === "waits" ? `${a} waits for the owner since ${shortDay(os[0].createdAt)}` : outcome === "declined" ? `the owner declined ${a} ${times}${shortDay(os[0].createdAt)}` : `${a} lapsed unanswered ${times}${shortDay(os[0].createdAt)}`);
  }
  const said = new Set<string>();
  for (const n of [...notes].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    const owner = n.author === "OWNER";
    for (const ticker of n.tickers) {
      const k = `${ticker.toUpperCase()}|${owner}`;
      if (said.has(k)) continue;
      said.add(k);
      const body = n.body.replace(/\s+/g, " ").trim();
      const cut = body.length > NOTE_CHARS ? `${body.slice(0, NOTE_CHARS).trimEnd()}…` : body;
      add(ticker, owner ? `the owner's note ${shortDay(n.createdAt)}: "${cut}"` : `Market Reviewer ${shortDay(n.createdAt)}: ${[n.effect, n.impact ? `${n.impact} impact` : null].filter(Boolean).join(", ") || "a note"}`);
    }
  }
  return out;
}

/** One line per stock: its holding's thesis when two analysts cover it. */
export function bookTable(theses: BookThesis[], snapshot: PortfolioSnapshot | null, charts: Map<string, IndicatorSnapshot>, now: Date, flags: Map<string, string[]> = new Map()): string {
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
      ...(flags.get(ticker) ?? []),
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
