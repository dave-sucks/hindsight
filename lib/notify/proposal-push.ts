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

/** Human verb for the subject line — mirrors the email's subjectVerb. */
function proposalVerb(
  intent: "OPEN" | "ADD" | "CLOSE" | "PARTIAL_CLOSE",
  direction: "LONG" | "SHORT",
): string {
  if (intent === "OPEN") return direction === "LONG" ? "buy" : "short";
  if (intent === "ADD") return direction === "LONG" ? "add to" : "add to short on";
  if (intent === "CLOSE") return "close";
  if (intent === "PARTIAL_CLOSE") return "trim";
  return "trade";
}

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
            analystId: true,
            environment: true,
            direction: true,
            symbol: true,
          },
        },
      },
    });
    if (!order || order.status !== "AWAITING_APPROVAL") return;

    const analyst = await prisma.agentConfig.findUnique({
      where: { id: order.position.analystId },
      select: { name: true },
    });

    const intent = (order.intent ?? "OPEN") as
      | "OPEN"
      | "ADD"
      | "CLOSE"
      | "PARTIAL_CLOSE";
    const direction = order.position.direction as "LONG" | "SHORT";
    const environment = order.position.environment as "PAPER" | "LIVE";
    const verb = proposalVerb(intent, direction);
    const livePrefix = environment === "LIVE" ? "[LIVE] " : "";

    // "PEAD wants to close 100 EWTX" — matches the email subject wording so the
    // two channels read identically.
    const title = `${livePrefix}Trade review needed`;
    const message = `${analyst?.name ?? "An analyst"} wants to ${verb} ${order.quantity} ${order.symbol} — approve or reject in the app.`;

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
