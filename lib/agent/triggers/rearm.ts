/**
 * A buy the trigger run passes because the price slipped back under its
 * level is not used up (DAV-343, QB ruling — Dave delegated).
 *
 * AAPL, Secular Compounder, 2026-09-30. The 5-minute check fired the buy
 * above $331 at $331.47 (09:30:22 ET). Twenty seconds later the trigger run
 * read $330.83, back under the level, and passed on the live-quote check —
 * "leaving the ladder intact because the buy level is still the right
 * confirmation line". At 09:35 AAPL traded $332.42 and kept going. The buy
 * was spent: its 1-day cooldown blocked a second fire that day, and the
 * next day's prior close sat above $331, so it could never cross again.
 *
 * The rule. A pass because the price was back on the wrong side of the level
 * at the moment of the check leaves the buy armed: the next check that finds
 * the price back past the level fires it again, the same day. At most
 * `MAX_REARMS_PER_DAY` times per buy per day, so a stock hovering on its
 * level doesn't wake the analyst every five minutes. Any other pass still
 * spends the buy.
 *
 * "The level no longer held" is read from what the pass recorded, not from
 * its words: the run's own close-out row carries the price it judged
 * (`priceAtTime`) and the trigger it answered (`triggerId`). A run that tried
 * to buy — an order, or a refused place_trade — did not pass on the price.
 * A pass for another reason while the price happened to sit under the level
 * gets at most one more look; that look finds the price past the level, so
 * a second pass there spends the buy.
 *
 * The re-arm is stored in `Thesis.triggerState[id].rearmedAt`, never on the
 * trigger: `lastFiredAt` stays, so the sheet still says when it fired and a
 * buy the price leaves behind is still flagged (buy-crossing.ts). The
 * cooldown reads the re-arm (`shouldFire`), and so does the trigger run's
 * four-hour "this buy was already checked" rule (`enterAlreadyChecked`).
 */

import { prisma } from "@/lib/prisma";
import { parseTriggerState } from "./load-levels";
import type { Trigger } from "./types";

/** How many times a day one buy is re-armed after a pass on the price. */
export const MAX_REARMS_PER_DAY = 3;

const etDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** The re-arms on `now`'s trading date (ET), oldest first. */
export function rearmsOn(rearmedAt: readonly string[] | undefined, now: Date): string[] {
  const today = etDay(now);
  return (rearmedAt ?? []).filter((iso) => {
    const d = new Date(iso);
    return !Number.isNaN(d.getTime()) && etDay(d) === today;
  });
}

/** A WATCHING stock's buy on an intraday price level — the only kind a quote can be back under. */
function isIntradayPriceBuy(t: Pick<Trigger, "action" | "predicate">): boolean {
  const p = t.predicate;
  return t.action === "ENTER" && (p.kind === "PRICE_ABOVE" || p.kind === "PRICE_BELOW") && p.basis !== "close";
}

export type RearmDecision =
  | { rearm: true; level: number; priceAtPass: number; rearmsToday: number }
  | {
      rearm: false;
      why:
        | "not-an-intraday-price-buy"
        | "not-watching"
        | "no-close-out"
        | "tried-to-buy"
        | "level-still-held"
        | "day-limit";
    };

/**
 * Should this pass leave the buy armed? Pure.
 *
 * Only a WATCHING stock's ENTER on an intraday price level: a close-based
 * buy is checked once a day on the close, and a chart or composite buy has
 * no single level a quote can be back under.
 */
