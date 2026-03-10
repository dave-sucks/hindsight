"use server";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface AnalystConfig {
  id: string;
  userId: string;
  name: string;
  enabled: boolean;
  analystPrompt: string | null;
  description: string | null;
  sectors: string[];
  signalTypes: string[];
  holdDurations: string[];
  directionBias: string;
  minConfidence: number;
  maxOpenPositions: number;
  maxPositionSize: number;
  maxRiskPct: number | null;
  scheduleTime: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnalystListItem {
  id: string;
  name: string;
  enabled: boolean;
  analystPrompt: string | null;
  description: string | null;
  sectors: string[];
  signalTypes: string[];
  holdDurations: string[];
  directionBias: string;
  minConfidence: number;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
  tradeCount: number;
  winRate: number | null;
  totalPnl: number;
}

export interface RunWithTheses {
  id: string;
  status: string;
  source: string;
  startedAt: Date;
  completedAt: Date | null;
  theses: {
    id: string;
    ticker: string;
    direction: string;
    confidenceScore: number;
    reasoningSummary: string;
    holdDuration: string;
    signalTypes: string[];
    sourcesUsed: unknown;
    trade: {
      id: string;
      status: string;
      realizedPnl: number | null;
      outcome: string | null;
    } | null;
  }[];
}

export interface TradeWithThesis {
  id: string;
  ticker: string;
  direction: string;
  status: string;
  entryPrice: number;
  closePrice: number | null;
  realizedPnl: number | null;
  outcome: string | null;
  openedAt: Date;
  closedAt: Date | null;
  thesis: {
    id: string;
    confidenceScore: number;
    reasoningSummary: string;
  };
}

export interface AnalystStats {
  totalRuns: number;
  totalTheses: number;
  totalTrades: number;
  winRate: number | null;
  totalPnl: number;
}

export interface AnalystDetail {
  config: AnalystConfig;
  recentRuns: RunWithTheses[];
  recentTrades: TradeWithThesis[];
  stats: AnalystStats;
}

export interface DashboardRun {
  id: string;
  analystId: string | null;
  analystName: string | null;
  source: string;
  startedAt: Date;
  completedAt: Date | null;
  theses: {
    ticker: string;
    direction: string;
    confidenceScore: number;
    trade: { id: string; status: string; realizedPnl: number | null } | null;
  }[];
}

// ── Helper ────────────────────────────────────────────────────────────────────

async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// ── getAnalystList ────────────────────────────────────────────────────────────

export async function getAnalystList(): Promise<AnalystListItem[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const configs = await prisma.agentConfig.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });

  if (configs.length === 0) return [];

  // Load all runs and trades for this user, group in JS
  const [allRuns, allTrades] = await Promise.all([
    prisma.researchRun.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        agentConfigId: true,
        status: true,
        startedAt: true,
      },
    }),
    prisma.trade.findMany({
      where: { userId },
      select: {
        id: true,
        outcome: true,
        realizedPnl: true,
        thesis: {
          select: {
            researchRun: {
              select: { agentConfigId: true },
            },
          },
        },
      },
    }),
  ]);

  return configs.map((config) => {
    const configRuns = allRuns.filter((r) => r.agentConfigId === config.id);
    const lastRun = configRuns[0] ?? null;

    const configTrades = allTrades.filter(
      (t) => t.thesis?.researchRun?.agentConfigId === config.id
    );

    const closedTrades = configTrades.filter((t) => t.outcome != null);
    const wins = closedTrades.filter((t) => t.outcome === "WIN").length;
    const winRate = closedTrades.length > 0 ? wins / closedTrades.length : null;
    const totalPnl = closedTrades.reduce(
      (sum, t) => sum + (t.realizedPnl ?? 0),
      0
    );

    return {
      id: config.id,
      name: config.name,
      enabled: config.enabled,
      analystPrompt: config.analystPrompt,
      description: config.description,
      sectors: config.sectors,
      signalTypes: config.signalTypes,
      holdDurations: config.holdDurations,
      directionBias: config.directionBias,
      minConfidence: config.minConfidence,
      lastRunAt: lastRun?.startedAt ?? null,
      lastRunStatus: lastRun?.status ?? null,
      tradeCount: configTrades.length,
      winRate,
      totalPnl,
    };
  });
}

// ── getAnalystDetail ──────────────────────────────────────────────────────────

