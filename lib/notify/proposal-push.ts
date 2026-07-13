/**
 * proposal-pending push — the phone/desktop counterpart to
 * `sendProposalPendingEmail`. Fires the instant an agent stages an
 * Order(AWAITING_APPROVAL) so a review can't be missed in a crowded inbox.
 *
 * Delivered via ntfy (see lib/notify/ntfy.ts). Master switch is the NTFY_TOPIC
 * env var — with it unset this whole path is a silent no-op. It is intentionally
 * INDEPENDENT of the per-analyst `emailAlerts` toggle: the env var is the opt-in
 * for push, so you get a push even if you muted proposal emails. (If per-analyst
 * push muting is ever wanted, add a `pushAlerts` flag mirroring `emailAlerts`.)
 *
 * Never throws — best-effort, exactly like the email path.
 */

import { prisma } from "@/lib/prisma";
import { sendNtfy } from "@/lib/notify/ntfy";
import { tradeDetailUrl } from "@/lib/emails/trade-card";
import {
  proposalHeadline,
  type ProposalIntent,
} from "@/lib/emails/proposal-headline";
import { getLiveExitPrice } from "@/lib/proposals/exit-quote";

export async function sendProposalPendingPush(orderId: string): Promise<void> {
  // Cheap early exit when push is disabled — skips the DB round trip entirely.
  if (!process.env.NTFY_TOPIC) return;

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        position: {
          select: {
            id: true,
            environment: true,
            direction: true,
            symbol: true,
            avgCost: true,
          },
        },
      },
    });
    if (!order || order.status !== "AWAITING_APPROVAL") return;

    const intent = (order.intent ?? "OPEN") as ProposalIntent;
    const direction = order.position.direction as "LONG" | "SHORT";
    const environment = order.position.environment as "PAPER" | "LIVE";
    const livePrefix = environment === "LIVE" ? "[LIVE] " : "";
    const isClose = intent === "CLOSE" || intent === "PARTIAL_CLOSE";

    // Same canonical sentence as the email subject (proposalHeadline) —
    // closes carry signed P&L off the live exit price, opens carry est. cost.
    // Alpaca real-time last trade (getLiveExitPrice), NOT Finnhub /quote.c
    // which returns a stale prior close near open — see exit-quote.ts. On
    // null the P&L clause is simply dropped; the push never blocks or lies.
    const liveExit = isClose ? await getLiveExitPrice(order.symbol) : null;
    const pnlKnown = isClose && liveExit != null && order.position.avgCost > 0;
    const dirSign = direction === "LONG" ? 1 : -1;

    const headline = proposalHeadline({
      intent,
      direction,
      environment,
      ticker: order.symbol,
      qty: order.quantity,
      pnlPct: pnlKnown
        ? ((liveExit - order.position.avgCost) / order.position.avgCost) * 100 * dirSign
        : null,
      pnlUsd: pnlKnown
        ? (liveExit - order.position.avgCost) * order.quantity * dirSign
        : null,
      estimatedCost: isClose ? null : order.quantity * order.position.avgCost,
      includeLivePrefix: false, // LIVE is carried by the title
    });

    const title = `${livePrefix}Trade review needed`;
    const message = `${headline} — approve or reject in the app.`;

    await sendNtfy(message, {
      title,
      // High priority for LIVE money; default-loud for paper.
      priority: environment === "LIVE" ? 5 : 4,
      tags: intent === "CLOSE" || intent === "PARTIAL_CLOSE" ? ["arrow_down"] : ["arrow_up"],
      clickUrl: tradeDetailUrl(order.position.id),
    });
  } catch (err) {
    console.warn(
      "[proposal-pending-push] send failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