export function decideBuyRearm(input: {
  trigger: Pick<Trigger, "id" | "action" | "predicate">;
  status: string;
  /** The run's close-out row on this thesis: the trigger it answered and the price it judged. */
  closeOut: { triggerId: string | null; priceAtTime: number | null } | null;
  /** The run placed a buy order, or place_trade refused one. */
  triedToBuy: boolean;
  /** Earlier re-arms of this buy (ISO), any day. */
  rearmedAt: readonly string[] | undefined;
  now: Date;
}): RearmDecision {
  const { trigger } = input;
  const p = trigger.predicate;
  if (!isIntradayPriceBuy(trigger) || (p.kind !== "PRICE_ABOVE" && p.kind !== "PRICE_BELOW")) {
    return { rearm: false, why: "not-an-intraday-price-buy" };
  }
  if (input.status !== "WATCHING") return { rearm: false, why: "not-watching" };

  // The run is for this one trigger, so a close-out that names no trigger
  // still answers it; one that names a different trigger does not.
  const row = input.closeOut;
  if (!row || row.priceAtTime == null || !(row.priceAtTime > 0)) return { rearm: false, why: "no-close-out" };
  if (row.triggerId != null && row.triggerId !== trigger.id) return { rearm: false, why: "no-close-out" };

  if (input.triedToBuy) return { rearm: false, why: "tried-to-buy" };

  // The same comparison the check fires on (evaluateTrigger).
  const holds = p.kind === "PRICE_ABOVE" ? row.priceAtTime > p.level : row.priceAtTime < p.level;
  if (holds) return { rearm: false, why: "level-still-held" };

  const today = rearmsOn(input.rearmedAt, input.now).length;
  if (today >= MAX_REARMS_PER_DAY) return { rearm: false, why: "day-limit" };
  return { rearm: true, level: p.level, priceAtPass: row.priceAtTime, rearmsToday: today + 1 };
}

/**
 * The trigger run's four-hour rule: a buy already checked by a completed
 * run within the window is not checked again. A buy re-armed after that run
 * is the exception — the re-arm is the point.
 */
export function enterAlreadyChecked(
  prior: { createdAt: Date | string },
  trigger: Pick<Trigger, "rearmedAt">,
): boolean {
  if (!trigger.rearmedAt) return true;
  return new Date(trigger.rearmedAt).getTime() <= new Date(prior.createdAt).getTime();
}

/**
 * After a trigger run on a buy: if it passed because the price was back on
 * the wrong side of the level, re-arm the buy (and say so on the run).
 * Called by the trigger run once the agent is done; never throws into it.
 */
export async function rearmBuyAfterPass(args: {
  runId: string;
  runStartedAt: Date;
  thesisId: string;
  trigger: Pick<Trigger, "id" | "action" | "predicate">;
  now?: Date;
}): Promise<RearmDecision> {
  const now = args.now ?? new Date();
  if (!isIntradayPriceBuy(args.trigger)) return { rearm: false, why: "not-an-intraday-price-buy" };

  const [closeOut, orders, refusals] = await Promise.all([
    prisma.thesisUpdate.findFirst({
      where: { runId: args.runId, thesisId: args.thesisId, type: { not: "TRIGGER_FIRED" } },
      orderBy: { timestamp: "desc" },
      select: { triggerId: true, priceAtTime: true },
    }),
    prisma.order.count({ where: { thesisId: args.thesisId, side: "BUY", createdAt: { gte: args.runStartedAt } } }),
    prisma.gateRejection.count({ where: { runId: args.runId, tool: "place_trade" } }),
  ]);

  return prisma.$transaction(async (tx) => {
    const row = await tx.thesis.findUnique({
      where: { id: args.thesisId },
      select: { ticker: true, status: true, triggerState: true },
    });
    if (!row) return { rearm: false, why: "not-watching" } as const;
    const state = parseTriggerState(row.triggerState);
    const decision = decideBuyRearm({
      trigger: args.trigger,
      status: row.status,
      closeOut: closeOut ? { triggerId: closeOut.triggerId, priceAtTime: closeOut.priceAtTime != null ? Number(closeOut.priceAtTime) : null } : null,
      triedToBuy: orders > 0 || refusals > 0,
      rearmedAt: state[args.trigger.id]?.rearmedAt,
      now,
    });
    if (!decision.rearm) return decision;

    state[args.trigger.id] = {
      ...state[args.trigger.id],
      rearmedAt: [...rearmsOn(state[args.trigger.id]?.rearmedAt, now), now.toISOString()],
    };
    await tx.thesis.update({ where: { id: args.thesisId }, data: { triggerState: state as unknown as object } });

    const side = args.trigger.predicate.kind === "PRICE_ABOVE" ? "under" : "over";
    await tx.runEvent.create({
      data: {
        runId: args.runId,
        type: "buy_rearmed",
        title: "The buy stays armed",
        message:
          `$${row.ticker} was $${decision.priceAtPass} at the check, back ${side} the $${decision.level} level, so this pass does not use up the buy. ` +
          `The next check that finds it past $${decision.level} today fires it again (${decision.rearmsToday} of ${MAX_REARMS_PER_DAY} today).`,
        payload: { thesisId: args.thesisId, triggerId: args.trigger.id, ...decision } as object,
      },
    });
    return decision;
  });
}
