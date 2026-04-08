"use server";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getLatestPrices, getLatestPricesWithMeta, type PriceLookup } from "@/lib/alpaca";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import type { MockTrade, TradeStatus } from "@/lib/mock-data/trades";
import { etTradingDayDate } from "@/lib/market-hours";

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
  decision: string | null; // BUY | SELL | PASS | HOLD — actual action taken
  position: {
    id: string;
    status: string;
    avgCost: number;
    quantity: number | null;
    openedAt: string; // ISO
  } | null;
  currentPrice: number | null;
  companyName: string | null;
  analystName: string | null;
  analystId: string | null;
  runId: string;
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
  hasAlpacaKey: boolean;
  analystCount: number;
  hasCompletedRun: boolean;
  hasBrief: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapStatus(status: string, outcome: string | null): TradeStatus {
  if (status === "OPEN") return "OPEN";
  if (status === "CANCELLED") return "CANCELLED";
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
      hasAlpacaKey: false,
      analystCount: 0,
      hasCompletedRun: false,
      hasBrief: false,
    };
  }

  const userId = user.id;
  const todayMidnight = etTradingDayDate();

  // ── Phase A: every DB read that doesn't depend on another result ─────────
  // Previously these were 7 sequential awaits stretched across the function;
  // collapsing them into one Promise.all turns a ~500ms waterfall into a
  // single round trip bounded by the slowest query.
  const [
    alpacaCreds,
    dbOpenPositions,
    dbClosedPositions,
    dbRecentPicks,
    dbAgentConfigs,
    positionsWithAnalyst,
    dbRecentRuns,
    dbTodaysPicks,
  ] = await Promise.all([
    resolveAlpacaCredentials(userId).then((c) => c ?? undefined),
    prisma.position.findMany({
      where: { userId, status: "OPEN" },
      include: {
        analyst: { select: { name: true } },
        // Most recent BUY/SELL order — used to surface fill state in UI
        orders: {
          where: { side: { in: ["BUY", "SELL"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            filledAt: true,
            filledPrice: true,
            createdAt: true,
            alpacaOrderId: true,
          },
        },
      },
      orderBy: { openedAt: "desc" },
    }),
    prisma.position.findMany({
      where: { userId, status: { in: ["CLOSED", "CANCELLED"] } },
      include: {
        analyst: { select: { name: true } },
      },
      orderBy: { closedAt: "desc" },
      take: 50,
    }),
    prisma.thesis.findMany({
      where: {
        userId,
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        ticker: true,
        researchRunId: true,
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
          select: { agentConfig: { select: { id: true, name: true } } },
        },
        // Pull the *opening* decision (INITIATE) so the position fields shown
        // on the thesis card always reflect the original entry, not a later
        // HOLD/EVALUATE decision that may have a null position link.
        decisions: {
          where: { decision: "INITIATE" },
          take: 1,
          orderBy: { createdAt: "asc" as const },
          select: {
            decision: true,
            position: {
              select: {
                id: true,
                status: true,
                avgCost: true,
                quantity: true,
                openedAt: true,
              },
            },
          },
        },
      },
    }),
    prisma.agentConfig.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      // select only what AgentConfigSummary needs — skip the big JSON/string
      // columns (analystPrompt, strategyInstructions, tickerUniverse, etc).
      select: {
        id: true,
        name: true,
        enabled: true,
        scheduleTime: true,
        researchRuns: {
          orderBy: { startedAt: "desc" },
          take: 1,
          select: { startedAt: true },
        },
      },
    }),
    prisma.position.findMany({
      where: { userId },
      select: { id: true, analystId: true },
    }),
    prisma.researchRun.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
      take: 10,
      // select only what RecentRunSummary needs — skip the `parameters`
      // JSON blob (can be huge) and the rest of the run's scalars.
      select: {
        id: true,
        startedAt: true,
        completedAt: true,
        status: true,
        agentConfig: { select: { name: true } },
        theses: { select: { id: true } },
        decisions: {
          where: { decision: "BUY" },
          select: { id: true },
        },
      },
    }),
    prisma.thesis.findMany({
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
    }),
  ]);

  // ── Phase B: price + name lookups, parallel ─────────────────────────────
  // These depend on tickers from phase A but are independent of each other,
  // so run them in parallel instead of sequentially.
  const openTickers = [...new Set(dbOpenPositions.map((p) => p.symbol))];
  const pickTickers = [...new Set(dbRecentPicks.map((p) => p.ticker))];
  const allTickers = [...new Set([...openTickers, ...pickTickers])];

  const emptyPriceLookup: PriceLookup = {
    prices: {},
    sources: {},
    fetchedAt: new Date().toISOString(),
  };

  const [priceLookup, nameMap] = await Promise.all([
    allTickers.length > 0
      ? getLatestPricesWithMeta(allTickers, alpacaCreds).catch((err) => {
          console.error(
            `[portfolio] getLatestPricesWithMeta threw — ${err instanceof Error ? err.message : err}. Falling back to entry prices.`,
          );
          return emptyPriceLookup;
        })
      : Promise.resolve(emptyPriceLookup),
    (async () => {
      const map: Record<string, string> = {};
      try {
        const { getStockProfile } = await import("@/lib/actions/finnhub.actions");
        const profiles = await Promise.allSettled(
          pickTickers.map(async (t) => {
            const p = await getStockProfile(t);
            return { ticker: t, name: p?.name ?? null };
          }),
        );
        for (const r of profiles) {
          if (r.status === "fulfilled" && r.value.name) {
            map[r.value.ticker] = r.value.name;
          }
        }
      } catch {
        // Finnhub down — names will be null
      }
      return map;
    })(),
  ]);
  const priceMap = priceLookup.prices;

  // ── 4. Map open positions → MockTrade shape ────────────────────────────────
  const openTrades: MockTrade[] = dbOpenPositions.map((p) => {
    const livePrice = priceMap[p.symbol];
    const priceSource = priceLookup.sources[p.symbol] ?? "missing";
    const currentPrice = livePrice ?? p.avgCost;
    const { dollars, pct } = calcPnl(p.direction, p.avgCost, currentPrice, p.quantity);
    const order = p.orders?.[0];
    // Derive the display status from Position.status + latest Order.status.
    // Position stays OPEN until its BUY actually fills; the PENDING/REJECTED
    // view-model statuses are UI-only denormalizations.
    let displayStatus: TradeStatus = "OPEN";
    if (order?.status === "REJECTED") displayStatus = "REJECTED";
    else if (order?.status === "PENDING" || (order && order.filledAt == null)) displayStatus = "PENDING";
    return {
      id: p.id,
      ticker: p.symbol,
      direction: p.direction as "LONG" | "SHORT",
      entryPrice: p.avgCost,
      currentPrice,
      targetPrice: p.targetPrice ?? p.avgCost * 1.1,
      stopPrice: p.stopLoss ?? p.avgCost * 0.9,
      confidenceScore: 0, // TODO: join via TradeDecision → Thesis
      status: displayStatus,
      pnl: livePrice !== undefined ? dollars : 0,
      pnlPct: livePrice !== undefined ? pct : 0,
      openedAt: p.openedAt.toISOString(),
      closedAt: undefined,
      thesis: "",
      shares: p.quantity,
      analystName: p.analyst?.name ?? undefined,
      placedAt: order?.createdAt?.toISOString(),
      filledAt: order?.filledAt?.toISOString(),
      orderStatus: order?.status,
      alpacaOrderId: order?.alpacaOrderId ?? undefined,
      priceSource,
      priceUpdatedAt: livePrice !== undefined ? priceLookup.fetchedAt : undefined,
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

  // ── 8. Agent configs with last-run info (fetched in phase A) ──────────
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

  // ── 9. Recent research runs (fetched in phase A) ─────────────────────
  const recentRuns: RecentRunSummary[] = dbRecentRuns.map((r) => ({
    id: r.id,
    agentName: r.agentConfig?.name ?? null,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    thesisCount: r.theses.length,
    tradesPlaced: r.decisions.length,
    status: r.status,
  }));

  // ── 10. Today's picks (fetched in phase A) ───────────────────────────
  const todaysPicks: TodaysPick[] = dbTodaysPicks.map((t) => ({
    id: t.id,
    ticker: t.ticker,
    direction: t.direction,
    confidenceScore: t.confidenceScore,
    signalTypes: t.signalTypes,
  }));

  // ── 11. Map recentPicks ────────────────────────────────────────────────────
  const recentPicks: RecentPick[] = dbRecentPicks.map((p) => {
    const dec = p.decisions[0];
    const position = dec?.position;
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
      decision: dec?.decision ?? null,
      position: position
        ? {
            id: position.id,
            status: position.status,
            avgCost: position.avgCost,
            quantity: position.quantity ?? null,
            openedAt: position.openedAt.toISOString(),
          }
        : null,
      currentPrice: priceMap[p.ticker] ?? null,
      companyName: nameMap[p.ticker] ?? null,
      analystName: p.researchRun?.agentConfig?.name ?? null,
      analystId: p.researchRun?.agentConfig?.id ?? null,
      runId: p.researchRunId,
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
    hasAlpacaKey: alpacaCreds !== undefined,
    analystCount: dbAgentConfigs.length,
    hasCompletedRun: dbRecentRuns.some((r) => r.status === "COMPLETE"),
    hasBrief: recentPicks.length > 0,
  };
}
