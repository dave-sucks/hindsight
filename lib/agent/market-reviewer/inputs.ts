/**
 * Everything the Market Reviewer is given, in one place.
 *
 * Each input below says what exactly it is, where it comes from, how much of
 * it the agent gets, and why. The agent reads them as its first message, in
 * this order, each section headed by its title and its reason
 * (`renderInputs`); the same numbers are saved on the digest's row as its
 * facts. To change what it reads, change this file: add an input to INPUTS
 * with its loader and its lines, or take one out.
 *
 * Mid-run it can also pull, through its tools (MODES["market-reviewer"] in
 * lib/agent/modes.ts): a stock's row (get_theses), a stock's price, chart and
 * news (get_stock_data) and the web (web_search, ten searches a run). Every
 * call shows on its run page.
 *
 * The market numbers are read here until the Market and portfolio block's
 * loader lands (#947); then this section reads that loader and
 * lib/market-data/cboe-closes.ts goes.
 *
 * Left out on purpose: a raw headline feed and Fed betting odds. Neither has
 * a stated use the dates, the closes and the web search don't already cover.
 */

import { prisma } from "@/lib/prisma";
import { loadIndicatorSnapshots } from "@/lib/market-data/load-indicators";
import type { IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";
import { fetchCboeHistory, lastCloses, tenYearYield, type IndexClose } from "@/lib/market-data/cboe-closes";
import { addDays, calendarGaps, dayLabel, scheduledMarketDates, type MarketDate, type MarketDateKind } from "@/lib/market-data/market-calendar";
import { fetchCalendarRows } from "@/lib/market-data/earnings-calendar";
import { getLiveQuotes } from "@/lib/market-data/live-quote";
import type { EarningsReport } from "@/lib/agent/triggers/earnings";
import { getAccount, type AlpacaCredentials } from "@/lib/alpaca";
import { finnhub } from "@/lib/agent/research-helpers";
import { isTradingDay, sessionOpenAt } from "@/lib/market-hours";
import { levelFor, levelWords } from "@/lib/agent/shared-notes";
import { loadStockFacts, type FactsRow } from "@/lib/agent/stock-facts";
import { situationsFor, SITUATIONS } from "@/lib/agent/situations";
import { isAgentAnswer } from "@/lib/agent/stock-context";

export type Book = "PAPER" | "LIVE";

/** How far ahead the dates reach: three weeks, the span a position is sized for. */
export const LOOK_AHEAD_DAYS = 21;
/** The most stocks whose earnings dates are looked up, holdings first: one Finnhub call each. */
export const EARNINGS_SYMBOL_CAP = 60;
/** The most stocks on the book's list, holdings first. */
export const BOOK_ROWS_CAP = 60;
/** A belief is cut here: its first sentence is usually shorter. */
export const BELIEF_CHARS = 200;
/** The newest company headlines a stock gets, since the previous run. */
export const HEADLINES_PER_STOCK = 5;
/** How far back its own notes on each stock go. */
export const OWN_NOTES_DAYS = 30;
/** A run line's or a waiting sale's note is cut here. */
const LINE_CHARS = 300;
/** The most of the Portfolio Digest's text the model gets. */
export const PORTFOLIO_DIGEST_CHARS = 4_000;
/** About 30 days of trading: the closes 21 sessions apart. */
const MONTH_SESSIONS = 21;

/** The 11 sector funds, with the sector each stands for. */
export const SECTOR_FUNDS: ReadonlyArray<[string, string]> = [
  ["XLK", "Technology"], ["XLF", "Financials"], ["XLV", "Health care"], ["XLY", "Consumer discretionary"],
  ["XLP", "Consumer staples"], ["XLE", "Energy"], ["XLI", "Industrials"], ["XLB", "Materials"],
  ["XLRE", "Real estate"], ["XLU", "Utilities"], ["XLC", "Communication services"],
];

export interface InputSpec {
  key: "market" | "marketDates" | "earnings" | "book" | "analysts" | "portfolioDigest";
  title: string;
  /** What exactly the model gets. */
  what: string;
  source: string;
  /** How much of it, at most. */
  cap: string;
  why: string;
}

/** The inputs, in the order the model reads them. */
export const INPUTS: readonly InputSpec[] = [
  {
    key: "market",
    title: "The market, last session",
    what: "The S&P 500 (SPY) and the Nasdaq 100 (QQQ): last session's move; the S&P against its 50- and 200-day averages; the VIX and the 10-year Treasury yield at their last close with the one before; the 11 sector funds' moves, largest first.",
    source: "Alpaca's snapshot for SPY, QQQ and the sector funds (lib/market-data/live-quote.ts); SPY's 6:30 AM chart-numbers row (TickerIndicators); Cboe's VIX and 10-year history files (lib/market-data/cboe-closes.ts).",
    cap: "One line each; the 11 sectors on one line.",
    why: "Where the whole market stands before the open: which way it went, how much movement is priced in, what rates did, and which groups led or lagged.",
  },
  {
    key: "marketDates",
    title: `Market dates in the next ${LOOK_AHEAD_DAYS} days`,
    what: "Fed decisions, the inflation reports (CPI, the producer price index, PCE), the jobs report, and US elections, with their day and time.",
    source: "The published calendars, written into lib/market-data/market-calendar.ts (each list names where it came from).",
    cap: `Every scheduled date in the next ${LOOK_AHEAD_DAYS} days, plus a line for any list that runs out inside the window.`,
    why: "These are the days the whole market can move at once, so what we hold going into them matters more than on a normal day.",
  },
  {
    key: "earnings",
    title: `Earnings dates of our holdings and watches, next ${LOOK_AHEAD_DAYS} days`,
    what: "Each holding or watched stock that reports in the window: the day, before the open or after the close, and whether we hold it. A report out before this morning's open says how it compared with the estimate.",
    source: "Finnhub's earnings calendar, one call per stock (lib/market-data/earnings-calendar.ts).",
    cap: `Up to ${EARNINGS_SYMBOL_CAP} stocks looked up, holdings first.`,
    why: "A report is a one-day move in one stock. Several in a week on stocks we hold, or a large holding reporting, is a risk to the account.",
  },
  {
    key: "book",
    title: "The book",
    what: "Each stock we hold or watch: its analyst, its share of the account, its move last session, over about 30 days and since our entry, its next report and its catalyst date; its belief in one line, and its key assumptions and what would prove it wrong, word for word and numbered; a proposal waiting on it with its note's gist; the situations it is in today; the newest line a run wrote on it, in its words; its company headlines since the previous 7:30; and your own notes on it from the last 30 days. Then the equity and the cash.",
    source: "Our open positions and their theses, priced by Alpaca; the 30-day move from each stock's 6:30 AM chart-numbers row; the orders waiting for approval; the situations and the Activity lines from the facts every read uses (lib/agent/stock-facts.ts, situationsFor); Finnhub's company news; the Market Reviewer's notes (SharedNote); the earnings lookups above; the equity and cash from Alpaca.",
    cap: `Up to ${BOOK_ROWS_CAP} stocks, holdings first; the belief cut at ${BELIEF_CHARS} characters, a run line and a sale's note at ${LINE_CHARS}, ${HEADLINES_PER_STOCK} headlines a stock.`,
    why: "A development matters only against what the thesis wrote down: its assumptions and what would prove it wrong. The run line and your own notes show what is already covered, so nothing is said twice.",
  },
  {
    key: "analysts",
    title: "The analysts",
    what: "Each analyst trading this book: its id, its name and its strategy in one line.",
    source: "AgentConfig: each enabled analyst's description.",
    cap: "Every enabled analyst; one line each.",
    why: "So a note about a group or a style goes to the analyst it bears on, by id.",
  },
  {
    key: "portfolioDigest",
    title: "The latest Portfolio Digest",
    what: "The newest Portfolio Digest written for this book, with its date.",
    source: "The PortfolioDigest table, written at 8:00 PM ET by lib/inngest/functions/portfolio-digest.ts.",
    cap: `Its text, up to ${PORTFOLIO_DIGEST_CHARS.toLocaleString("en-US")} characters.`,
    why: "What the book did yesterday, so this read starts from where the account stands rather than repeating it.",
  },
];

// ── The facts each input reads to ───────────────────────────────────────────

export interface SpyReading {
  close: number;
  /** Last session's move, percent; null when the quote didn't come back. */
  changePct: number | null;
  sma50: number;
  sma200: number;
  /** Close against each average, percent (−1.2 = 1.2% below). */
  vs50Pct: number;
  vs200Pct: number;
  /** The session the averages cover, YYYY-MM-DD. */
  asOf: string;
}

export interface MarketReadings {
  spy: SpyReading | null;
  nasdaq: { close: number; changePct: number | null } | null;
  vix: IndexClose | null;
  /** The 10-year Treasury yield, percent. */
  tenYear: IndexClose | null;
  /** Largest move first, either way. */
  sectors: Array<{ symbol: string; name: string; changePct: number }>;
}

export interface EarningsAhead {
  ticker: string;
  date: string;
  /** "before the open" | "after the close" | null when the calendar doesn't say. */
  when: string | null;
  held: boolean;
  /** Today's report, out already (a report before the open is out by 7:30): EPS against the estimate, percent. */
  reported?: { surprisePct: number | null };
}

export interface BookRow {
  ticker: string;
  held: boolean;
  thesisId: string | null;
  /** Its analysts' names; two analysts can watch one stock. */
  analysts: string[];
  price: number | null;
  value: number | null;
  /** Share of the account's equity, percent; held only. */
  sharePct: number | null;
  dayPct: number | null;
  monthPct: number | null;
  sinceEntryPct: number | null;
  /** What waits for approval on it ("a sale of 250 shares"), since when, and its note's gist. */
  pending: { what: string; at: string; gist: string | null } | null;
  /** The situations it is in today, by name (lib/agent/situations.ts). */
  situations: string[];
  belief: string | null;
  /** Word for word, in order: they are numbered when read. */
  assumptions: string[];
  conditions: string[];
  /** Its catalyst date, YYYY-MM-DD. */
  catalystDate: string | null;
  nextEarnings: { date: string; when: string | null } | null;
  /** The newest line a run wrote on it: the New York day and its words. */
  lastRunLine: { date: string; text: string } | null;
  /** Its company headlines since the previous 7:30, newest first. */
  headlines: Array<{ title: string; source: string; at: string }>;
  /** The Market Reviewer's own notes on it from the last 30 days, newest first. */
  ownNotes: Array<{ date: string; level: string; title: string }>;
}

export interface MarketReviewerFacts {
  /** The New York date the run is for. */
  date: string;
  environment: Book;
  market: MarketReadings;
  marketDates: { days: number; dates: MarketDate[]; gaps: string[] };
  earnings: { days: number; rows: EarningsAhead[]; checked: number; notChecked: number };
  book: { equity: number | null; cash: number | null; cashPct: number | null; rows: BookRow[]; notListed: number };
  analysts: Array<{ id: string; name: string; strategy: string | null }>;
  portfolioDigest: { date: string; narrative: string; truncated: boolean } | null;
  /** What could not be read, in words, by input. */
  missing: Partial<Record<InputSpec["key"], string>>;
}

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const pctFrom = (v: number, base: number) => round(((v - base) / base) * 100, 1);

/** SPY's last close against its 50- and 200-day averages. Null when the row lacks them. */
export function spyReading(snap: IndicatorSnapshot | null | undefined, changePct: number | null = null): SpyReading | null {
  const close = snap?.closes[snap.closes.length - 1];
  const s50 = snap?.sma[50];
  const s200 = snap?.sma[200];
  if (!snap || close == null || s50 == null || s200 == null) return null;
  return { close, changePct: changePct != null ? round(changePct, 2) : null, sma50: s50, sma200: s200, vs50Pct: pctFrom(close, s50), vs200Pct: pctFrom(close, s200), asOf: snap.asOf };
}

/** The sector funds' moves, largest first either way. */
export function sectorMoves(quotes: Readonly<Record<string, { dp: number | null } | undefined>>): MarketReadings["sectors"] {
  return SECTOR_FUNDS.flatMap(([symbol, name]) => {
    const dp = quotes[symbol]?.dp;
    return dp != null ? [{ symbol, name, changePct: round(dp, 2) }] : [];
  }).sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct) || a.symbol.localeCompare(b.symbol));
}

