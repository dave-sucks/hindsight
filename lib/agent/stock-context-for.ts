/**
 * stock-context-for.ts — the "what's been said" block for one stock, built
 * from its feed (lib/thesis/activity-feed.ts): the stock's saved Activity
 * lines plus its proposals' steps from their orders. get_theses and the
 * trigger run both read a stock through this, so every run reads the same
 * block the Overview shows.
 */
import { activityFeed, type ProposalOrder, type StoredLine } from "@/lib/thesis/activity-feed";
import { buildStockContext, type StockContext } from "@/lib/agent/stock-context";
import { coversStock, noteLine, notesBlock, notesForRun, unansweredNote, type NoteShare, type SharedNoteRow } from "@/lib/agent/shared-notes";
import type { TitleTrigger } from "@/components/agent/sheets/thesis-timeline-utils";

/**
 * How many of a stock's newest Activity lines are loaded (about a month).
 * The agent reads the newest 8 of the feed; the situations read all of these
 * for an unanswered fire or an unanswered word of the principal's.
 */
export const ACTIVITY_LINES = 40;

/** The Activity columns every loader selects. */
export const ACTIVITY_SELECT = {
  id: true, thesisId: true, type: true, triggerId: true, timestamp: true, fieldChanges: true,
  summary: true, rationale: true, runId: true, priceAtTime: true, positionAtTime: true, signalIds: true, tradeId: true, run: { select: { mode: true } },
  verdict: true, verdictLine: true, answersUpdateId: true, answers: { select: { timestamp: true } },
  triggerAction: true, triggerCondition: true,
} as const;

/**
 * `notes` are the account's shared notes, newest first (lib/agent/shared-notes.ts).
 * The ones that cover this stock join its Activity, except up to 3 read in
 * their own block above the newest 8: the one it must answer first, then the
 * newest since its last run line. A note giving the stock REVIEW or URGENT,
 * or one the owner pinned, puts it in PINNED_NOTE until a run writes on it.
 */
export function stockContextFor(args: {
  ticker: string;
  rows: StoredLine[];
  orders?: ProposalOrder[];
  triggers?: ReadonlyArray<TitleTrigger>;
  notes?: readonly SharedNoteRow[];
  shares?: ReadonlyMap<string, NoteShare>;
  now?: Date;
}): StockContext {
  const now = args.now ?? new Date();
  const covering = (args.notes ?? []).filter((n) => coversStock(n, { ticker: args.ticker }));
  const read = notesForRun(covering, args.ticker, args.rows, now);
  const shown = new Set(read.map((n) => n.id));
  const inFeed = covering.filter((n) => !shown.has(n.id)).map((n) => noteLine(n, args.ticker));
  const base = buildStockContext({ ticker: args.ticker, feed: activityFeed({ updates: [...args.rows, ...inFeed], orders: args.orders ?? [] }), triggers: args.triggers });
  const open = unansweredNote(covering, args.ticker, args.rows, now);
  if (read.length === 0 && !open) return base;
  return {
    ...base,
    text: [notesBlock(args.ticker, read, args.shares ?? new Map()), base.text].filter(Boolean).join("\n"),
    pinnedNote: open ? { id: open.id, at: open.createdAt } : null,
  };
}
