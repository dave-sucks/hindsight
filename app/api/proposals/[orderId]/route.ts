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
        select: { accountId: true, direction: true, targetPrice: true, stopLoss: true, avgCost: true },
      },
    },
  });
  if (!order) return new Response("Order not found", { status: 404 });
  if (order.position.accountId !== accountId) {
    return new Response("Forbidden", { status: 403 });
  }

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
  });
}
