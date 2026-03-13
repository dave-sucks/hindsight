"use server";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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
  minMarketCapTier: string | null;
  watchlist: string[];
  exclusionList: string[];
  dailyLossLimit: number;
  scheduleTime: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnalystOpenTrade {
  id: string;
  ticker: string;
  direction: string;
  entryPrice: number;
  shares: number;
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
  openTrades: AnalystOpenTrade[];
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
  wins: number;
  losses: number;
  bestWin: number | null;
  worstLoss: number | null;
  avgConfidence: number | null;
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
        ticker: true,
        direction: true,
        status: true,
        entryPrice: true,
        shares: true,
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

    const openTrades: AnalystOpenTrade[] = configTrades
      .filter((t) => t.status === "OPEN")
      .slice(0, 3)
      .map((t) => ({
        id: t.id,
        ticker: t.ticker,
        direction: t.direction,
        entryPrice: t.entryPrice,
        shares: t.shares,
      }));

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
      openTrades,
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

  // Compute stats from all trades
  const [allTrades, avgConfAgg] = await Promise.all([
    prisma.trade.findMany({
      where: {
        userId,
        thesis: { researchRun: { agentConfigId: analystId } },
      },
      select: { outcome: true, realizedPnl: true },
    }),
    prisma.thesis.aggregate({
      where: { researchRun: { agentConfigId: analystId }, userId },
      _avg: { confidenceScore: true },
    }),
  ]);

  const closedTrades = allTrades.filter((t) => t.outcome != null);
  const wins = closedTrades.filter((t) => t.outcome === "WIN").length;
  const losses = closedTrades.filter((t) => t.outcome === "LOSS").length;
  const winRate = closedTrades.length > 0 ? wins / closedTrades.length : null;
  const totalPnl = closedTrades.reduce(
    (sum, t) => sum + (t.realizedPnl ?? 0),
    0
  );
  const winTrades = closedTrades.filter(
    (t) => t.outcome === "WIN" && t.realizedPnl != null
  );
  const lossTrades = closedTrades.filter(
    (t) => t.outcome === "LOSS" && t.realizedPnl != null
  );
  const bestWin =
    winTrades.length > 0
      ? Math.max(...winTrades.map((t) => t.realizedPnl!))
      : null;
  const worstLoss =
    lossTrades.length > 0
      ? Math.min(...lossTrades.map((t) => t.realizedPnl!))
      : null;
  const avgConfidence = avgConfAgg._avg.confidenceScore ?? null;

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
    minMarketCapTier: config.minMarketCapTier,
    watchlist: (config.watchlist as string[]) ?? [],
    exclusionList: (config.exclusionList as string[]) ?? [],
    dailyLossLimit: config.dailyLossLimit,
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
      wins,
      losses,
      bestWin,
      worstLoss,
      avgConfidence,
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

// ── updateAnalystPrompt ───────────────────────────────────────────────────────

export async function updateAnalystPrompt(
  id: string,
  prompt: string
): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  await prisma.agentConfig.update({
    where: { id, userId },
    data: { analystPrompt: prompt },
  });

  revalidatePath(`/analysts/${id}`);
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

// ── createAnalystFromBuilder (AI chat builder — richer config) ──────────────

interface BuilderConfig {
  name: string;
  analystPrompt: string;
  description?: string;
  directionBias: "LONG" | "SHORT" | "BOTH";
  holdDurations: ("DAY" | "SWING" | "POSITION")[];
  sectors: string[];
  signalTypes: string[];
  minConfidence: number;
  maxPositionSize: number;
  maxOpenPositions: number;
  minMarketCapTier: "LARGE" | "MID" | "SMALL";
  watchlist?: string[];
  exclusionList?: string[];
}

export async function createAnalystFromBuilder(
  data: BuilderConfig
): Promise<{ id: string }> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  // Coerce all values to their expected types — AI tool output can be unpredictable
  const name = String(data.name || "Untitled Analyst");
  const prompt = String(data.analystPrompt || "General market research analyst");
  const posSize = Number(data.maxPositionSize) || 5000;
  const maxPos = Math.round(Number(data.maxOpenPositions) || 5);
  const minConf = Math.round(Number(data.minConfidence) || 70);
  const bias = (["LONG", "SHORT", "BOTH"] as const).includes(data.directionBias as "LONG" | "SHORT" | "BOTH")
    ? data.directionBias
    : "BOTH";
  const holdDurs = Array.isArray(data.holdDurations) ? data.holdDurations : ["SWING"];
  const sectors = Array.isArray(data.sectors) ? data.sectors : [];
  const signals = Array.isArray(data.signalTypes) ? data.signalTypes : [];
  const capTier = (["LARGE", "MID", "SMALL"] as const).includes(data.minMarketCapTier as "LARGE" | "MID" | "SMALL")
    ? data.minMarketCapTier
    : "LARGE";

  console.log(`[analyst] Creating analyst: name="${name}" sectors=${sectors.join(",") || "all"} bias=${bias} posSize=${posSize} minConf=${minConf}`);

  const analyst = await prisma.agentConfig.create({
    data: {
      userId,
      name,
      description: data.description ?? "",
      enabled: true,
      analystPrompt: prompt,
      markets: ["US_EQUITIES"],
      exchanges: ["NASDAQ", "NYSE"],
      sectors,
      watchlist: Array.isArray(data.watchlist) ? data.watchlist : [],
      exclusionList: Array.isArray(data.exclusionList) ? data.exclusionList : [],
      maxPositionSize: posSize,
      maxOpenPositions: maxPos,
      minConfidence: minConf,
      maxRiskPct: 2,
      dailyLossLimit: 300,
      holdDurations: holdDurs,
      directionBias: bias,
      signalTypes: signals,
      minMarketCapTier: capTier,
      scheduleTime: "08:00",
      priceCheckFreq: "HOURLY",
      weekendMode: false,
      graduationWinRate: 0.65,
      graduationMinTrades: 50,
      graduationProfitFactor: 1.5,
      realTradingEnabled: false,
      realMaxPosition: posSize,
      emailAlerts: true,
      weeklyDigestEnabled: true,
    },
  });

  console.log(`[analyst] Created analyst id=${analyst.id} name="${name}"`);
  revalidatePath("/analysts");
  return { id: analyst.id };
}

// ── updateAnalystFromBuilder (apply AI-suggested config to existing analyst) ──

export async function updateAnalystFromBuilder(
  id: string,
  data: Partial<BuilderConfig>
): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.analystPrompt !== undefined) updateData.analystPrompt = data.analystPrompt;
  if (data.directionBias !== undefined) updateData.directionBias = data.directionBias;
  if (data.holdDurations !== undefined) updateData.holdDurations = data.holdDurations;
  if (data.sectors !== undefined) updateData.sectors = data.sectors;
  if (data.signalTypes !== undefined) updateData.signalTypes = data.signalTypes;
  if (data.minConfidence !== undefined) updateData.minConfidence = data.minConfidence;
  if (data.maxPositionSize !== undefined) updateData.maxPositionSize = data.maxPositionSize;
  if (data.maxOpenPositions !== undefined) updateData.maxOpenPositions = data.maxOpenPositions;
  if (data.minMarketCapTier !== undefined) updateData.minMarketCapTier = data.minMarketCapTier;
  if (data.watchlist !== undefined) updateData.watchlist = data.watchlist;
  if (data.exclusionList !== undefined) updateData.exclusionList = data.exclusionList;

  await prisma.agentConfig.update({
    where: { id, userId },
    data: updateData,
  });

  revalidatePath(`/analysts/${id}`);
  revalidatePath("/analysts");
}
