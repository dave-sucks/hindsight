/**
 * proposalHeadline — THE one sentence describing a pending trade proposal.
 * The email subject, the ntfy push body, and the email card headline all
 * render this same string so every channel reads identically:
 *
 *   "[LIVE] Hindsight wants to sell 181 shares of ARQT for +25.6% (+$1,025)"
 *   "Hindsight wants to buy 60 shares of SMTC (~$3,480)"
 *
 * Branded "Hindsight" rather than the analyst name — which analyst staged
 * the proposal is visible in the app; the notification only needs the what,
 * how much, and at what gain. Closes carry signed P&L (% and $) when the
 * exit quote is known; opens/adds carry the estimated order cost.
 *
 * If you change the wording here, every proposal surface changes together —
 * that is the point. Do not rebuild this string at a call site.
 */

export type ProposalIntent = "OPEN" | "ADD" | "CLOSE" | "PARTIAL_CLOSE";

export interface ProposalHeadlineParts {
  intent: ProposalIntent;
  direction: "LONG" | "SHORT";
  environment: "PAPER" | "LIVE";
  ticker: string;
  qty: number;
  /** CLOSE / PARTIAL_CLOSE with a known exit quote — signed. */
  pnlPct?: number | null;
  pnlUsd?: number | null;
  /** OPEN / ADD — estimated order cost in dollars. */
  estimatedCost?: number | null;
  /** Subject lines want "[LIVE] "; push bodies carry LIVE in the title. */
  includeLivePrefix?: boolean;
}

export function proposalVerb(
  intent: ProposalIntent,
  direction: "LONG" | "SHORT",
): string {
  if (intent === "OPEN") return direction === "LONG" ? "buy" : "short";
  if (intent === "ADD") return "add";
  if (intent === "CLOSE") return direction === "LONG" ? "sell" : "cover";
  if (intent === "PARTIAL_CLOSE") return "trim";
  return "trade";
}

function wholeDollars(n: number): string {
  return `$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function proposalHeadline(p: ProposalHeadlineParts): string {
  const prefix =
    p.includeLivePrefix !== false && p.environment === "LIVE" ? "[LIVE] " : "";
  const verb = proposalVerb(p.intent, p.direction);
  const shares = p.qty === 1 ? "share" : "shares";
  const base = `${prefix}Hindsight wants to ${verb} ${p.qty.toLocaleString()} ${shares} of ${p.ticker}`;

  const isClose = p.intent === "CLOSE" || p.intent === "PARTIAL_CLOSE";
  if (isClose && p.pnlPct != null) {
    const pct = `${p.pnlPct >= 0 ? "+" : "-"}${Math.abs(p.pnlPct).toFixed(1)}%`;
    const usd =
      p.pnlUsd != null
        ? ` (${p.pnlUsd >= 0 ? "+" : "-"}${wholeDollars(p.pnlUsd)})`
        : "";
    return `${base} for ${pct}${usd}`;
  }
  if (!isClose && p.estimatedCost != null && p.estimatedCost > 0) {
    return `${base} (~${wholeDollars(p.estimatedCost)})`;
  }
  return base;
}
