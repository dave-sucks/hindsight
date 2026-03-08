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

export interface DashboardData {
  openTrades: MockTrade[];
  closedTrades: MockTrade[];
  portfolio: PortfolioStats;
  equityCurve: { date: string; value: number }[];
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
 * Fetches all trades for the current user and computes portfolio stats.
 * Returns empty data if the user is not authenticated.
 * Falls back gracefully if Alpaca price fetch fails.
 */
export async function getDashboardData(): Promise<DashboardData> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      openTrades: [],
      closedTrades: [],
      portfolio: {
        totalValue: STARTING_CAPITAL,
        unrealizedPnl: 0,
        realizedPnl: 0,
        winRate: null,
        openCount: 0,
      },
      equityCurve: [],
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
      take: 50, // cap at 50 recent closed trades for the dashboard
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
  };
}
