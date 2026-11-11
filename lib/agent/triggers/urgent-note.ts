/**
 * An urgent note starts a run now on each stock it names that we hold or
 * watch, through the account's rule "Review if an urgent note names this
 * stock" (seed-account.ts, measure ./condition/measures/note.ts). It sends
 * the same event the five-minute check sends for a fire, when the note is
 * saved, so the trigger run (lib/inngest/functions/tactical-run.ts) takes it
 * from there. The rule decides: deleted, nothing fires; set to Flag for
 * Review, the fire is written down for the next morning run.
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

export type UrgentOutcome = "SENT" | "FLAGGED" | "NO_RULE" | "ANSWERED";

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

export async function fireUrgentNote(note: { id: string; userId: string; tickers: readonly string[]; body: string; createdAt: Date }): Promise<Array<{ ticker: string; thesisId: string; outcome: UrgentOutcome }>> {
  const tickers = [...new Set(note.tickers.map((t) => t.toUpperCase()))];
  if (tickers.length === 0) return [];
  const theses = await prisma.thesis.findMany({
    where: { userId: note.userId, ticker: { in: tickers }, status: { in: ["HOLDING", "WATCHING"] } },
    select: { id: true, ticker: true, status: true, horizon: true, direction: true, triggers: true, triggerState: true, researchRun: { select: { agentConfigId: true } } },
  });
  const analystIds = theses.map((t) => t.researchRun?.agentConfigId).filter((id): id is string => !!id);
  const sources = await loadLevelSources(analystIds);
  const firedContext = `Urgent note: "${note.body.replace(/\s+/g, " ").trim()}" [note ${note.id}]`;

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
    // One event per note and stock: a retried save sends nothing twice.
    await inngest.send({
      id: `urgent-note-${note.id}-${t.id}`,
      name: "app/thesis.trigger.fired",
      data: { thesisId: t.id, triggerId: rule.id, analystId, ticker: t.ticker, action: rule.action, firedPrice: null, firedContext, sentence: sentenceOf(rule, t.status === "HOLDING") },
    });
    out.push({ ticker: t.ticker, thesisId: t.id, outcome: "SENT" });
  }
  return out;
}
