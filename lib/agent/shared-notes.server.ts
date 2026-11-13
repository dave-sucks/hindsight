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
  isPinned,
  LOAD_DAYS,
  NOTE_MAX_PIN_DAYS,
  RUN_NOTE_DEFAULT_DAYS,
  SHARED_NOTE_CHARS,
  type NoteAudience,
  type NoteAuthor,
  type NoteShare,
  type SharedNoteRow,
} from "@/lib/agent/shared-notes";

const DAY = 86_400_000;

/** The account's notes from the last month and a half, newest first. Empty on a failed read: a note is never worth failing a run. */
export async function loadSharedNotes(userId: string | undefined, now: Date): Promise<SharedNoteRow[]> {
  if (!userId) return [];
  try {
    return await prisma.sharedNote.findMany({
      where: { userId, createdAt: { gte: new Date(now.getTime() - LOAD_DAYS * DAY) } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
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
 * Each pinned note's holdings and their share of the account, worked out now
 * from the open positions and live prices. Only pinned notes to stocks;
 * nothing is stored. Missing when the equity or a price is missing.
 */
export async function noteShares(
  notes: readonly SharedNoteRow[],
  opts: { userId?: string; environment?: "PAPER" | "LIVE"; equity: number | null; creds?: AlpacaCredentials; now: Date },
): Promise<Map<string, NoteShare>> {
  const out = new Map<string, NoteShare>();
  const pinned = notes.filter((n) => isPinned(n, opts.now) && n.audience === "STOCKS");
  if (pinned.length === 0 || !opts.userId || !opts.equity || opts.equity <= 0) return out;
  try {
    const positions = await prisma.position.findMany({
      where: { userId: opts.userId, status: "OPEN", environment: opts.environment ?? "LIVE" },
      select: { symbol: true, quantity: true },
    });
    if (positions.length === 0) return out;
    const symbols = [...new Set(positions.map((p) => p.symbol.toUpperCase()))];
    const quotes = await getLiveQuotes(symbols, { caller: "other", creds: opts.creds });
    for (const n of pinned) {
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
  /** The Market Reviewer's two fields, kept as it gave them. */
  impact?: string | null;
  effect?: string | null;
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
      impact: input.impact ?? null,
      effect: input.effect ?? null,
    },
    select: { id: true },
  });
  return { id: row.id, pinnedUntil, adjusted };
}