export async function getAnalystDetail(
  analystId: string
): Promise<AnalystDetail | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const config = await prisma.agentConfig.findFirst({
    where: { id: analystId, userId },
  });
  if (!config) return null;

  const [recentRuns, recentTrades, totalRuns, totalTheses] = await Promise.all([
    // Last 20 runs with their theses
    prisma.researchRun.findMany({
      where: { agentConfigId: analystId, userId },
      orderBy: { startedAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        source: true,
        startedAt: true,
        completedAt: true,
        theses: {
          select: {
            id: true,
            ticker: true,
            direction: true,
            confidenceScore: true,
            reasoningSummary: true,
            holdDuration: true,
            signalTypes: true,
            sourcesUsed: true,
            trade: {
              select: {
                id: true,
                status: true,
                realizedPnl: true,
                outcome: true,
              },
            },
          },
          orderBy: { confidenceScore: "desc" },
        },
      },
    }),
    // Last 20 trades attributed to this analyst
    prisma.trade.findMany({
      where: {
        userId,
        thesis: { researchRun: { agentConfigId: analystId } },
      },
      orderBy: { openedAt: "desc" },
      take: 20,
      select: {
        id: true,
        ticker: true,
        direction: true,
        status: true,
        entryPrice: true,
        closePrice: true,
        realizedPnl: true,
        outcome: true,
        openedAt: true,
        closedAt: true,
        thesis: {
          select: {
            id: true,
            confidenceScore: true,
            reasoningSummary: true,
          },
        },
      },
    }),
    prisma.researchRun.count({ where: { agentConfigId: analystId, userId } }),
    prisma.thesis.count({
      where: { researchRun: { agentConfigId: analystId }, userId },
    }),
  ]);

  // Compute stats from recentTrades (approximate for display)
  const allTrades = await prisma.trade.findMany({
    where: {
      userId,
      thesis: { researchRun: { agentConfigId: analystId } },
    },
    select: { outcome: true, realizedPnl: true },
  });

  const closedTrades = allTrades.filter((t) => t.outcome != null);
  const wins = closedTrades.filter((t) => t.outcome === "WIN").length;
  const winRate = closedTrades.length > 0 ? wins / closedTrades.length : null;
  const totalPnl = closedTrades.reduce(
    (sum, t) => sum + (t.realizedPnl ?? 0),
    0
  );

  // Map Prisma config (Json fields) → typed AnalystConfig
  const mappedConfig: AnalystConfig = {
    id: config.id,
    userId: config.userId,
    name: config.name,
    enabled: config.enabled,
    analystPrompt: config.analystPrompt,
    description: config.description,
    sectors: config.sectors as string[],
    signalTypes: config.signalTypes as string[],
    holdDurations: config.holdDurations as string[],
    directionBias: config.directionBias,
    minConfidence: config.minConfidence,
    maxOpenPositions: config.maxOpenPositions,
    maxPositionSize: config.maxPositionSize,
    maxRiskPct: config.maxRiskPct,
    scheduleTime: config.scheduleTime,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };

  return {
    config: mappedConfig,
    recentRuns,
    recentTrades,
    stats: {
      totalRuns,
      totalTheses,
      totalTrades: allTrades.length,
      winRate,
      totalPnl,
    },
  };
}

// ── getRecentRunsForDashboard ─────────────────────────────────────────────────

export async function getRecentRunsForDashboard(): Promise<DashboardRun[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const runs = await prisma.researchRun.findMany({
    where: { userId },
    orderBy: { startedAt: "desc" },
    take: 8,
    select: {
      id: true,
      source: true,
      startedAt: true,
      completedAt: true,
      agentConfigId: true,
      agentConfig: { select: { name: true } },
      theses: {
        select: {
          ticker: true,
          direction: true,
          confidenceScore: true,
          trade: {
            select: { id: true, status: true, realizedPnl: true },
          },
        },
        orderBy: { confidenceScore: "desc" },
        take: 8,
      },
    },
  });

  return runs.map((r) => ({
    id: r.id,
    analystId: r.agentConfigId,
    analystName: r.agentConfig?.name ?? null,
    source: r.source,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    theses: r.theses,
  }));
}

// ── createAnalystFromWizard ───────────────────────────────────────────────────

export interface WizardConfig {
  analystPrompt: string;
  name: string;
  holdDurations: ("DAY" | "SWING" | "POSITION")[];
  directionBias: "LONG" | "SHORT" | "BOTH";
  maxPositionSize: number;
  minConfidence: number;
}

export async function createAnalystFromWizard(
  data: WizardConfig
): Promise<{ id: string }> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const analyst = await prisma.agentConfig.create({
    data: {
      userId,
      name: data.name,
      enabled: true,
      analystPrompt: data.analystPrompt,
      markets: ["US_EQUITIES"],
      exchanges: ["NASDAQ", "NYSE"],
      sectors: [],
      watchlist: [],
      exclusionList: [],
      maxPositionSize: data.maxPositionSize,
      maxOpenPositions: 5,
      minConfidence: data.minConfidence,
      maxRiskPct: 2,
      dailyLossLimit: 300,
      holdDurations: data.holdDurations,
      directionBias: data.directionBias,
      signalTypes: [],
      minMarketCapTier: "LARGE",
      scheduleTime: "08:00",
      priceCheckFreq: "HOURLY",
      weekendMode: false,
      graduationWinRate: 0.65,
      graduationMinTrades: 50,
      graduationProfitFactor: 1.5,
      realTradingEnabled: false,
      realMaxPosition: data.maxPositionSize,
      emailAlerts: true,
      weeklyDigestEnabled: true,
    },
  });

  return { id: analyst.id };
}
