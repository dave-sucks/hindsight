/**
 * proposal-pending email — sent when an agent stages an
 * Order(AWAITING_APPROVAL) and the Account has the matching
 * `requireApprovalFor{Buys,Sells}` toggle on. V1 is informational only
 * ("PEAD wants to buy 100 SMTC; review in app"); a future iteration can
 * add one-click magic-link approve/reject from the email itself, but
 * that needs signed tokens we don't have yet.
 *
 * Renders the unified trade-card primitive. CLOSE / PARTIAL_CLOSE intents
 * map to SELL; OPEN / ADD map to BUY. The yellow "Proposed" badge in the
 * header and the "Est." prefixes on prices are driven by `tense: PROPOSAL`.
 *
 * See docs/plans/TRADE_AS_PROPOSAL.md §6.5.
 */

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { getEmailRecipients } from "@/lib/emails/recipients";
import { getStockQuote } from "@/lib/actions/finnhub.actions";
import {
  renderTradeCard,
  tradeDetailUrl,
  tradesIndexUrl,
} from "./trade-card";

export interface ProposalPendingData {
  analystName: string;
  ticker: string;
  tickerName?: string | null;
  direction: "LONG" | "SHORT";
  intent: "OPEN" | "ADD" | "CLOSE" | "PARTIAL_CLOSE";
  qty: number;
  estimatedPrice: number;
  estimatedCost: number;
  /** For CLOSE / PARTIAL_CLOSE proposals — the original entry price; lets the card show entry → est. exit. */
  entryPrice?: number | null;
  /** Optional current live quote — useful when the proposal sits while the market moves. */
  currentPrice?: number | null;
  /**
   * Close proposals only: did we resolve a live exit quote? When false (quote
   * lookup failed / returned 0) the card renders Est. exit "—" and suppresses
   * P&L instead of showing a false $0 / +0.0% — the avgCost-as-exit bug.
   * Defaults to true.
   */
  exitPriceKnown?: boolean;
  /** Proposed target / stop on OPEN / ADD. */
  targetPrice?: number | null;
  stopLoss?: number | null;
  expiresAt: Date;
  rationale: string | null;
  environment: "PAPER" | "LIVE";
  /** Position id — drives the CTA deep link. */
  positionId?: string | null;
  openedAt?: Date | null;
}

export function proposalPendingHtml(d: ProposalPendingData): string {
  const isClose = d.intent === "CLOSE" || d.intent === "PARTIAL_CLOSE";
  // Defaults true; only a failed live-quote lookup sets it false.
  const exitKnown = d.exitPriceKnown !== false;

  // For sells the proposal's "exit price" is the estimated fill (a live quote);
  // entry comes from the existing position. For buys the estimated entry IS the
  // price. When the exit quote is unknown, leave exit undefined → the card shows
  // "—" and suppresses P&L rather than rendering a false $0.
  const entryPrice = isClose ? d.entryPrice ?? d.estimatedPrice : d.estimatedPrice;
  const exitPrice = isClose && exitKnown ? d.estimatedPrice : undefined;

  const realizedPnl =
    isClose && exitKnown && d.entryPrice != null
      ? (d.estimatedPrice - d.entryPrice) * d.qty * (d.direction === "LONG" ? 1 : -1)
      : null;
  const realizedPnlPct =
    isClose && exitKnown && d.entryPrice != null && d.entryPrice > 0
      ? ((d.estimatedPrice - d.entryPrice) / d.entryPrice) * 100 *
        (d.direction === "LONG" ? 1 : -1)
      : null;

  return renderTradeCard({
    analystName: d.analystName,
    action: isClose ? "SELL" : "BUY",
    tense: "PROPOSAL",
    direction: d.direction,
    environment: d.environment,
    ticker: d.ticker,
    tickerName: d.tickerName ?? null,
    qty: d.qty,
    entryPrice,
    exitPrice,
    currentPrice: d.currentPrice ?? d.estimatedPrice,
    targetPrice: d.targetPrice ?? null,
    stopLoss: d.stopLoss ?? null,
    marketValue: d.estimatedCost,
    realizedPnl,
    realizedPnlPct,
    openedAt: d.openedAt ?? null,
    closedAt: isClose ? new Date() : null,
    reasoning: d.rationale,
    expiresAt: d.expiresAt,
    hindsightUrl: d.positionId ? tradeDetailUrl(d.positionId) : tradesIndexUrl(),
  });
}

