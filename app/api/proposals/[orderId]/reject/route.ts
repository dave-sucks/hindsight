/**
 * POST /api/proposals/[orderId]/reject
 *
 * Reject an Order(AWAITING_APPROVAL) proposal. Body: { message?: string }
 * (optional user-written reason). Flips Order to REJECTED; for OPEN
 * proposals also cancels the staged Position. Writes a
 * ThesisUpdate(type='PROPOSAL_REJECTED') with the user's message verbatim
 * so the agent reads it on its next run and adapts.
 *
 * See docs/plans/TRADE_AS_PROPOSAL.md.
 */

import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import { rejectProposal, ProposalExecutionError } from "@/lib/proposals/execute";

interface RejectBody {
  message?: string;
}

export async function POST(
  req: Request,
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

  const role = await getUserRole(user.id, accountId);
  if (role === "VIEWER") return new Response("Forbidden", { status: 403 });

  // Tolerate empty body (the chat-inline reject button posts no body).
  let body: RejectBody = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text) as RejectBody;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  const message =
    typeof body.message === "string" && body.message.trim().length > 0
      ? body.message.slice(0, 2000)
      : null;

  // Account ownership check — same shape as the approve route.
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { position: { select: { accountId: true } } },
  });
  if (!order) return new Response("Order not found", { status: 404 });
  if (order.position.accountId !== accountId) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const result = await rejectProposal(orderId, message, user.id);
    return Response.json(result);
  } catch (err) {
    if (err instanceof ProposalExecutionError) {
      const statusCode =
        err.code === "NOT_FOUND" ? 404 :
        err.code === "NOT_AWAITING" ? 409 :
        500;
      return Response.json(
        { error: err.message, code: err.code },
        { status: statusCode },
      );
    }
    console.error(`[reject-proposal] unexpected error for ${orderId}:`, err);
    return new Response("Internal error", { status: 500 });
  }
}
