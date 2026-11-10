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
 * - ANALYST: that analyst's runs read it once, at the top, while it lasts.
 * - ACCOUNT: every run reads it once, at the top, while it lasts.
 *
 * A note to stocks can be pinned until a date at most two weeks out. Pinned,
 * it reads in its own block above the stock's newest 8 Activity lines and
 * doesn't count against them, and the stock is in the PINNED_NOTE situation
 * until a run writes on the stock after it. A note to the account or an
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
import { etStamp, isAgentAnswer, type ActivityRow } from "@/lib/agent/stock-context";

export type NoteAudience = "ACCOUNT" | "ANALYST" | "STOCKS";
export type NoteAuthor = "OWNER" | "PORTFOLIO_MANAGER";

export interface SharedNoteRow {
  id: string;
  author: string;
  runId: string | null;
  body: string;
  audience: string;
  analystId: string | null;
  tickers: string[];
  eventDate: string | null;
  pinnedUntil: Date | null;
  createdAt: Date;
}

/** The longest a note stays pinned. */
export const NOTE_MAX_PIN_DAYS = 14;
/** A note to the account or an analyst lasts this long unless it names an end. */
export const RUN_NOTE_DEFAULT_DAYS = 7;
/** A stock reads at most this many pinned notes, the newest. */
export const PINNED_PER_STOCK = 2;
export const SHARED_NOTE_CHARS = 2000;
/** How far back the agents' read loads notes: past any pin, and about the month the Activity scan covers. */
export const LOAD_DAYS = 45;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function isPinned(n: Pick<SharedNoteRow, "pinnedUntil">, now: Date): boolean {
  return n.pinnedUntil != null && n.pinnedUntil.getTime() > now.getTime();
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
 * list. A run reads a note to the account or an analyst once at the top, and
 * the stock's two newest pinned notes in their own block, so none of those
 * counts toward the 8.
 */
export function newestEightForRuns<T extends { type: string; fieldChanges?: unknown }>(feed: readonly T[], now: Date): T[] {
  let pinnedLeft = PINNED_PER_STOCK;
  const read: T[] = [];
  for (const item of feed) {
    if (item.type === "SHARED_NOTE") {
      const to = (item.fieldChanges as { sharedNote?: { to?: { audience?: string; pinnedUntil?: string | null } } } | null)?.sharedNote?.to;
      if (to?.audience === "ACCOUNT" || to?.audience === "ANALYST") continue;
      if (pinnedLeft > 0 && to?.pinnedUntil && new Date(to.pinnedUntil).getTime() > now.getTime()) {
        pinnedLeft--;
        continue;
      }
    }
    read.push(item);
    if (read.length === RECENT_ITEMS) break;
  }
  return read;
}

/** The notes read once at the top of a run: the account's and the analyst's, while they last. An account-wide read gets every analyst's. */
export function runNotes(notes: readonly SharedNoteRow[], analystId: string | null | undefined, now: Date): SharedNoteRow[] {
  return notes.filter(
    (n) => isPinned(n, now) && (n.audience === "ACCOUNT" || (n.audience === "ANALYST" && (!analystId || n.analystId === analystId))),
  );
}

export function authorWords(author: string): string {
  return author === "OWNER" ? "Your note" : "Portfolio manager's note";
}

export function audienceWords(n: Pick<SharedNoteRow, "audience" | "tickers">, analystName?: string | null): string {
  if (n.audience === "ACCOUNT") return "the whole account";
  if (n.audience === "ANALYST") return analystName ? `the ${analystName}` : "one analyst";
  return n.tickers.join(", ");
}

/** "11-04": the day, as the Activity lines write it. */
const dayOf = (d: Date) => etStamp(d).split(" ")[0];

/** A note to stocks as a line in a covered stock's Activity. Never a run's answer on that stock, so it carries no run. */
export function noteLine(n: SharedNoteRow): StoredLine {
  return {
    id: `note:${n.id}`,
    timestamp: n.createdAt,
    type: "SHARED_NOTE",
    summary: `${authorWords(n.author)} to ${audienceWords(n)}`,
    rationale: n.body,
    fieldChanges: {
      sharedNote: {
        from: null,
        to: { noteId: n.id, author: n.author, audience: n.audience, tickers: n.tickers, eventDate: n.eventDate, pinnedUntil: n.pinnedUntil?.toISOString() ?? null, runId: n.runId },
      },
    },
    runId: null,
  };
}

/** A pinned note's holdings: the covered stocks we hold, and their share of the account (0–1). */
export interface NoteShare {
  holdings: string[];
  share: number;
}

/** The newest pinned note on the stock that no run has written after. Null when every one is answered. */
export function unansweredPinned(pinned: readonly SharedNoteRow[], rows: readonly ActivityRow[]): SharedNoteRow | null {
  const answers = rows.filter(isAgentAnswer).map((r) => r.timestamp.getTime());
  const newest = Math.max(-Infinity, ...answers);
  return [...pinned].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).find((n) => newest <= n.createdAt.getTime()) ?? null;
}

/** The block read before a stock's Activity lines: its pinned notes, newest first, with what they hold. */
export function pinnedBlock(ticker: string, pinned: readonly SharedNoteRow[], shares: ReadonlyMap<string, NoteShare>): string | null {
  if (pinned.length === 0) return null;
  const T = ticker.toUpperCase();
  const lines = pinned.map((n) => {
    const about = n.eventDate ? `, about ${n.eventDate}` : "";
    const until = n.pinnedUntil ? `, pinned until ${dayOf(n.pinnedUntil)}` : "";
    let line = `  ${etStamp(n.createdAt)} · ${authorWords(n.author)} to ${audienceWords(n)}${about}${until} — "${oneLine(n.body)}" [note ${n.id}]`;
    const s = shares.get(n.id);
    if (s && s.holdings.length > 0) {
      const pct = `${Math.round(s.share * 100)}% of the account`;
      line += s.holdings.includes(T)
        ? `\n    $${T} is one of ${s.holdings.length} holding${s.holdings.length === 1 ? "" : "s"} in this note, ${pct}.`
        : `\n    The note's holdings: ${s.holdings.join(", ")}, ${pct}.`;
    }
    return line;
  });
  return [`PINNED ON $${T}: notes to more than this stock, read before its Activity lines:`, ...lines].join("\n");
}

/** One line per note read at the top of a run. */
export function runNoteLine(n: SharedNoteRow, analystName?: string | null): string {
  const about = n.eventDate ? `, about ${n.eventDate}` : "";
  const until = n.pinnedUntil ? `, until ${dayOf(n.pinnedUntil)}` : "";
  return `${etStamp(n.createdAt)} · ${authorWords(n.author)} to ${audienceWords(n, analystName)}${about}${until}: "${oneLine(n.body)}" [note ${n.id}]`;
}
