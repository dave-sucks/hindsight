/**
 * snapshot.ts — the portfolio snapshot: the one set of numbers about the
 * account that the 8 PM digest and the agents read. The account's value and
 * cash, the day's and lifetime P&L, every holding with its move that day and
 * since it was bought, the day's buys and sells, and the proposals waiting
 * for the owner. Written by code; no model touches a number in it.
 *
 * Prices are the app's one price (lib/market-data/live-quote.ts): the latest
 * trade in the session, the 4:00 PM close outside it. The broker's own figures
 * are not used for prices: after the close it marks holdings at after-hours
 * trades and resets "today" to them (CEG at 10 PM on Nov 11: $271.81 and
 * −1.1% "today", against a $274.73 close, +2.6% on the day).
 *
 * Pure: the loader is load-snapshot.ts.
 */

export interface SnapshotHolding {
  ticker: string;
  shares: number;
  avgCost: number;
  /** The app's price, or null when no vendor priced it. */
  price: number | null;
  /** The close before the price's session. */
  prevClose: number | null;
  analyst: string | null;
}

export interface SnapshotTrade {
  /** ISO time of the fill. Strings, not Dates, so a snapshot passes through a job step unchanged. */
  at: string;
  side: "BUY" | "SELL";
  ticker: string;
  shares: number;
  price: number;
  /** For a sale: the close before that session, so the day counts what the shares made. */
  prevClose: number | null;
  analyst: string | null;
}

export interface SnapshotProposal {
  side: "BUY" | "SELL";
  ticker: string;
  shares: number;
  /** When this stock's proposal on this side was first made, counting expired and declined ones. */
  firstProposed: string;
  /** How many times it has been proposed, this one included. */
  times: number;
  /** The analyst's reason, as written. */
  note: string | null;
  analyst: string | null;
}

export interface SnapshotInputs {
  /** The session the prices are from, as YYYY-MM-DD in New York. */
  day: string;
  /** True while the market is open: prices are live, not the close. */
  live: boolean;
  /** When the prices were read (ISO). */
  at: string;
  cash: number;
  /** Money put in, net of withdrawals; null when it couldn't be read. */
  contributed: number | null;
  holdings: SnapshotHolding[];
  /** Fills on `day`. */
  trades: SnapshotTrade[];
  waiting: SnapshotProposal[];
}

export interface HoldingLine extends SnapshotHolding {
  value: number | null;
  share: number | null;
  day: { dollars: number; pct: number } | null;
  sinceBought: { dollars: number; pct: number } | null;
}

export interface PortfolioSnapshot {
  day: string;
  live: boolean;
  at: string;
  value: number;
  cash: number;
  /** The day's change: the holdings' moves and what was sold, against the prior close (a buy that day, against its fill). Null when a holding had no price. */
  dayChange: { dollars: number; pct: number } | null;
  /** Value less the money put in. */
  lifetime: { dollars: number; pct: number; contributed: number } | null;
  holdings: HoldingLine[];
  trades: SnapshotTrade[];
  waiting: SnapshotProposal[];
  /** Holdings with no price: valued at cost, so the value is not exact. */
  unpriced: string[];
}

const ratio = (part: number, base: number) => (base > 0 ? (part / base) * 100 : 0);

export function buildSnapshot(i: SnapshotInputs): PortfolioSnapshot {
  // A buy filled that day moves from its fill price, not the prior close.
  const boughtAt = new Map<string, number>();
  for (const t of i.trades) if (t.side === "BUY") boughtAt.set(t.ticker, t.price);
  const unpriced: string[] = [];
  let dayDollars = 0;
  let dayKnown = true;
  const lines: HoldingLine[] = i.holdings.map((h) => {
    if (h.price == null) {
      unpriced.push(h.ticker);
      dayKnown = false;
      return { ...h, value: null, share: null, day: null, sinceBought: null };
    }
    const base = boughtAt.get(h.ticker) ?? h.prevClose;
    const day = base != null && base > 0 ? { dollars: h.shares * (h.price - base), pct: ratio(h.price - base, base) } : null;
    if (day) dayDollars += day.dollars;
    else dayKnown = false;
    const sinceBought = h.avgCost > 0 ? { dollars: h.shares * (h.price - h.avgCost), pct: ratio(h.price - h.avgCost, h.avgCost) } : null;
    return { ...h, value: h.shares * h.price, share: null, day, sinceBought };
  });
  // A sale that day: what the shares made against the prior close.
  for (const t of i.trades) {
    if (t.side !== "SELL") continue;
    if (t.prevClose != null && t.prevClose > 0) dayDollars += t.shares * (t.price - t.prevClose);
    else dayKnown = false;
  }
  const held = lines.reduce((s, h) => s + (h.value ?? h.shares * h.avgCost), 0);
  const value = i.cash + held;
  for (const h of lines) h.share = h.value != null && value > 0 ? ratio(h.value, value) : null;
  lines.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const startOfDay = value - dayDollars;
  return {
    day: i.day,
    live: i.live,
    at: i.at,
    value,
    cash: i.cash,
    dayChange: dayKnown ? { dollars: dayDollars, pct: ratio(dayDollars, startOfDay) } : null,
    lifetime: i.contributed != null && i.contributed > 0 ? { dollars: value - i.contributed, pct: ratio(value - i.contributed, i.contributed), contributed: i.contributed } : null,
    holdings: lines,
    trades: i.trades,
    waiting: i.waiting,
    unpriced,
  };
}

