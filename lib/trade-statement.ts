/**
 * trade-statement — the ONE source of truth for the sentence that describes
 * a trade's state, shared across every surface that renders one:
 *
 *   • thesis sheet TradeBlock        (components/agent/sheets/ThesisSheet.tsx)
 *   • thesis row banner              (components/ui/thesis-row.tsx)
 *   • trade-detail page header       (app/(root)/trades/[id]/page.tsx)
 *   • homepage activity feed         (components/dashboard/DashboardClient.tsx)
 *
 * Before this existed each surface hand-rolled its own version, which drifted:
 * different grammar ("N shares · avg entry $X" vs "Bought N shares at $X"),
 * different decimal handling (raw 5.953027164 vs fmtQty), and a bespoke
 * opaque-paren P&L vs the shared PriceChange. The sentence is now built here;
 * the green/red gain is rendered by <TradeStatement> via <PriceChange>.
 *
 * Pure (no React) so it's safe to import server- or client-side. The LABEL is
 * intentionally NOT decided here — it's context-specific: the activity feed is
 * an event log ("Bought" / "Sold"), the live surfaces show current state
 * ("Holding" / "Won" / "Loss"). Only the sentence + gain unify.
 */

/** Share quantity: integer as-is, otherwise 2 decimals (no 5.953027164). */
export function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** "share" for exactly 1, "shares" otherwise (incl. fractional like 0.5/3.54). */
function sharesWord(n: number): string {
  return n === 1 ? "share" : "shares";
}

const usd = (n: number) => `$${n.toFixed(2)}`;

export type TradeStatementKind =
  | "proposed-buy" // pending entry, no position held yet
  | "holding" // open position
  | "closed" // closed position
  | "proposed-exit"; // open position + a pending close / add / trim

export interface TradeStatementInput {
  kind: TradeStatementKind;
  /**
   * Shares. For holding/closed/proposed-exit this is the TOTAL held quantity;
   * for proposed-buy it's the order quantity. Multiple adds collapse into the
   * total (see `entry`).
   */
  qty: number | null;
  /**
   * Entry price. For held/closed positions this is the AVG COST, so a
   * position built from multiple buys still reads correctly: "bought 150
   * shares at $41.20" = total quantity at average cost.
   */
  entry: number;
  /** Live current price — used by holding + proposed-exit. */
  current?: number | null;
  /** Exit fill price — used by closed. */
  closePrice?: number | null;
  /** proposed-buy verb. LONG → "Buy", SHORT → "Short". Default "Buy". */
  buyVerb?: "Buy" | "Short";
  /** proposed-exit verb. CLOSE → "close", ADD → "add", PARTIAL_CLOSE → "trim". */
  exitVerb?: "close" | "add" | "trim";
  /**
   * proposed-exit only: the proposal's OWN share count (an ADD or TRIM order
   * moves a specific quantity, distinct from the total held `qty`). Omitted →
   * the action clause has no share count (a full close doesn't need one).
   */
  proposalQty?: number | null;
}

/**
 * The canonical one-line description of a trade's state. Returns null when
 * there's no quantity to describe (nothing to say). The ACTION leads, the
 * entry context trails:
 *
 *   proposed-buy   → "Proposed: Buy 100 shares at $40.93"
 *   holding        → "Bought 100 shares at $40.93, now trading at $45.41"
 *   closed         → "Sold at $416.63, bought 3.54 shares at $282.35"
 *   proposed-exit  → "Proposed: Sell at $45.41, bought 100 shares at $40.93"
 *     (trim)       → "Proposed: Trim 30 shares at $45.41, bought 100 shares at $40.93"
 *     (add)        → "Proposed: Add 50 shares at $45.41, bought 100 shares at $40.93"
 */
export function buildTradeSentence(i: TradeStatementInput): string | null {
  if (i.qty == null) return null;
  const q = fmtQty(i.qty);
  const unit = sharesWord(i.qty);
  // Trailing entry context (lowercase — it follows the action clause).
  const entryClause = `bought ${q} ${unit} at ${usd(i.entry)}`;

  switch (i.kind) {
    case "proposed-buy":
      return `Proposed: ${i.buyVerb ?? "Buy"} ${q} ${unit}${
        i.entry > 0 ? ` at ${usd(i.entry)}` : ""
      }`;
    case "holding":
      return (
        `Bought ${q} ${unit} at ${usd(i.entry)}` +
        (i.current != null ? `, now trading at ${usd(i.current)}` : "")
      );
    case "closed":
      return i.closePrice != null
        ? `Sold at ${usd(i.closePrice)}, ${entryClause}`
        : `Sold — ${entryClause}`;
    case "proposed-exit": {
      const verb =
        i.exitVerb === "add" ? "Add" : i.exitVerb === "trim" ? "Trim" : "Sell";
      // Adds/trims move a specific share count; a full close doesn't need one.
      const pq =
        i.proposalQty != null && i.exitVerb !== "close" && i.exitVerb !== undefined
          ? ` ${fmtQty(i.proposalQty)} ${sharesWord(i.proposalQty)}`
          : "";
      const at = i.current != null ? ` at ${usd(i.current)}` : "";
      return `Proposed: ${verb}${pq}${at}, ${entryClause}`;
    }
  }
}
