/**
 * An urgent note starts a run now on each stock it names that we hold or
 * watch, through the account's rule "Review if an urgent note names this
 * stock" (seed-account.ts, measure ./condition/measures/note.ts). It sends
 * the same event the five-minute check sends for a fire, when the note is
 * saved, so the trigger run (lib/inngest/functions/tactical-run.ts) takes it
 * from there. The rule decides: deleted, nothing fires; set to Flag for
 * Review, the fire is written down for the next morning run.
 *
 * One run per stock per day (the event id is the thesis and the New York
 * day). A stock whose last urgent note cited the same condition, and that a
 * run answered within the last 5 trading days, is skipped: a line that has
 * been crossed for days is not news. The fire's line names the note and its
 * title; the note itself reaches the run once, in its notes block.
 */
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { loadLevelSources, resolveThesisLadder } from "./load-levels";
import { sentenceOf } from "./condition";
import { shapeOf } from "./condition/valid";
import { isGroup } from "./condition/types";
import { waitsForMorning } from "./fire-mode";
import { ruleOnTheLine, writeThesisUpdate } from "@/lib/agent/thesis-updates";
import type { Trigger } from "./types";
import { levelFor } from "@/lib/agent/shared-notes";
import { etToday } from "@/lib/market-data/market-calendar";
import { isTradingDay } from "@/lib/market-hours";

export type UrgentOutcome = "SENT" | "FLAGGED" | "NO_RULE" | "ANSWERED" | "REPEAT";

/** A repeat of an answered urgent citation is skipped for this many trading days. */
export const URGENT_REPEAT_TRADING_DAYS = 5;

/**
 * What the note's line for this stock says it hits, with the words the note
 * quoted from the thesis: `condition 2 ("Guidance cut before the report…")`,
 * "the catalyst", or null. A condition renumbered or rewritten since is not
 * the same line.
 */
export function citedIn(body: string, ticker: string): string | null {
  const line = body.split("\n").find((l) => l.startsWith(`${ticker.toUpperCase()} · urgent · `));
  return line?.match(/ · urgent · ((?:condition|assumption) \d+(?: \("[^"]*"\))?|the catalyst)/)?.[1] ?? null;
}

/** The start of the New York day `n` trading days before `at`. */
export function tradingDaysBefore(at: Date, n: number): Date {
  let d = new Date(at);
  for (let left = n; left > 0; ) {
    d = new Date(d.getTime() - 86_400_000);
    if (isTradingDay(new Date(`${etToday(d)}T17:00:00Z`))) left--;
  }
  return new Date(`${etToday(d)}T05:00:00Z`);
}

/** The account rule on this stock's ladder that an urgent note fires. */
export function urgentNoteRule(ladder: readonly Trigger[]): Trigger | null {
  return (
    ladder.find((t) => {
      const w = shapeOf(t.predicate);
      return w != null && !isGroup(w) && w.watch === "note";
    }) ?? null
  );
}

/** A run wrote on the stock after the note: it is answered, so no new run. */
async function answeredSince(thesisId: string, at: Date): Promise<boolean> {
  const row = await prisma.thesisUpdate.findFirst({
    where: { thesisId, timestamp: { gt: at }, runId: { not: null }, type: { notIn: ["TRIGGER_FIRED", "NOTE"] } },
    select: { id: true },
  });
  return row != null;
}

export async function fireUrgentNote(
  note: { id: string; userId: string; tickers: readonly string[]; body: string; createdAt: Date; accountId?: string; environment?: string },
  now: Date = new Date(),
): Promise<Array<{ ticker: string; thesisId: string; outcome: UrgentOutcome }>> {
  const tickers = [...new Set(note.tickers.map((t) => t.toUpperCase()))];
  if (tickers.length === 0) return [];
  // The note's book: a run on the same stock in the other environment is not this note's.
  const book = note.environment ? { researchRun: { agentConfig: { ...(note.accountId ? { accountId: note.accountId } : {}), tradingEnvironment: note.environment } } } : {};
  const theses = await prisma.thesis.findMany({
    where: { userId: note.userId, ticker: { in: tickers }, status: { in: ["HOLDING", "WATCHING"] }, ...book },
    select: { id: true, ticker: true, status: true, horizon: true, direction: true, triggers: true, triggerState: true, researchRun: { select: { agentConfigId: true } } },
  });
  const analystIds = theses.map((t) => t.researchRun?.agentConfigId).filter((id): id is string => !!id);
  const sources = await loadLevelSources(analystIds);
  // The fire's line names the note; its text reaches the run once, in the stock's notes block.
  const firedContext = `Urgent note [note ${note.id}]: ${note.body.split("\n")[0].trim()}`;
  // The last urgent notes from this book's runs (a few a week; filtered by stock below).
  const since = tradingDaysBefore(note.createdAt, URGENT_REPEAT_TRADING_DAYS);
  const bookRuns = note.environment
    ? (await prisma.researchRun.findMany({ where: { ...(note.accountId ? { accountId: note.accountId } : {}), environment: note.environment, mode: "MARKET_REVIEWER", startedAt: { gte: since } }, select: { id: true } })).map((r) => r.id)
    : null;
  const earlier = await prisma.sharedNote.findMany({
    where: { userId: note.userId, author: "MARKET_REVIEWER", audience: "STOCKS", createdAt: { gte: since, lt: note.createdAt }, ...(bookRuns ? { runId: { in: bookRuns } } : {}) },
    select: { id: true, tickers: true, levels: true, body: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const out: Array<{ ticker: string; thesisId: string; outcome: UrgentOutcome }> = [];
  for (const t of theses) {
    const analystId = t.researchRun?.agentConfigId;
    if (!analystId) continue;
    const rule = urgentNoteRule(resolveThesisLadder(t, sources.get(analystId), `thesis=${t.id}`));
    if (!rule) {
      out.push({ ticker: t.ticker, thesisId: t.id, outcome: "NO_RULE" });
      continue;
    }
    if (await answeredSince(t.id, note.createdAt)) {
      out.push({ ticker: t.ticker, thesisId: t.id, outcome: "ANSWERED" });
      continue;
    }
    // The same line, cited urgent again and already answered: not news.
    const last = earlier.find((e) => e.tickers.includes(t.ticker) && levelFor(e, t.ticker) === "URGENT");
    const cited = citedIn(note.body, t.ticker);
    if (last && cited && citedIn(last.body, t.ticker) === cited && (await answeredSince(t.id, last.createdAt))) {
      out.push({ ticker: t.ticker, thesisId: t.id, outcome: "REPEAT" });
      continue;
    }
    if (waitsForMorning(rule)) {
      await writeThesisUpdate({
        thesisId: t.id,
        type: "TRIGGER_FIRED",
        summary: sentenceOf(rule),
        rationale: firedContext,
        triggerId: rule.id,
        ...ruleOnTheLine(rule),
        signalIds: [],
        runId: null,
        priceAtTime: null,
      });
      out.push({ ticker: t.ticker, thesisId: t.id, outcome: "FLAGGED" });
      continue;
    }
    // One run per stock per day, however many urgent notes name it.
    await inngest.send({
      id: `urgent-${t.id}-${etToday(now)}`,
      name: "app/thesis.trigger.fired",
      data: { thesisId: t.id, triggerId: rule.id, analystId, ticker: t.ticker, action: rule.action, firedPrice: null, firedContext, sentence: sentenceOf(rule, t.status === "HOLDING") },
    });
    out.push({ ticker: t.ticker, thesisId: t.id, outcome: "SENT" });
  }
  return out;
}
