/**
 * A proposal a trigger made stays open while its trigger holds (the owner's
 * ruling, 2026-11-13).
 *
 * A buy, add, trim or sale a trigger's fire proposed carries the triggers it
 * answers (`Order.triggerIds`, ./staged.ts) and no `expiresAt`, so the
 * 30-minute expiry sweep never lapses it. On the 16:20 ET close pass, if none
 * of those triggers holds on the day's close, it comes down itself: the order
 * is WITHDRAWN with the reason in words, and a proposed buy's staged position
 * is cancelled. On the close only, so a stock bouncing around its line
 * doesn't open and close the proposal all day. Approve and reject are as
 * they were.
 *
 * Before it, each proposal lapsed after 24 hours and the standing order asked
 * again: 94 of 126 proposals from 2026-10-14 to 11-13 were those re-asks on
 * six holdings (NVDA 23, none filled). A proposal nothing fired (a morning
 * run's own call, a chat) keeps the 24 hours.
 */
import { prisma } from "@/lib/prisma";
import { evaluateTrigger, type EvaluationContext } from "@/lib/agent/triggers/evaluate";
import { conditionSentence, levelOf, money, shapeOf } from "@/lib/agent/triggers/condition";
import { trailFireLevel } from "@/lib/agent/triggers/trail";
import type { Trigger } from "@/lib/agent/triggers/types";

/** A trigger's proposal waiting on a stock, as the close pass reads it. */
export interface TriggerProposal {
  id: string;
  intent: string | null;
  positionId: string;
  triggerIds: string[];
}

const usd = (n: number) => money(Math.round(n * 100) / 100);

/** Why the proposal came down, in words: "closed back above $236 at $238.10". */
export function backPast(t: Trigger, ctx: EvaluationContext): string {
  const close = ctx.latestQuote?.price;
  const at = close != null ? ` at ${usd(close)}` : "";
  const w = shapeOf(t.predicate);
  const level = w ? levelOf(w) : null;
  if (level && !(w as { variable?: string }).variable) return `closed back ${level.above ? "below" : "above"} ${money(level.value)}${at}`;
  const c = w as { watch?: string; variable?: string; value?: number } | null;
  const short = ctx.thesis.direction === "SHORT";
  const trail = c?.watch === "move" && c.variable === "peak" && c.value != null ? trailFireLevel(c.value, { peak: ctx.position?.peakPrice, isLong: !short }) : null;
  if (trail != null) return `closed back ${short ? "below" : "above"} ${usd(trail)}, ${c!.value}% off the high${at}`;
  return `closed${at}; no longer ${conditionSentence(t.predicate)}`;
}

/**
 * The close pass, for one stock: a trigger's proposal comes down when none of
 * its triggers holds on the close, read with the check's own reader
 * (`evaluateTrigger`) against the day's close. A trigger no longer on the
 * stock can't be read, so a proposal whose triggers are all gone waits for
 * the owner.
 */
export async function withdrawOnTheClose(args: {
  /** The stock's resolved triggers. */
  ladder: Trigger[];
  /** The close pass's context: the day's close as the price. */
  ctx: EvaluationContext;
  proposals: TriggerProposal[];
}): Promise<Array<{ id: string; reason: string }>> {
  const out: Array<{ id: string; reason: string }> = [];
  for (const p of args.proposals) {
    const behind = p.triggerIds.map((id) => args.ladder.find((t) => t.id === id)).filter((t): t is Trigger => t != null);
    if (behind.length === 0 || behind.some((t) => evaluateTrigger(t.predicate, args.ctx))) continue;
    const reason = backPast(behind[0], args.ctx);
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({ where: { id: p.id, status: "AWAITING_APPROVAL" }, data: { status: "WITHDRAWN", withdrawnReason: reason } });
      // A proposed buy staged a position that was never held; it goes, as on an expiry.
      if (count > 0 && p.intent === "OPEN") {
        await tx.position.updateMany({ where: { id: p.positionId, status: "PENDING_APPROVAL" }, data: { status: "CANCELLED", closedAt: args.ctx.now, closeReason: "MANUAL" } });
      }
    });
    out.push({ id: p.id, reason });
  }
  return out;
}
