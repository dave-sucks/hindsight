/**
 * shared-notes.ts: a note written once and read on every stock in its
 * audience (the Portfolio Manager Plan, step 2).
 *
 * The rule in one sentence: a note on one stock is the NOTE line in its
 * Activity (lib/agent/notes.ts); a note on more than one stock is one
 * SharedNote row with its audience, and each covered stock reads it.
 *
 * Audiences:
 * - STOCKS: the stocks it names. A note in each one's Activity.
 * - ANALYST: that analyst's agents read it in their Market and portfolio
 *   block (lib/agent/market-and-portfolio.ts), once per request, while it lasts.
 * - ACCOUNT: every agent reads it there, while it lasts.
 *
 * A run on a stock reads up to 3 notes naming it, each with its author, in
 * their own block above its newest 8 Activity lines: the one it is waiting
 * to answer first, then the newest written since the stock's last run line.
 * A note gives each stock it names its own level: CONTEXT (read, nothing
 * more), REVIEW (the stock is in the PINNED_NOTE situation until a run writes
 * on it after the note), URGENT (the same, and a run starts on it:
 * lib/agent/triggers/urgent-note.ts) or PROPOSAL (about the sale waiting on
 * it, shown on that proposal's card for the owner). A note the owner pinned
 * from the chat counts as one to review on every stock it names until its date. A note to the account or an
 * analyst always has an end date (a week unless it says otherwise): a market
 * note with no end goes stale.
 *
 * On the Activity tab every note is a line on each stock it reaches, including
 * a note to the account or an analyst (`inStockActivity`); the tab's "newest
 * 8" mark skips the ones a run reads elsewhere (`newestEightForRuns`).
 *
 * Nothing matches by tag: the author picks the audience (docs/plans/LANES.md §2).
 *
 * Pure: stock-context-for.ts imports it. The loader, the shares and the
 * save are in shared-notes.server.ts.
 */
import { RECENT_ITEMS, type StoredLine } from "@/lib/thesis/activity-feed";
import { etStamp, isRunLine, type ActivityRow } from "@/lib/agent/stock-context";

export type NoteAudience = "ACCOUNT" | "ANALYST" | "STOCKS";
export type NoteAuthor = "OWNER" | "MARKET_REVIEWER" | "PORTFOLIO_REVIEWER";
export const NOTE_LEVELS = ["CONTEXT", "REVIEW", "URGENT", "PROPOSAL"] as const;
export type NoteLevel = (typeof NOTE_LEVELS)[number];

export interface SharedNoteRow {
  id: string;
  author: string;
  runId: string | null;
  body: string;
  audience: string;
  analystId: string | null;
  tickers: string[];
  eventDate: string | null;
  /** Each named stock's level (ticker → NoteLevel); a stock not listed, and every note to an analyst or the account, is CONTEXT. */
  levels: unknown;
  pinnedUntil: Date | null;
  createdAt: Date;
}

/** The longest a note stays pinned. */
export const NOTE_MAX_PIN_DAYS = 14;
/** A note to the account or an analyst lasts this long unless it names an end. */
export const RUN_NOTE_DEFAULT_DAYS = 7;
/** A run on a stock reads at most this many notes naming it. */
export const NOTES_PER_STOCK = 3;
export const SHARED_NOTE_CHARS = 2000;
/** How far back the agents' read loads notes: past any pin, and about the month the Activity scan covers. */
export const LOAD_DAYS = 45;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function isPinned(n: Pick<SharedNoteRow, "pinnedUntil">, now: Date): boolean {
  return n.pinnedUntil != null && n.pinnedUntil.getTime() > now.getTime();
}

/** This stock's level in the note: CONTEXT unless the note gave it another. */
export function levelFor(n: Pick<SharedNoteRow, "levels">, ticker: string): NoteLevel {
  const l = (n.levels && typeof n.levels === "object" ? (n.levels as Record<string, unknown>) : {})[ticker.toUpperCase()];
  return typeof l === "string" && (NOTE_LEVELS as readonly string[]).includes(l) ? (l as NoteLevel) : "CONTEXT";
}

