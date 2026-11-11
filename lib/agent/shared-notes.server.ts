/**
 * shared-notes.server.ts: loads the account's shared notes, works out a
 * pinned note's share of the account, and saves a note (the rules are in
 * shared-notes.ts).
 */
import { prisma } from "@/lib/prisma";
import { getLiveQuotes } from "@/lib/market-data/live-quote";
import type { AlpacaCredentials } from "@/lib/alpaca";
import {
  coversStock,
  levelFor,
  LOAD_DAYS,
  NOTE_MAX_PIN_DAYS,
  RUN_NOTE_DEFAULT_DAYS,
  SHARED_NOTE_CHARS,
  type NoteAudience,
  type NoteAuthor,
  type NoteLevel,
  type NoteShare,
  type SharedNoteRow,
} from "@/lib/agent/shared-notes";

const DAY = 86_400_000;

/** The newest notes a read loads; past it, the owner's and those still asking for an answer still load. */
export const NOTES_LOADED = 100;

/**
 * The account's notes from the last month and a half, newest first: the
 * newest NOTES_LOADED, and past them every note the owner wrote, every note
 * still pinned, and every note that marks a stock to review or urgent (the
 * stock's own lines say whether it was answered). Empty on a failed read: a
 * note is never worth failing a run.
 */
export async function loadSharedNotes(userId: string | undefined, now: Date): Promise<SharedNoteRow[]> {
  if (!userId) return [];
  try {
    const window = { userId, createdAt: { gte: new Date(now.getTime() - LOAD_DAYS * DAY) } };
    const newest = await prisma.sharedNote.findMany({ where: window, orderBy: { createdAt: "desc" }, take: NOTES_LOADED });
    if (newest.length < NOTES_LOADED) return newest;
    const kept = new Set(newest.map((n) => n.id));
    const older = { ...window, createdAt: { ...window.createdAt, lt: newest[newest.length - 1].createdAt } };
    const [mine, asking] = await Promise.all([
      prisma.sharedNote.findMany({ where: { ...older, OR: [{ author: "OWNER" }, { pinnedUntil: { gt: now } }] } }),
      prisma.sharedNote.findMany({ where: { ...older, author: { not: "OWNER" }, audience: "STOCKS" }, select: { id: true, tickers: true, levels: true } }),
    ]);
    const askingIds = asking.filter((n) => n.tickers.some((t) => levelFor(n, t) === "REVIEW" || levelFor(n, t) === "URGENT")).map((n) => n.id);
    const more = askingIds.length ? await prisma.sharedNote.findMany({ where: { id: { in: askingIds } } }) : [];
    const extra = [...mine, ...more].filter((n) => !kept.has(n.id) && !!kept.add(n.id));
    return [...newest, ...extra].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } catch (err) {
    console.warn("[shared-notes] load failed; runs read without them:", err);
    return [];
  }
}

/**
 * The notes one stock's Activity tab can show: every note since a month and a
 * half before its thesis began (a note to stocks that a run would already have
 * read at the thesis's start), newest first. Throws; the tab catches.
 */
