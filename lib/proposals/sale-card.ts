/**
 * The sale card: a sale or trim a trigger's fire proposed (the owner's ruling,
 * 2026-11-13, replacing "a sale asks every day" of 2026-10-13).
 *
 * It stays open exactly as long as its reason holds. It has no deadline: the
 * order carries the triggers it answers (`Order.triggerIds`) instead of an
 * `expiresAt`, so the 30-minute expiry sweep never sees it, and while it
 * waits the five-minute check drops every sale fire on the stock (a sale
 * already under way), adding the trigger to the card. On the 16:20 ET close
 * pass, if none of its triggers holds on the close, it comes down itself
 * (WITHDRAWN, with the reason in words). Withdrawn on the close only, so a
 * stock bouncing around the line doesn't open and close the card all day.
 *
 * The owner answers it with Sell (approve) or Hold (decline). Hold keeps every
 * trigger behind the card quiet until the stock closes back past it and
 * breaks it again, or its condition changes (../agent/triggers/hold.ts).
 *
 * Before it, each proposal lapsed after 24 hours and the standing order asked
 * again: 94 of 126 proposals from 2026-10-14 to 11-13 were those re-asks on
 * six holdings (NVDA 23, none filled). A sale nothing fired (a morning run's
 * own call, a chat) keeps the 24 hours.
 */
import { prisma } from "@/lib/prisma";
import { evaluateTrigger, type EvaluationContext } from "@/lib/agent/triggers/evaluate";
import { holdKey } from "@/lib/agent/triggers/hold";
import { loadLevelSources, parseTriggerState, resolveThesisLadder } from "@/lib/agent/triggers/load-levels";
import { conditionSentence, levelOf, money, shapeOf } from "@/lib/agent/triggers/condition";
import { trailFireLevel } from "@/lib/agent/triggers/trail";
import type { Trigger } from "@/lib/agent/triggers/types";

/** A sale fire while the stock's card waits: the card answers that trigger too, so it stays open while that holds, and Hold quiets it. */
export async function joinSaleCard(card: { id: string; triggerIds: string[] }, firedIds: string[]): Promise<void> {
  const more = firedIds.filter((id) => !card.triggerIds.includes(id));
  if (card.triggerIds.length === 0 || more.length === 0) return;
  card.triggerIds = [...card.triggerIds, ...more];
  await prisma.order.updateMany({ where: { id: card.id, status: "AWAITING_APPROVAL" }, data: { triggerIds: card.triggerIds } });
}

/** Why the card came down, in words: "closed at $238.10, back above $236". */
export function backPast(t: Trigger, ctx: EvaluationContext): string {
  const close = ctx.latestQuote?.price;
  const at = close != null ? `closed at ${money(Math.round(close * 100) / 100)}` : "closed";
  const short = ctx.thesis.direction === "SHORT";
  const w = shapeOf(t.predicate);
  const level = w ? levelOf(w) : null;
  if (level && !(w as { variable?: string }).variable) return `${at}, back ${level.above ? "below" : "above"} ${money(level.value)}`;
  const c = w as { watch?: string; variable?: string; value?: number } | null;
  const trail = c?.watch === "move" && c.variable === "peak" && c.value != null ? trailFireLevel(c.value, { peak: ctx.position?.peakPrice, isLong: !short }) : null;
  if (trail != null) return `${at}, back ${short ? "below" : "above"} ${money(Math.round(trail * 100) / 100)}, ${c!.value}% off the high`;
  return `${at}; no longer ${conditionSentence(t.predicate)}`;
}

/**
 * The close pass, for one stock we own: the card comes down when none of its
 * triggers holds on the close, and a held trigger that doesn't hold on the
 * close re-arms. Read with the check's own reader (`evaluateTrigger`) against
 * the day's close. A trigger behind the card that is no longer on the stock
 * can't be read, so the card waits for the owner.
 */
export async function settleOnTheClose(args: {
  thesisId: string;
  /** The stock's resolved sale and trim triggers, the owner's holds merged on. */
  sales: Trigger[];
  /** The close pass's context: the day's close as the price. */
  ctx: EvaluationContext;
  card: { id: string; triggerIds: string[] } | null;
}): Promise<{ withdrawn: string | null; rearmed: string[] }> {
  const holds = (t: Trigger) => evaluateTrigger(t.predicate, args.ctx);
  let withdrawn: string | null = null;
  const behind = (args.card?.triggerIds ?? []).map((id) => args.sales.find((t) => t.id === id)).filter((t): t is Trigger => t != null);
  if (args.card && behind.length > 0 && !behind.some(holds)) {
    withdrawn = backPast(behind[0], args.ctx);
    await prisma.order.updateMany({ where: { id: args.card.id, status: "AWAITING_APPROVAL" }, data: { status: "WITHDRAWN", withdrawnReason: withdrawn } });
  }
  const rearmed = args.sales.filter((t) => t.heldAt && !holds(t)).map((t) => t.id);
  if (rearmed.length) await writeHolds(args.thesisId, rearmed, null);
  return { withdrawn, rearmed };
}

/**
 * Hold: the owner declined a sale a trigger proposed. Each trigger behind it
 * stays quiet on this stock until it re-arms, or its condition changes.
 */
export async function holdSaleTriggers(args: { thesisId: string; triggerIds: string[]; now: Date }): Promise<string[]> {
  const thesis = await prisma.thesis.findUnique({
    where: { id: args.thesisId },
    select: { triggers: true, triggerState: true, status: true, horizon: true, direction: true, researchRun: { select: { agentConfigId: true } } },
  });
  if (!thesis) return [];
  const analystId = thesis.researchRun?.agentConfigId ?? null;
  const ladder = resolveThesisLadder(thesis, analystId ? (await loadLevelSources([analystId])).get(analystId) : undefined, `thesis=${args.thesisId}`);
  const held = args.triggerIds.map((id) => ladder.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => t != null);
  if (held.length === 0) return [];
  await writeHolds(args.thesisId, held.map((t) => t.id), (id) => ({ at: args.now.toISOString(), on: holdKey(held.find((t) => t.id === id)!) }));
  return held.map((t) => t.id);
}

/** Set (or, with null, lift) the hold on these triggers, re-reading the row so a concurrent stamp isn't lost. */
async function writeHolds(thesisId: string, ids: string[], hold: ((id: string) => { at: string; on: string }) | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.thesis.findUnique({ where: { id: thesisId }, select: { triggerState: true } });
    if (!row) return;
    const state = parseTriggerState(row.triggerState);
    for (const id of ids) {
      const { held: _was, ...rest } = state[id] ?? {};
      void _was;
      state[id] = hold ? { ...rest, held: hold(id) } : rest;
    }
    await tx.thesis.update({ where: { id: thesisId }, data: { triggerState: state as unknown as object } });
  });
}
