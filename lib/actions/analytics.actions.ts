"use server";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

const STARTING_CAPITAL = 100_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EquityPoint {
  date: string; // "MM-DD"
  value: number;
}

export interface DirectionBreakdown {
  direction: string;
  wins: number;
  losses: number;
}

export interface DurationBreakdown {
  duration: string;
  avgReturn: number;
}

export interface SectorBreakdown {
  sector: string;
  return: number;
}

export interface ConfidencePoint {
  ticker: string;
  confidence: number;
  return: number;
}

export interface GraduationData {
  currentWinRate: number;
  winRateTarget: number;
  currentClosedTrades: number;
  closedTradesRequired: number;
}

export interface AnalyticsStats {
  totalReturn: number;
  totalReturnPct: number;
  winRate: number;
  avgReturnPerTrade: number;
  openTrades: number;
  closedTrades: number;
  totalTrades: number;
  graduation: GraduationData;
}

export interface AnalystStat {
  analystId: string;
  name: string;
  wins: number;
  losses: number;
  trades: number;
  winRate: number;
  totalPnl: number;
}

export interface ResearchRunSummary {
  id: string;
  startedAt: Date;
  analystName: string;
  thesesCount: number;
  tradesPlaced: number;
  closedTrades: number;
  pnl: number;
  wins: number;
  losses: number;
}

export interface AnalyticsData {
  equityCurve: EquityPoint[];
  directionBreakdown: DirectionBreakdown[];
  durationBreakdown: DurationBreakdown[];
  sectorBreakdown: SectorBreakdown[];
  confidenceScatter: ConfidencePoint[];
  stats: AnalyticsStats;
  analystBreakdown: AnalystStat[];
  recentRuns: ResearchRunSummary[];
}

// ─── Helper: equity curve ─────────────────────────────────────────────────────

function buildEquityCurve(
  closedTrades: Array<{ closedAt: Date | null; realizedPnl: number | null }>,
  days = 30
): EquityPoint[] {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const byDay = new Map<string, number>();

  for (const t of closedTrades) {
    if (!t.closedAt || !t.realizedPnl) continue;
    if (t.closedAt < cutoff) continue;
    const day = t.closedAt.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + t.realizedPnl);
  }

  let balance = STARTING_CAPITAL;
  const points: EquityPoint[] = [];
  for (let d = days - 1; d >= 0; d--) {
    const date = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
    const iso = date.toISOString().slice(0, 10);
    balance += byDay.get(iso) ?? 0;
    points.push({ date: iso.slice(5), value: balance });
  }
  return points;
}

// ─── Main loader ──────────────────────────────────────────────────────────────

