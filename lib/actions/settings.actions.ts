"use server";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { AgentConfig } from "@/lib/generated/prisma";

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function getServerUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Not authenticated");
  return user.id;
}

// ─── Load (or create) default AgentConfig (legacy — for old SettingsPage) ─────

export async function getAgentConfig(): Promise<AgentConfig> {
  const userId = await getServerUserId();
  const existing = await prisma.agentConfig.findFirst({ where: { userId } });
  if (existing) return existing;
  return prisma.agentConfig.create({
    data: {
      userId,
      name: "My Analyst",
      enabled: true,
      markets: ["NASDAQ", "NYSE"],
      exchanges: ["NASDAQ", "NYSE"],
      sectors: ["Technology", "Healthcare", "Financials"],
      watchlist: [],
      exclusionList: [],
      maxPositionSize: 1000,
      maxOpenPositions: 5,
      minConfidence: 70,
      maxRiskPct: 2,
      dailyLossLimit: 200,
      holdDurations: ["SWING"],
      directionBias: "BOTH",
      signalTypes: ["EARNINGS_BEAT", "TECHNICAL_BREAKOUT", "NEWS_CATALYST"],
      minMarketCapTier: "LARGE",
      scheduleTime: "08:00",
      priceCheckFreq: "HOURLY",
      weekendMode: false,
      graduationWinRate: 0.65,
      graduationMinTrades: 50,
      graduationProfitFactor: 1.5,
      realTradingEnabled: false,
      realMaxPosition: 500,
      emailAlerts: true,
      weeklyDigestEnabled: true,
    },
  });
}

// ─── Load all analysts for current user ───────────────────────────────────────

export async function getAllAgentConfigs(): Promise<AgentConfig[]> {
  const userId = await getServerUserId();
  return prisma.agentConfig.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
}

// ─── Input types ──────────────────────────────────────────────────────────────

export type AgentConfigInput = {
  enabled: boolean;
  maxOpenPositions: number;
  minConfidence: number;
  holdDurations: string[];
  sectors: string[];
  signalTypes: string[];
  weeklyDigestEnabled: boolean;
  digestEmail: string | null;
  graduationWinRate: number;
  graduationMinTrades: number;
  realMaxPosition: number;
  emailAlerts: boolean;
};

export type AnalystFormInput = {
  name: string;
  enabled: boolean;
  minConfidence: number;
  maxOpenPositions: number;
  holdDurations: string[];
  sectors: string[];
  signalTypes: string[];
  directionBias: string;
  // M10 strategy fields
  description?: string | null;
  strategyType?: string;
  strategyInstructions?: string | null;
  tradePolicyAutoTrade?: boolean;
};

// ─── Create a new analyst ─────────────────────────────────────────────────────

export async function createAnalyst(
  data: AnalystFormInput
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const userId = await getServerUserId();
    const analyst = await prisma.agentConfig.create({
      data: {
        userId,
        name: data.name,
        enabled: data.enabled,
        markets: ["NASDAQ", "NYSE"],
        exchanges: ["NASDAQ", "NYSE"],
        sectors: data.sectors,
        watchlist: [],
        exclusionList: [],
        maxPositionSize: 1000,
        maxOpenPositions: data.maxOpenPositions,
        minConfidence: data.minConfidence,
        maxRiskPct: 2,
        dailyLossLimit: 300,
        holdDurations: data.holdDurations,
        directionBias: data.directionBias,
        signalTypes: data.signalTypes,
        minMarketCapTier: "LARGE",
        scheduleTime: "08:00",
        priceCheckFreq: "HOURLY",
        weekendMode: false,
        graduationWinRate: 0.65,
        graduationMinTrades: 50,
        graduationProfitFactor: 1.5,
        realTradingEnabled: false,
        realMaxPosition: 500,
        emailAlerts: true,
        weeklyDigestEnabled: true,
      },
    });
    revalidatePath("/settings");
    return { success: true, id: analyst.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Update a specific analyst ────────────────────────────────────────────────

export async function updateAnalyst(
  id: string,
  data: AnalystFormInput
): Promise<{ success: boolean; error?: string }> {
  try {
    const userId = await getServerUserId();
    const existing = await prisma.agentConfig.findFirst({
      where: { id, userId },
    });
    if (!existing) return { success: false, error: "Not found" };

    await prisma.agentConfig.update({
      where: { id },
      data: {
        name: data.name,
        enabled: data.enabled,
        sectors: data.sectors,
        maxOpenPositions: data.maxOpenPositions,
        minConfidence: data.minConfidence,
        holdDurations: data.holdDurations,
        directionBias: data.directionBias,
        signalTypes: data.signalTypes,
        ...(data.description !== undefined && { description: data.description }),
        ...(data.strategyType !== undefined && { strategyType: data.strategyType }),
        ...(data.strategyInstructions !== undefined && { strategyInstructions: data.strategyInstructions }),
        ...(data.tradePolicyAutoTrade !== undefined && { tradePolicyAutoTrade: data.tradePolicyAutoTrade }),
      },
    });
    revalidatePath("/settings");
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Toggle enabled for a specific analyst ────────────────────────────────────

export async function toggleAnalystEnabled(
  id: string,
  enabled: boolean
): Promise<{ success: boolean }> {
  try {
    const userId = await getServerUserId();
    const existing = await prisma.agentConfig.findFirst({
      where: { id, userId },
    });
    if (!existing) return { success: false };
    await prisma.agentConfig.update({ where: { id }, data: { enabled } });
    revalidatePath("/settings");
    return { success: true };
  } catch {
    return { success: false };
  }
}

// ─── Delete a specific analyst ────────────────────────────────────────────────

export async function deleteAnalyst(
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const userId = await getServerUserId();
    const existing = await prisma.agentConfig.findFirst({
      where: { id, userId },
    });
    if (!existing) return { success: false, error: "Not found" };
    await prisma.agentConfig.delete({ where: { id } });
    revalidatePath("/settings");
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Save full settings (legacy) ──────────────────────────────────────────────

export async function saveAgentConfig(
  data: AgentConfigInput
): Promise<{ success: boolean; error?: string }> {
  try {
    const userId = await getServerUserId();
    const config = await prisma.agentConfig.findFirst({ where: { userId } });
    if (!config) return { success: false, error: "No agent config found" };
    await prisma.agentConfig.update({
      where: { id: config.id },
      data: {
        enabled: data.enabled,
        maxOpenPositions: data.maxOpenPositions,
        minConfidence: data.minConfidence,
        holdDurations: data.holdDurations,
        sectors: data.sectors,
        signalTypes: data.signalTypes,
        weeklyDigestEnabled: data.weeklyDigestEnabled,
        digestEmail: data.digestEmail || null,
        graduationWinRate: data.graduationWinRate,
        graduationMinTrades: data.graduationMinTrades,
        realMaxPosition: data.realMaxPosition,
        emailAlerts: data.emailAlerts,
      },
    });
    revalidatePath("/settings");
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Quick auto-run toggle (legacy) ───────────────────────────────────────────

export async function toggleAutoRun(
  enabled: boolean
): Promise<{ success: boolean }> {
  try {
    const userId = await getServerUserId();
    const config = await prisma.agentConfig.findFirst({ where: { userId } });
    if (!config) return { success: false };
    await prisma.agentConfig.update({
      where: { id: config.id },
      data: { enabled },
    });
    revalidatePath("/settings");
    return { success: true };
  } catch {
    return { success: false };
  }
}
