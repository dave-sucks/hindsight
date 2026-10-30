/**
 * The analyst's write-up of an Auto trade (tactical-run.ts).
 *
 * A trigger set to Auto makes its trade with no analyst deciding. The same
 * trigger run then reads the stock and writes the note; that note becomes the
 * trade's reason, so the card, the approval email and the trade page show the
 * analyst's words, never a line the app put together. While it is being
 * written the order carries one plain line naming the trigger (`autoTradeLine`,
 * lib/agent/triggers/do-it.ts).
 */

import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";

/** Sent when the write-up of an Auto trade is on its order (or its run ended without one). */
export const NOTE_WRITTEN = "app/proposal.note.written";

/** How long after the order a write-up still counts as coming. */
const WRITEUP_WINDOW_MS = 15 * 60 * 1000;

/**
 * Puts the run's note on the order in place of the line it was made with. The
 * note is the analyst's update_thesis row written since the write-up began
 * (`since`), never a line the trade or the fill wrote for this run. False when
 * there is none.
 */
export async function putNoteOnOrder(args: { runId: string; thesisId: string; orderId: string; since: Date }): Promise<boolean> {
  const saved = await prisma.thesisUpdate.findFirst({
    where: { runId: args.runId, thesisId: args.thesisId, type: { in: ["UPDATED", "REVIEWED"] }, timestamp: { gte: args.since }, rationale: { not: null } },
    orderBy: { timestamp: "desc" },
    select: { rationale: true },
  });
  const note = saved?.rationale?.trim();
  if (!note) return false;
  const order = await prisma.order.findUnique({ where: { id: args.orderId }, select: { id: true } });
  if (!order) return false;
  await prisma.order.update({ where: { id: args.orderId }, data: { rationale: note } });
  return true;
}

/** Tells the approval email the write-up is done. Never throws. */
export async function sendNoteWritten(orderId: string): Promise<void> {
  try {
    await inngest.send({ name: NOTE_WRITTEN, data: { orderId } });
  } catch (err) {
    console.warn(`[auto-writeup] could not send ${NOTE_WRITTEN} for ${orderId}:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Whether the analyst is still writing up this order: an Auto trigger run on
 * its stock is running, started at most 15 minutes before the order. The card
 * shows that it is being written; the approval email waits for it.
 */
export async function writeupComing(orderId: string, now: Date = new Date()): Promise<boolean> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { createdAt: true, position: { select: { analystId: true, symbol: true } } },
  });
  if (!order || now.getTime() - order.createdAt.getTime() > WRITEUP_WINDOW_MS) return false;
  const run = await prisma.researchRun.findFirst({
    where: {
      agentConfigId: order.position.analystId,
      mode: "INTRADAY_TACTICAL",
      status: "RUNNING",
      createdAt: { gte: new Date(order.createdAt.getTime() - WRITEUP_WINDOW_MS), lte: order.createdAt },
      AND: [{ parameters: { path: ["autoTrade"], equals: true } }, { parameters: { path: ["ticker"], equals: order.position.symbol } }],
    },
    select: { id: true },
  });
  return run != null;
}
