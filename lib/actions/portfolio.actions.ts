"use server";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getLatestPrices } from "@/lib/alpaca";
import type { MockTrade, TradeStatus } from "@/lib/mock-data/trades";

// ─── Constants ────────────────────────────────────────────────────────────────

const STARTING_CAPITAL = 100_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PortfolioStats {
  totalValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  winRate: number | null; // 0–1 or null if no closed positions
  openCount: number;
}

export interface AgentConfigSummary {
  id: string;
  name: string;
  enabled: boolean;
  scheduleTime: string;
  lastRunAt: string | null; // ISO string
  tradesPlaced: number;
}

export interface RecentRunSummary {
  id: string;
  agentName: string | null;
  startedAt: string; // ISO string
  completedAt: string | null;
  thesisCount: number;
  tradesPlaced: number;
  status: string;
}

export interface TodaysPick {
  id: string;
  ticker: string;
  direction: string;
  confidenceScore: number;
  signalTypes: string[];
}

export interface RecentPick {
  id: string;
  ticker: string;
  direction: string;
  confidenceScore: number;
  signalTypes: string[];
  reasoningSummary: string;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  createdAt: string; // ISO
  trade: {
    id: string;
    status: string;
    entryPrice: number;
    openedAt: string; // ISO
  } | null;
  currentPrice: number | null;
  analystName: string | null;
  sourcesUsed: unknown;
}

export interface DashboardData {
  openTrades: MockTrade[];
  closedTrades: MockTrade[];
  portfolio: PortfolioStats;
  equityCurve: { date: string; value: number }[];
  agentConfigs: AgentConfigSummary[];
  recentRuns: RecentRunSummary[];
  todaysPicks: TodaysPick[];
  recentPicks: RecentPick[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapStatus(status: string, outcome: string | null): TradeStatus {
  if (status === "OPEN") return "OPEN";
  if (outcome === "WIN") return "CLOSED_WIN";
  if (outcome === "LOSS") return "CLOSED_LOSS";
  return "CLOSED_EXPIRED";
}

function calcPnl(
  direction: string,
  entryPrice: number,
  currentPrice: number,
  shares: number
): { dollars: number; pct: number } {
  const dollars =
    direction === "LONG"
      ? (currentPrice - entryPrice) * shares
      : (entryPrice - currentPrice) * shares;
  const pct =
    direction === "LONG"
      ? ((currentPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - currentPrice) / entryPrice) * 100;
  return { dollars, pct };
}

function buildEquityCurve(
  closedPositions: Array<{ closedAt: Date | null; realizedPnl: number | null }>,
  startCapital: number,
  currentTotalValue: number,
  days = 365
): { date: string; value: number }[] {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const byDay = new Map<string, number>();
  for (const pos of closedPositions) {
    if (!pos.closedAt || !pos.realizedPnl) continue;
    if (pos.closedAt < cutoff) continue;
    const day = pos.closedAt.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + pos.realizedPnl);
  }

  let balance = startCapital;
  const points: { date: string; value: number }[] = [];

  for (let d = days - 1; d >= 0; d--) {
    const date = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
    const iso = date.toISOString().slice(0, 10);
    balance += byDay.get(iso) ?? 0;
    points.push({ date: iso, value: balance });
  }

  if (points.length > 0) {
    points[points.length - 1] = {
      ...points[points.length - 1],
      value: currentTotalValue,
    };
  }

  return points;
}

// ─── Main data loader ─────────────────────────────────────────────────────────

export async function getDashboardData(): Promise<DashboardData> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const emptyPortfolio: PortfolioStats = {
    totalValue: STARTING_CAPITAL,
    unrealizedPnl: 0,
    realizedPnl: 0,
    winRate: null,
    openCount: 0,
  };

  if (!user) {
    return {
      openTrades: [],
      closedTrades: [],
      portfolio: emptyPortfolio,
      equityCurve: [],
      agentConfigs: [],
      recentRuns: [],
      todaysPicks: [],
      recentPicks: [],
    };
  }

  const userId = user.id;

