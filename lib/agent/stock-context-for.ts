/**
 * stock-context-for.ts — the "what's been said" block for one stock, with
 * its resolved triggers as the labels. Server-side: describePredicate lives
 * with the evaluator. get_theses and the trigger run both call this, so the
 * morning run and the trigger run read the same block
 * (docs/plans/AGENT_CONTEXT.md §3.2).
 */
import { describePredicate } from "@/lib/agent/needs-action";
import { buildStockContext, type ActivityRow, type StockContext } from "@/lib/agent/stock-context";
import type { Trigger } from "@/lib/agent/triggers/types";

export function stockContextFor(args: {
  ticker: string;
  rows: ActivityRow[];
  /** The resolved ladder — the stock's own triggers and the ones it inherits. */
  triggers: Trigger[];
  now: Date;
}): StockContext {
  return buildStockContext({
    ticker: args.ticker,
    rows: args.rows,
    labelFor: (id) => {
      const t = args.triggers.find((x) => x.id === id);
      return t
        ? { label: `${describePredicate(t.predicate)} → ${t.action.toLowerCase()}`, rationale: t.rationale ?? null }
        : null;
    },
    now: args.now,
  });
}
