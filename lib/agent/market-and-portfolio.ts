/**
 * market-and-portfolio.ts — the Market and portfolio block: one short block
 * every agent that decides on stocks or talks about the book gets on every
 * request (the morning run through buildRunInput, the trigger run, the chat
 * and the Writer; not the builder, the editor or the podcast). Written once,
 * like house-rules.ts and situations.ts: BLOCK_PARTS is the one table of what
 * it carries, this file renders it, and the one paragraph on how to read it is
 * in HOUSE_RULES. The Framework page draws BLOCK_PARTS.
 *
 * It goes in each agent's prompt after its fixed text and before its read:
 * last for the morning run, the chat and the Writer, just before the stock's
 * row for the trigger run. Every request carries its prompt, retries
 * included. The headings are fixed: the run page splits what a request was
 * sent on them.
 *
 * Each part is left out when it is empty or switched off, with nothing said
 * about it. The 8 PM digest's long text is never here; only its brief is.
 * The loader is load-market-and-portfolio.ts.
 */
import type { Brief } from "@/lib/agent/market-digest-slot";
import { marketNumbersLines, type MarketNumbers } from "@/lib/market-data/market-numbers";
import { dayLabel } from "@/lib/market-data/market-calendar";
import { saleQueueLines, type WaitingSale } from "@/lib/portfolio/sale-queue";

export type BlockPartId = "marketBrief" | "marketNumbers" | "portfolioBrief" | "portfolioNumbers" | "notes";

/** The block's parts, in order: each one's heading, who writes it, and its switch. */
export const BLOCK_PARTS: ReadonlyArray<{ id: BlockPartId; heading: string; source: "AI" | "code" | "notes"; on: boolean; what: string }> = [
  { id: "marketBrief", heading: "Market brief", source: "AI", on: true, what: "The Market Reviewer's 7:30 AM brief: what the market is doing and why, and what it means for this book. From the last 4 days." },
  { id: "marketNumbers", heading: "Market numbers", source: "code", on: true, what: "SPY and QQQ on the day, SPY against its 50- and 200-day, the VIX and the 10-year at the close, the 11 sectors best to worst, and the market dates in the next 7 days." },
  { id: "portfolioBrief", heading: "Portfolio brief", source: "AI", on: true, what: "The Portfolio Reviewer's 8 PM brief: where the account stands and what needs attention. From the last 4 days." },
  { id: "portfolioNumbers", heading: "Portfolio numbers", source: "code", on: true, what: "The value and the day's change at the app's own prices (the close outside the session), real cash, the holdings and the 3 biggest, each sale waiting for approval with its history, the other proposals waiting, and the holdings reporting in the next 14 days." },
  { id: "notes", heading: "Notes", source: "notes", on: true, what: "Notes to the account and to this run's analyst while they last: every one of yours in full, and the newest 3 from the reviewers (the Market Reviewer and the Portfolio Reviewer) in full." },
];

export const isOn = (id: BlockPartId) => BLOCK_PARTS.find((p) => p.id === id)?.on === true;

/** A brief older than this many days is left out: Friday's still reads on a Tuesday after a Monday holiday. */
export const BRIEF_SHELF_LIFE_DAYS = 4;
/** The most a brief may be; a longer one is cut at its last sentence that fits. */
export const BRIEF_MAX_CHARS = 700;
/** The reviewers' notes the block shows (the Market Reviewer's and the Portfolio Reviewer's; author PORTFOLIO_MANAGER), the newest; every one of the owner's is shown. None is ever cut. */
export const REVIEWER_NOTES_SHOWN = 3;

