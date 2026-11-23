/**
 * A sale trigger that fired always reaches the owner (2026-11-23).
 *
 * A "Sell if" set to Send to Agent starts a run, and the run may hold. Its
 * hold used to end there, with a note in Activity and nothing to answer: from
 * Nov 10 to Nov 23 CEG sat under its $280 line through ten looks, GEV under
 * its $987 line through seventeen, and neither ever put a sale in front of
 * the owner. The analyst keeps its say: the note it wrote is the card's
 * reason, "I'd hold" included. It no longer decides whether the owner sees it.
 *
 * With the approval switch off there is no card to open, so the run's decision
 * stands. Nothing here can sell: the order is always a proposal.
 */
import { prisma } from "@/lib/prisma";
import { approvalRequired } from "@/lib/proposals/maybe-await-approval";
import { saleUnderWay } from "@/lib/proposals/position-lock";

export async function cardForFiredSale(args: {
  positionId: string;
  thesisId: string;
  runId: string;
  /** The trigger's sentence, the card's reason when the run wrote no note. */
  sentence: string;
  reason: "STOP" | "TARGET";
  /** The triggers this sale answers: the card stays open while one holds. */
  triggerIds: string[];
  firedPrice: number | null;
}): Promise<string | null> {
  const position = await prisma.position.findUnique({
    where: { id: args.positionId },
    select: { status: true, accountId: true, environment: true },
  });
  if (position?.status !== "OPEN") return null;
  const environment = position.environment === "LIVE" ? "LIVE" : "PAPER";
  if (!(await approvalRequired({ accountId: position.accountId, intent: "CLOSE", environment }))) return null;

  // The run proposed a sale or a trim itself: that is the card.
  const underWay = await prisma.order.findFirst({
    where: { positionId: args.positionId, intent: { in: ["CLOSE", "PARTIAL_CLOSE"] }, OR: saleUnderWay(new Date()) },
    select: { id: true },
  });
  if (underWay) return null;

  const note = await prisma.thesisUpdate.findFirst({
    where: { runId: args.runId, thesisId: args.thesisId, type: { in: ["UPDATED", "REVIEWED"] }, rationale: { not: null } },
    orderBy: { timestamp: "desc" },
    select: { id: true, rationale: true, verdict: true },
  });
  const text = note?.rationale?.trim() || null;
  // A hold that didn't call the belief broken: if the owner sells, the stock goes back on watch.
  const beliefSurvived = note?.verdict ? note.verdict !== "BROKEN" : null;

  const { closeOpenPosition } = await import("@/lib/actions/closeTrade.actions");
  const outcome = await closeOpenPosition(
    args.positionId,
    args.reason,
    undefined,
    "price_monitor", // the stored name for a trigger's sale; approval-gated
    text ?? `Your "${args.sentence}" came true.`,
    args.runId,
    beliefSurvived,
    { propose: true, triggerIds: args.triggerIds, proposedPrice: args.firedPrice },
  );
  if (outcome.kind !== "proposed") return null;
  if (note && text) await prisma.thesisUpdate.update({ where: { id: note.id }, data: { tradeId: outcome.proposal.orderId } });
  return outcome.proposal.orderId;
}
