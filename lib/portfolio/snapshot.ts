/**
 * snapshot.ts — the portfolio snapshot: the one set of numbers about the
 * account that the 8 PM digest and the agents read. The account's value and
 * cash, the day's and lifetime P&L, every holding with its move that day and
 * since it was bought, the day's buys and sells, and the proposals waiting
 * for the owner. Written by code; no model touches a number in it.
 *
 * Prices are the app's one price (lib/market-data/live-quote.ts): the latest
 * trade in the session, the close outside it. The broker's own figures are
 * not used for prices: after the close it marks holdings at after-hours
 * trades and resets "today" to them (CEG at 10 PM on Nov 11: $271.81 and
 * −1.1% "today", against a $274.73 close, +2.6% on the day).
 *
 * Pure: the loader is load-snapshot.ts.
 */

export interface SnapshotHolding {
  ticker: string;
  /** Signed: a short is negative. */
  shares: number;
  avgCost: number;
  /** The app's price, or null when no vendor priced it. */
  price: number | null;
  /** The close before the price's session. Equal to the price when the stock didn't trade that day. */
  prevClose: number | null;
  /** The stock had no trade on the snapshot's day (a halt, or before its first print): its day is flat. */
  noTradeThatDay?: boolean;
  /** The broker's own value of the holding: used only when the app has no price. */
  brokerValue?: number | null;
  analyst: string | null;
}

export interface SnapshotTrade {
  /** ISO time of the fill. Strings, not Dates, so a snapshot passes through a job step unchanged. */
  at: string;
  side: "BUY" | "SELL";
  ticker: string;
  shares: number;
  price: number;
  /** The close before that session: what a stock sold out that day is measured from. */
  prevClose: number | null;
  analyst: string | null;
}

export interface SnapshotProposal {
  side: "BUY" | "SELL";
  ticker: string;
  shares: number;
  /** When this stock's proposal on this side was first made, counting expired and declined ones (ISO). */
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
  /** Stocks with a fill on `day` whose price wasn't recorded: their day can't be worked out. */
  unrecordedFills?: string[];
  waiting: SnapshotProposal[];
}

type Change = { dollars: number; pct: number };

export interface HoldingLine extends SnapshotHolding {
  value: number;
  share: number | null;
  /** The stock's own move that day, price against the prior close. */
  move: number | null;
  /** What these shares made that day, buys and sales at their own prices included. Null when it can't be worked out. */
  dayDollars: number | null;
  /** Bought or sold that day. */
  traded: boolean;
  sinceBought: Change | null;
}

export interface PortfolioSnapshot {
  day: string;
  live: boolean;
  at: string;
  value: number;
  cash: number;
  /** The day's change across every stock that was held or traded, against the prior close. Null when one can't be worked out. */
  dayChange: Change | null;
  /** Value less the money put in. */
  lifetime: (Change & { contributed: number }) | null;
  holdings: HoldingLine[];
  trades: SnapshotTrade[];
  waiting: SnapshotProposal[];
  /** Holdings with no price: valued at the broker's figure, so the value is not exact. */
  unpriced: string[];
}

const ratio = (part: number, base: number) => (base !== 0 ? (part / base) * 100 : 0);

/**
 * A stock's day: what its shares are worth now, less what they were worth at
 * the prior close, less what was paid for that day's buys, plus what that
 * day's sales brought in. Right for an add to a stock held overnight, several
 * buys, and a buy and a sale the same day; null when a price it needs is missing.
 */
function stockDay(sharesNow: number, price: number | null, prior: number | null, trades: SnapshotTrade[]): number | null {
  const bought = trades.filter((t) => t.side === "BUY");
  const sold = trades.filter((t) => t.side === "SELL");
  const sharesAtOpen = sharesNow - bought.reduce((s, t) => s + t.shares, 0) + sold.reduce((s, t) => s + t.shares, 0);
  if (sharesNow !== 0 && price == null) return null;
  if (sharesAtOpen !== 0 && (prior == null || prior <= 0)) return null;
  return (
    sharesNow * (price ?? 0) -
    sharesAtOpen * (prior ?? 0) -
    bought.reduce((s, t) => s + t.shares * t.price, 0) +
    sold.reduce((s, t) => s + t.shares * t.price, 0)
  );
}