/** The account, read when the request is built. */
export interface PortfolioNumbers {
  at: Date;
  /** The New York day of the close the holdings are priced at; null in the session, or when one had no price. */
  close: string | null;
  open: boolean;
  /** Cash and the holdings at the app's own prices (lib/portfolio/value-at-quotes.ts), never the broker's after-hours marks. */
  equity: number;
  /** The day's change net of deposits and withdrawals: today in the session, the close's day outside it. Null when it can't be worked out. */
  today: { dollars: number; pct: number } | null;
  /** Real cash, which can be negative on margin. Never buying power. */
  cash: number;
  holdings: number;
  /** The 3 biggest holdings by share of the account (0–1), biggest first. */
  biggest: Array<{ ticker: string; share: number }>;
  /** Each sale and trim waiting for approval, with its history, oldest first (lib/portfolio/sale-queue.ts); null when they couldn't be read. */
  sales: WaitingSale[] | null;
  /** The other proposals waiting (buys and adds), oldest first. */
  pending: Array<{ ticker: string; kind: "buy" | "add" }>;
  /** Holdings with a report in the next 14 days, soonest first; null when the dates couldn't be read. */
  reporting: Array<{ ticker: string; date: string; hour: string | null }> | null;
}

/** What the block carries for one book. A null part, or no notes, is left out. */
export interface MarketAndPortfolio {
  marketBrief: Brief | null;
  marketNumbers: MarketNumbers | null;
  portfolioBrief: Brief | null;
  portfolioNumbers: PortfolioNumbers | null;
  /** One line per live note, newest first, as runNoteLine writes it (lib/agent/shared-notes.ts), with who wrote it. */
  notes: Array<{ author: string; line: string }>;
  /** The parts that failed or ran out of time: each prints a line saying so. */
  unread: BlockPartId[];
  /** When it was read. The block renders against this time, so a replay prints what the run read. */
  at?: Date;
}

export const EMPTY_BLOCK: MarketAndPortfolio = { marketBrief: null, marketNumbers: null, portfolioBrief: null, portfolioNumbers: null, notes: [], unread: [] };

/** What a part that couldn't be read says in its place. The morning prompt no longer states the cash, so the account's line is never just left out. */
export const UNREAD_LINE: Record<BlockPartId, string> = {
  marketBrief: "The market brief couldn't be read this run",
  marketNumbers: "Market numbers couldn't be read this run",
  portfolioBrief: "The portfolio brief couldn't be read this run",
  portfolioNumbers: "Account numbers couldn't be read this run",
  notes: "The notes couldn't be read this run",
};

const nyDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** The brief, if it is for a New York day within the shelf life of `now` and has words in it. */
export function freshBrief(b: Brief | null | undefined, now: Date): Brief | null {
  if (!b?.brief?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return null;
  const age = (Date.parse(`${nyDay(now)}T00:00:00Z`) - Date.parse(`${b.date}T00:00:00Z`)) / 86_400_000;
  return age >= 0 && age <= BRIEF_SHELF_LIFE_DAYS ? b : null;
}

/** A brief within BRIEF_MAX_CHARS: cut at its last full sentence that fits. */
export function capBrief(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= BRIEF_MAX_CHARS) return t;
  const head = t.slice(0, BRIEF_MAX_CHARS);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  return end > 0 ? head.slice(0, end + 1) : `${head.slice(0, BRIEF_MAX_CHARS - 1).trimEnd()}…`;
}

const MINUS = "−";
const dollars = (n: number) => `${n < 0 ? MINUS : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const signedDollars = (n: number) => `${n < 0 ? MINUS : "+"}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const signedPct = (n: number) => `${n < 0 ? MINUS : "+"}${Math.abs(n).toFixed(2)}%`;
const time = (d: Date | string) => `${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(d))} ET`;
const HOUR: Record<string, string> = { bmo: " before the open", amc: " after the close" };

/** "2 pending buy proposals (ETN, WST)", one phrase per kind, in the order they first appear. */
function pendingPhrases(pending: PortfolioNumbers["pending"]): string[] {
  const byKind = new Map<string, string[]>();
  for (const p of pending) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p.ticker]);
  return [...byKind].map(([kind, t]) => `${t.length} pending ${kind} proposal${t.length === 1 ? "" : "s"} (${t.join(", ")})`);
}

