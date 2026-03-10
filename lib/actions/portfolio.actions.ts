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
  winRate: number | null; // 0–1 or null if no closed trades
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
  holdDuration: string;
  reasoningSummary: string;
  sourcesUsed?: unknown;
  createdAt?: string;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  currentPrice?: number | null;
  trade: {
    id: string;
    realizedPnl: number | null;
    status: string;
    entryPrice: number;
    closePrice: number | null;
  } | null;
}

export interface DashboardData {
  openTrades: MockTrade[];
  closedTrades: MockTrade[];
  portfolio: PortfolioStats;
  equityCurve: { date: string; value: number }[];
  agentConfigs: AgentConfigSummary[];
  recentRuns: RecentRunSummary[];
  todaysPicks: TodaysPick[];
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
  closedTrades: Array<{ closedAt: Date | null; realizedPnl: number | null }>,
  startCapital: number,
  days = 30
): { date: string; value: number }[] {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Accumulate P&L per calendar day
  const byDay = new Map<string, number>();
  for (const trade of closedTrades) {
    if (!trade.closedAt || !trade.realizedPnl) continue;
    if (trade.closedAt < cutoff) continue;
    const day = trade.closedAt.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + trade.realizedPnl);
  }

  // Build running balance for each day in the window
  let balance = startCapital;
  const points: { date: string; value: number }[] = [];

  for (let d = days - 1; d >= 0; d--) {
    const date = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
    const iso = date.toISOString().slice(0, 10); // "YYYY-MM-DD"
    balance += byDay.get(iso) ?? 0;
    points.push({ date: iso.slice(5), value: balance }); // "MM-DD" for chart x-axis
  }

  return points;
}

// ─── Main data loader ─────────────────────────────────────────────────────────