export async function loadNotesSince(userId: string, since: Date): Promise<SharedNoteRow[]> {
  return prisma.sharedNote.findMany({
    where: { userId, createdAt: { gte: new Date(since.getTime() - LOAD_DAYS * DAY) } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}

/**
 * Each note's holdings and their share of the account, worked out now from
 * the open positions and live prices. Only notes to stocks; nothing is
 * stored. Missing when the equity or a price is missing.
 */
export async function noteShares(
  notes: readonly SharedNoteRow[],
  opts: { userId?: string; environment?: "PAPER" | "LIVE"; equity: number | null; creds?: AlpacaCredentials; now: Date; tickers?: readonly string[] },
): Promise<Map<string, NoteShare>> {
  const out = new Map<string, NoteShare>();
  // Only the notes this read shows: to stocks, naming one of the read's stocks.
  const read = opts.tickers ? new Set(opts.tickers.map((t) => t.toUpperCase())) : null;
  const toStocks = notes.filter((n) => n.audience === "STOCKS" && (!read || n.tickers.some((t) => read.has(t))));
  if (toStocks.length === 0 || !opts.userId || !opts.equity || opts.equity <= 0) return out;
  try {
    const positions = await prisma.position.findMany({
      where: { userId: opts.userId, status: "OPEN", environment: opts.environment ?? "LIVE" },
      select: { symbol: true, quantity: true },
    });
    if (positions.length === 0) return out;
    const symbols = [...new Set(positions.map((p) => p.symbol.toUpperCase()))];
    const quotes = await getLiveQuotes(symbols, { caller: "other", creds: opts.creds });
    for (const n of toStocks) {
      let value = 0;
      const holdings: string[] = [];
      let priced = true;
      for (const p of positions) {
        const sym = p.symbol.toUpperCase();
        if (!coversStock(n, { ticker: sym })) continue;
        const price = quotes[sym]?.quote?.c;
        if (typeof price !== "number" || price <= 0) priced = false;
        else value += price * p.quantity;
        if (!holdings.includes(sym)) holdings.push(sym);
      }
      if (holdings.length > 0 && priced) out.set(n.id, { holdings, share: value / opts.equity });
    }
  } catch (err) {
    console.warn("[shared-notes] share of the account not worked out:", err);
  }
  return out;
}

/** A reviewer's note on a sale waiting, as its proposal card shows it. */
export interface SaleNote {
  id: string;
  author: string;
  at: string;
  title: string;
  /** The note's line for this stock: its level, what it touches and how much. */
  line: string | null;
}

/**
 * The reviewers' notes on a stock's waiting sale (level PROPOSAL for it),
 * written since `since`, newest first: the proposal card shows them, since
 * the stock is off its analyst's list while the sale waits. Empty on a
 * failed read.
 */
export async function saleNotes(userId: string, ticker: string, since: Date): Promise<SaleNote[]> {
  const T = ticker.toUpperCase();
  try {
    const rows = await prisma.sharedNote.findMany({
      where: { userId, audience: "STOCKS", tickers: { has: T }, author: { in: ["MARKET_REVIEWER", "PORTFOLIO_REVIEWER"] }, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      select: { id: true, author: true, body: true, levels: true, createdAt: true },
    });
    return rows
      .filter((n) => levelFor(n, T) === "PROPOSAL")
      .slice(0, 5)
      .map((n) => {
        const lines = n.body.split("\n");
        return { id: n.id, author: n.author, at: n.createdAt.toISOString(), title: lines[0], line: lines.find((l) => l.startsWith(`${T} ·`)) ?? null };
      });
  } catch (err) {
    console.warn("[shared-notes] sale notes not read:", err);
    return [];
  }
}

/** What a note to more than one stock is saved with, after what doesn't fit is trimmed. */
export interface SharedNoteInput {
  userId: string;
  author: NoteAuthor;
  runId?: string | null;
  body: string;
  audience: NoteAudience;
  analystId?: string | null;
  tickers?: readonly string[];
  /** YYYY-MM-DD; anything else is dropped. */
  eventDate?: string | null;
  pinnedUntil?: Date | null;
  /** Each named stock's level; a stock not listed is CONTEXT. */
  levels?: Record<string, NoteLevel> | null;
  now?: Date;
}

/**
 * Saves a shared note. Nothing is refused for its shape: the text is cut at
 * the limit, a pin past two weeks comes in to two weeks, a note to the
 * account or an analyst with no end lasts a week, and a date that isn't
 * YYYY-MM-DD is dropped. Each change is said back in `adjusted`.
 */
export async function writeSharedNote(input: SharedNoteInput): Promise<{ id: string; pinnedUntil: Date | null; adjusted: string[] }> {
  const now = input.now ?? new Date();
  const adjusted: string[] = [];
  const body = input.body.trim().slice(0, SHARED_NOTE_CHARS);
  if (input.body.trim().length > SHARED_NOTE_CHARS) adjusted.push(`the text was cut at ${SHARED_NOTE_CHARS} characters`);
  const maxPin = new Date(now.getTime() + NOTE_MAX_PIN_DAYS * DAY);
  let pinnedUntil = input.pinnedUntil ?? null;
  if (pinnedUntil && pinnedUntil > maxPin) {
    pinnedUntil = maxPin;
    adjusted.push(`pinned for ${NOTE_MAX_PIN_DAYS} days, the most a note is`);
  }
  if (!pinnedUntil && (input.audience === "ACCOUNT" || input.audience === "ANALYST")) {
    pinnedUntil = new Date(now.getTime() + RUN_NOTE_DEFAULT_DAYS * DAY);
    adjusted.push(`a note to ${input.audience === "ACCOUNT" ? "the account" : "an analyst"} lasts ${RUN_NOTE_DEFAULT_DAYS} days unless it names an end`);
  }
  const eventDate = input.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(input.eventDate.trim()) ? input.eventDate.trim() : null;
  if (input.eventDate && !eventDate) adjusted.push(`the date "${input.eventDate}" was dropped (YYYY-MM-DD only)`);
  const row = await prisma.sharedNote.create({
    data: {
      userId: input.userId,
      author: input.author,
      runId: input.runId ?? null,
      body,
      audience: input.audience,
      analystId: input.audience === "ANALYST" ? (input.analystId ?? null) : null,
      tickers: input.audience === "STOCKS" ? [...new Set((input.tickers ?? []).map((t) => t.trim().toUpperCase()).filter(Boolean))] : [],
      eventDate,
      pinnedUntil,
      levels: input.audience === "STOCKS" ? (input.levels ?? {}) : {},
    },
    select: { id: true },
  });
  return { id: row.id, pinnedUntil, adjusted };
}
