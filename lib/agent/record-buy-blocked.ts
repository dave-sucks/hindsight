/**
 * record-buy-blocked.ts — a buy the position limit blocked leaves one line
 * where a person looks (DAV-286).
 *
 * ISRG 2026-09-16 and 09-17: the buy fired, the tactical run decided to buy,
 * place_trade blocked it at the 4-position limit, and the only trace was a
 * sentence inside that run's own rationale. From outside it looked the same
 * as a trigger that fired and was declined on the merits.
 *
 * The block itself is unchanged. This writes ONE Activity line on the
 * watched thesis naming the limit and what the analyst holds — one per day,
 * not one per pass. Fail-soft: it never turns a blocked buy into an error.
 */
import { prisma } from "@/lib/prisma";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";

/** The Activity line. Pure, so the wording is tested. */
export function buyBlockedSummary(ticker: string, open: number, max: number, held: string[]): string {
  return `Buy blocked — analyst full (${open} of ${max}): $${ticker} wants in${held.length ? `; holds ${held.map((t) => `$${t}`).join(", ")}` : ""}`;
}

export async function recordBuyBlockedByFull(opts: {
  ticker: string;
  analystId: string;
  open: number;
  max: number;
  runId?: string | null;
  now?: Date;
}): Promise<boolean> {
  try {
    const now = opts.now ?? new Date();
    const thesis = await prisma.thesis.findFirst({
      where: { ticker: opts.ticker, status: "WATCHING", researchRun: { agentConfigId: opts.analystId } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!thesis) return false;
    // One line per day, not one per pass.
    const recent = await prisma.thesisUpdate.findFirst({
      where: { thesisId: thesis.id, summary: { startsWith: "Buy blocked — analyst full" }, timestamp: { gte: new Date(now.getTime() - 20 * 3_600_000) } },
      select: { id: true },
    });
    if (recent) return false;
    const held = (
      await prisma.position.findMany({
        where: { analystId: opts.analystId, status: { in: ["OPEN", "PENDING_APPROVAL"] } },
        select: { symbol: true },
      })
    ).map((p) => p.symbol);
    await writeThesisUpdate({
      thesisId: thesis.id,
      type: "UPDATED",
      summary: buyBlockedSummary(opts.ticker, opts.open, opts.max, held),
      rationale: `The buy was confirmed and place_trade refused it at the position limit (${opts.open} of ${opts.max}). Nothing is wrong with the plan; the analyst has no room. The decision is the principal's: is $${opts.ticker} a better use of a slot than one of ${held.map((t) => `$${t}`).join(", ") || "the current holdings"}? Raise the limit on the analyst's page, close one, or leave it waiting.`,
      fieldChanges: { buyBlocked: { from: null, to: { limit: "MAX_OPEN_POSITIONS", open: opts.open, max: opts.max, held } } },
      runId: opts.runId ?? null,
    });
    return true;
  } catch (err) {
    console.warn(`[recordBuyBlockedByFull] ${opts.ticker}:`, err instanceof Error ? err.message : err);
    return false;
  }
}