// ── The text every reader gets ───────────────────────────────────────────────

const usd = (n: number, cents = false) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;
const signedUsd = (n: number) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`;
const signedPct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;
const change = (c: { dollars: number; pct: number }) => `${signedPct(c.pct)} (${signedUsd(c.dollars)})`;
const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const nyDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const etTime = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
const shares = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(4)} share${n === 1 ? "" : "s"}`;
/** A long reason cut at its last full sentence inside 280 characters, so the list stays short. */
const gist = (note: string) => {
  const flat = note.replace(/\s+/g, " ").trim();
  if (flat.length <= 280) return flat;
  const head = flat.slice(0, 280);
  // A sentence ends at a lowercase letter, digit or closing mark before its stop; "U.S." doesn't.
  const ends = [...head.matchAll(/[a-z0-9)%"'”’][.!?](?=\s)/g)].map((m) => m.index! + 2);
  const cut = ends.filter((i) => i > 100).pop();
  return cut ? head.slice(0, cut) : `${head.slice(0, head.lastIndexOf(" "))}…`;
};

/** The snapshot as every reader gets it: plain lines, no ids. */
export function snapshotText(s: PortfolioSnapshot): string {
  const when = s.live ? `${dayLabel(s.day)}, ${etTime(new Date(s.at))} ET (market open, latest prices)` : `${dayLabel(s.day)} at the 4:00 PM close`;
  const out: string[] = [`Your portfolio, ${when}`];
  out.push(`Value ${usd(s.value, true)} · cash ${usd(s.cash, true)} (${ratio(s.cash, s.value).toFixed(1)}% of the account)`);
  const dayWord = s.live ? "Today" : dayLabel(s.day);
  out.push(
    `${dayWord}: ${s.dayChange ? change(s.dayChange) : "couldn't be worked out (a holding had no price)"} · ` +
      (s.lifetime ? `since you started: ${change(s.lifetime)} on ${usd(s.lifetime.contributed)} put in` : "since you started: couldn't be read"),
  );
  out.push("");
  out.push(s.holdings.length ? `Holdings (${s.holdings.length}), largest first:` : "Holdings: none.");
  for (const h of s.holdings) {
    const who = h.analyst ? ` · ${h.analyst}` : "";
    if (h.price == null) {
      out.push(`- ${h.ticker}: ${shares(h.shares)}, bought at ${usd(h.avgCost, true)}; no price${who}`);
      continue;
    }
    out.push(
      `- ${h.ticker}: ${shares(h.shares)} at ${usd(h.price, true)} = ${usd(h.value!)} (${h.share!.toFixed(1)}%)` +
        ` · day ${h.day ? change(h.day) : "unknown"}` +
        ` · since bought at ${usd(h.avgCost, true)}: ${h.sinceBought ? change(h.sinceBought) : "unknown"}${who}`,
    );
  }
  out.push("");
  if (!s.trades.length) out.push(`Bought or sold ${s.live ? "today" : `on ${dayLabel(s.day)}`}: nothing.`);
  else {
    out.push(`Bought or sold ${s.live ? "today" : `on ${dayLabel(s.day)}`}:`);
    for (const t of s.trades)
      out.push(`- ${etTime(new Date(t.at))} ET: ${t.side === "BUY" ? "bought" : "sold"} ${shares(t.shares)} of ${t.ticker} at ${usd(t.price, true)}${t.analyst ? ` · ${t.analyst}` : ""}`);
  }
  out.push("");
  if (!s.waiting.length) out.push("Waiting for your approval: nothing.");
  else {
    out.push("Waiting for your approval (proposals, not trades, until you approve them):");
    for (const p of s.waiting) {
      const first = dayLabel(nyDay(new Date(p.firstProposed)));
      const history = p.times > 1 ? `proposed ${p.times} times since ${first}` : `proposed ${first}`;
      out.push(
        `- ${p.side === "BUY" ? "Buy" : "Sell"} ${shares(p.shares)} of ${p.ticker}, ${history}${p.analyst ? ` · ${p.analyst}` : ""}` +
          (p.note ? `. Its reason: "${gist(p.note)}"` : ""),
      );
    }
  }
  if (s.unpriced.length) out.push("", `No price for ${s.unpriced.join(", ")}: valued at what was paid.`);
  return out.join("\n");
}
