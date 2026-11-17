/**
 * After a buy placed by hand: the analyst writes what the stock is missing.
 *
 * The sale is the analyst's job. A buy that lands on a thesis with no view or
 * no "Sell if" trigger sends the writer to fill it in; the triggers already
 * there (the sale typed into the Trade dialog among them) are kept — the
 * writer fills only the empty ones (`keepLevels`). There is no target of our
 * own to be missing.
 */

import { prisma } from "@/lib/prisma";
import { startWriterRun } from "@/lib/agent/thesis-writer-dispatch";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";
import { parseTriggersResilient } from "@/lib/agent/triggers/schema";

/** What the writer is sent for, or null when the thesis has everything. */
export function researchOwed(t: { noView: boolean; hasSale: boolean }): {
  reason: string;
  missing: string;
} | null {
  if (t.noView) return { reason: "Bought by hand with no research yet; write its view and its sale.", missing: "research" };
  if (!t.hasSale) return { reason: "Bought by hand; set its sale.", missing: "sale" };
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
    .findUnique({ where: { id: opts.thesisId }, select: { triggers: true } })
    .catch(() => null);
  const owed = researchOwed({
    noView: opts.noView,
    hasSale: parseTriggersResilient(row?.triggers).triggers.some((t) => t.action === "EXIT"),
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