/** The account as lines: value and cash; holdings and the biggest; the sales waiting; the other proposals; what reports soon. */
export function portfolioNumbersLines(a: PortfolioNumbers): string[] {
  const value = [dollars(a.equity)];
  const day = a.close ? "on the day" : a.open ? "today" : "since the last close";
  value.push(a.today ? `${signedDollars(a.today.dollars)} ${day} (${signedPct(a.today.pct)})` : "the day's change couldn't be read");
  value.push(`${dollars(a.cash)} cash${a.equity > 0 ? ` (${((a.cash / a.equity) * 100).toFixed(1)}%)` : ""}`);
  const lines = [`${a.close ? `At the ${dayLabel(a.close)} close` : `At ${time(a.at)}`}: ${value.join(" · ")}`];
  const held = `${a.holdings} holding${a.holdings === 1 ? "" : "s"}`;
  lines.push(a.biggest.length ? `${held}; the biggest: ${a.biggest.map((b) => `${b.ticker} ${(b.share * 100).toFixed(1)}%`).join(" · ")}` : held);
  if (a.sales === null) lines.push("Sales waiting for approval couldn't be read this run");
  else lines.push(...saleQueueLines(a.sales));
  const waiting = pendingPhrases(a.pending);
  if (waiting.length) lines.push(waiting.join(" · "));
  if (a.reporting === null) lines.push("Report dates couldn't be read this run");
  else if (a.reporting.length) lines.push(`Reporting in the next 14 days: ${a.reporting.map((r) => `${r.ticker} ${dayLabel(r.date)}${HOUR[r.hour ?? ""] ?? ""}`).join(" · ")}`);
  return lines;
}

/** "Tue Nov 10, 8:00 PM ET: …", or the day alone when the brief has no time. */
const briefText = (b: Brief) => `${dayLabel(b.date)}${b.writtenAt ? `, ${time(new Date(b.writtenAt))}` : ""}: ${capBrief(b.brief)}`;

/** Every one of the owner's notes and the reviewers' newest REVIEWER_NOTES_SHOWN, newest first, each in full, and how many of the reviewers' are left out. */
function noteLines(notes: MarketAndPortfolio["notes"]): string[] {
  let reviewer = 0;
  const shown = notes.filter((n) => n.author === "OWNER" || reviewer++ < REVIEWER_NOTES_SHOWN).map((n) => `- ${n.line}`);
  const more = reviewer - REVIEWER_NOTES_SHOWN;
  return more > 0 ? [...shown, `(${more} older note${more === 1 ? "" : "s"} from the Market Reviewer and Portfolio Reviewer not shown)`] : shown;
}

/** Each part's text, or null when it has nothing to show. */
const RENDER: Record<BlockPartId, (layer: MarketAndPortfolio, now: Date) => string | null> = {
  marketBrief: (l) => (l.marketBrief ? briefText(l.marketBrief) : null),
  marketNumbers: (l, now) => {
    const lines = l.marketNumbers ? marketNumbersLines(l.marketNumbers, now) : [];
    return lines.length ? lines.join("\n") : null;
  },
  portfolioBrief: (l) => (l.portfolioBrief ? briefText(l.portfolioBrief) : null),
  portfolioNumbers: (l) => (l.portfolioNumbers ? portfolioNumbersLines(l.portfolioNumbers).join("\n") : null),
  notes: (l) => (l.notes.length ? noteLines(l.notes).join("\n") : null),
};

/** The block as every agent reads it, or "" when there is nothing to show. */
export function marketAndPortfolioBlock(layer: MarketAndPortfolio | null | undefined, at?: Date): string {
  if (!layer) return "";
  const now = at ?? (layer.at ? new Date(layer.at) : new Date());
  const parts = BLOCK_PARTS.flatMap((p) => {
    const text = !p.on ? null : (layer.unread ?? []).includes(p.id) ? UNREAD_LINE[p.id] : RENDER[p.id](layer, now);
    return text ? [`### ${p.heading}\n${text}`] : [];
  });
  return parts.length ? `## Market and portfolio\n\n${parts.join("\n\n")}` : "";
}
