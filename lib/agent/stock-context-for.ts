/**
 * stock-context-for.ts — the "what's been said" block for one stock, built
 * from its feed (lib/thesis/activity-feed.ts): the stock's saved Activity
 * lines plus its proposals' steps from their orders. get_theses and the
 * trigger run both read a stock through this, so every run reads the same
 * block the Overview shows.
 */
import { activityFeed, type ProposalOrder, type StoredLine } from "@/lib/thesis/activity-feed";
import { buildStockContext, type StockContext } from "@/lib/agent/stock-context";
import {
  coversStock,
  isPinned,
  noteLine,
  pinnedBlock,
  unansweredPinned,
  PINNED_PER_STOCK,
  type NoteShare,
  type SharedNoteRow,
} from "@/lib/agent/shared-notes";
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
 * The ones that cover this stock join its Activity, except the newest two
 * pinned ones, which read in their own block above the newest 8 and put the
 * stock in PINNED_NOTE until a run writes on it after them.
 */
export function stockContextFor(args: {
  ticker: string;
  rows: StoredLine[];
  orders?: ProposalOrder[];
  triggers?: ReadonlyArray<TitleTrigger>;
  sector?: string | null;
  notes?: readonly SharedNoteRow[];
  shares?: ReadonlyMap<string, NoteShare>;
  now?: Date;
}): StockContext {
  const now = args.now ?? new Date();
  const covering = (args.notes ?? []).filter((n) => coversStock(n, { ticker: args.ticker, sector: args.sector }));
  const pinned = covering.filter((n) => isPinned(n, now)).slice(0, PINNED_PER_STOCK);
  const shown = new Set(pinned.map((n) => n.id));
  const inFeed = covering.filter((n) => !shown.has(n.id)).map(noteLine);
  const base = buildStockContext({ ticker: args.ticker, feed: activityFeed({ updates: [...args.rows, ...inFeed], orders: args.orders ?? [] }), triggers: args.triggers });
  if (pinned.length === 0) return base;
  const open = unansweredPinned(pinned, args.rows);
  return {
    ...base,
    text: [pinnedBlock(args.ticker, pinned, args.shares ?? new Map()), base.text].filter(Boolean).join("\n"),
    pinnedNote: open ? { id: open.id, at: open.createdAt } : null,
  };
}