/** A note this stock's analyst must answer: to review or urgent on it, or pinned by the owner until its date. */
export function needsAnswer(n: Pick<SharedNoteRow, "levels" | "pinnedUntil">, ticker: string, now: Date): boolean {
  const l = levelFor(n, ticker);
  return l === "REVIEW" || l === "URGENT" || isPinned(n, now);
}

/** When a run last wrote on the stock, from its stored lines or its Activity feed alike (`isRunLine`). */
export function lastRunLineAt(rows: readonly ActivityRow[]): number {
  return Math.max(-Infinity, ...rows.filter(isRunLine).map((r) => r.timestamp.getTime()));
}

/**
 * The notes a run on this stock reads, at most NOTES_PER_STOCK: the ones it
 * must answer first, then the newest, all written since its last run line.
 * `notes` are the ones naming the stock.
 */
export function notesForRun<T extends Pick<SharedNoteRow, "levels" | "pinnedUntil" | "createdAt">>(notes: readonly T[], ticker: string, rows: readonly ActivityRow[], now: Date): T[] {
  const since = lastRunLineAt(rows);
  const open = (n: T) => (needsAnswer(n, ticker, now) ? 1 : 0);
  return notes
    .filter((n) => n.createdAt.getTime() >= since)
    .sort((a, b) => open(b) - open(a) || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, NOTES_PER_STOCK);
}

/** Whether a note to stocks covers this one. A note to the account or an analyst covers none: it is read once per run. */
export function coversStock(n: Pick<SharedNoteRow, "audience" | "tickers">, stock: { ticker: string }): boolean {
  return n.audience === "STOCKS" && n.tickers.includes(stock.ticker.toUpperCase());
}

/**
 * Whether a note is a line in this stock's Activity tab. A note to stocks:
 * when it names the stock. A note to the account, or to the stock's
 * analyst: when it was written while the stock was on the book.
 */
export function inStockActivity(
  n: Pick<SharedNoteRow, "audience" | "tickers" | "analystId" | "createdAt">,
  stock: { ticker: string; analystId?: string | null; createdAt: Date; endedAt?: Date | null },
): boolean {
  if (n.audience === "STOCKS") return coversStock(n, stock);
  const live = n.createdAt.getTime() >= stock.createdAt.getTime() && (!stock.endedAt || n.createdAt.getTime() <= stock.endedAt.getTime());
  if (n.audience === "ACCOUNT") return live;
  if (n.audience === "ANALYST") return live && !!n.analystId && n.analystId === stock.analystId;
  return false;
}

/**
 * The stock's newest 8 as its next run reads them, from the Activity tab's
 * list. A run reads a note to the account or an analyst in its Market and
 * portfolio block, and the stock's notes in their own block (`notesForRun`),
 * so none of those counts toward the 8.
 */
export function newestEightForRuns<T extends ActivityRow & { id: string }>(feed: readonly T[], ticker: string, now: Date): T[] {
  type To = { audience?: string; levels?: unknown; pinnedUntil?: string | null };
  const toOf = (item: T) => (item.fieldChanges as { sharedNote?: { to?: To } } | null)?.sharedNote?.to;
  const stockNotes = feed
    .filter((i) => i.type === "SHARED_NOTE" && toOf(i)?.audience === "STOCKS")
    .map((i) => ({ id: i.id, createdAt: i.timestamp, levels: toOf(i)?.levels ?? {}, pinnedUntil: toOf(i)?.pinnedUntil ? new Date(toOf(i)!.pinnedUntil!) : null }));
  const inBlock = new Set(notesForRun(stockNotes, ticker, feed, now).map((n) => n.id));
  return feed
    .filter((i) => !(i.type === "SHARED_NOTE" && (inBlock.has(i.id) || toOf(i)?.audience === "ACCOUNT" || toOf(i)?.audience === "ANALYST")))
    .slice(0, RECENT_ITEMS);
}

/** The notes in a run's Market and portfolio block: the account's and the analyst's, while they last. A run with no analyst gets every analyst's. */
export function runNotes(notes: readonly SharedNoteRow[], analystId: string | null | undefined, now: Date): SharedNoteRow[] {
  return notes.filter(
    (n) => isPinned(n, now) && (n.audience === "ACCOUNT" || (n.audience === "ANALYST" && (!analystId || n.analystId === analystId))),
  );
}

