/**
 * POST /api/proposals/[orderId]/approve
 *
 * Approve an Order(AWAITING_APPROVAL) proposal. Submits the trade to
 * Alpaca with the stored idempotencyKey and flips the Order to PENDING.
 * The reconcile-orders cron picks up the fill within ~5 min. For OPEN
 * proposals the Position also goes PENDING_APPROVAL → OPEN in the same
 * transaction so the portfolio view reflects the holding from this moment.
 *
 * See docs/plans/TRADE_AS_PROPOSAL.md.
 */

import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import {
  approveProposal,
  ProposalExecutionError,
  type ProposalApprovalEdits,
} from "@/lib/proposals/execute";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;

  // Optional "Edit & Approve" body — { quantity?, targetPrice?, stopLoss? }.
  // Absent / non-JSON body = plain approve at the proposed values.
  let edits: ProposalApprovalEdits | undefined;
  try {
    const body = (await req.json()) as Record<string, unknown> | null;
    if (body) {
      // Number.isFinite rejects NaN / Infinity; approveProposal additionally
      // requires > 0. (JSON can't carry Infinity, but a huge finite value could
      // — keep this guard in lockstep with thesis-edit's validation.)
      const num = (v: unknown): number | undefined =>
        typeof v === "number" && Number.isFinite(v) ? v : undefined;
      const e: ProposalApprovalEdits = {};
      if (num(body.quantity) !== undefined) e.quantity = body.quantity as number;
      if (num(body.targetPrice) !== undefined) e.targetPrice = body.targetPrice as number;
      if (num(body.stopLoss) !== undefined) e.stopLoss = body.stopLoss as number;
      if (Object.keys(e).length > 0) edits = e;
    }
  } catch {
    /* no body — plain approve */
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const accountId = await getAccountId(user.id);
  if (!accountId) return new Response("No account", { status: 403 });

  const role = await getUserRole(user.id, accountId);
  if (role === "VIEWER") return new Response("Forbidden", { status: 403 });

  // Verify the order belongs to the caller's account — defense in depth
  // against orderId guessing. The Position carries accountId; we don't
  // trust Order.userId alone (an EDITOR approving a proposal still must
  // belong to the same Account).
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { position: { select: { accountId: true } } },
  });
  if (!order) return new Response("Order not found", { status: 404 });
  if (order.position.accountId !== accountId) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const result = await approveProposal(orderId, user.id, edits);
    return Response.json(result);
  } catch (err) {
    if (err instanceof ProposalExecutionError) {
      const statusCode =
        err.code === "NOT_FOUND" ? 404 :
        err.code === "NOT_AWAITING" ? 409 :
        err.code === "EXPIRED" ? 410 :
        err.code === "ALPACA_REJECTED" ? 422 :
        // 202 Accepted — submit was uncertain; reconcile will resolve.
        err.code === "ALPACA_UNCERTAIN" ? 202 :
        500;
      return Response.json(
        { error: err.message, code: err.code, retryable: err.retryable },
        { status: statusCode },
      );
    }
    console.error(`[approve-proposal] unexpected error for ${orderId}:`, err);
    return new Response("Internal error", { status: 500 });
  }
}
