/**
 * The analyst's note is the proposal's reason (one paragraph per trade,
 * 2026-10-30). A run that proposes a trade, or makes an Auto trade, writes
 * one note on the stock with update_thesis; at the end of the run that note
 * goes on the order, so the card, the approval email and the trade page show
 * the analyst's words and nothing else. Until it lands the card says the
 * analyst is writing it up and the email waits.
 *
 * The note row is stamped with the order it wrote up (`tradeId`), so the
 * stock's feed shows the proposal and its note as one line
 * (lib/thesis/activity-feed.ts). An Auto trade's order carries one plain line
 * naming the trigger until then (`autoTradeLine`, lib/agent/triggers/do-it.ts).
 */

import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";

/** Sent when a proposal's note is on its order (or its run ended without one). */
export const NOTE_WRITTEN = "app/proposal.note.written";

/** How long after the order a note still counts as coming: a morning run can take a quarter of an hour. */
const WRITEUP_WINDOW_MS = 20 * 60 * 1000;

/**
 * Puts the run's notes on the proposals it made: every order of the analyst's
 * created since the run started whose stock the run then wrote a note on
 * (an update_thesis row of this run, after the order). The note replaces
 * whatever the trade tool wrote, and the note row is stamped with the order.
 * Returns the orders that got their note. Safe to run twice.
 */
export async function putNotesOnRunProposals(args: { runId: string; analystId: string | null; since: Date }): Promise<string[]> {
  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: args.since }, thesisId: { not: null } },
    select: { id: true, thesisId: true, createdAt: true, position: { select: { analystId: true } } },
  });
  const noted: string[] = [];
  for (const o of orders) {
    if (args.analystId && o.position?.analystId && o.position.analystId !== args.analystId) continue;
    const note = await prisma.thesisUpdate.findFirst({
      where: { runId: args.runId, thesisId: o.thesisId!, type: { in: ["UPDATED", "REVIEWED"] }, timestamp: { gte: o.createdAt }, rationale: { not: null } },
      orderBy: { timestamp: "desc" },
      select: { id: true, rationale: true },
    });
    const text = note?.rationale?.trim();
    if (!note || !text) continue;
    await prisma.order.update({ where: { id: o.id }, data: { rationale: text } });
    await prisma.thesisUpdate.update({ where: { id: note.id }, data: { tradeId: o.id } });
    noted.push(o.id);
  }
  return noted;
}

/** Tells the approval email the note is on the order. Never throws. */
export async function sendNoteWritten(orderId: string): Promise<void> {
  try {
    await inngest.send({ name: NOTE_WRITTEN, data: { orderId } });
  } catch (err) {
    console.warn(`[note-on-proposal] could not send ${NOTE_WRITTEN} for ${orderId}:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Whether the analyst is still writing up this order: no note is on it yet,
 * and a run of its analyst that started before the order is still running
 * (a trigger run on its stock, or the morning run). The card shows that it
 * is being written; the approval email waits for it. Your chat's proposals
 * carry your chat's words at once.
 */
export async function writeupComing(orderId: string, now: Date = new Date()): Promise<boolean> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { createdAt: true, position: { select: { analystId: true, symbol: true } } },
  });
  if (!order || now.getTime() - order.createdAt.getTime() > WRITEUP_WINDOW_MS) return false;
  const noted = await prisma.thesisUpdate.findFirst({ where: { tradeId: orderId }, select: { id: true } });
  if (noted) return false;
  const run = await prisma.researchRun.findFirst({
    where: {
      agentConfigId: order.position.analystId,
      status: "RUNNING",
      startedAt: { gte: new Date(order.createdAt.getTime() - WRITEUP_WINDOW_MS), lte: order.createdAt },
      OR: [
        { mode: "MORNING_PLAN" },
        { mode: "INTRADAY_TACTICAL", parameters: { path: ["ticker"], equals: order.position.symbol } },
      ],
    },
    select: { id: true },
  });
  return run != null;
}
