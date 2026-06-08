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
import { sendEmail, getUserEmail } from "@/lib/email";
import { getOwnerUserId } from "@/lib/auth/account";
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

  // For sells the proposal's "exit price" is the estimated fill; entry comes
  // from the existing position. For buys the estimated entry IS the price.
  const entryPrice = isClose ? d.entryPrice ?? d.estimatedPrice : d.estimatedPrice;
  const exitPrice = isClose ? d.estimatedPrice : undefined;

  const realizedPnl =
    isClose && d.entryPrice != null
      ? (d.estimatedPrice - d.entryPrice) * d.qty * (d.direction === "LONG" ? 1 : -1)
      : null;
  const realizedPnlPct =
    isClose && d.entryPrice != null && d.entryPrice > 0
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
 * Fire-and-forget — sends the proposal-pending email to the Account OWNER.
 * Resolves the Order + Position + analyst details, composes the subject and
 * HTML, calls sendEmail. Never throws — failures are logged.
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

    // OWNER is the canonical recipient. Solo OWNER = self; team workspaces
    // route to the OWNER regardless of which EDITOR's run produced the
    // proposal (Dave decides for the Account).
    const ownerUserId = await getOwnerUserId(order.position.accountId);
    const toEmail = await getUserEmail(ownerUserId ?? order.position.userId);
    if (!toEmail) return;

    const intent = (order.intent ?? "OPEN") as ProposalPendingData["intent"];
    const direction = order.position.direction as "LONG" | "SHORT";
    const environment = order.position.environment as "PAPER" | "LIVE";
    const livePrefix = environment === "LIVE" ? "[LIVE] " : "";
    const verbStr = subjectVerb(intent, direction);
    const subject = `${livePrefix}${analyst?.name ?? "Analyst"} wants to ${verbStr} ${order.quantity} ${order.symbol}`;

    const html = proposalPendingHtml({
      analystName: analyst?.name ?? "Analyst",
      ticker: order.symbol,
      direction,
      intent,
      qty: order.quantity,
      estimatedPrice: order.position.avgCost,
      estimatedCost: order.quantity * order.position.avgCost,
      entryPrice: order.position.avgCost,
      openedAt: order.position.openedAt ?? null,
      expiresAt: order.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
      rationale: order.rationale,
      environment,
      positionId: order.position.id,
    });

    await sendEmail({ to: toEmail, subject, html });
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
