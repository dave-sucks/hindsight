/**
 * Trade-as-Proposal — approve/reject execution.
 *
 * The approve handler is intentionally minimal: it submits the proposed
 * Order's payload to Alpaca with the stored idempotencyKey, flips Order
 * AWAITING_APPROVAL → PENDING (and Position PENDING_APPROVAL → OPEN for
 * buy proposals), and returns. The existing `reconcile-orders` cron
 * (every 5 min Mon-Fri, 4 AM-8 PM ET) handles every post-fill case
 * (OPEN / ADD / CLOSE / PARTIAL_CLOSE) by dispatching on Order.intent
 * — so we don't duplicate that logic here.
 *
 * Why this is safe:
 *   - The same idempotencyKey was stored on the AWAITING_APPROVAL Order
 *     at proposal time. Reconcile recovers any in-flight submit via
 *     getOrderByClientOrderId — so a network hiccup on the approve path
 *     doesn't lose the fill.
 *   - PAPER fills are typically immediate; LIVE fills are typically
 *     within seconds. The 5-min cron cadence is the safety net, not the
 *     primary fill path.
 *
 * The reject handler is even simpler: flip Order to REJECTED, cancel the
 * staged Position if intent=OPEN, write a PROPOSAL_REJECTED ThesisUpdate
 * so the agent reads it on its next run.
 *
 * See docs/plans/TRADE_AS_PROPOSAL.md.
 */

import { prisma } from "@/lib/prisma";
import {
  placeMarketOrder,
  closePositionPartial,
  type AlpacaCredentials,
} from "@/lib/alpaca";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";
import {
  promoteThesisOnApproval,
  closeThesisOnApproval,
} from "@/lib/proposals/thesis-flips";

export interface ProposalApprovalResult {
  ok: true;
  orderId: string;
  positionId: string;
  alpacaOrderId: string;
  intent: string;
}

export interface ProposalRejectionResult {
  ok: true;
  orderId: string;
  positionId: string;
  rejectionMessage: string | null;
}

/**
 * Principal edits applied at approve time — "Edit & Approve" (the DELL case:
 * the agent proposed 6 shares, the principal wants 12). Only OPEN/ADD honor a
 * quantity change; only OPEN honors target/stop (the staged position's exits,
 * which flow into the held-side trigger regen). All optional; omitted fields
 * keep the proposed values. CLOSE/PARTIAL_CLOSE ignore edits — a "don't close,
 * adjust instead" intent is a reject + a thesis-sheet level edit, not this path.
 */
export interface ProposalApprovalEdits {
  quantity?: number;
  targetPrice?: number;
  stopLoss?: number;
}

export class ProposalExecutionError extends Error {
  code:
    | "NOT_FOUND"
    | "NOT_AWAITING"
    | "EXPIRED"
    | "ALPACA_REJECTED"
    | "ALPACA_UNCERTAIN"
    | "UNKNOWN_INTENT";
  retryable: boolean;
  constructor(code: ProposalExecutionError["code"], message: string, retryable = false) {
    super(message);
    this.name = "ProposalExecutionError";
    this.code = code;
    this.retryable = retryable;
  }
}

function classifyAlpacaError(err: unknown): "rejected" | "uncertain" {
  const e = err as { statusCode?: number; status?: number; message?: string };
  const code = e?.statusCode ?? e?.status;
  if (typeof code === "number" && code >= 400 && code < 500) return "rejected";
  return "uncertain";
}

/**
 * Approve a proposal — submit it to Alpaca and flip the staged rows live.
 *
 * Throws ProposalExecutionError on validation failure or Alpaca rejection.
 * On success: Order is PENDING (with alpacaOrderId); for buy proposals,
 * Position is OPEN. The reconcile-orders cron will pick up the fill.
 */
