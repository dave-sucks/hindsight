/**
 * indicator-needs.ts — which predicates read the daily indicator snapshot.
 *
 * The 5-minute pass loads a snapshot only for the stocks whose ladder asks
 * for one, so this gate decides what the evaluator can see. A predicate
 * missing from it reads its chart input as absent and silently falls back —
 * which is how a range-widened trail came to sell at the written percent
 * while the thesis sheet, which looks the ATR up for itself, drew the wider
 * line (DAV-294, caught in review before it shipped).
 *
 * Pure, so it can be tested without the Inngest module around it.
 */

import type { TriggerPredicate } from "./types";

export function needsIndicators(p: TriggerPredicate): boolean {
  switch (p.kind) {
    case "VS_SMA":
    case "NEAR_SMA":
    case "VOLUME_RATIO":
    case "NEW_HIGH":
    case "PCT_FROM_52W_HIGH":
    case "RS_VS_SPY":
    case "GAP_UP":
    case "RSI":
    case "INSIDER_CLUSTER":
      return true;
    case "PRICE_MOVE_PCT":
      return p.window !== "1D";
    case "TRAILING_FROM_HIGH":
      // A trail whose give-back widens with the stock's range reads ATR(14)
      // off the snapshot. A plain trail needs nothing and costs nothing.
      return p.atrMultiple != null;
    case "AND":
    case "OR":
      return p.predicates.some(needsIndicators);
    default:
      return false;
  }
}