const AUTHOR_WORDS: Record<string, string> = { OWNER: "Your note", MARKET_REVIEWER: "Market Reviewer", PORTFOLIO_REVIEWER: "Portfolio Reviewer" };
export function authorWords(author: string): string {
  return AUTHOR_WORDS[author] ?? "Note";
}

/** A stock's level, said after the note's audience: nothing for context. */
export function levelWords(level: string): string {
  return level === "URGENT" ? " · urgent" : level === "REVIEW" ? " · to review" : level === "PROPOSAL" ? " · on the waiting sale" : "";
}

export function audienceWords(n: Pick<SharedNoteRow, "audience" | "tickers">, analystName?: string | null): string {
  if (n.audience === "ACCOUNT") return "the whole account";
  if (n.audience === "ANALYST") return analystName ? `the ${analystName}` : "one analyst";
  return n.tickers.join(", ");
}

/** "11-04": the day, as the Activity lines write it. */
const dayOf = (d: Date) => etStamp(d).split(" ")[0];

/** A note as a line in a stock's Activity, with that stock's level. Never a run's answer on that stock, so it carries no run. */
export function noteLine(n: SharedNoteRow, ticker?: string): StoredLine {
  return {
    id: `note:${n.id}`,
    timestamp: n.createdAt,
    type: "SHARED_NOTE",
    summary: `${authorWords(n.author)} to ${audienceWords(n)}${ticker ? levelWords(levelFor(n, ticker)) : ""}`,
    rationale: n.body,
    fieldChanges: {
      sharedNote: {
        from: null,
        to: { noteId: n.id, author: n.author, audience: n.audience, tickers: n.tickers, eventDate: n.eventDate, levels: n.levels ?? {}, pinnedUntil: n.pinnedUntil?.toISOString() ?? null, runId: n.runId },
      },
    },
    runId: null,
  };
}

/** A note's holdings: the covered stocks we hold, and their share of the account (0–1). */
export interface NoteShare {
  holdings: string[];
  share: number;
}

/** The newest note this stock must answer that no run has written after. Null when every one is answered. */
export function unansweredNote(notes: readonly SharedNoteRow[], ticker: string, rows: readonly ActivityRow[], now: Date): SharedNoteRow | null {
  const since = lastRunLineAt(rows);
  return [...notes]
    .filter((n) => needsAnswer(n, ticker, now) && n.createdAt.getTime() >= since)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
}

/** The block read before a stock's Activity lines: its notes (`notesForRun`), with this stock's level and what they hold. */
export function notesBlock(ticker: string, notes: readonly SharedNoteRow[], shares: ReadonlyMap<string, NoteShare>): string | null {
  if (notes.length === 0) return null;
  const T = ticker.toUpperCase();
  const lines = notes.map((n) => {
    const about = n.eventDate ? `, about ${n.eventDate}` : "";
    const until = n.pinnedUntil ? `, pinned until ${dayOf(n.pinnedUntil)}` : "";
    let line = `  ${etStamp(n.createdAt)} · ${authorWords(n.author)} to ${audienceWords(n)}${about}${until}${levelWords(levelFor(n, T))} — "${oneLine(n.body)}" [note ${n.id}]`;
    const s = shares.get(n.id);
    if (s && s.holdings.length > 0) {
      const pct = `${Math.round(s.share * 100)}% of the account`;
      line += !s.holdings.includes(T)
        ? `\n    The note's holdings: ${s.holdings.join(", ")}, ${pct}.`
        : s.holdings.length === 1
          ? `\n    $${T} is the one holding in this note, ${pct}.`
          : `\n    $${T} is one of ${s.holdings.length} holdings in this note, ${pct}.`;
    }
    return line;
  });
  return [`NOTES ON $${T}, read before its Activity lines: the one waiting for an answer first, then the newest since its last run line:`, ...lines].join("\n");
}

/** One line per note in the Market and portfolio block. */
export function runNoteLine(n: SharedNoteRow, analystName?: string | null): string {
  const about = n.eventDate ? `, about ${n.eventDate}` : "";
  const until = n.pinnedUntil ? `, until ${dayOf(n.pinnedUntil)}` : "";
  return `${etStamp(n.createdAt)} · ${authorWords(n.author)} to ${audienceWords(n, analystName)}${about}${until}: "${oneLine(n.body)}" [note ${n.id}]`;
}
