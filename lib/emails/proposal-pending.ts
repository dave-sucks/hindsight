/**
 * proposal-pending email — sent when an agent stages an Order(AWAITING_
 * APPROVAL) and the Account has the matching `requireApprovalFor{Buys,
 * Sells}` toggle on. V1 is informational only ("PEAD wants to buy 100
 * SMTC; review in app"); a future iteration can add one-click magic-link
 * approve/reject from the email itself, but that needs signed tokens we
 * don't have yet.
 *
 * See docs/plans/TRADE_AS_PROPOSAL.md §6.5.
 */

import { prisma } from "@/lib/prisma";
import { sendEmail, getUserEmail } from "@/lib/email";
import { getOwnerUserId } from "@/lib/auth/account";

const COLORS = {
  cardBorder: "#e5e7eb",
  textPrimary: "#0f172a",
  textMuted: "#64748b",
  textFaint: "#94a3b8",
  chipBg: "#f1f5f9",
  chipText: "#334155",
  amberBg: "#fffbeb",
  amberBorder: "#fbbf24",
  amberText: "#92400e",
};

export interface ProposalPendingData {
  analystName: string;
  ticker: string;
  direction: "LONG" | "SHORT";
  intent: "OPEN" | "ADD" | "CLOSE" | "PARTIAL_CLOSE";
  qty: number;
  estimatedPrice: number;
  estimatedCost: number;
  expiresAt: Date;
  rationale: string | null;
  environment: "PAPER" | "LIVE";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function verb(intent: ProposalPendingData["intent"], direction: "LONG" | "SHORT"): string {
  if (intent === "OPEN") return direction === "LONG" ? "buy" : "short";
  if (intent === "ADD") return direction === "LONG" ? "add to" : "add to short on";
  if (intent === "CLOSE") return "close";
  if (intent === "PARTIAL_CLOSE") return "trim";
  return "trade";
}

export function proposalPendingHtml(d: ProposalPendingData): string {
  const fmtPrice = (n: number) => `$${n.toFixed(2)}`;
  const fmtNotional = (n: number) =>
    `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const hoursUntil = Math.max(
    1,
    Math.round((d.expiresAt.getTime() - Date.now()) / (60 * 60 * 1000)),
  );

  const rationaleBlock = d.rationale
    ? `<div style="margin-top:14px;padding:14px 16px;background:${COLORS.chipBg};border-radius:8px;">
        <p style="margin:0 0 4px;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${COLORS.textFaint};">Rationale</p>
        <p style="margin:0;font-size:13px;line-height:1.5;color:${COLORS.textMuted};">${escapeHtml(truncate(d.rationale, 400))}</p>
      </div>`
    : "";

  const livePrefix = d.environment === "LIVE" ? "[LIVE] " : "";
  const verbStr = verb(d.intent, d.direction);

  return `
<!doctype html>
<html>
<body style="margin:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:32px auto;padding:0 16px;">
    <div style="padding:12px 16px;background:${COLORS.amberBg};border:1px solid ${COLORS.amberBorder};border-radius:8px;margin-bottom:16px;">
      <p style="margin:0;font-size:13px;font-weight:600;color:${COLORS.amberText};">⏳ Awaiting your approval — expires in ${hoursUntil}h</p>
    </div>
    <div style="border:1px solid ${COLORS.cardBorder};border-radius:12px;padding:20px;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${COLORS.textFaint};">${escapeHtml(d.analystName)} wants to</p>
      <p style="margin:0 0 16px;font-size:18px;font-weight:600;color:${COLORS.textPrimary};">${livePrefix}${escapeHtml(verbStr)} ${d.qty} ${escapeHtml(d.ticker)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr>
          <td style="padding:6px 0;color:${COLORS.textMuted};">Direction</td>
          <td style="padding:6px 0;text-align:right;color:${COLORS.textPrimary};font-variant-numeric:tabular-nums;">${d.direction}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:${COLORS.textMuted};">Est. price</td>
          <td style="padding:6px 0;text-align:right;color:${COLORS.textPrimary};font-variant-numeric:tabular-nums;">${fmtPrice(d.estimatedPrice)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:${COLORS.textMuted};">Est. cost</td>
          <td style="padding:6px 0;text-align:right;color:${COLORS.textPrimary};font-variant-numeric:tabular-nums;">${fmtNotional(d.estimatedCost)}</td>
        </tr>
      </table>
      ${rationaleBlock}
      <p style="margin:18px 0 0;font-size:12px;color:${COLORS.textMuted};">Open Hindsight to approve or reject this proposal. If no decision is made by ${escapeHtml(d.expiresAt.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" }))} the proposal expires and the agent reads the expiry on its next run.</p>
    </div>
  </div>
</body>
</html>`;
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
            accountId: true,
            userId: true,
            analystId: true,
            environment: true,
            direction: true,
            symbol: true,
            avgCost: true,
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
    const verbStr = verb(intent, direction);
    const livePrefix = environment === "LIVE" ? "[LIVE] " : "";
    const subject = `${livePrefix}${analyst?.name ?? "Analyst"} wants to ${verbStr} ${order.quantity} ${order.symbol}`;

    const html = proposalPendingHtml({
      analystName: analyst?.name ?? "Analyst",
      ticker: order.symbol,
      direction,
      intent,
      qty: order.quantity,
      estimatedPrice: order.position.avgCost,
      estimatedCost: order.quantity * order.position.avgCost,
      expiresAt: order.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
      rationale: order.rationale,
      environment,
    });

    await sendEmail({ to: toEmail, subject, html });
  } catch (err) {
    console.warn(
      "[proposal-pending-email] send failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