const WHEN: Record<string, string> = { bmo: "before the open", amc: "after the close" };

/**
 * The reports in the window, soonest first. A row with a result has reported:
 * it stays only when that was today (before the open, so already out at 7:30).
 */
export function earningsAhead(reports: readonly EarningsReport[], held: ReadonlySet<string>, today: string, days: number): EarningsAhead[] {
  const end = addDays(today, days);
  const seen = new Set<string>();
  return reports
    .filter((r) => r.reportDate >= today && r.reportDate <= end && (r.epsActual == null || r.reportDate === today))
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate) || a.symbol.localeCompare(b.symbol))
    .filter((r) => {
      const k = `${r.symbol}:${r.reportDate}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r) => ({
      ticker: r.symbol,
      date: r.reportDate,
      when: (r.hour && WHEN[r.hour]) || null,
      held: held.has(r.symbol),
      ...(r.epsActual != null ? { reported: { surprisePct: r.surprisePct != null ? round(r.surprisePct, 1) : null } } : {}),
    }));
}

export interface PositionRow {
  symbol: string;
  direction: string;
  quantity: number;
  avgCost: number;
  analystId: string;
}
export interface ThesisRow {
  id: string;
  ticker: string;
  status: string;
  coreBelief: string | null;
  keyAssumptions?: string[];
  invalidationConds?: string[];
  catalystDate?: Date | string | null;
  analystId: string | null;
}
export interface PendingOrder {
  symbol: string;
  intent: string | null;
  quantity: number;
  rationale?: string | null;
  createdAt?: Date | string;
}

/** A Finnhub company headline. */
export interface Headline {
  headline: string;
  source: string;
  /** Unix seconds. */
  datetime: number;
}

const PENDING_WORDS: Record<string, string> = { OPEN: "a buy", ADD: "an add", CLOSE: "a sale", PARTIAL_CLOSE: "a trim" };

/** A belief in one line: its first sentence, cut at BELIEF_CHARS. */
export function beliefLine(belief: string | null | undefined, chars = BELIEF_CHARS): string | null {
  const text = belief?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const first = text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text;
  return first.length > chars ? `${first.slice(0, chars).trimEnd()}…` : first;
}

const cut = (text: string, chars: number) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > chars ? `${t.slice(0, chars).trimEnd()}…` : t;
};
const nyDay = (d: Date | string) => new Date(d).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const nyTime = (d: Date) => d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

/** The previous run's 7:30 AM ET: the trading day before `date`. Headlines are read from then. */
export function previousReviewAt(date: string): Date {
  let d = addDays(date, -1);
  for (let i = 0; i < 10 && !isTradingDay(new Date(`${d}T17:00:00Z`)); i++) d = addDays(d, -1);
  return new Date(sessionOpenAt(d).getTime() - 2 * 3_600_000);
}

/** A stock's headlines since `from`, newest first, each title once, at most HEADLINES_PER_STOCK. */
export function headlinesSince(rows: readonly Headline[], from: Date): BookRow["headlines"] {
  const seen = new Set<string>();
  return [...rows]
    .filter((r) => r.headline && r.datetime * 1000 >= from.getTime() && !seen.has(r.headline) && !!seen.add(r.headline))
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, HEADLINES_PER_STOCK)
    .map((r) => ({ title: cut(r.headline, 160), source: r.source, at: nyTime(new Date(r.datetime * 1000)) }));
}

/**
 * The book, one row per stock: holdings first, largest first, then watches
 * by ticker. A stock two analysts hold or watch is one row naming both.
 */
export function bookRows(args: {
  positions: readonly PositionRow[];
  theses: readonly ThesisRow[];
  analystNames: ReadonlyMap<string, string>;
  quotes: Readonly<Record<string, { c: number; dp: number | null } | undefined>>;
  closes: ReadonlyMap<string, readonly number[]>;
  pending: readonly PendingOrder[];
  earnings: readonly EarningsAhead[];
  /** Per thesis id: the situations it is in today, and the newest line a run wrote on it. */
  situations?: ReadonlyMap<string, readonly string[]>;
  lastRunLines?: ReadonlyMap<string, { date: string; text: string }>;
  /** Per ticker: its headlines since the previous 7:30, and the Market Reviewer's own notes on it. */
  headlines?: ReadonlyMap<string, BookRow["headlines"]>;
  ownNotes?: ReadonlyMap<string, BookRow["ownNotes"]>;
  equity: number | null;
  cash: number | null;
}): MarketReviewerFacts["book"] {
  const share = (v: number | null) => (v != null && args.equity != null && args.equity > 0 ? round((v / args.equity) * 100, 1) : null);
  const name = (id: string | null | undefined) => (id ? args.analystNames.get(id) ?? null : null);
  const monthPct = (t: string, price: number | null) => {
    const cl = args.closes.get(t);
    const base = cl ? cl[cl.length - 1 - MONTH_SESSIONS] : undefined;
    return price != null && base != null && base > 0 ? pctFrom(price, base) : null;
  };
  const pendingOf = (t: string): BookRow["pending"] => {
    const orders = args.pending.filter((o) => o.symbol.toUpperCase() === t);
    if (orders.length === 0) return null;
    const first = orders[0];
    return {
      what: orders.map((o) => `${PENDING_WORDS[o.intent ?? ""] ?? "an order"} of ${o.quantity} shares`).join(" and "),
      at: first.createdAt ? nyDay(first.createdAt) : "",
      gist: first.rationale ? beliefLine(first.rationale, LINE_CHARS) : null,
    };
  };
  const nextOf = (t: string) => {
    const e = args.earnings.find((r) => r.ticker === t);
    return e ? { date: e.date, when: e.when } : null;
  };

  const held = new Map<string, { qty: number; cost: number; analysts: Set<string> }>();
  for (const p of args.positions) {
    const t = p.symbol.toUpperCase();
    const h = held.get(t) ?? { qty: 0, cost: 0, analysts: new Set<string>() };
    h.qty += p.quantity;
    h.cost += p.quantity * p.avgCost;
    const n = name(p.analystId);
    if (n) h.analysts.add(n);
    held.set(t, h);
  }
  const rowFor = (t: string, isHeld: boolean): BookRow => {
    const theses = args.theses.filter((x) => x.ticker.toUpperCase() === t && (isHeld ? x.status === "HOLDING" : x.status === "WATCHING"));
    const withBelief = theses.find((x) => x.coreBelief) ?? theses[0];
    const claim = theses.find((x) => (x.keyAssumptions?.length ?? 0) + (x.invalidationConds?.length ?? 0) > 0) ?? withBelief;
    const catalyst = theses.map((x) => x.catalystDate).find((d) => d != null);
    const lastLine = theses.map((x) => args.lastRunLines?.get(x.id)).filter((l): l is { date: string; text: string } => !!l).sort((a, b) => a.date.localeCompare(b.date)).pop() ?? null;
    const h = held.get(t);
    const analysts = new Set<string>(h?.analysts ?? []);
    for (const x of theses) {
      const n = name(x.analystId);
      if (n) analysts.add(n);
    }
    const q = args.quotes[t];
    const price = q?.c ?? null;
    const value = h && price != null ? round(Math.abs(h.qty * price)) : null;
    const avg = h && h.qty !== 0 ? h.cost / h.qty : null;
    return {
      ticker: t,
      held: isHeld,
      thesisId: withBelief?.id ?? null,
      analysts: [...analysts],
      price,
      value,
      sharePct: isHeld ? share(value) : null,
      dayPct: q?.dp != null ? round(q.dp, 1) : null,
      monthPct: monthPct(t, price),
      sinceEntryPct: isHeld && avg != null && price != null ? pctFrom(price, avg) : null,
      pending: pendingOf(t),
      situations: [...new Set(theses.flatMap((x) => args.situations?.get(x.id) ?? []))],
      belief: beliefLine(withBelief?.coreBelief),
      assumptions: claim?.keyAssumptions ?? [],
      conditions: claim?.invalidationConds ?? [],
      // A date column: its UTC day, never the New York day of UTC midnight (the day before).
      catalystDate: catalyst != null ? new Date(catalyst).toISOString().slice(0, 10) : null,
      nextEarnings: nextOf(t),
      lastRunLine: lastLine,
      headlines: args.headlines?.get(t) ?? [],
      ownNotes: args.ownNotes?.get(t) ?? [],
    };
  };

  const holdings = [...held.keys()].map((t) => rowFor(t, true)).sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.ticker.localeCompare(b.ticker));
  const watched = [...new Set(args.theses.filter((x) => x.status === "WATCHING").map((x) => x.ticker.toUpperCase()))]
    .filter((t) => !held.has(t))
    .sort()
    .map((t) => rowFor(t, false));
  const all = [...holdings, ...watched];
  return { equity: args.equity, cash: args.cash, cashPct: share(args.cash), rows: all.slice(0, BOOK_ROWS_CAP), notListed: Math.max(0, all.length - BOOK_ROWS_CAP) };
}

/** The Portfolio Digest's text, capped. */
export function portfolioDigestInput(row: { date: Date | string; narrative: string } | null): MarketReviewerFacts["portfolioDigest"] {
  if (!row) return null;
  const date = (typeof row.date === "string" ? row.date : row.date.toISOString()).slice(0, 10);
  const text = row.narrative.trim();
  const truncated = text.length > PORTFOLIO_DIGEST_CHARS;
  return { date, narrative: truncated ? `${text.slice(0, PORTFOLIO_DIGEST_CHARS).trimEnd()}…` : text, truncated };
}

// ── What the agent reads ─────────────────────────────────────────────────────

const $ = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const $0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
// A move that rounds to zero has no sign: "0.0%", never "-0.0%".
const signedPct = (n: number, digits: number) => (Number(n.toFixed(digits)) === 0 ? `${(0).toFixed(digits)}%` : `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`);
const pct = (n: number) => signedPct(n, 1);
/** A market move, to two places: "+1.45%". */
const pct2 = (n: number) => signedPct(n, 2);
const side = (p: number, label: string, avg: number) => `${Math.abs(p).toFixed(1)}% ${p >= 0 ? "above" : "below"} its ${label} (${$(avg)})`;
const TIME_OF: Record<MarketDateKind, string | null> = { FED: "2:00 PM ET", CPI: "8:30 AM ET", PPI: "8:30 AM ET", PCE: "8:30 AM ET", JOBS: "8:30 AM ET", ELECTION: null };
const closeLine = (what: string, c: IndexClose, unit = "") =>
  `${what} closed ${c.close.toFixed(2)}${unit} on ${dayLabel(c.asOf)}${c.prevClose != null ? `, from ${c.prevClose.toFixed(2)}${unit} the session before` : ""}.`;

const numbered = (items: readonly string[]) => items.map((x, i) => `    ${i + 1}. ${x.replace(/\s+/g, " ").trim()}`);

function bookLine(r: BookRow): string {
  const parts = [`- ${r.ticker} · ${r.held ? "held" : "watched"}${r.analysts.length ? ` by ${r.analysts.join(" and ")}` : ""}`];
  if (r.held) parts.push(r.sharePct != null ? `${r.sharePct.toFixed(1)}% of the account (${$0(r.value ?? 0)})` : "share unknown");
  if (r.dayPct != null) parts.push(`last session ${pct(r.dayPct)}`);
  if (r.monthPct != null) parts.push(`30 days ${pct(r.monthPct)}`);
  if (r.sinceEntryPct != null) parts.push(`since our entry ${pct(r.sinceEntryPct)}`);
  if (r.nextEarnings) parts.push(`reports ${dayLabel(r.nextEarnings.date)}${r.nextEarnings.when ? ` ${r.nextEarnings.when}` : ""}`);
  if (r.catalystDate) parts.push(`catalyst ${dayLabel(r.catalystDate)}`);
  if (r.thesisId) parts.push(`thesis ${r.thesisId}`);
  const lines = [parts.join(" · ")];
  if (r.belief) lines.push(`  Belief: ${r.belief}`);
  if (r.assumptions.length) lines.push("  Key assumptions:", ...numbered(r.assumptions));
  if (r.conditions.length) lines.push("  What would prove it wrong:", ...numbered(r.conditions));
  if (r.pending) lines.push(`  Waiting for approval: ${r.pending.what}${r.pending.at ? `, proposed ${dayLabel(r.pending.at)}` : ""}${r.pending.gist ? `. The analyst's note: "${r.pending.gist}"` : ""}`);
  if (r.situations.length) lines.push(`  Today: ${r.situations.join(", ")}`);
  lines.push(r.lastRunLine ? `  Newest run line, ${dayLabel(r.lastRunLine.date)}: "${r.lastRunLine.text}"` : "  No run has written on it.");
  if (r.headlines.length) lines.push("  Headlines since the last review:", ...r.headlines.map((h) => `    ${h.at} · ${h.source}: ${h.title}`));
  if (r.ownNotes.length) lines.push("  Your notes on it, last 30 days:", ...r.ownNotes.map((n) => `    ${dayLabel(n.date)}${levelWords(n.level) || " · context"}: ${n.title}`));
  return lines.join("\n");
}

/** The market, last session, as lines: the run's inputs, and the Market tab above its digest (lib/agent/market-reviewer/latest.ts). */
export function marketLines(m: MarketReadings): string[] {
  return [
    m.spy
      ? `S&P 500 (SPY) closed ${$(m.spy.close)}${m.spy.changePct != null ? `, ${pct2(m.spy.changePct)} on the session` : ""}: ${side(m.spy.vs50Pct, "50-day", m.spy.sma50)} and ${side(m.spy.vs200Pct, "200-day", m.spy.sma200)} (as of ${dayLabel(m.spy.asOf)}).`
      : "S&P 500: not available.",
    m.nasdaq ? `Nasdaq 100 (QQQ) closed ${$(m.nasdaq.close)}${m.nasdaq.changePct != null ? `, ${pct2(m.nasdaq.changePct)} on the session` : ""}.` : "Nasdaq 100: not available.",
    m.vix ? closeLine("The VIX", m.vix) : "The VIX: not available.",
    m.tenYear ? closeLine("The 10-year Treasury yield", m.tenYear, "%") : "The 10-year yield: not available.",
    m.sectors.length ? `Sectors, largest move first: ${m.sectors.map((s) => `${s.name} ${pct2(s.changePct)}`).join(", ")}.` : "Sectors: not available.",
  ];
}

function linesFor(key: InputSpec["key"], f: MarketReviewerFacts): string[] {
  const missing = f.missing[key];
  switch (key) {
    case "market": {
      const lines = marketLines(f.market);
      if (missing) lines.push(`Could not read: ${missing}.`);
      return lines;
    }
    case "marketDates": {
      const lines = f.marketDates.dates.map((d) => `- ${dayLabel(d.date)}: ${d.what}${TIME_OF[d.kind] ? `, ${TIME_OF[d.kind]}` : ""}`);
      if (lines.length === 0) lines.push(`None on file in the next ${f.marketDates.days} days.`);
      return [...lines, ...f.marketDates.gaps];
    }
    case "earnings": {
      if (missing && f.earnings.checked === 0) return [`Not available: ${missing}.`];
      const out = (r: EarningsAhead) =>
        !r.reported ? "" : r.reported.surprisePct == null ? ", already reported" : `, already reported: earnings ${Math.abs(r.reported.surprisePct)}% ${r.reported.surprisePct >= 0 ? "above" : "below"} the estimate`;
      const lines = f.earnings.rows.map((r) => `- ${dayLabel(r.date)}: ${r.ticker} (${r.held ? "we hold it" : "we watch it"})${r.when ? `, ${r.when}` : ""}${out(r)}`);
      if (lines.length === 0) lines.push(`None of the ${f.earnings.checked} stocks reports in the next ${f.earnings.days} days.`);
      else lines.push(`Looked up ${f.earnings.checked} stocks; the others report later or have no date.`);
      if (f.earnings.notChecked > 0) lines.push(`${f.earnings.notChecked} watched stocks were not looked up (the cap is ${EARNINGS_SYMBOL_CAP}).`);
      if (missing) lines.push(`Some lookups failed: ${missing}.`);
      return lines;
    }
    case "book": {
      const b = f.book;
      if (b.rows.length === 0) return [missing ? `Not available: ${missing}.` : "We hold and watch nothing."];
      const lines = [
        b.equity != null ? `Equity ${$(b.equity)}${b.cash != null ? `; cash ${$0(b.cash)}${b.cashPct != null ? ` (${b.cashPct.toFixed(1)}%)` : ""}` : ""}.` : `Equity not available${missing ? `: ${missing}` : ""}; shares can't be worked out.`,
        ...b.rows.map(bookLine),
      ];
      if (b.notListed > 0) lines.push(`${b.notListed} more watched stocks are not listed (the cap is ${BOOK_ROWS_CAP}).`);
      if (missing) lines.push(`Could not read: ${missing}.`);
      return lines;
    }
    case "analysts":
      return f.analysts.length ? f.analysts.map((a) => `- ${a.name} (id ${a.id})${a.strategy ? `: ${a.strategy}` : ""}`) : [missing ? `Not available: ${missing}.` : "No analyst trades this book."];
    case "portfolioDigest":
      return f.portfolioDigest
        ? [`Written for ${dayLabel(f.portfolioDigest.date)}${f.portfolioDigest.truncated ? `, cut at ${PORTFOLIO_DIGEST_CHARS.toLocaleString("en-US")} characters` : ""}:`, "", f.portfolioDigest.narrative]
        : [missing ? `Not available: ${missing}.` : "None written yet for this book."];
  }
}

