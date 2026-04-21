/**
 * Suppression lookup — closes the feedback loop.
 *
 * When the user dismisses a suggestion we record the reason (NOT_RELEVANT /
 * ALREADY_KNOW / WRONG). The next weekly pass calls `loadSuppressionHints`
 * to fetch those dismissals so it can skip re-proposing the same thing.
 *
 * A DISMISSED row with dedupeKey K means "the user explicitly said no to
 * this exact proposal". We hard-block re-emission of the same dedupeKey
 * for 60 days after the dismissal — roughly 8 weekly cycles. That's long
 * enough to be meaningful, short enough that the proposal can resurface
 * if the underlying pattern reappears months later.
 */

import { prisma } from "@/lib/prisma";

const SUPPRESSION_WINDOW_DAYS = 60;

export interface SuppressionHints {
  /** dedupeKeys the next pass should skip outright. */
  blockedDedupeKeys: Set<string>;
  /**
   * Rough per-kind dismissal counts over the window. Fed into the prompt
   * so GPT-4o can see "the user dismissed 4 WATCHLIST_ADD suggestions in a
   * row, they probably don't want more unless the evidence is overwhelming".
   */
  dismissalSummary: Array<{
    kind: string;
    count: number;
    reasons: Record<string, number>;
    examples: Array<{ title: string; reason: string | null; note: string | null }>;
  }>;
}

export async function loadSuppressionHints(
  analystId: string,
): Promise<SuppressionHints> {
  const windowStart = new Date(Date.now() - SUPPRESSION_WINDOW_DAYS * 86_400_000);

  const dismissed = await prisma.suggestion.findMany({
    where: {
      analystId,
      status: "DISMISSED",
      resolvedAt: { gte: windowStart },
    },
    select: {
      kind: true,
      dedupeKey: true,
      title: true,
      dismissReason: true,
      dismissNote: true,
    },
    orderBy: { resolvedAt: "desc" },
    take: 200,
  });

  const blocked = new Set<string>();
  const byKind = new Map<
    string,
    { count: number; reasons: Record<string, number>; examples: Array<{ title: string; reason: string | null; note: string | null }> }
  >();

  for (const row of dismissed) {
    blocked.add(row.dedupeKey);

    const entry = byKind.get(row.kind) ?? {
      count: 0,
      reasons: {},
      examples: [],
    };
    entry.count += 1;
    const reasonKey = row.dismissReason ?? "UNSPECIFIED";
    entry.reasons[reasonKey] = (entry.reasons[reasonKey] ?? 0) + 1;
    if (entry.examples.length < 3) {
      entry.examples.push({
        title: row.title,
        reason: row.dismissReason,
        note: row.dismissNote,
      });
    }
    byKind.set(row.kind, entry);
  }

  return {
    blockedDedupeKeys: blocked,
    dismissalSummary: Array.from(byKind.entries()).map(([kind, data]) => ({
      kind,
      count: data.count,
      reasons: data.reasons,
      examples: data.examples,
    })),
  };
}
