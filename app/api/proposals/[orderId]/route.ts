/**
 * GET /api/proposals/[orderId]
 *
 * Lightweight read of a pending proposal's current values — used by the
 * "Edit & Approve" dialog to seed its inputs (proposed shares, target, stop)
 * regardless of which surface opened it, so we don't thread that data through
 * every ProposalActions call site.
 */

import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getAccountId } from "@/lib/auth/account";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const accountId = await getAccountId(user.id);
  if (!accountId) return new Response("No account", { status: 403 });

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      intent: true,
      side: true,
      symbol: true,
      quantity: true,
      status: true,
      position: {
        select: {
          accountId: true,
          analystId: true,
          direction: true,
          targetPrice: true,
          stopLoss: true,
          avgCost: true,
        },
      },
    },
  });
  if (!order) return new Response("Order not found", { status: 404 });
  if (order.position.accountId !== accountId) {
    return new Response("Forbidden", { status: 403 });
  }

  // Resolve the paired thesis so the reject dialog can render its trigger
  // editor inline (raise the stop, add a "down X%" alert, etc.). Same
  // (account, analyst, ticker, HOLDING) linkage every close path uses — there's
  // no direct Order→Thesis FK. Best-effort: null when it can't be resolved.
  // HOLDING covers CLOSE/TRIM proposals (held name); WATCHING covers OPEN/ADD
  // entry proposals (position still PENDING_APPROVAL, thesis not yet flipped) —
  // so rejecting a proposed BUY can still retune its ENTER triggers. Newest of
  // the two wins; normally there's only one active thesis per (analyst, ticker).
  const thesis = await prisma.thesis.findFirst({
    where: {
      accountId,
      ticker: order.symbol,
      status: { in: ["HOLDING", "WATCHING"] },
      ...(order.position.analystId
        ? { researchRun: { agentConfigId: order.position.analystId } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, direction: true },
  });

  return Response.json({
    orderId: order.id,
    intent: order.intent ?? "OPEN",
    side: order.side,
    symbol: order.symbol,
    quantity: order.quantity,
    status: order.status,
    direction: order.position.direction,
    targetPrice: order.position.targetPrice,
    stopLoss: order.position.stopLoss,
    estimatedPrice: order.position.avgCost,
    // For the reject dialog's inline trigger editor.
    thesisId: thesis?.id ?? null,
    thesisDirection: thesis?.direction ?? order.position.direction ?? null,
  });
}
