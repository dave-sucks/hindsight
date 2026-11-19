/**
 * true-now.ts — which triggers already hold at today's price, read as the
 * trigger check reads them (conditionHolds): the live price, the chart
 * snapshot and the open position when a condition reads them, and no session,
 * so a close-only line is read at today's price. One that holds fires at the
 * next check (a close-only one at the 16:20 pass).
 *
 * A planner's buy or add that holds is refused (edit_triggers, TRADE_NOW). A
 * line the watch rewrite puts on that holds is named to the Writer, in its
 * brief and in the triggers it reads after its save (TRUE_NOW), and the
 * Writer keeps it or removes it with its reason: ETN 2026-11-19 sat under its
 * 200-day, so the Compounder's "Stop watching if below the 200-day" would have
 * dropped it at the close with no run.
 */
import { prisma } from "@/lib/prisma";
import { getLiveQuote } from "@/lib/market-data/live-quote";
import { loadIndicatorSnapshots } from "@/lib/market-data/load-indicators";
import type { AlpacaCredentials } from "@/lib/alpaca";
import { parseTriggersResilient } from "./schema";
import { conditionHolds, type EvaluationContext } from "./evaluate";
import { MEASURES, isGroup, readsSource, readsThePosition, shapeOf } from "./condition";
import type { Trigger } from "./types";

/** What the Writer reads beside a line that holds today. */
export const TRUE_NOW = "true today: fires at the next check";

/**
 * The stock now, for reading `triggers` (and the stored ones named in
 * `storedIds`) as the trigger check would. Null with no price, or a thesis the
 * caller doesn't own: nothing is said on a guess.
 */
export async function readNow(
  thesisId: string,
  who: { userId: string; analystId?: string | null; alpacaCreds?: AlpacaCredentials | null },
  triggers: Trigger[],
  storedIds: string[] = [],
): Promise<{ read: EvaluationContext; stored: Trigger[]; direction: string | null; status: string } | null> {
  const thesis = await prisma.thesis.findUnique({ where: { id: thesisId }, select: { ticker: true, status: true, direction: true, triggers: true, userId: true, createdAt: true, lastReviewedAt: true, catalystDate: true } });
  if (!thesis || thesis.userId !== who.userId) return null;
  const quote = (await getLiveQuote(thesis.ticker, { caller: "other", creds: who.alpacaCreds ?? undefined }).catch(() => null))?.quote;
  if (!quote) return null;
  const stored = parseTriggersResilient(thesis.triggers).triggers as Trigger[];
  const shape = (t: Trigger) => {
    try {
      return shapeOf(t.predicate);
    } catch {
      return null;
    }
  };
  const shapes = [...triggers, ...stored.filter((t) => storedIds.includes(t.id))].map(shape).filter((w) => w != null);
  const now = new Date();
  const indicators = shapes.some((w) => readsSource(w, "snapshot"))
    ? ((await loadIndicatorSnapshots([thesis.ticker], now).catch(() => null))?.get(thesis.ticker) ?? null)
    : null;
  const position = thesis.status === "HOLDING" && who.analystId && shapes.some((w) => readsThePosition(w))
    ? await prisma.position.findFirst({ where: { analystId: who.analystId, symbol: thesis.ticker, status: "OPEN" }, select: { avgCost: true, peakPrice: true, openedAt: true }, orderBy: { openedAt: "desc" } }).catch(() => null)
    : null;
  return {
    read: {
      latestQuote: { price: quote.c, changePct: quote.dp ?? 0, prevClose: quote.pc ?? undefined },
      indicators,
      position: position ? { avgCost: position.avgCost != null ? Number(position.avgCost) : null, peakPrice: position.peakPrice != null ? Number(position.peakPrice) : null, openedAt: position.openedAt } : null,
      thesis: { createdAt: thesis.createdAt, lastReviewedAt: thesis.lastReviewedAt, catalystDate: thesis.catalystDate, direction: thesis.direction },
      now,
    },
    stored,
    direction: thesis.direction,
    status: thesis.status,
  };
}

/**
 * The triggers that hold at today's price or chart. A clock is left out: it is
 * due by the date, and its run is the look it asks for (MA's 7-day review was
 * due on its first check). One that can't be read holds nothing. Pure.
 */
export function holdingNow(triggers: Trigger[], read: EvaluationContext): Trigger[] {
  return triggers.filter((t) => {
    try {
      const w = shapeOf(t.predicate);
      const conditions = !w ? [] : isGroup(w) ? w.conditions : [w];
      return conditions.some((c) => !MEASURES[c.watch]?.timed) && conditionHolds(t, read);
    } catch {
      return false;
    }
  });
}

/** The ids of a stock's own triggers that hold now; empty when the stock can't be read. */
export async function trueNowIds(thesisId: string, who: Parameters<typeof readNow>[1], triggers: Trigger[]): Promise<Set<string>> {
  const now = await readNow(thesisId, who, triggers).catch(() => null);
  return new Set(now ? holdingNow(triggers, now.read).map((t) => t.id) : []);
}
