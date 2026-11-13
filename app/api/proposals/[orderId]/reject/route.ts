/**
 * POST /api/proposals/[orderId]/reject
 *
 * Reject an Order(AWAITING_APPROVAL) proposal. Body: { message?: string,
 * line?: condition }: an optional user-written reason, and on a sale a
 * trigger proposed, Hold with a new line. The decline holds the triggers
 * behind the sale (lib/proposals/sale-card.ts); then the stock's own sell
 * line becomes `line` through the trigger editor's own write, so the new line
 * is armed and the rest stay quiet. Flips Order to REJECTED; for OPEN
 * proposals also cancels the staged Position. Writes a
 * ThesisUpdate(type='PROPOSAL_REJECTED') with the user's message verbatim
 * so the agent reads it on its next run and adapts.
 *
 * See docs/plans/TRADE_AS_PROPOSAL.md.
 */

import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import { rejectProposal, ProposalExecutionError, findRelatedThesisId } from "@/lib/proposals/execute";
import { applyTriggerAdd, buildPrincipalTrigger } from "@/lib/actions/thesis-edit";
import { parseTriggersResilient } from "@/lib/agent/triggers/schema";
import { fireModeOf } from "@/lib/agent/triggers/fire-mode";
import { addedTriggerRationale } from "@/lib/agent/triggers/ops";
import { addProblem, triggerSlot, type When } from "@/lib/agent/triggers/condition";

interface RejectBody {
  message?: string;
  /** Hold with a new line: the condition the stock's own sale takes in place of the old one. */
  line?: When;
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
    include: { position: { select: { accountId: true, analystId: true } } },
  });
  if (!order) return new Response("Order not found", { status: 404 });
  if (order.position.accountId !== accountId) {
    return new Response("Forbidden", { status: 403 });
  }

  // A new line is checked before the decline lands, so a refused line never leaves a Hold without it.
  const line = body.line ?? null;
  if (line) {
    if (order.side !== "SELL" || order.triggerIds.length === 0) return Response.json({ error: "A new line goes with a sale a trigger proposed." }, { status: 400 });
    const problem = addProblem(line, "THESIS");
    if (problem) return Response.json({ error: problem, code: "INVALID" }, { status: 400 });
    try {
      buildPrincipalTrigger({ action: "EXIT", predicate: line, defaultRationale: addedTriggerRationale("EXIT", line) });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : String(err), code: "INVALID" }, { status: 400 });
    }
  }

  try {
    const result = await rejectProposal(orderId, message, user.id);
    if (!line) return Response.json(result);
    // The stock's own sell line: the one the new line replaces keeps its On fire (an Auto-sell stays one).
    try {
      const thesisId = order.thesisId ?? (await findRelatedThesisId(order.position.analystId!, order.symbol));
      const thesis = await prisma.thesis.findUnique({ where: { id: thesisId }, select: { triggers: true } });
      const slot = triggerSlot({ action: "EXIT", predicate: line });
      const same = parseTriggersResilient(thesis?.triggers ?? []).triggers.find((t) => triggerSlot(t) === slot);
      const added = await applyTriggerAdd(
        thesisId,
        { action: "EXIT", predicate: line, ...(same ? { fireMode: fireModeOf(same) } : {}) },
        { accountId, actorUserId: user.id },
      );
      return Response.json({ ...result, line: added.trigger });
    } catch (err) {
      // The Hold landed; the line didn't. Say so, and the owner sets it from the trigger list.
      return Response.json({ ...result, lineError: err instanceof Error ? err.message : String(err) });
    }
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