export async function getAnalyticsData(): Promise<AnalyticsData> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const userId = user?.id;

  // ── Fetch trades, open count, agent config, and recent runs ──────────────
  const [closedTrades, openCount, agentConfig, completedRuns] = await Promise.all([
    userId
      ? prisma.trade.findMany({
          where: { userId, status: "CLOSED" },
          select: {
            direction: true,
            outcome: true,
            realizedPnl: true,
            closedAt: true,
            entryPrice: true,
            shares: true,
            thesis: {
              select: {
                confidenceScore: true,
                sector: true,
                holdDuration: true,
                ticker: true,
                researchRun: {
                  select: {
                    agentConfigId: true,
                    agentConfig: { select: { name: true } },
                  },
                },
              },
            },
          },
          orderBy: { closedAt: "asc" },
        })
      : Promise.resolve([]),
    userId
      ? prisma.trade.count({ where: { userId, status: "OPEN" } })
      : Promise.resolve(0),
    userId
      ? prisma.agentConfig.findFirst({ where: { userId } })
      : Promise.resolve(null),
    userId
      ? prisma.researchRun.findMany({
          where: { userId, status: "COMPLETE" },
          orderBy: { startedAt: "desc" },
          take: 20,
          select: {
            id: true,
            startedAt: true,
            source: true,
            agentConfig: { select: { name: true } },
            theses: {
              select: {
                trade: {
                  select: { outcome: true, realizedPnl: true, status: true },
                },
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  // ── Equity curve ──────────────────────────────────────────────────────────

  const equityCurve = buildEquityCurve(closedTrades);

  // ── P&L stats ─────────────────────────────────────────────────────────────

  const totalReturn = closedTrades.reduce((s, t) => s + (t.realizedPnl ?? 0), 0);
  const totalReturnPct = (totalReturn / STARTING_CAPITAL) * 100;

  const tradesWithOutcome = closedTrades.filter((t) => t.outcome);
  const wins = tradesWithOutcome.filter((t) => t.outcome === "WIN");
  const winRate = tradesWithOutcome.length > 0 ? (wins.length / tradesWithOutcome.length) * 100 : 0;

  const avgReturnPerTrade =
    closedTrades.length > 0
      ? closedTrades.reduce((s, t) => {
          const cost = t.entryPrice * t.shares;
          return s + (cost > 0 ? ((t.realizedPnl ?? 0) / cost) * 100 : 0);
        }, 0) / closedTrades.length
      : 0;

  // ── Direction breakdown ───────────────────────────────────────────────────

  const dirMap = new Map<string, { wins: number; losses: number }>();
  for (const t of tradesWithOutcome) {
    const key = t.direction;
    const entry = dirMap.get(key) ?? { wins: 0, losses: 0 };
    if (t.outcome === "WIN") entry.wins++;
    else entry.losses++;
    dirMap.set(key, entry);
  }
  const directionBreakdown: DirectionBreakdown[] = ["LONG", "SHORT"]
    .map((d) => ({ direction: d, ...(dirMap.get(d) ?? { wins: 0, losses: 0 }) }));

  // ── Hold duration breakdown ───────────────────────────────────────────────

  const durMap = new Map<string, number[]>();
  for (const t of closedTrades) {
    const dur = t.thesis?.holdDuration ?? "SWING";
    const cost = t.entryPrice * t.shares;
    const ret = cost > 0 ? ((t.realizedPnl ?? 0) / cost) * 100 : 0;
    const arr = durMap.get(dur) ?? [];
    arr.push(ret);
    durMap.set(dur, arr);
  }
  const durationBreakdown: DurationBreakdown[] = Array.from(durMap.entries()).map(([duration, rets]) => ({
    duration,
    avgReturn: rets.reduce((s, r) => s + r, 0) / rets.length,
  }));

  // ── Sector breakdown ──────────────────────────────────────────────────────

  const secMap = new Map<string, number[]>();
  for (const t of closedTrades) {
    const sec = t.thesis?.sector ?? "Unknown";
    const cost = t.entryPrice * t.shares;
    const ret = cost > 0 ? ((t.realizedPnl ?? 0) / cost) * 100 : 0;
    const arr = secMap.get(sec) ?? [];
    arr.push(ret);
    secMap.set(sec, arr);
  }
  const sectorBreakdown: SectorBreakdown[] = Array.from(secMap.entries())
    .map(([sector, rets]) => ({
      sector,
      return: rets.reduce((s, r) => s + r, 0) / rets.length,
    }))
    .sort((a, b) => b.return - a.return);

  // ── Confidence scatter ────────────────────────────────────────────────────

  const confidenceScatter: ConfidencePoint[] = closedTrades
    .filter((t) => t.thesis?.confidenceScore != null)
    .map((t) => {
      const cost = t.entryPrice * t.shares;
      const ret = cost > 0 ? ((t.realizedPnl ?? 0) / cost) * 100 : 0;
      return {
        ticker: t.thesis!.ticker,
        confidence: t.thesis!.confidenceScore,
        return: ret,
      };
    });

  // ── Graduation progress ───────────────────────────────────────────────────

  const winRateTarget = (agentConfig?.graduationWinRate ?? 0.65) * 100;
  const closedTradesRequired = agentConfig?.graduationMinTrades ?? 50;

  const stats: AnalyticsStats = {
    totalReturn,
    totalReturnPct,
    winRate,
    avgReturnPerTrade,
    openTrades: openCount,
    closedTrades: closedTrades.length,
    totalTrades: openCount + closedTrades.length,
    graduation: {
      currentWinRate: winRate,
      winRateTarget,
      currentClosedTrades: closedTrades.length,
      closedTradesRequired,
    },
  };

  // ── Per-analyst breakdown ─────────────────────────────────────────────────

  interface AnalystAccum { name: string; wins: number; losses: number; totalPnl: number; }
  const analystMap = new Map<string, AnalystAccum>();

  for (const t of tradesWithOutcome) {
    const runConfig = (t.thesis as { researchRun?: { agentConfigId: string | null; agentConfig: { name: string } | null } } | undefined)?.researchRun;
    const analystId = runConfig?.agentConfigId ?? "__unassigned__";
    const analystName = runConfig?.agentConfig?.name ?? "Unassigned";
    const acc = analystMap.get(analystId) ?? { name: analystName, wins: 0, losses: 0, totalPnl: 0 };
    if (t.outcome === "WIN") acc.wins++;
    else if (t.outcome === "LOSS") acc.losses++;
    acc.totalPnl += t.realizedPnl ?? 0;
    analystMap.set(analystId, acc);
  }

  const analystBreakdown: AnalystStat[] = Array.from(analystMap.entries())
    .map(([analystId, acc]) => ({
      analystId,
      name: acc.name,
      wins: acc.wins,
      losses: acc.losses,
      trades: acc.wins + acc.losses,
      winRate: acc.wins + acc.losses > 0 ? (acc.wins / (acc.wins + acc.losses)) * 100 : 0,
      totalPnl: acc.totalPnl,
    }))
    .sort((a, b) => b.trades - a.trades);

  // ── Research run summaries ────────────────────────────────────────────────

  const recentRuns: ResearchRunSummary[] = completedRuns.map((run) => {
    const allTrades = run.theses.flatMap((th) => (th.trade ? [th.trade] : []));
    const closed = allTrades.filter((tr) => tr.status === "CLOSED");
    const runWins = closed.filter((tr) => tr.outcome === "WIN").length;
    const runLosses = closed.filter((tr) => tr.outcome === "LOSS").length;
    const pnl = closed.reduce((s, tr) => s + (tr.realizedPnl ?? 0), 0);
    return {
      id: run.id,
      startedAt: run.startedAt,
      analystName: run.agentConfig?.name ?? (run.source === "MANUAL" ? "Manual" : "Agent"),
      thesesCount: run.theses.length,
      tradesPlaced: allTrades.length,
      closedTrades: closed.length,
      pnl,
      wins: runWins,
      losses: runLosses,
    };
  });

  return {
    equityCurve,
    directionBreakdown,
    durationBreakdown,
    sectorBreakdown,
    confidenceScatter,
    stats,
    analystBreakdown,
    recentRuns,
  };
}