export async function approveProposal(
  orderId: string,
  actorUserId: string,
  edits?: ProposalApprovalEdits,
): Promise<ProposalApprovalResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      position: {
        select: {
          id: true,
          accountId: true,
          userId: true,
          analystId: true,
          symbol: true,
          direction: true,
          status: true,
          environment: true,
          avgCost: true,
          targetPrice: true,
          stopLoss: true,
        },
      },
    },
  });
  if (!order) {
    throw new ProposalExecutionError("NOT_FOUND", `Order ${orderId} not found`);
  }
  if (order.status !== "AWAITING_APPROVAL") {
    throw new ProposalExecutionError(
      "NOT_AWAITING",
      `Order ${orderId} is ${order.status}, not AWAITING_APPROVAL`,
    );
  }
  if (order.expiresAt && order.expiresAt < new Date()) {
    throw new ProposalExecutionError(
      "EXPIRED",
      `Proposal ${orderId} expired at ${order.expiresAt.toISOString()}`,
    );
  }
  if (!order.idempotencyKey) {
    throw new ProposalExecutionError(
      "NOT_FOUND",
      `Order ${orderId} missing idempotencyKey — cannot resubmit safely`,
    );
  }

  const intent = order.intent ?? "OPEN";

  // ── "Edit & Approve" — apply principal edits to the staged rows BEFORE the
  //    Alpaca submit. Quantity edits honored for OPEN/ADD; target/stop only
  //    for OPEN (they become the held position's exits + drive trigger regen).
  const canEditQty = intent === "OPEN" || intent === "ADD";
  const effectiveQty =
    edits?.quantity != null && edits.quantity > 0 && canEditQty
      ? edits.quantity
      : order.quantity;
  const effectiveTarget =
    edits?.targetPrice != null && edits.targetPrice > 0 && intent === "OPEN"
      ? edits.targetPrice
      : order.position.targetPrice;
  const effectiveStop =
    edits?.stopLoss != null && edits.stopLoss > 0 && intent === "OPEN"
      ? edits.stopLoss
      : order.position.stopLoss;
  const qtyEdited = effectiveQty !== order.quantity;

  const positionEnvironment = order.position.environment as "PAPER" | "LIVE";
  const creds: AlpacaCredentials | undefined =
    (await resolveAlpacaCredentials(order.position.userId, positionEnvironment)) ??
    undefined;

  // 1. Flip the staged rows from "awaiting approval" to "pending fill" in a
  //    single transaction. For OPEN proposals the Position also goes
  //    PENDING_APPROVAL → OPEN here so the duplicate-position check, the
  //    portfolio queries, and the heartbeat all see a real holding from this
  //    moment on. For closes/adds/partial-closes the Position stays OPEN
  //    and only the Order flips.
  const promotedAt = new Date();
  await prisma.$transaction(async (tx) => {
    if (intent === "OPEN" && order.position.status === "PENDING_APPROVAL") {
      await tx.position.update({
        where: { id: order.position.id },
        data: {
          status: "OPEN",
          openedAt: promotedAt,
          // Apply principal edits to the staged position. avgCost stays the
          // proposal estimate; reconcile-orders corrects it to the real fill.
          ...(qtyEdited ? { quantity: effectiveQty, initialQty: effectiveQty } : {}),
          ...(effectiveTarget !== order.position.targetPrice ? { targetPrice: effectiveTarget } : {}),
          ...(effectiveStop !== order.position.stopLoss ? { stopLoss: effectiveStop } : {}),
        },
      });
    }
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: "PENDING",
        alpacaSubmittedAt: promotedAt,
        ...(qtyEdited ? { quantity: effectiveQty } : {}),
      },
    });
    await tx.positionEvent.create({
      data: {
        positionId: order.position.id,
        eventType: intent === "OPEN" ? "OPENED" : "PRICE_CHECK",
        description: `Proposal approved by user ${actorUserId}; submitting ${intent} to Alpaca (idem=${order.idempotencyKey!.slice(0, 8)}).`,
        priceAt: order.position.avgCost,
      },
    });
  });

  // 2. Submit to Alpaca using the SAME idempotencyKey stored at proposal
  //    time. If this call fails uncertainly (network/5xx), the Order stays
  //    PENDING and reconcile-orders recovers by client_order_id on the
  //    next pass — same recovery guarantee place_trade / closeOpenPosition
  //    rely on today.
  const side = order.side.toLowerCase() as "buy" | "sell";
  let alpacaOrderId: string;
  try {
    if (intent === "PARTIAL_CLOSE") {
      const ap = await closePositionPartial(
        order.symbol,
        effectiveQty,
        side,
        creds,
        order.idempotencyKey,
      );
      alpacaOrderId = ap.id;
    } else {
      // OPEN / ADD / CLOSE all submit a market order with the (possibly edited) qty.
      const ap = await placeMarketOrder(
        {
          symbol: order.symbol,
          qty: effectiveQty,
          side,
          clientOrderId: order.idempotencyKey,
        },
        creds,
      );
      alpacaOrderId = ap.id;
    }
  } catch (submitErr) {
    const outcome = classifyAlpacaError(submitErr);
    const msg = submitErr instanceof Error ? submitErr.message : String(submitErr);
    if (outcome === "rejected") {
      // Definitive 4xx — Alpaca says no. Mark Order REJECTED. For OPEN, also
      // roll the Position back from OPEN to CANCELLED so the portfolio
      // doesn't carry a phantom holding.
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: orderId },
          data: { status: "REJECTED", alpacaConfirmedAt: new Date() },
        });
        if (intent === "OPEN") {
          await tx.position.update({
            where: { id: order.position.id },
            data: { status: "CANCELLED", closedAt: new Date(), closeReason: "MANUAL" },
          });
        }
      });
      throw new ProposalExecutionError(
        "ALPACA_REJECTED",
        `Alpaca rejected the approved trade: ${msg}`,
      );
    }
    // Uncertain — leave PENDING; reconcile will recover.
    console.error(
      `CRITICAL-SYNC-UNCERTAIN [approveProposal] Alpaca submit uncertain for order ${orderId} idem=${order.idempotencyKey.slice(0, 8)}: ${msg}. Reconcile will recover by client_order_id.`,
    );
    throw new ProposalExecutionError(
      "ALPACA_UNCERTAIN",
      `Alpaca submit uncertain (${msg}). Reconcile will recover within ~5 min.`,
      true,
    );
  }

  // 3. Stamp the Alpaca order id on the Order so reconcile-orders can pick
  //    it up directly (skipping the client_order_id lookup path).
  await prisma.order.update({
    where: { id: orderId },
    data: { alpacaOrderId, alpacaConfirmedAt: new Date() },
  });

  // 3.5. Flip the thesis lifecycle right here at approve-time so the agent's
  //      next run sees a consistent view. The non-proposal path (inline
  //      place_trade / closeOpenPosition) does this AFTER the Alpaca submit
  //      succeeds — we mirror that timing exactly. ADD and PARTIAL_CLOSE
  //      don't change thesis status. See lib/proposals/thesis-flips.ts.
  if (intent === "OPEN") {
    await promoteThesisOnApproval({
      analystId: order.position.analystId,
      ticker: order.position.symbol,
      positionId: order.position.id,
      // Position carries the proposed levels (set in the tool's DB tx
      // before the seam) — use them as the "executed" levels for trigger
      // regeneration. The real Alpaca fill price corrects avgCost via
      // reconcile-orders; targets/stops were already set from the
      // proposal args.
      entryPrice: order.position.avgCost,
      targetPrice: effectiveTarget ?? order.position.avgCost,
      stopLoss: effectiveStop ?? order.position.avgCost,
    });
  } else if (intent === "CLOSE") {
    await closeThesisOnApproval({
      analystId: order.position.analystId,
      ticker: order.position.symbol,
      positionId: order.position.id,
      // Use the originating decision's reason (STOP/TARGET/etc.) carried on the
      // Order, not a blanket MANUAL — keeps the thesis CLOSED audit row aligned
      // with the Position.closeReason that reconcile-orders stamps on fill.
      closeReason: order.closeReason ?? "MANUAL",
      rationale: order.rationale,
      // P1-35: the belief attestation the agent made when it PROPOSED this
      // close. Approval can land days later, so the Order is what carries the
      // agent's judgment across the gap — true recycles the thesis to WATCHING
      // for a reclaim instead of retiring it dead.
      beliefSurvived: order.closeBeliefSurvived,
    });
  }

  // 4. Audit row + RunEvent for the approval event. The Position lifecycle
  //    events (OPENED/CLOSED with PnL/etc.) get written by reconcile-orders
  //    when the fill lands — we don't pre-empt them here.
  void (async () => {
    try {
      await writeThesisUpdate({
        thesisId: await findRelatedThesisId(order.position.analystId, order.position.symbol),
        type: "PROPOSAL_APPROVED",
        summary: `Approved ${intent} on ${order.symbol}${qtyEdited ? ` (edited ${order.quantity}→${effectiveQty} sh)` : ""} — submitted to Alpaca (idem=${order.idempotencyKey!.slice(0, 8)})`,
        rationale: `User approved the ${intent} proposal${qtyEdited ? `, resizing ${order.quantity}→${effectiveQty} shares` : ""}. Alpaca order id ${alpacaOrderId}.`,
        fieldChanges: {
          proposal: {
            from: { orderId, status: "AWAITING_APPROVAL", quantity: order.quantity },
            to: {
              orderId,
              status: "APPROVED",
              intent,
              quantity: effectiveQty,
              ...(qtyEdited ? { proposedQuantity: order.quantity, edited: true } : {}),
              approvedAt: promotedAt.toISOString(),
              approvedBy: actorUserId,
              alpacaOrderId,
            },
          },
        },
      });
    } catch (err) {
      console.warn(
        `[approveProposal] ThesisUpdate(PROPOSAL_APPROVED) write failed for order ${orderId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  })();

  return {
    ok: true,
    orderId,
    positionId: order.position.id,
    alpacaOrderId,
    intent,
  };
}

/**
 * Reject a proposal — flip the staged rows to terminal state and persist
 * the user's optional rejection message as a ThesisUpdate so the agent
 * reads it on its next run.
 */
export async function rejectProposal(
  orderId: string,
  rejectionMessage: string | null,
  actorUserId: string,
): Promise<ProposalRejectionResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      position: {
        select: {
          id: true,
          accountId: true,
          analystId: true,
          symbol: true,
          status: true,
        },
      },
    },
  });
  if (!order) {
    throw new ProposalExecutionError("NOT_FOUND", `Order ${orderId} not found`);
  }
  if (order.status !== "AWAITING_APPROVAL") {
    throw new ProposalExecutionError(
      "NOT_AWAITING",
      `Order ${orderId} is ${order.status}, not AWAITING_APPROVAL`,
    );
  }

  const intent = order.intent ?? "OPEN";
  const rejectedAt = new Date();
  const trimmedMessage = rejectionMessage?.trim() || null;

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: "REJECTED",
        rejectionMessage: trimmedMessage,
        alpacaConfirmedAt: rejectedAt,
      },
    });
    // For OPEN: the Position was staged as PENDING_APPROVAL. Cancel it so
    // the portfolio view doesn't show a phantom. For CLOSE/ADD/PARTIAL_CLOSE:
    // the Position stays OPEN — only the proposed order is rejected.
    if (intent === "OPEN" && order.position.status === "PENDING_APPROVAL") {
      await tx.position.update({
        where: { id: order.position.id },
        data: { status: "CANCELLED", closedAt: rejectedAt, closeReason: "MANUAL" },
      });
    }
    await tx.positionEvent.create({
      data: {
        positionId: order.position.id,
        eventType: intent === "OPEN" ? "CLOSED" : "PRICE_CHECK",
        description: `Proposal rejected by user ${actorUserId}${trimmedMessage ? `: ${trimmedMessage.slice(0, 200)}` : " (no message)"}.`,
        priceAt: null,
      },
    });
  });

  // The agent reads thesis history via get_theses(include_history: true)
  // — the rationale text below is the durable signal it sees on its next
  // run. Verbatim user wording is preserved; structural metadata lives in
  // fieldChanges.
  void (async () => {
    try {
      const thesisId = await findRelatedThesisId(
        order.position.analystId,
        order.position.symbol,
      );
      // P1-29: a reject WITH a written comment flags the thesis for review via
      // the existing nextReviewAt mechanism, so the next daily run surfaces it
      // as needsAction=REVIEW_DUE and reads the note through
      // get_theses.principalDirective. The agent responds with judgment — no
      // forcing needsAction kind. A no-comment reject doesn't flag a review;
      // the cross-day cooldown already suppresses re-proposal.
      if (trimmedMessage) {
        await prisma.thesis.update({
          where: { id: thesisId },
          data: { nextReviewAt: rejectedAt },
        });
      }
      await writeThesisUpdate({
        thesisId,
        type: "PROPOSAL_REJECTED",
        summary: `Rejected ${intent} proposal on ${order.symbol}${trimmedMessage ? ` — "${trimmedMessage.slice(0, 80)}"` : ""}`,
        rationale:
          trimmedMessage ??
          `[REJECTED:USER] User rejected the ${intent} proposal without a written reason. Treat this as a soft no; re-proposal is allowed if the setup materially changes.`,
        fieldChanges: {
          proposal: {
            from: { orderId, status: "AWAITING_APPROVAL" },
            to: {
              orderId,
              status: "REJECTED",
              intent,
              quantity: order.quantity,
              rejectedAt: rejectedAt.toISOString(),
              rejectedBy: actorUserId,
              userMessage: trimmedMessage,
            },
          },
        },
      });
    } catch (err) {
      console.warn(
        `[rejectProposal] ThesisUpdate(PROPOSAL_REJECTED) write failed for order ${orderId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  })();

  return {
    ok: true,
    orderId,
    positionId: order.position.id,
    rejectionMessage: trimmedMessage,
  };
}

/**
 * Resolve the most recent thesis row associated with this (analyst, ticker)
 * pair. Used to attach PROPOSAL_APPROVED / PROPOSAL_REJECTED audit rows
 * to the right thesis so the agent's get_theses(include_history) sees them.
 *
 * Falls back to throwing if no thesis exists — the proposal could not
 * have been created without one (place_trade requires thesis_id; the
 * other proposal paths come from manage_position on an existing position
 * whose Position.analystId we trust).
 */
async function findRelatedThesisId(
  analystId: string,
  ticker: string,
): Promise<string> {
  const thesis = await prisma.thesis.findFirst({
    where: {
      ticker,
      researchRun: { agentConfigId: analystId },
      status: { in: ["HOLDING", "WATCHING", "PROMOTED"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!thesis) {
    throw new Error(
      `No live thesis found for analyst=${analystId} ticker=${ticker} — cannot attach proposal audit row`,
    );
  }
  return thesis.id;
}