/**
 * Fire-and-forget — sends the proposal-pending email to every account
 * member subscribed to TRADE_PROPOSALS (all members by default; per-member
 * opt-out on /settings/team). Resolves the Order + Position + analyst
 * details, composes the subject and HTML, calls sendEmail per recipient.
 * Never throws — failures are logged.
 */
export async function sendProposalPendingEmail(orderId: string): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        position: {
          select: {
            id: true,
            accountId: true,
            userId: true,
            analystId: true,
            environment: true,
            direction: true,
            symbol: true,
            avgCost: true,
            openedAt: true,
          },
        },
      },
    });
    if (!order || order.status !== "AWAITING_APPROVAL") return;

    const analyst = await prisma.agentConfig.findUnique({
      where: { id: order.position.analystId },
      select: { name: true, emailAlerts: true },
    });
    if (analyst?.emailAlerts === false) return;

    // Every account member subscribed to TRADE_PROPOSALS gets the email
    // (default: all members). Falls back to the position's userId only
    // when the account has no membership rows at all.
    const recipients = await getEmailRecipients(
      order.position.accountId,
      "TRADE_PROPOSALS",
      { fallbackUserId: order.position.userId },
    );
    if (recipients.length === 0) return;

    const intent = (order.intent ?? "OPEN") as ProposalPendingData["intent"];
    const direction = order.position.direction as "LONG" | "SHORT";
    const environment = order.position.environment as "PAPER" | "LIVE";
    const isClose = intent === "CLOSE" || intent === "PARTIAL_CLOSE";

    // BUG FIX (2026-06-09): for CLOSE/PARTIAL_CLOSE the proposal price is the
    // EXIT — a fresh live quote — NOT the position's entry (avgCost). Feeding
    // avgCost made the email render exit == entry → "Est. P&L +$0.00 / +0.0%"
    // on every sell proposal. Buys are unaffected: for an OPEN/ADD the
    // position's avgCost IS the proposed entry. If the quote is missing or 0
    // (Finnhub returns c:0 for unknown symbols), fall back to avgCost but flag
    // exitPriceKnown=false so the card shows "—" + no P&L, never a false zero.
    const liveQuote = isClose ? await getStockQuote(order.symbol) : null;
    const liveExit = liveQuote && liveQuote.c > 0 ? liveQuote.c : null;
    const estimatedPrice = isClose
      ? liveExit ?? order.position.avgCost
      : order.position.avgCost;

    const livePrefix = environment === "LIVE" ? "[LIVE] " : "";
    const verbStr = subjectVerb(intent, direction);
    const subject = `${livePrefix}${analyst?.name ?? "Analyst"} wants to ${verbStr} ${order.quantity} ${order.symbol}`;

    const html = proposalPendingHtml({
      analystName: analyst?.name ?? "Analyst",
      ticker: order.symbol,
      direction,
      intent,
      qty: order.quantity,
      estimatedPrice,
      estimatedCost: order.quantity * estimatedPrice,
      entryPrice: order.position.avgCost,
      currentPrice: isClose ? liveExit : order.position.avgCost,
      exitPriceKnown: isClose ? liveExit != null : true,
      openedAt: order.position.openedAt ?? null,
      expiresAt: order.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
      rationale: order.rationale,
      environment,
      positionId: order.position.id,
    });

    await Promise.all(
      recipients.map((to) => sendEmail({ to, subject, html })),
    );
  } catch (err) {
    console.warn(
      "[proposal-pending-email] send failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

/** Subject-line verb only. The card body uses the shared primitive's verb. */
function subjectVerb(
  intent: ProposalPendingData["intent"],
  direction: "LONG" | "SHORT",
): string {
  if (intent === "OPEN") return direction === "LONG" ? "buy" : "short";
  if (intent === "ADD") return direction === "LONG" ? "add to" : "add to short on";
  if (intent === "CLOSE") return "close";
  if (intent === "PARTIAL_CLOSE") return "trim";
  return "trade";
}
