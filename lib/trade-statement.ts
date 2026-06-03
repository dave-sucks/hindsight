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

const usd = (n: number) => `$${n.toFixed(2)}`;

export type TradeStatementKind =
  | "proposed-buy" // pending entry, no position held yet
  | "holding" // open position
  | "closed" // closed position
  | "proposed-exit"; // open position + a pending close / add / trim

export interface TradeStatementInput {
  kind: TradeStatementKind;
  /** Shares — held qty (holding/closed/proposed-exit) or order qty (proposed-buy). */
  qty: number | null;
  /** Avg cost (held/closed) or proposed entry price (proposed-buy). */
  entry: number;
  /** Live current price — used by holding + proposed-exit. */
  current?: number | null;
  /** Exit fill price — used by closed. */
  closePrice?: number | null;
  /** proposed-buy verb. LONG → "Buy", SHORT → "Short". Default "Buy". */
  buyVerb?: "Buy" | "Short";
  /** proposed-exit verb. CLOSE → "close", ADD → "add", PARTIAL_CLOSE → "trim". */
  exitVerb?: "close" | "add" | "trim";
}

/**
 * The canonical one-line description of a trade's state. Returns null when
 * there's no quantity to describe (nothing to say). The four forms:
 *
 *   proposed-buy   → "Proposed: Buy 500 shares at $5.11"
 *   holding        → "Bought 500 shares at $5.11, now trading at $8.35"
 *   closed         → "Bought 500 shares at $5.11, closed at $8.35"
 *   proposed-exit  → "Proposed: Bought 500 shares at $5.11, close at $8.35"
 */
export function buildTradeSentence(i: TradeStatementInput): string | null {
  if (i.qty == null) return null;
  const q = fmtQty(i.qty);
  const stem = `Bought ${q} shares at ${usd(i.entry)}`;

  switch (i.kind) {
    case "proposed-buy":
      return `Proposed: ${i.buyVerb ?? "Buy"} ${q} shares${
        i.entry > 0 ? ` at ${usd(i.entry)}` : ""
      }`;
    case "holding":
      return stem + (i.current != null ? `, now trading at ${usd(i.current)}` : "");
    case "closed":
      return stem + (i.closePrice != null ? `, closed at ${usd(i.closePrice)}` : "");
    case "proposed-exit": {
      const verb = i.exitVerb ?? "close";
      return (
        `Proposed: ${stem}` +
        (i.current != null ? `, ${verb} at ${usd(i.current)}` : `, ${verb}`)
      );
    }
  }
}