  // ── 1. Fetch positions from DB ──────────────────────────────────────────────
  const [dbOpenPositions, dbClosedPositions] = await Promise.all([
    prisma.position.findMany({
      where: { userId, status: "OPEN" },
      include: {
        analyst: { select: { name: true } },
      },
      orderBy: { openedAt: "desc" },
    }),
    prisma.position.findMany({
      where: { userId, status: "CLOSED" },
      include: {
        analyst: { select: { name: true } },
      },
      orderBy: { closedAt: "desc" },
      take: 50,
    }),
  ]);

  // ── 2. Fetch recent picks (last 20 actionable theses) ────────────────────
  const dbRecentPicks = await prisma.thesis.findMany({
    where: {
      userId,
      direction: { in: ["LONG", "SHORT"] },
      createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      ticker: true,
      direction: true,
      confidenceScore: true,
      signalTypes: true,
      reasoningSummary: true,
      entryPrice: true,
      targetPrice: true,
      stopLoss: true,
      createdAt: true,
      sourcesUsed: true,
      researchRun: {
        select: { agentConfig: { select: { name: true } } },
      },
      // Check if there's a trade decision with a position for this thesis
      decisions: {
        where: { decision: "BUY" },
        take: 1,
        select: {
          position: {
            select: {
              id: true,
              status: true,
              avgCost: true,
              openedAt: true,
            },
          },
        },
      },
    },
  });

  // ── 3. Batch-fetch current prices ───────────────────────────────────────────
  const openTickers = [...new Set(dbOpenPositions.map((p) => p.symbol))];
  const pickTickers = [...new Set(dbRecentPicks.map((p) => p.ticker))];
  const allTickers = [...new Set([...openTickers, ...pickTickers])];
  let priceMap: Record<string, number> = {};
  if (allTickers.length > 0) {
    try {
      priceMap = await getLatestPrices(allTickers);
    } catch {
      // Fall back to entry price
    }
  }

  // ── 4. Map open positions → MockTrade shape ────────────────────────────────
  const openTrades: MockTrade[] = dbOpenPositions.map((p) => {
    const currentPrice = priceMap[p.symbol] ?? p.avgCost;
    const { dollars, pct } = calcPnl(p.direction, p.avgCost, currentPrice, p.quantity);
    return {
      id: p.id,
      ticker: p.symbol,
      direction: p.direction as "LONG" | "SHORT",
      entryPrice: p.avgCost,
      currentPrice,
      targetPrice: p.targetPrice ?? p.avgCost * 1.1,
      stopPrice: p.stopLoss ?? p.avgCost * 0.9,
      confidenceScore: 0, // TODO: join via TradeDecision → Thesis
      status: "OPEN" as const,
      pnl: dollars,
      pnlPct: pct,
      openedAt: p.openedAt.toISOString(),
      closedAt: undefined,
      thesis: "",
      shares: p.quantity,
      analystName: p.analyst?.name ?? undefined,
    };
  });

  // ── 5. Map closed positions → MockTrade shape ──────────────────────────────
  const closedTrades: MockTrade[] = dbClosedPositions.map((p) => {
    const closePrice = p.closePrice ?? p.avgCost;
    const positionCost = p.avgCost * p.quantity;
    const realizedPnl = p.realizedPnl ?? 0;
    return {
      id: p.id,
      ticker: p.symbol,
      direction: p.direction as "LONG" | "SHORT",
      entryPrice: p.avgCost,
      currentPrice: closePrice,
      targetPrice: p.targetPrice ?? p.avgCost * 1.1,
      stopPrice: p.stopLoss ?? p.avgCost * 0.9,
      confidenceScore: 0,
      status: mapStatus(p.status, p.outcome),
      pnl: realizedPnl,
      pnlPct: positionCost > 0 ? (realizedPnl / positionCost) * 100 : 0,
      openedAt: p.openedAt.toISOString(),
      closedAt: p.closedAt?.toISOString(),
      thesis: "",
      shares: p.quantity,
      analystName: p.analyst?.name ?? undefined,
    };
  });

  // ── 6. Portfolio stats ─────────────────────────────────────────────────────
  const realizedPnl = dbClosedPositions.reduce((sum, p) => sum + (p.realizedPnl ?? 0), 0);
  const unrealizedPnl = openTrades.reduce((sum, t) => sum + t.pnl, 0);
  const totalValue = STARTING_CAPITAL + realizedPnl + unrealizedPnl;

