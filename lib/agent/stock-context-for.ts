/**
 * stock-context-for.ts — the "what's been said" block for one stock, with
 * its resolved triggers as the labels, in the catalog's words. get_theses and the trigger run both call this, so the
 * morning run and the trigger run read the same block
 * (docs/plans/AGENT_CONTEXT.md §3.2).
 */
import { sentenceOf } from "@/lib/agent/triggers/condition";
import { buildStockContext, type ActivityRow, type StockContext } from "@/lib/agent/stock-context";
import type { Trigger } from "@/lib/agent/triggers/types";

/** The Activity columns the block reads, for every caller's query. */
export const ACTIVITY_SELECT = {
  id: true, thesisId: true, type: true, triggerId: true, timestamp: true, fieldChanges: true,
  summary: true, rationale: true, runId: true, priceAtTime: true, run: { select: { mode: true } },
} as const;

export function stockContextFor(args: {
  ticker: string;
  rows: ActivityRow[];
  /** The resolved ladder — the stock's own triggers and the ones it inherits. */
  triggers: Trigger[];
  now: Date;
  /** The live price, for "now" beside the principal's price then. */
  currentPrice?: number | null;
}): StockContext {
  return buildStockContext({
    ticker: args.ticker,
    rows: args.rows,
    labelFor: (id) => {
      const t = args.triggers.find((x) => x.id === id);
      return t
        ? { label: sentenceOf(t), rationale: t.rationale ?? null }
        : null;
    },
    now: args.now,
    currentPrice: args.currentPrice ?? null,
  });
}
