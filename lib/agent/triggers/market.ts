/**
 * The account's own triggers, on the market: "Run the Portfolio Manager if
 * the S&P is down 2% on the day", and the same for up 2%. They are stored on the account
 * (Account.marketTriggers), in the same shape as every trigger, and no stock
 * inherits them: a stock's ladder reads Account.triggers only. Each one that
 * fires starts one Portfolio Manager run for the account
 * (lib/inngest/functions/agent-scheduler.ts).
 *
 * They are checked by the trigger check (trigger-evaluator.ts) on its
 * five-minute passes, and fire like every trigger (./evaluate): when the
 * condition becomes true, and not again until a 4:20 PM close finds it false.
 * The fire state is on the trigger itself. The S&P's move is SPY's quote from
 * lib/market-data/live-quote; with no quote, or one that isn't from the last
 * 15 minutes, the pass checks nothing.
 */
import { prisma } from "@/lib/prisma";
import { getLiveQuotes, type LiveQuote } from "@/lib/market-data/live-quote";
import { staleForTrading } from "@/lib/market-data/quote-age";
import { etDateOf } from "@/lib/market-data/intraday-window";
import { conditionHolds, shouldFire, type EvaluationContext } from "./evaluate";
import { firedSinceFalseClose, sentenceOf } from "./condition";
import { parseLevelTriggers } from "./load-levels";
import type { Trigger } from "./types";

/** The fund the S&P 500 is read by. */
export const MARKET_SYMBOL = "SPY";
/** Sent when an account's market trigger fires; the agent scheduler starts the run. */
export const MARKET_TRIGGER_FIRED = "app/market.trigger.fired";

export interface MarketFire {
  accountId: string;
  triggerId: string;
  /** The run's first-message line: the move, and the trigger it fired. */
  message: string;
}

/** The S&P's move in words: "The S&P is down 2.3% today". */
export function marketMoveWords(changePct: number): string {
  return `The S&P is ${changePct < 0 ? "down" : "up"} ${Math.abs(changePct).toFixed(1)}% today`;
}

/** What a run a market trigger starts is told: one line, with the number and the trigger. */
export function marketFireMessage(trigger: Pick<Trigger, "action" | "predicate">, changePct: number): string {
  return `${marketMoveWords(changePct)}, which fired the account's trigger "${sentenceOf(trigger)}".`;
}

/**
 * The S&P's move a pass may read, or why not. During the session the quote is
 * from the last 15 minutes; on the close pass it is today's close.
 */
export function marketMove(quote: LiveQuote | null | undefined, session: "INTRADAY" | "CLOSE", now: Date): { changePct: number } | { skipped: string } {
  if (!quote || quote.dp == null) return { skipped: "no quote" };
  if (session === "INTRADAY" && staleForTrading(quote, now)) return { skipped: "the quote is stale" };
  if (etDateOf(new Date(quote.t * 1000)) !== etDateOf(now)) return { skipped: "the quote isn't today's" };
  return { changePct: quote.dp };
}

/**
 * One account's triggers against the S&P's move. Pure. An intraday pass fires
 * what became true; the close pass fires nothing and marks each fired trigger
 * it finds false, so it can fire again.
 */
export function readMarketTriggers(
  triggers: Trigger[],
  changePct: number,
  session: "INTRADAY" | "CLOSE",
  now: Date,
): { fired: Trigger[]; next: Trigger[] } {
  const ctx: EvaluationContext = { market: { changePct }, session, thesis: { createdAt: now }, now };
  const at = now.toISOString();
  const fired: Trigger[] = [];
  const next = triggers.map((t) => {
    if (session === "CLOSE") return firedSinceFalseClose(t) && !conditionHolds(t, ctx) ? { ...t, falseAtCloseAt: at } : t;
    if (!shouldFire(t, ctx).fires) return t;
    fired.push(t);
    return { ...t, lastFiredAt: at };
  });
  return { fired, next };
}

/**
 * The pass: every account's market triggers, one SPY quote for all of them.
 * Each account's row is locked while its triggers are read and stamped, so two
 * passes can't both fire one trigger; the stamp lands before the fire is
 * handed back, so a failed send loses one run and never starts two.
 */
export async function checkMarketTriggers(session: "INTRADAY" | "CLOSE", now: Date): Promise<MarketFire[]> {
  const accounts = (await prisma.account.findMany({ select: { id: true, marketTriggers: true } })).filter(
    (a) => Array.isArray(a.marketTriggers) && a.marketTriggers.length > 0,
  );
  if (accounts.length === 0) return [];
  const quotes = await getLiveQuotes([MARKET_SYMBOL], { caller: "trigger-check", now });
  const move = marketMove(quotes[MARKET_SYMBOL]?.quote, session, now);
  if ("skipped" in move) {
    console.error(`[market-triggers] not checked this pass: ${move.skipped}${quotes[MARKET_SYMBOL]?.error ? ` (${quotes[MARKET_SYMBOL].error})` : ""}`);
    return [];
  }
  const fires: MarketFire[] = [];
  for (const { id } of accounts) {
    const fired = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.account.findUnique({ where: { id }, select: { marketTriggers: true } });
      const triggers = parseLevelTriggers(row?.marketTriggers, `market account=${id}`);
      const read = readMarketTriggers(triggers, move.changePct, session, now);
      if (read.next.some((t, i) => t !== triggers[i])) await tx.account.update({ where: { id }, data: { marketTriggers: read.next as unknown as object[] } });
      return read.fired;
    });
    for (const t of fired) fires.push({ accountId: id, triggerId: t.id, message: marketFireMessage(t, move.changePct) });
  }
  return fires;
}
