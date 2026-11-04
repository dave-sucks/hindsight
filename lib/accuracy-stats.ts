/**
 * Pure utility for computing accuracy / calibration stats.
 * No "use server" directive — safe to import from Inngest functions,
 * API routes, or anywhere on the server.
 */

import { prisma } from "@/lib/prisma";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CalibrationBucket = {
  label: string;           // the conviction tier: Low, Medium, High, Strong
  count: number;
  winRate: number | null;  // null when no trades in bucket
};

export type SignalAccuracy = {
  signal: string;
  count: number;
  winRate: number | null;
};

export type DirectionStats = {
  direction: "LONG" | "SHORT";
  count: number;
  winRate: number | null;
};

export type ShadowStats = {
  totalPasses: number;
  goodPasses: number;       // price moved against the would-be trade (pass was correct)
  badPasses: number;        // price moved in favor (missed opportunity)
  passAccuracy: number | null;  // goodPasses / totalPasses
  avgMissedGain: number;    // avg $ missed on bad passes
  avgAvoidedLoss: number;   // avg $ avoided on good passes
};

export type AccuracyStats = {
  tradesAnalyzed: number;
  overallWinRate: number | null;
  calibration: CalibrationBucket[];
  signalAccuracy: SignalAccuracy[];
  directionStats: DirectionStats[];
  longestWinStreak: number;
  longestLossStreak: number;
  shadowStats: ShadowStats | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Win rate by the analyst's conviction tier on the thesis the trade came from. */
const CONVICTION_TIERS: Array<{ label: string; tier: string }> = [
  { label: "Low", tier: "LOW" },
  { label: "Medium", tier: "MEDIUM" },
  { label: "High", tier: "HIGH" },
  { label: "Strong", tier: "STRONG" },
];

function winRateFrom(wins: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((wins / total) * 1000) / 1000; // 3 dp
}

function streaks(outcomes: string[]): { win: number; loss: number } {
  let maxWin = 0, maxLoss = 0, curWin = 0, curLoss = 0;
  for (const o of outcomes) {
    if (o === "WIN") {
      curWin++;
      curLoss = 0;
      maxWin = Math.max(maxWin, curWin);
    } else if (o === "LOSS") {
      curLoss++;
      curWin = 0;
      maxLoss = Math.max(maxLoss, curLoss);
    } else {
      curWin = 0;
      curLoss = 0;
    }
  }
  return { win: maxWin, loss: maxLoss };
}

// ─── Main function ───────────────────────────────────────────────────────────

/**
 * Compute calibration + signal accuracy for all closed positions for a user.
 * Optionally scope to a date range (e.g. last 30 days).
 */
export async function getAccuracyStats(
  userId: string,
  since?: Date
): Promise<AccuracyStats> {
  const positions = await prisma.position.findMany({
    where: {
      userId,
      status: "CLOSED",
      outcome: { in: ["WIN", "LOSS", "BREAKEVEN"] },
      ...(since ? { closedAt: { gte: since } } : {}),
    },
    include: {
      decisions: {
        take: 1,
        include: {
          thesis: {
            // The signal-type rollup below joins through
            // sourceSignalIds → Signal.aggregateType.
            select: { conviction: true, sourceSignalIds: true },
          },
        },
      },
    },
    orderBy: { closedAt: "asc" },
  });

  const n = positions.length;
  if (n === 0) {
    return {
      tradesAnalyzed: 0,
      overallWinRate: null,
      calibration: CONVICTION_TIERS.map((b) => ({ label: b.label, count: 0, winRate: null })),
      signalAccuracy: [],
      directionStats: [],
      longestWinStreak: 0,
      longestLossStreak: 0,
      shadowStats: null,
    };
  }

  // Helper to get thesis from position via TradeDecision
  const getThesis = (p: (typeof positions)[number]) => p.decisions[0]?.thesis;

  // ── Overall win rate ──────────────────────────────────────────────────────
  const wins = positions.filter((p) => p.outcome === "WIN").length;
  const overallWinRate = winRateFrom(wins, n);

  // ── Win rate by conviction tier ───────────────────────────────────────────
  const calibration: CalibrationBucket[] = CONVICTION_TIERS.map((b) => {
    const inBucket = positions.filter((p) => getThesis(p)?.conviction === b.tier);
    const bucketWins = inBucket.filter((p) => p.outcome === "WIN").length;
    return { label: b.label, count: inBucket.length, winRate: winRateFrom(bucketWins, inBucket.length) };
  });

  // ── Signal-type accuracy ──────────────────────────────────────────────────
  // PR-9 rebuild: the rollup joins through `Thesis.sourceSignalIds[]` →
  // `Signal[].aggregateType`. Each closed Position whose thesis cited a
  // routed signal contributes the signal's aggregateType into the bucket.
  // Theses without source signals (WEB_SEARCH / WATCHLIST_REVIEW provenance)
  // don't contribute.
  const allSignalIds = new Set<string>();
  for (const p of positions) {
    const ids = getThesis(p)?.sourceSignalIds ?? [];
    for (const id of ids) allSignalIds.add(id);
  }
  const signalAggMap = new Map<string, string>(); // signalId → aggregateType
  if (allSignalIds.size > 0) {
    const signalRows = await prisma.signal.findMany({
      where: { id: { in: Array.from(allSignalIds) } },
      select: { id: true, aggregateType: true },
    });
    for (const s of signalRows) {
      if (s.aggregateType) signalAggMap.set(s.id, s.aggregateType);
    }
  }
  const signalMap = new Map<string, { wins: number; total: number }>();
  for (const pos of positions) {
    const ids = getThesis(pos)?.sourceSignalIds ?? [];
    // De-dup aggregateTypes per thesis — a thesis citing 3 EARNINGS_BEAT
    // signals should only contribute once to that bucket.
    const aggTypes = new Set<string>();
    for (const id of ids) {
      const agg = signalAggMap.get(id);
      if (agg) aggTypes.add(agg);
    }
    for (const agg of aggTypes) {
      const entry = signalMap.get(agg) ?? { wins: 0, total: 0 };
      entry.total++;
      if (pos.outcome === "WIN") entry.wins++;
      signalMap.set(agg, entry);
    }
  }
  const signalAccuracy: SignalAccuracy[] = Array.from(signalMap.entries())
    .map(([signal, { wins: w, total }]) => ({
      signal,
      count: total,
      winRate: winRateFrom(w, total),
    }))
    .sort((a, b) => b.count - a.count);

  // ── Direction stats ───────────────────────────────────────────────────────
  const directionStats: DirectionStats[] = (["LONG", "SHORT"] as const).map((dir) => {
    const group = positions.filter((p) => p.direction === dir);
    const groupWins = group.filter((p) => p.outcome === "WIN").length;
    return {
      direction: dir,
      count: group.length,
      winRate: winRateFrom(groupWins, group.length),
    };
  });

  // ── Streaks ───────────────────────────────────────────────────────────────
  const { win: longestWinStreak, loss: longestLossStreak } = streaks(
    positions.map((p) => p.outcome ?? "")
  );

  // ── Shadow / pass accuracy (from PASS decisions) ──────────────────────────
  // PASS decisions don't create positions — shadow stats are no longer tracked
  // in the new Position/Order schema. Return null until a separate pass-tracking
  // mechanism is built.
  const shadowStats: ShadowStats | null = null;

  return {
    tradesAnalyzed: n,
    overallWinRate,
    calibration,
    signalAccuracy,
    directionStats,
    longestWinStreak,
    longestLossStreak,
    shadowStats,
  };
}
