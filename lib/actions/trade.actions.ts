"use server";

// The Close and Cancel buttons: the only way a browser sells or cancels a position.
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth/editor";
import { cancelPosition, closeOpenPosition, type CloseOpenPositionOutcome } from "@/lib/actions/closeTrade.actions";

const REASONS = ["TARGET", "STOP", "TIME", "MANUAL"] as const;

/** Signed in, allowed to trade, and the position is on the caller's own account. */
async function ownPosition(positionId: string): Promise<void> {
  const { accountId } = await requireEditor();
  const position = await prisma.position.findUnique({ where: { id: String(positionId) }, select: { accountId: true } });
  if (!position || position.accountId !== accountId) throw new Error("Position not found");
}

/** Your own click sells it now; the approval switch is for trades an agent or a trigger starts. */
export async function closeTrade(tradeId: string, reason: (typeof REASONS)[number]): Promise<CloseOpenPositionOutcome> {
  if (!REASONS.includes(reason)) throw new Error("Unknown close reason");
  await ownPosition(tradeId);
  return closeOpenPosition(tradeId, reason, undefined, "user");
}

export async function cancelTrade(tradeId: string): Promise<void> {
  await ownPosition(tradeId);
  return cancelPosition(tradeId);
}
