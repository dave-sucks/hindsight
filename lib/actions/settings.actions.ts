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

// ─── Load (or create) AgentConfig ─────────────────────────────────────────────

export async function getAgentConfig(): Promise<AgentConfig> {
  const userId = await getServerUserId();
  // userId is no longer unique — find the first (default) config, create if absent
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

// ─── Save full settings ────────────────────────────────────────────────────────

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

// ─── Quick auto-run toggle ────────────────────────────────────────────────────

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