/** The inputs as the model reads them: one section per input, in INPUTS order, each with its reason. */
export function renderInputs(f: MarketReviewerFacts): string {
  const head = `Inputs for the Market Reviewer, ${dayLabel(f.date)} (the ${f.environment} book). Each section says why you have it.`;
  return [head, ...INPUTS.map((i) => [`## ${i.title}`, `Why: ${i.why}`, ...linesFor(i.key, f)].join("\n"))].join("\n\n");
}

// ── Loading them ─────────────────────────────────────────────────────────────

export interface InputScope {
  accountId: string;
  /** The account's owner: the theses, the notes and the situations are read as theirs. */
  userId: string;
  environment: Book;
  /** The New York date the run is for. */
  date: string;
  creds?: AlpacaCredentials;
  now?: Date;
  /** How long a refused headline lookup waits before it is asked again; a minute and a second unless a test says less. */
  retryWaitMs?: number;
}

const why = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Reads every input. Each one fails on its own: a vendor that doesn't answer
 * leaves its section saying so, and the rest still load.
 */
export async function loadMarketReviewerInputs(scope: InputScope): Promise<MarketReviewerFacts> {
  const { accountId, environment, date } = scope;
  const now = scope.now ?? new Date();
  const missing: MarketReviewerFacts["missing"] = {};
  const note = (key: InputSpec["key"], e: unknown) => (missing[key] = missing[key] ? `${missing[key]}; ${why(e)}` : why(e));

  const [positions, theses, analysts, pending, digestRow, account, vixCsv, tnxCsv] = await Promise.all([
    prisma.position
      .findMany({ where: { accountId, environment, status: "OPEN" }, select: { symbol: true, direction: true, quantity: true, avgCost: true, analystId: true } })
      .catch((e) => (note("book", e), [] as PositionRow[])),
    prisma.thesis
      .findMany({
        where: {
          OR: [
            { status: "HOLDING", researchRun: { agentConfig: { accountId, tradingEnvironment: environment } } },
            { status: "WATCHING", researchRun: { agentConfig: { accountId, enabled: true, tradingEnvironment: environment } } },
          ],
        },
        select: {
          id: true, ticker: true, status: true, direction: true, entryPrice: true, targetPrice: true, stopLoss: true, triggers: true,
          catalystDate: true, setupId: true, horizon: true, createdAt: true, coreBelief: true, keyAssumptions: true, invalidationConds: true,
          researchRun: { select: { agentConfigId: true, agentConfig: { select: { setupIds: true } } } },
        },
      })
      .catch((e) => (note("book", e), [] as Array<FactsRow & { coreBelief: string | null; keyAssumptions: string[]; invalidationConds: string[] }>)),
    prisma.agentConfig
      .findMany({ where: { accountId }, select: { id: true, name: true, description: true, enabled: true, tradingEnvironment: true }, orderBy: { createdAt: "asc" } })
      .catch((e) => (note("analysts", e), [] as Array<{ id: string; name: string; description: string | null; enabled: boolean; tradingEnvironment: string | null }>)),
    prisma.order
      .findMany({ where: { status: "AWAITING_APPROVAL", position: { accountId, environment } }, select: { symbol: true, intent: true, quantity: true, rationale: true, createdAt: true }, orderBy: { createdAt: "asc" } })
      .catch((e) => (note("book", e), [] as PendingOrder[])),
    prisma.portfolioDigest
      .findFirst({ where: { accountId, environment }, orderBy: { date: "desc" }, select: { date: true, narrative: true } })
      .catch((e) => (note("portfolioDigest", e), null)),
    scope.creds ? getAccount(scope.creds).catch((e) => (note("book", e), null)) : Promise.resolve(null),
    fetchCboeHistory("VIX").catch((e) => (note("market", e), null)),
    fetchCboeHistory("TNX").catch((e) => (note("market", e), null)),
  ]);
  if (!scope.creds) note("book", "no broker keys for this book");

  const heldTickers = [...new Set(positions.map((p) => p.symbol.toUpperCase()))].sort();
  const thesisRows: ThesisRow[] = theses.map((t) => ({
    id: t.id, ticker: t.ticker, status: t.status, coreBelief: t.coreBelief, keyAssumptions: t.keyAssumptions, invalidationConds: t.invalidationConds,
    catalystDate: t.catalystDate, analystId: t.researchRun?.agentConfigId ?? null,
  }));
  const watchTickers = [...new Set(theses.filter((t) => t.status === "WATCHING").map((t) => t.ticker.toUpperCase()))].filter((t) => !heldTickers.includes(t)).sort();
  const lookups = [...heldTickers, ...watchTickers];
  const toCheck = lookups.slice(0, EARNINGS_SYMBOL_CAP);
  const funds = ["SPY", "QQQ", ...SECTOR_FUNDS.map(([s]) => s)];

  const since = previousReviewAt(date);
  const earningsLookups = (async () => {
    const out: EarningsReport[] = [];
    const failed: string[] = [];
    // Ten at a time: the shared client throttles, and the trigger check shares the key.
    for (let i = 0; i < toCheck.length; i += 10) {
      const batch = await Promise.all(
        toCheck.slice(i, i + 10).map((symbol) =>
          fetchCalendarRows({ symbol, from: date, to: addDays(date, LOOK_AHEAD_DAYS), throwOnError: true }).catch(() => (failed.push(symbol), [] as EarningsReport[])),
        ),
      );
      out.push(...batch.flat());
    }
    if (failed.length) missing.earnings = `no answer for ${failed.join(", ")}`;
    return { reports: out, failed };
  })();
  const [snapshots, quotes, { reports, failed }, headlines, ownNotes] = await Promise.all([
    loadIndicatorSnapshots(["SPY", ...lookups], now).catch((e) => (note("market", e), new Map<string, IndicatorSnapshot>())),
    getLiveQuotes([...funds, ...lookups], { caller: "other", creds: scope.creds, now })
      .then((all) => Object.fromEntries(Object.entries(all).flatMap(([t, r]) => (r.quote ? [[t, { c: r.quote.c, dp: r.quote.dp, t: r.quote.t }]] : [])) as Array<[string, { c: number; dp: number | null; t: number }]>))
      .catch((e) => (note("market", e), {} as Record<string, { c: number; dp: number | null; t: number }>)),
    earningsLookups,
    // Each stock's company headlines since the previous 7:30, ten at a time, after
    // the earnings lookups: the two together are about two calls a stock, past
    // the key's 60 a minute on a book of 30, so a refused one is asked again
    // once the minute has turned.
    (async () => {
      await earningsLookups;
      const out = new Map<string, BookRow["headlines"]>();
      const ask = async (symbols: string[]) => {
        const failed: string[] = [];
        for (let i = 0; i < symbols.length; i += 10) {
          await Promise.all(
            symbols.slice(i, i + 10).map(async (symbol) => {
              const res = await finnhub(`/company-news?symbol=${symbol}&from=${nyDay(since)}&to=${date}`, 1);
              if (res.error || !Array.isArray(res.data)) failed.push(symbol);
              else out.set(symbol, headlinesSince(res.data as Headline[], since));
            }),
          );
        }
        return failed;
      };
      let failedNews = await ask(toCheck);
      if (failedNews.length) {
        await new Promise((r) => setTimeout(r, scope.retryWaitMs ?? 61_000));
        failedNews = await ask(failedNews);
      }
      if (failedNews.length) note("book", `no headlines for ${failedNews.join(", ")}`);
      return out;
    })(),
    // Its own notes on each stock from the last 30 days.
    prisma.sharedNote
      .findMany({
        where: { userId: scope.userId, author: "MARKET_REVIEWER", audience: "STOCKS", createdAt: { gte: new Date(now.getTime() - OWN_NOTES_DAYS * 86_400_000) } },
        select: { tickers: true, levels: true, body: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      })
      .then((rows) => {
        const out = new Map<string, BookRow["ownNotes"]>();
        for (const n of rows) for (const t of n.tickers) out.set(t, [...(out.get(t) ?? []), { date: nyDay(n.createdAt), level: levelFor(n, t), title: n.body.split("\n")[0] }]);
        return out;
      })
      .catch((e) => (note("book", e), new Map<string, BookRow["ownNotes"]>())),
  ]);

  const equity = account ? Number(account.equity) : null;
  const cash = account ? Number(account.cash) : null;
  const earnings = earningsAhead(reports, new Set(heldTickers), date, LOOK_AHEAD_DAYS);

  // Today's situations and each stock's Activity, from the facts every read
  // uses, read for the whole account (each stock under its own analyst) with
  // the prices above, so the vendor is asked once.
  const situations = new Map<string, string[]>();
  const lastRunLines = new Map<string, { date: string; text: string }>();
  try {
    const prices = Object.fromEntries(Object.entries(quotes).map(([t, q]) => [t, { price: q.c, t: q.t, dp: q.dp }]));
    const facts = await loadStockFacts(theses, { userId: scope.userId, runEnvironment: environment, alpacaCreds: scope.creds, accountId, prices, slots: null });
    for (const t of theses) {
      const src = facts.sources.get(t.id);
      if (src) situations.set(t.id, situationsFor(src).map((c) => SITUATIONS[c].name));
      const last = (facts.load.inputs.get(t.id)?.activity ?? []).filter(isAgentAnswer).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
      if (last) lastRunLines.set(t.id, { date: nyDay(last.timestamp), text: cut([last.summary, last.rationale].filter(Boolean).join(": "), LINE_CHARS) });
    }
  } catch (e) {
    note("book", e);
  }
  const closes = new Map([...snapshots].map(([t, s]) => [t, s.closes] as const));

  return {
    date,
    environment,
    market: {
      spy: spyReading(snapshots.get("SPY"), quotes.SPY?.dp ?? null),
      nasdaq: quotes.QQQ ? { close: quotes.QQQ.c, changePct: quotes.QQQ.dp != null ? round(quotes.QQQ.dp, 2) : null } : null,
      vix: vixCsv ? lastCloses(vixCsv) : null,
      tenYear: tnxCsv ? tenYearYield(lastCloses(tnxCsv)) : null,
      sectors: sectorMoves(quotes),
    },
    marketDates: { days: LOOK_AHEAD_DAYS, dates: scheduledMarketDates(date, LOOK_AHEAD_DAYS), gaps: calendarGaps(date, LOOK_AHEAD_DAYS) },
    earnings: { days: LOOK_AHEAD_DAYS, rows: earnings, checked: toCheck.length - failed.length, notChecked: lookups.length - toCheck.length },
    book: bookRows({
      positions,
      theses: thesisRows,
      analystNames: new Map(analysts.map((a) => [a.id, a.name])),
      quotes,
      closes,
      pending,
      earnings,
      situations,
      lastRunLines,
      headlines,
      ownNotes,
      equity: Number.isFinite(equity) ? equity : null,
      cash: Number.isFinite(cash) ? cash : null,
    }),
    analysts: analysts
      .filter((a) => a.enabled && a.tradingEnvironment === environment)
      .map((a) => ({ id: a.id, name: a.name, strategy: beliefLine(a.description) })),
    portfolioDigest: portfolioDigestInput(digestRow),
    missing,
  };
}
