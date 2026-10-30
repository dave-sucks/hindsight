/**
 * After a buy placed by hand: the analyst writes what the stock is missing.
 *
 * The floor and target are the analyst's job. A buy that lands on a thesis
 * with no view, no floor or no target sends the writer to fill them in; the
 * levels already there (the ones typed into the Trade dialog among them) are
 * kept — the writer fills only the empty ones (`keepLevels`).
 */

import { prisma } from "@/lib/prisma";
import { startWriterRun } from "@/lib/agent/thesis-writer-dispatch";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";

/** What the writer is sent for, or null when the thesis has everything. */
export function researchOwed(t: { noView: boolean; floor: number | null; target: number | null }): {
  reason: string;
  missing: string;
} | null {
  if (t.noView) return { reason: "Bought by hand with no research yet; write its view, floor and target.", missing: "research" };
  if (t.floor == null) return { reason: "Bought by hand; set its floor and target.", missing: "floor" };
  if (t.target == null) return { reason: "Bought by hand; set its floor and target.", missing: "target" };
  return null;
}

/** Sends the writer when owed; returns whether it started. A failure is one Activity line, never a failed trade. */
export async function sendWriterAfterBuy(opts: {
  userId: string;
  accountId: string;
  analystId: string;
  environment: "PAPER" | "LIVE";
  ticker: string;
  thesisId: string;
  /** The buy made this thesis LONG — it had no view. */
  noView: boolean;
}): Promise<boolean> {
  const row = await prisma.thesis
    .findUnique({ where: { id: opts.thesisId }, select: { stopLoss: true, targetPrice: true } })
    .catch(() => null);
  const owed = researchOwed({
    noView: opts.noView,
    floor: row?.stopLoss ?? null,
    target: row?.targetPrice ?? null,
  });
  if (!owed) return false;
  try {
    await startWriterRun({
      userId: opts.userId,
      accountId: opts.accountId,
      analystId: opts.analystId,
      environment: opts.environment,
      ticker: opts.ticker,
      mode: "refresh",
      existingThesisId: opts.thesisId,
      reviewCadenceDays: null,
      reason: owed.reason,
      source: "USER",
      dispatchedBy: "manual-trade",
      keepLevels: true,
    });
    return true;
  } catch (err) {
    console.error(`[sendWriterAfterBuy] ${opts.ticker}:`, err instanceof Error ? err.message : err);
    await writeThesisUpdate({
      thesisId: opts.thesisId,
      type: "ACTED",
      summary: `Bought ${opts.ticker} by hand; the write-up didn't start`,
    });
    return false;
  }
}