export function buildSnapshot(i: SnapshotInputs): PortfolioSnapshot {
  const unrecorded = new Set(i.unrecordedFills ?? []);
  const tradesOf = (t: string) => i.trades.filter((x) => x.ticker === t);
  let dayDollars = 0;
  let dayKnown = unrecorded.size === 0;
  const unpriced: string[] = [];

  const lines: HoldingLine[] = i.holdings.map((h) => {
    const trades = tradesOf(h.ticker);
    if (h.price == null) unpriced.push(h.ticker);
    const value = h.price != null ? h.shares * h.price : h.brokerValue ?? h.shares * h.avgCost;
    const day = unrecorded.has(h.ticker) ? null : stockDay(h.shares, h.price, h.prevClose, trades);
    if (day == null) dayKnown = false;
    else dayDollars += day;
    const cost = Math.abs(h.shares) * h.avgCost;
    const gain = h.price != null && h.avgCost > 0 ? h.shares * (h.price - h.avgCost) : null;
    return {
      ...h,
      value,
      share: null,
      move: h.price != null && h.prevClose != null && h.prevClose > 0 ? ratio(h.price - h.prevClose, h.prevClose) : null,
      dayDollars: day,
      traded: trades.length > 0,
      sinceBought: gain != null && cost > 0 ? { dollars: gain, pct: ratio(gain, cost) } : null,
    };
  });

  // A stock sold out that day is in no holding: its day is what the sale made against the prior close.
  const held = new Set(i.holdings.map((h) => h.ticker));
  for (const t of new Set(i.trades.map((x) => x.ticker).filter((x) => !held.has(x)))) {
    const trades = tradesOf(t);
    const day = unrecorded.has(t) ? null : stockDay(0, null, trades.find((x) => x.prevClose != null)?.prevClose ?? null, trades);
    if (day == null) dayKnown = false;
    else dayDollars += day;
  }

  const value = i.cash + lines.reduce((s, h) => s + h.value, 0);
  for (const h of lines) h.share = value > 0 ? ratio(h.value, value) : null;
  lines.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return {
    day: i.day,
    live: i.live,
    at: i.at,
    value,
    cash: i.cash,
    dayChange: dayKnown ? { dollars: dayDollars, pct: ratio(dayDollars, value - dayDollars) } : null,
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
const change = (c: Change) => `${signedPct(c.pct)} (${signedUsd(c.dollars)})`;
const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const nyDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const etTime = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
const shares = (n: number) => {
  const size = Math.abs(n);
  return `${Number.isInteger(size) ? size : size.toFixed(4)} share${size === 1 ? "" : "s"}${n < 0 ? " short" : ""}`;
};
/** A long reason cut at its last full sentence inside 280 characters, so the list stays short. */
const gist = (note: string) => {
  const flat = note.replace(/\s+/g, " ").trim();
  if (flat.length <= 280) return flat;
  const head = flat.slice(0, 280);
  // A sentence ends at a lowercase letter, digit or closing mark before its stop; "U.S.", "Inc." and "vs." don't.
  const ends = [...head.matchAll(/(?<!\b(?:Inc|Corp|Co|Ltd|vs|etc|Mr|Ms|Dr|St|e\.g|i\.e))[a-z0-9)%"'”’][.!?](?=\s)/g)].map((m) => m.index! + 2);
  const cut = ends.filter((i) => i > 100).pop();
  return cut ? head.slice(0, cut) : `${head.slice(0, head.lastIndexOf(" "))}…`;
};

function holdingLine(h: HoldingLine, dayName: string): string {
  const who = h.analyst ? ` · ${h.analyst}` : "";
  if (h.price == null) return `- ${h.ticker}: ${shares(h.shares)}, bought at ${usd(h.avgCost, true)}; no price, valued at the broker's ${usd(h.value)}${who}`;
  let day: string;
  if (h.noTradeThatDay) day = `no trade on ${dayName}`;
  else if (h.traded) day = `the stock ${h.move != null ? signedPct(h.move) : "unknown"}, these shares ${h.dayDollars != null ? signedUsd(h.dayDollars) : "unknown"} with that day's buys and sales`;
  else day = h.move != null && h.dayDollars != null ? `${signedPct(h.move)} (${signedUsd(h.dayDollars)})` : "unknown";
  return (
    `- ${h.ticker}: ${shares(h.shares)} at ${usd(h.price, true)} = ${usd(Math.abs(h.value))} (${h.share!.toFixed(1)}%)` +
    ` · day ${day}` +
    ` · since bought at ${usd(h.avgCost, true)}: ${h.sinceBought ? change(h.sinceBought) : "unknown"}${who}`
  );
}

/** The snapshot as every reader gets it: plain lines, no ids. */
export function snapshotText(s: PortfolioSnapshot): string {
  const when = s.live ? `${dayLabel(s.day)}, ${etTime(new Date(s.at))} ET (market open, latest prices)` : `${dayLabel(s.day)} at the close`;
  const out: string[] = [`Your portfolio, ${when}`];
  out.push(`Value ${usd(s.value, true)} · cash ${usd(s.cash, true)} (${ratio(s.cash, s.value).toFixed(1)}% of the account)`);
  const dayName = s.live ? "today" : dayLabel(s.day);
  out.push(
    `${s.live ? "Today" : dayName}: ${s.dayChange ? change(s.dayChange) : "couldn't be worked out (a price is missing)"} · ` +
      (s.lifetime ? `since you started: ${change(s.lifetime)} on ${usd(s.lifetime.contributed)} put in` : "since you started: couldn't be read"),
  );
  out.push("");
  out.push(s.holdings.length ? `Holdings (${s.holdings.length}), largest first:` : "Holdings: none.");
  for (const h of s.holdings) out.push(holdingLine(h, dayName));
  out.push("");
  const on = s.live ? "today" : `on ${dayName}`;
  if (!s.trades.length) out.push(`Bought or sold ${on}: nothing.`);
  else {
    out.push(`Bought or sold ${on}:`);
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
  if (s.unpriced.length) out.push("", `No price for ${s.unpriced.join(", ")}: valued at the broker's figure, so the value is not exact.`);
  return out.join("\n");
}