/**
 * Fetches all trades, agent configs, recent runs, and today's picks for the
 * current user. Returns empty data if the user is not authenticated.
 */
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
    };
  }

  const userId = user.id;

  // ── 1. Fetch trades from DB ────────────────────────────────────────────────
  const [dbOpenTrades, dbClosedTrades] = await Promise.all([
    prisma.trade.findMany({
      where: { userId, status: "OPEN" },
      include: { thesis: { select: { confidenceScore: true } } },
      orderBy: { openedAt: "desc" },
    }),
    prisma.trade.findMany({
      where: { userId, status: "CLOSED" },
      include: { thesis: { select: { confidenceScore: true } } },
      orderBy: { closedAt: "desc" },
      take: 50,
    }),
  ]);

  // ── 2. Batch-fetch current prices for open trades ─────────────────────────
  const openTickers = [...new Set(dbOpenTrades.map((t) => t.ticker))];
  let priceMap: Record<string, number> = {};
  if (openTickers.length > 0) {
    try {
      priceMap = await getLatestPrices(openTickers);
    } catch {
      // Fall back to entry price — pnl will be 0 but trade still renders
    }
  }

  // ── 3. Map open trades → MockTrade shape ──────────────────────────────────
  const openTrades: MockTrade[] = dbOpenTrades.map((t) => {
    const currentPrice = priceMap[t.ticker] ?? t.entryPrice;
    const { dollars, pct } = calcPnl(t.direction, t.entryPrice, currentPrice, t.shares);
    return {
      id: t.id,
      ticker: t.ticker,
      direction: t.direction as "LONG" | "SHORT",
      entryPrice: t.entryPrice,
      currentPrice,
      targetPrice: t.targetPrice ?? t.entryPrice * 1.1,
      stopPrice: t.stopLoss ?? t.entryPrice * 0.9,
      confidenceScore: t.thesis?.confidenceScore ?? 0,
      status: "OPEN" as const,
      pnl: dollars,
      pnlPct: pct,
      openedAt: t.openedAt.toISOString(),
      closedAt: undefined,
      thesis: "",
    };
  });

  // ── 4. Map closed trades → MockTrade shape ────────────────────────────────
  const closedTrades: MockTrade[] = dbClosedTrades.map((t) => {
    const closePrice = t.closePrice ?? t.entryPrice;
    const positionCost = t.entryPrice * t.shares;
    const realizedPnl = t.realizedPnl ?? 0;
    return {
      id: t.id,
      ticker: t.ticker,
      direction: t.direction as "LONG" | "SHORT",
      entryPrice: t.entryPrice,
      currentPrice: closePrice,
      targetPrice: t.targetPrice ?? t.entryPrice * 1.1,
      stopPrice: t.stopLoss ?? t.entryPrice * 0.9,
      confidenceScore: t.thesis?.confidenceScore ?? 0,
      status: mapStatus(t.status, t.outcome),
      pnl: realizedPnl,
      pnlPct: positionCost > 0 ? (realizedPnl / positionCost) * 100 : 0,
      openedAt: t.openedAt.toISOString(),
      closedAt: t.closedAt?.toISOString(),
      thesis: "",
    };
  });

  // ── 5. Portfolio stats ─────────────────────────────────────────────────────
  const realizedPnl = dbClosedTrades.reduce((sum, t) => sum + (t.realizedPnl ?? 0), 0);
  const unrealizedPnl = openTrades.reduce((sum, t) => sum + t.pnl, 0);
  const totalValue = STARTING_CAPITAL + realizedPnl + unrealizedPnl;

  const closedWithOutcome = dbClosedTrades.filter((t) => t.outcome);
  const winRate =
    closedWithOutcome.length > 0
      ? closedWithOutcome.filter((t) => t.outcome === "WIN").length /
        closedWithOutcome.length
      : null;

  // ── 6. Equity curve (last 30 days) ────────────────────────────────────────
  const equityCurve = buildEquityCurve(dbClosedTrades, STARTING_CAPITAL);

  // ── 7. Agent configs with last-run info ───────────────────────────────────
  const [dbAgentConfigs, tradesWithAgent] = await Promise.all([
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
    // Count trades per agent via nested relation filter
    prisma.trade.findMany({
      where: {
        userId,
        thesis: {
          researchRun: { agentConfigId: { not: null } },
        },
      },
      select: {
        id: true,
        thesis: {
          select: {
            researchRun: { select: { agentConfigId: true } },
          },
        },
      },
    }),
  ]);

  const tradeCountMap = new Map<string, number>();
  for (const trade of tradesWithAgent) {
    const agentId = trade.thesis.researchRun.agentConfigId;
    if (agentId) {
      tradeCountMap.set(agentId, (tradeCountMap.get(agentId) ?? 0) + 1);
    }
  }

  const agentConfigs: AgentConfigSummary[] = dbAgentConfigs.map((a) => ({
    id: a.id,
    name: a.name,
    enabled: a.enabled,
    scheduleTime: a.scheduleTime,
    lastRunAt: a.researchRuns[0]?.startedAt.toISOString() ?? null,
    tradesPlaced: tradeCountMap.get(a.id) ?? 0,
  }));

  // ── 8. Recent research runs (last 10) ─────────────────────────────────────
  const dbRecentRuns = await prisma.researchRun.findMany({
    where: { userId },
    orderBy: { startedAt: "desc" },
    take: 10,
    include: {
      agentConfig: { select: { name: true } },
      theses: {
        select: { trade: { select: { id: true } } },
      },
    },
  });

  const recentRuns: RecentRunSummary[] = dbRecentRuns.map((r) => ({
    id: r.id,
    agentName: r.agentConfig?.name ?? null,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    thesisCount: r.theses.length,
    tradesPlaced: r.theses.filter((t) => t.trade).length,
    status: r.status,
  }));

  // ── 9. Recent picks — last 10 theses regardless of day ───────────────────
  const dbTodaysPicks = await prisma.thesis.findMany({
    where: {
      userId,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      ticker: true,
      direction: true,
      confidenceScore: true,
      signalTypes: true,
      holdDuration: true,
      reasoningSummary: true,
      sourcesUsed: true,
      createdAt: true,
      entryPrice: true,
      targetPrice: true,
      stopLoss: true,
      trade: {
        select: {
          id: true,
          realizedPnl: true,
          status: true,
          entryPrice: true,
          closePrice: true,
        },
      },
    },
  });

  // ── 9b. Fetch live prices for pick tickers not already in priceMap ─────────
  const pickOpenTickers = [
    ...new Set(
      dbTodaysPicks
        .filter((t) => t.trade?.status === "OPEN")
        .map((t) => t.ticker)
        .filter((ticker) => !(ticker in priceMap))
    ),
  ];
  if (pickOpenTickers.length > 0) {
    try {
      const extraPrices = await getLatestPrices(pickOpenTickers);
      Object.assign(priceMap, extraPrices);
    } catch {
      // fall back to entry price — delta won't show but card still renders
    }
  }

  const todaysPicks: TodaysPick[] = dbTodaysPicks.map((t) => {
    // currentPrice: live price for open trades, closePrice for closed trades
    let currentPrice: number | null = null;
    if (t.trade?.status === "OPEN") {
      currentPrice = priceMap[t.ticker] ?? null;
    } else if (t.trade?.closePrice != null) {
      currentPrice = t.trade.closePrice;
    }

    return {
      id: t.id,
      ticker: t.ticker,
      direction: t.direction,
      confidenceScore: t.confidenceScore,
      signalTypes: t.signalTypes,
      holdDuration: t.holdDuration,
      reasoningSummary: t.reasoningSummary,
      sourcesUsed: t.sourcesUsed,
      createdAt: t.createdAt.toISOString(),
      entryPrice: t.entryPrice,
      targetPrice: t.targetPrice,
      stopLoss: t.stopLoss,
      currentPrice,
      trade: t.trade
        ? {
            id: t.trade.id,
            realizedPnl: t.trade.realizedPnl,
            status: t.trade.status,
            entryPrice: t.trade.entryPrice,
            closePrice: t.trade.closePrice,
          }
        : null,
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
  };
}
