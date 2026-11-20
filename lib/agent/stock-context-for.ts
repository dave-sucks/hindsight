/**
 * stock-context-for.ts — one stock's Activity as an agent reads it, built
 * from its feed (lib/thesis/activity-feed.ts): the stock's saved Activity
 * lines plus its proposals' steps from their orders. Every agent's read of a
 * stock goes through this (get_theses, and the trigger run through it).
 */
import { activityFeed, type ProposalOrder, type StoredLine } from "@/lib/thesis/activity-feed";
import { buildStockContext, type StockContext } from "@/lib/agent/stock-context";
import {
  coversStock,
  isPinned,
  noteLine,
  pinnedBlock,
  PINNED_PER_STOCK,
  type NoteShare,
  type SharedNoteRow,
} from "@/lib/agent/shared-notes";
import type { TitleTrigger } from "@/components/agent/sheets/thesis-timeline-utils";

/**
 * How many of a stock's newest Activity lines are loaded (about a month):
 * what the agent's four parts and the situations' unanswered fires read.
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
 * pinned ones (the owner's), which read in their own block above it.
 */
export function stockContextFor(args: {
  ticker: string;
  rows: StoredLine[];
  orders?: ProposalOrder[];
  triggers?: ReadonlyArray<TitleTrigger>;
  notes?: readonly SharedNoteRow[];
  shares?: ReadonlyMap<string, NoteShare>;
  /** The stock's conviction, said with where it stands. */
  conviction?: string | null;
  now?: Date;
}): StockContext {
  const now = args.now ?? new Date();
  const covering = (args.notes ?? []).filter((n) => coversStock(n, { ticker: args.ticker }));
  const pinned = covering.filter((n) => isPinned(n, now)).slice(0, PINNED_PER_STOCK);
  const shown = new Set(pinned.map((n) => n.id));
  const inFeed = covering.filter((n) => !shown.has(n.id)).map((n) => noteLine(n, args.ticker));
  const base = buildStockContext({ ticker: args.ticker, feed: activityFeed({ updates: [...args.rows, ...inFeed], orders: args.orders ?? [] }), triggers: args.triggers, conviction: args.conviction });
  if (pinned.length === 0) return base;
  return { ...base, text: [pinnedBlock(args.ticker, pinned, args.shares ?? new Map()), base.text].filter(Boolean).join("\n") };
}