  const closedWithOutcome = dbClosedPositions.filter((p) => p.outcome);
  const winRate =
    closedWithOutcome.length > 0
      ? closedWithOutcome.filter((p) => p.outcome === "WIN").length /
        closedWithOutcome.length
      : null;

  // ── 7. Equity curve ────────────────────────────────────────────────────────
  const equityCurve = buildEquityCurve(dbClosedPositions, STARTING_CAPITAL, totalValue);

  // ── 8. Agent configs with last-run info ────────────────────────────────────
  const [dbAgentConfigs, positionsWithAnalyst] = await Promise.all([
    prisma.agentConfig.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      include: {
        researchRuns: {
          orderBy: { startedAt: "desc" },
          take: 1,
          select: { startedAt: true },
        },
      },
    }),
    prisma.position.findMany({
      where: { userId },
      select: {
        id: true,
        analystId: true,
      },
    }),
  ]);

  const tradeCountMap = new Map<string, number>();
  for (const pos of positionsWithAnalyst) {
    tradeCountMap.set(pos.analystId, (tradeCountMap.get(pos.analystId) ?? 0) + 1);
  }

  const agentConfigs: AgentConfigSummary[] = dbAgentConfigs.map((a) => ({
    id: a.id,
    name: a.name,
    enabled: a.enabled,
    scheduleTime: a.scheduleTime,
    lastRunAt: a.researchRuns[0]?.startedAt.toISOString() ?? null,
    tradesPlaced: tradeCountMap.get(a.id) ?? 0,
  }));

  // ── 9. Recent research runs (last 10) ──────────────────────────────────────
  const dbRecentRuns = await prisma.researchRun.findMany({
    where: { userId },
    orderBy: { startedAt: "desc" },
    take: 10,
    include: {
      agentConfig: { select: { name: true } },
      theses: { select: { id: true } },
      decisions: {
        where: { decision: "BUY" },
        select: { id: true },
      },
    },
  });

  const recentRuns: RecentRunSummary[] = dbRecentRuns.map((r) => ({
    id: r.id,
    agentName: r.agentConfig?.name ?? null,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    thesisCount: r.theses.length,
    tradesPlaced: r.decisions.length,
    status: r.status,
  }));

  // ── 10. Today's picks ──────────────────────────────────────────────────────
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  const dbTodaysPicks = await prisma.thesis.findMany({
    where: {
      userId,
      createdAt: { gte: todayMidnight },
      direction: { in: ["LONG", "SHORT"] },
    },
    orderBy: { confidenceScore: "desc" },
    take: 5,
    select: {
      id: true,
      ticker: true,
      direction: true,
      confidenceScore: true,
      signalTypes: true,
    },
  });

  const todaysPicks: TodaysPick[] = dbTodaysPicks.map((t) => ({
    id: t.id,
    ticker: t.ticker,
    direction: t.direction,
    confidenceScore: t.confidenceScore,
    signalTypes: t.signalTypes,
  }));

  // ── 11. Map recentPicks ────────────────────────────────────────────────────
  const recentPicks: RecentPick[] = dbRecentPicks.map((p) => {
    const decision = p.decisions[0];
    const position = decision?.position;
    return {
      id: p.id,
      ticker: p.ticker,
      direction: p.direction,
      confidenceScore: p.confidenceScore,
      signalTypes: p.signalTypes,
      reasoningSummary: p.reasoningSummary,
      entryPrice: p.entryPrice,
      targetPrice: p.targetPrice,
      stopLoss: p.stopLoss,
      createdAt: p.createdAt.toISOString(),
      trade: position
        ? {
            id: position.id,
            status: position.status,
            entryPrice: position.avgCost,
            openedAt: position.openedAt.toISOString(),
          }
        : null,
      currentPrice: priceMap[p.ticker] ?? null,
      analystName: p.researchRun?.agentConfig?.name ?? null,
      sourcesUsed: p.sourcesUsed,
    };
  });

  return {
    openTrades,
    closedTrades,
    portfolio: {
      totalValue,
      unrealizedPnl,
      realizedPnl,
      winRate,
      openCount: openTrades.length,
    },
    equityCurve,
    agentConfigs,
    recentRuns,
    todaysPicks,
    recentPicks,
  };
}
