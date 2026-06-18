"use server";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { getLatestPricesWithMeta } from "@/lib/alpaca";
import type { TradeStatus } from "@/lib/mock-data/trades";
import { DEFAULT_INTELLIGENCE_POLICY } from "@/lib/intelligence/types";
import type { SourceCategory, QueryCategory, IntelligencePolicy } from "@/lib/intelligence/types";
import {
  normalizeSectors,
  normalizeIndustries,
  normalizeThemes,
} from "@/lib/universe/canonical";
import { normalizeFeeds } from "@/lib/universe/feeds";
import { getAccountId } from "@/lib/auth/account";
import {
  getThesisComposite,
  getThesisSnapshotText,
} from "@/lib/agent/thesis-narrative";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface AnalystConfig {
  id: string;
  userId: string;
  name: string;
  enabled: boolean;
  /** PAPER (default) or LIVE — drives which Alpaca account this analyst trades into. */
  tradingEnvironment: "PAPER" | "LIVE";
  /** Per-position cap when tradingEnvironment="LIVE". Ignored in PAPER. */
  realMaxPosition: number;
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
  exchanges: string[];
  watchlist: string[];
  exclusionList: string[];
  // ── Universe (B1) — narrower discovery fence ─────────────────────
  industries: string[];
  themes: string[];
  marketCapMin: number | null;
  marketCapMax: number | null;
  // ── Feeds — firm-aggregate subscription dimension ────────────────
  // Canonical FEEDS values (lib/universe/feeds.ts) matching Signal.aggregateType.
  feeds: string[];
  dailyLossLimit: number;
  scheduleTime: string;
  /** Owner email opt-out for this analyst (new trades, fills, approval requests). */
  emailAlerts: boolean;
  createdAt: Date;
  updatedAt: Date;
  // V3 intelligence fields — populated from Monitor table + AgentConfig.intelligencePolicy
  intelligencePolicy: Record<string, unknown> | null;
  domainMonitors: Array<{
    id: string;
    name: string;
    domain: string;
    category: string;
    qualityScore: number;
    enabled: boolean;
  }>;
  searchMonitors: Array<{
    id: string;
    name: string;
    query: string;
    category: string;
    enabled: boolean;
  }>;
}

export interface AnalystOpenTrade {
  id: string;
  ticker: string;
  direction: string | null;
  entryPrice: number;
  shares: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
  status: TradeStatus;
  openedAt: string;
  priceSource: "alpaca" | "finnhub" | "missing";
  priceUpdatedAt?: string;
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
  mode: string | null;
  startedAt: Date;
  completedAt: Date | null;
  theses: {
    id: string;
    ticker: string;
    direction: string | null;
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

export interface PositionWithThesis {
  id: string;
  symbol: string;
  direction: string | null;
  status: string;
  avgCost: number;
  quantity: number;
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
  // Trade-as-Proposal — populated when an Order(AWAITING_APPROVAL) is
  // linked to this Position. AnalystTradeRow passes this through to
  // TradeRow which renders the inline [Approve][Reject] buttons.
  // See docs/plans/TRADE_AS_PROPOSAL.md §6.
  pendingProposal?: {
    orderId: string;
    intent: "OPEN" | "ADD" | "CLOSE" | "PARTIAL_CLOSE";
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
  /** Count of theses currently in PROMOTED state — awaiting first-live-run resolution. */
  promotedCount: number;
}

export interface MorningBriefItem {
  id: string;
  date: Date;
  marketContext: string;
  portfolioAlerts: unknown;
  watchlistUpdates: unknown;
  newOpportunities: unknown;
  attentionPriority: string[];
  riskFlags: string[];
  signalCount: number;
  generatedAt: Date;
}

export interface AnalystDetail {
  config: AnalystConfig;
  recentRuns: RunWithTheses[];
  recentTrades: PositionWithThesis[];
  stats: AnalystStats;
  briefings: AnalystBriefingItem[];
  morningBriefs: MorningBriefItem[];
}

export interface AnalystBriefingItem {
  id: string;
  runId: string | null;
  narrative: string;
  marketContext: unknown;
  theses: unknown;
  trades: unknown;
  portfolioSnapshot: unknown;
  strategyNotes: string | null;
  marketPosture: string | null;
  watchTomorrow: unknown;
  unresolvedItems: unknown;
  selfCorrections: unknown;
  createdAt: Date;
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
    direction: string | null;
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

export async function getAnalystList(
  environment: "PAPER" | "LIVE" = "PAPER",
): Promise<AnalystListItem[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  const accountId = await getAccountId(userId);
  if (!accountId) return [];

  // The analyst grid shows analysts that operate in the selected env.
  // tradingEnvironment is single-valued per analyst; a paper-env user
  // never sees promoted-to-live analysts mixed into the list and vice
  // versa. Run / position aggregates below also scope by env so
  // cross-env activity doesn't leak into a cohort's stats.
  const configs = await prisma.agentConfig.findMany({
    where: { accountId, tradingEnvironment: environment },
    orderBy: { createdAt: "asc" },
  });

  if (configs.length === 0) return [];

  // Load all runs and positions for this account, group in JS
  const [allRuns, allPositions, alpacaCreds] = await Promise.all([
    prisma.researchRun.findMany({
      where: { accountId, environment },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        agentConfigId: true,
        status: true,
        startedAt: true,
      },
    }),
    prisma.position.findMany({
      where: { accountId, environment },
      select: {
        id: true,
        symbol: true,
        direction: true,
        status: true,
        avgCost: true,
        quantity: true,
        outcome: true,
        realizedPnl: true,
        analystId: true,
        openedAt: true,
      },
    }),
    resolveAlpacaCredentials(userId, environment).catch(() => undefined),
  ]);

  // Fetch live prices once for all open positions across analysts.
  const openSymbols = Array.from(
    new Set(allPositions.filter((p) => p.status === "OPEN").map((p) => p.symbol)),
  );
  const priceLookup = openSymbols.length > 0
    ? await getLatestPricesWithMeta(openSymbols, alpacaCreds ?? undefined).catch(() => ({
        prices: {} as Record<string, number>,
        sources: {} as Record<string, "alpaca" | "finnhub" | "missing">,
        fetchedAt: new Date().toISOString(),
      }))
    : { prices: {} as Record<string, number>, sources: {} as Record<string, "alpaca" | "finnhub" | "missing">, fetchedAt: new Date().toISOString() };

  return configs.map((config) => {
    const configRuns = allRuns.filter((r) => r.agentConfigId === config.id);
    const lastRun = configRuns[0] ?? null;

    const configPositions = allPositions.filter(
      (p) => p.analystId === config.id
    );

    const closedPositions = configPositions.filter((p) => p.outcome != null);
    const wins = closedPositions.filter((p) => p.outcome === "WIN").length;
    const winRate = closedPositions.length > 0 ? wins / closedPositions.length : null;
    const totalPnl = closedPositions.reduce(
      (sum, p) => sum + (p.realizedPnl ?? 0),
      0
    );

    const openTrades: AnalystOpenTrade[] = configPositions
      .filter((p) => p.status === "OPEN")
      .slice(0, 3)
      .map((p) => {
        const livePrice = priceLookup.prices[p.symbol];
        const priceSource = priceLookup.sources[p.symbol] ?? "missing";
        const currentPrice = livePrice ?? p.avgCost;
        const dollars =
          p.direction === "LONG"
            ? (currentPrice - p.avgCost) * p.quantity
            : (p.avgCost - currentPrice) * p.quantity;
        const pct =
          p.direction === "LONG"
            ? ((currentPrice - p.avgCost) / p.avgCost) * 100
            : ((p.avgCost - currentPrice) / p.avgCost) * 100;
        return {
          id: p.id,
          ticker: p.symbol,
          direction: p.direction,
          entryPrice: p.avgCost,
          shares: p.quantity,
          currentPrice,
          pnl: livePrice !== undefined ? dollars : 0,
          pnlPct: livePrice !== undefined ? pct : 0,
          status: "OPEN" as TradeStatus,
          openedAt: p.openedAt.toISOString(),
          priceSource,
          priceUpdatedAt: livePrice !== undefined ? priceLookup.fetchedAt : undefined,
        };
      });

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
      tradeCount: configPositions.length,
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
  const accountId = await getAccountId(userId);
  if (!accountId) return null;

  const config = await prisma.agentConfig.findFirst({
    where: { id: analystId, accountId },
  });
  if (!config) return null;

  const [recentRuns, recentPositions, totalRuns, totalTheses, watchlistTheses, briefings, morningBriefs, monitors] = await Promise.all([
    // Last 20 runs with their theses (join trade info via decisions)
    prisma.researchRun.findMany({
      where: { agentConfigId: analystId, accountId },
      orderBy: { startedAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        source: true,
        mode: true,
        startedAt: true,
        completedAt: true,
        theses: {
          select: {
            id: true,
            ticker: true,
            direction: true,
            scoring: true,
            snapshot: true,
            holdDuration: true,
            decisions: {
              take: 1,
              where: { decision: "BUY" },
              select: {
                position: {
                  select: {
                    id: true,
                    status: true,
                    realizedPnl: true,
                    outcome: true,
                  },
                },
              },
            },
          },
          // PR-9: was orderBy confidenceScore desc — sort client-side
          // off scoring.composite below.
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    // Last 20 positions attributed to this analyst
    prisma.position.findMany({
      where: { accountId, analystId },
      orderBy: { openedAt: "desc" },
      take: 20,
      select: {
        id: true,
        symbol: true,
        direction: true,
        status: true,
        avgCost: true,
        quantity: true,
        closePrice: true,
        realizedPnl: true,
        outcome: true,
        openedAt: true,
        closedAt: true,
        // Trade-as-Proposal — pull AWAITING_APPROVAL orders so the
        // analyst-page sidebar TradeRow renders inline [Approve][Reject].
        orders: {
          where: { status: "AWAITING_APPROVAL" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, intent: true, expiresAt: true },
        },
        decisions: {
          take: 1,
          select: {
            thesis: {
              select: {
                id: true,
                scoring: true,
                snapshot: true,
              },
            },
          },
        },
      },
    }),
    prisma.researchRun.count({ where: { agentConfigId: analystId, accountId } }),
    prisma.thesis.count({
      where: { researchRun: { agentConfigId: analystId }, accountId },
    }),
    // Watchlist = active WATCHING theses for this analyst (post-collapse).
    prisma.thesis.findMany({
      where: {
        accountId,
        status: "WATCHING",
        researchRun: { agentConfigId: analystId },
      },
      select: { ticker: true },
      orderBy: { createdAt: "desc" },
    }),
    // Load briefings (most recent 20)
    prisma.analystBriefing.findMany({
      where: { analystId, accountId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        runId: true,
        narrative: true,
        marketContext: true,
        theses: true,
        trades: true,
        portfolioSnapshot: true,
        strategyNotes: true,
        marketPosture: true,
        watchTomorrow: true,
        unresolvedItems: true,
        selfCorrections: true,
        createdAt: true,
      },
    }),
    // Load morning briefs (most recent 10)
    prisma.morningBrief.findMany({
      where: { analystId },
      orderBy: { date: "desc" },
      take: 10,
      select: {
        id: true,
        date: true,
        marketContext: true,
        portfolioAlerts: true,
        watchlistUpdates: true,
        newOpportunities: true,
        attentionPriority: true,
        riskFlags: true,
        signalCount: true,
        generatedAt: true,
      },
    }),
    // Load monitors (DOMAIN + SEARCH) for intelligence display
    prisma.monitor.findMany({
      where: { analystId },
      select: {
        id: true,
        name: true,
        type: true,
        config: true,
        category: true,
        enabled: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // Compute stats from all positions for this analyst.
  // PR-9 dropped the legacy `confidenceScore` Int — the conviction signal
  // moved into `scoring.composite` (Json `{ ... composite: number }`).
  // Prisma aggregate can't average a Json field; fetch the scoring blobs
  // and average composites client-side. Cheap on a per-analyst scope.
  // promotedCount feeds the "N promoted" badge on the analyst
  // detail header.
  const [allPositions, scoringRows, promotedCount] = await Promise.all([
    prisma.position.findMany({
      where: { accountId, analystId },
      select: { outcome: true, realizedPnl: true },
    }),
    prisma.thesis.findMany({
      where: { researchRun: { agentConfigId: analystId }, accountId },
      select: { scoring: true },
    }),
    // PROMOTED theses awaiting first-live-run resolution. Surfaced in the
    // analyst detail header so the user can see "this many names need
    // re-entry decisions on the next live run."
    prisma.thesis.count({
      where: {
        status: "PROMOTED",
        researchRun: { agentConfigId: analystId },
        accountId,
      },
    }),
  ]);

  const closedPositions = allPositions.filter((p) => p.outcome != null);
  const wins = closedPositions.filter((p) => p.outcome === "WIN").length;
  const losses = closedPositions.filter((p) => p.outcome === "LOSS").length;
  const winRate = closedPositions.length > 0 ? wins / closedPositions.length : null;
  const totalPnl = closedPositions.reduce(
    (sum, p) => sum + (p.realizedPnl ?? 0),
    0
  );
  const winPositions = closedPositions.filter(
    (p) => p.outcome === "WIN" && p.realizedPnl != null
  );
  const lossPositions = closedPositions.filter(
    (p) => p.outcome === "LOSS" && p.realizedPnl != null
  );
  const bestWin =
    winPositions.length > 0
      ? Math.max(...winPositions.map((p) => p.realizedPnl!))
      : null;
  const worstLoss =
    lossPositions.length > 0
      ? Math.min(...lossPositions.map((p) => p.realizedPnl!))
      : null;
  // Average composite, on the legacy 0-100 scale (composite × 10) so the
  // analyst card's existing renderer keeps working.
  const composites: number[] = scoringRows
    .map((r) => getThesisComposite(r))
    .filter((c): c is number => c != null);
  const avgConfidence =
    composites.length > 0
      ? (composites.reduce((s, c) => s + c, 0) / composites.length) * 10
      : null;

  // Map monitors into typed arrays for UI display
  const domainMonitors = monitors
    .filter((m) => m.type === "DOMAIN")
    .map((m) => {
      const cfg = (m.config as Record<string, unknown>) ?? {};
      return {
        id: m.id,
        name: m.name,
        domain: (cfg.domain as string) ?? "",
        category: m.category,
        qualityScore: (cfg.qualityScore as number) ?? 3,
        enabled: m.enabled,
      };
    });

  const searchMonitors = monitors
    .filter((m) => m.type === "SEARCH")
    .map((m) => {
      const cfg = (m.config as Record<string, unknown>) ?? {};
      return {
        id: m.id,
        name: m.name,
        query: (cfg.query as string) ?? m.name,
        category: m.category,
        enabled: m.enabled,
      };
    });

  // Map Prisma config (Json fields) → typed AnalystConfig
  const mappedConfig: AnalystConfig = {
    id: config.id,
    userId: config.userId,
    name: config.name,
    enabled: config.enabled,
    tradingEnvironment: (config.tradingEnvironment as "PAPER" | "LIVE") ?? "PAPER",
    realMaxPosition: config.realMaxPosition,
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
    exchanges: (config.exchanges as string[]) ?? [],
    watchlist: watchlistTheses.map((t) => t.ticker),
    exclusionList: (config.exclusionList as string[]) ?? [],
    industries: (config.industries as string[]) ?? [],
    themes: (config.themes as string[]) ?? [],
    marketCapMin: config.marketCapMin != null ? Number(config.marketCapMin) : null,
    marketCapMax: config.marketCapMax != null ? Number(config.marketCapMax) : null,
    feeds: (config.feeds as string[] | undefined) ?? [],
    dailyLossLimit: config.dailyLossLimit,
    scheduleTime: config.scheduleTime,
    emailAlerts: config.emailAlerts,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    intelligencePolicy: (config.intelligencePolicy as Record<string, unknown>) ?? null,
    domainMonitors,
    searchMonitors,
  };

  // Map runs: transform theses.decisions[0].position → trade shape for backwards compat
  const mappedRuns: RunWithTheses[] = recentRuns.map((r) => ({
    id: r.id,
    status: r.status,
    source: r.source,
    mode: r.mode,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    theses: r.theses.map((th) => {
      const pos = th.decisions[0]?.position;
      const composite = getThesisComposite(th);
      return {
        id: th.id,
        ticker: th.ticker,
        direction: th.direction,
        // PR-9: legacy 0-100 confidence → composite × 10 for renderers.
        confidenceScore: composite != null ? composite * 10 : 0,
        reasoningSummary: getThesisSnapshotText(th),
        holdDuration: th.holdDuration,
        // PR-9: signalTypes / sourcesUsed columns dropped.
        signalTypes: [],
        sourcesUsed: [],
        trade: pos
          ? { id: pos.id, status: pos.status, realizedPnl: pos.realizedPnl, outcome: pos.outcome }
          : null,
      };
    }),
  }));

  const mappedTrades: PositionWithThesis[] = recentPositions.map((p) => {
    const th = p.decisions[0]?.thesis;
    const composite = th ? getThesisComposite(th) : null;
    const awaiting = p.orders?.[0];
    return {
      id: p.id,
      symbol: p.symbol,
      direction: p.direction,
      status: p.status,
      avgCost: p.avgCost,
      quantity: p.quantity,
      closePrice: p.closePrice,
      realizedPnl: p.realizedPnl,
      outcome: p.outcome,
      openedAt: p.openedAt,
      closedAt: p.closedAt,
      // PR-9: API contract still exposes `confidenceScore` (0-100) and
      // `reasoningSummary` (string) — populate from the new flat columns
      // via the helpers so downstream UI keeps working.
      thesis: th
        ? {
            id: th.id,
            confidenceScore: composite != null ? composite * 10 : 0,
            reasoningSummary: getThesisSnapshotText(th),
          }
        : { id: "", confidenceScore: 0, reasoningSummary: "" },
      pendingProposal: awaiting
        ? {
            orderId: awaiting.id,
            intent: (awaiting.intent ?? "OPEN") as
              | "OPEN"
              | "ADD"
              | "CLOSE"
              | "PARTIAL_CLOSE",
          }
        : undefined,
    };
  });

  return {
    config: mappedConfig,
    recentRuns: mappedRuns,
    recentTrades: mappedTrades,
    briefings,
    morningBriefs,
    stats: {
      totalRuns,
      totalTheses,
      totalTrades: allPositions.length,
      winRate,
      totalPnl,
      wins,
      losses,
      bestWin,
      worstLoss,
      avgConfidence,
      promotedCount,
    },
  };
}

// ── getRecentRunsForDashboard ─────────────────────────────────────────────────

export async function getRecentRunsForDashboard(): Promise<DashboardRun[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  const accountId = await getAccountId(userId);
  if (!accountId) return [];

  const runs = await prisma.researchRun.findMany({
    where: { accountId },
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
          scoring: true,
          decisions: {
            take: 1,
            where: { decision: "BUY" },
            select: {
              position: {
                select: { id: true, status: true, realizedPnl: true },
              },
            },
          },
        },
        // PR-9: was orderBy confidenceScore desc — server-side sort on
        // Json composite isn't supported; results land createdAt-desc and
        // downstream renderers sort if needed.
        orderBy: { createdAt: "desc" },
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
    theses: r.theses.map((th) => {
      const pos = th.decisions[0]?.position;
      const composite = getThesisComposite(th);
      return {
        ticker: th.ticker,
        direction: th.direction,
        // PR-9: legacy 0-100 confidence → composite × 10 for renderers
        // still consuming the 0-100 shape.
        confidenceScore: composite != null ? composite * 10 : 0,
        trade: pos ? { id: pos.id, status: pos.status, realizedPnl: pos.realizedPnl } : null,
      };
    }),
  }));
}

// ── updateAnalystPrompt ───────────────────────────────────────────────────────

export async function updateAnalystPrompt(
  id: string,
  prompt: string
): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");
  const accountId = await getAccountId(userId);
  if (!accountId) throw new Error("No account");

  // accountId can't go in `update.where` (not a unique key) — verify
  // ownership separately, then update by primary key.
  const owned = await prisma.agentConfig.findFirst({
    where: { id, accountId },
    select: { id: true },
  });
  if (!owned) throw new Error("Analyst not found");

  await prisma.agentConfig.update({
    where: { id },
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
  const accountId = await getAccountId(userId);
  if (!accountId) throw new Error("No account");

  const analyst = await prisma.agentConfig.create({
    data: {
      userId,
      accountId,
      name: data.name,
      enabled: true,
      analystPrompt: data.analystPrompt,
      markets: ["US_EQUITIES"],
      exchanges: ["NASDAQ", "NYSE"],
      sectors: [],
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
      tradingEnvironment: "PAPER",
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
  // V3: Intelligence layer proposals from the builder
  domainMonitorProposal?: {
    name: string;
    sources: Array<{
      name: string;
      domain: string;
      category: string;
      qualityScore: number;
      reason: string;
    }>;
  };
  intelligenceQueries?: Array<{
    query: string;
    category: string;
    reason: string;
  }>;
  intelligencePolicy?: {
    holdingsAttention: number;
    watchlistAttention: number;
    discoveryAttention: number;
    maxSignalsPerRun?: number;
    maxArtifactReads?: number;
    allowLiveSearch?: boolean;
    liveSearchBudget?: number;
  };
  // Session 3: Universe payload from builder/editor `suggest_config`.
  universe?: {
    sectors?: string[];
    industries?: string[];
    themes?: string[];
    exchanges?: string[];
    marketCapMin?: number;
    marketCapMax?: number;
    priceMin?: number;
    priceMax?: number;
    exclusions?: string[];
    // Firm-aggregate feed subscriptions (canonical FEEDS in lib/universe/feeds.ts).
    // Builder seeds from the chosen archetype's defaultFeeds; editor can patch.
    // Wiring into suggest_config schema deferred until after PR #170 merges
    // (it owns suggest-config.ts) — this field is defensively read on the
    // analyst write path so when the builder side ships it Just Works.
    feeds?: string[];
  };
}

export async function createAnalystFromBuilder(
  data: BuilderConfig
): Promise<{ id: string }> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");
  const accountId = await getAccountId(userId);
  if (!accountId) throw new Error("No account");

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

  // Parse watchlist: supports both old format (string[]) and new format ({symbol, reason, priority}[])
  const rawWatchlist = Array.isArray(data.watchlist) ? data.watchlist : [];
  const watchlistSymbols: string[] = [];
  const structuredWatchlist: { symbol: string; reason: string; priority: string }[] = [];
  for (const item of rawWatchlist) {
    if (typeof item === "string") {
      watchlistSymbols.push(item.toUpperCase());
    } else if (item && typeof item === "object" && "symbol" in item) {
      const sym = String((item as { symbol: string }).symbol).toUpperCase();
      watchlistSymbols.push(sym);
      structuredWatchlist.push({
        symbol: sym,
        reason: String((item as { reason?: string }).reason ?? "Added during analyst creation"),
        priority: String((item as { priority?: string }).priority ?? "NORMAL"),
      });
    }
  }

  // Build intelligence policy from builder proposal, merging with defaults
  const policyInput = data.intelligencePolicy;
  const intelligencePolicy: IntelligencePolicy = {
    ...DEFAULT_INTELLIGENCE_POLICY,
    ...(policyInput ? {
      holdingsAttention: policyInput.holdingsAttention,
      watchlistAttention: policyInput.watchlistAttention,
      discoveryAttention: policyInput.discoveryAttention,
      ...(policyInput.maxSignalsPerRun != null ? { maxSignalsPerRun: policyInput.maxSignalsPerRun } : {}),
      ...(policyInput.maxArtifactReads != null ? { maxArtifactReads: policyInput.maxArtifactReads } : {}),
      ...(policyInput.allowLiveSearch != null ? { allowLiveSearch: policyInput.allowLiveSearch } : {}),
      ...(policyInput.liveSearchBudget != null ? { liveSearchBudget: policyInput.liveSearchBudget } : {}),
    } : {}),
  };

  // ── Universe payload — maps to AgentConfig fields per B contract ──
  // `universe.sectors/exchanges/exclusions` collapse into the existing
  // `sectors/exchanges/exclusionList` columns. `industries`, `themes`, and
  // `marketCapMin/Max` have dedicated columns. priceMin/priceMax are NOT
  // currently persisted — they're treated as hints for future filtering.
  const universe = data.universe;
  const rawUniverseSectors =
    Array.isArray(universe?.sectors) && universe!.sectors!.length > 0
      ? universe!.sectors!
      : sectors; // fall back to the non-universe sectors field if builder didn't set universe
  // Session A: normalize universe fields at the write boundary so the
  // AgentConfig table only ever stores canonical GICS Title Case sectors /
  // industries and uppercase snake_case themes. Anything the normalizer can't
  // map is dropped silently — same policy as Signal ingestion.
  const universeSectors = normalizeSectors(rawUniverseSectors);
  const universeExchanges = Array.isArray(universe?.exchanges) && universe!.exchanges!.length > 0
    ? universe!.exchanges!
    : ["NASDAQ", "NYSE"];
  const universeExclusions = Array.isArray(universe?.exclusions) ? universe!.exclusions! : [];
  // Combine builder's general exclusionList with universe.exclusions (dedup).
  const combinedExclusions = Array.from(
    new Set([
      ...(Array.isArray(data.exclusionList) ? data.exclusionList : []),
      ...universeExclusions,
    ].map((s) => s.toUpperCase())),
  );
  const industries = normalizeIndustries(
    Array.isArray(universe?.industries) ? universe!.industries! : [],
  );
  const themes = normalizeThemes(
    Array.isArray(universe?.themes) ? universe!.themes! : [],
  );
  const marketCapMin =
    typeof universe?.marketCapMin === "number" && Number.isFinite(universe.marketCapMin)
      ? BigInt(Math.round(universe.marketCapMin))
      : null;
  const marketCapMax =
    typeof universe?.marketCapMax === "number" && Number.isFinite(universe.marketCapMax)
      ? BigInt(Math.round(universe.marketCapMax))
      : null;
  // Feeds — canonical FEEDS values. Dropped silently if the builder slipped a
  // non-canonical key in (same policy as sectors/industries normalization).
  const feeds = normalizeFeeds(
    Array.isArray(universe?.feeds) ? universe!.feeds! : [],
  );

  // ── Transactional creation: analyst + watchlist + monitors ──
  // All intelligence setup is atomic — if monitor creation fails midway,
  // the analyst still gets created but without a partial/broken intelligence setup.
  const analyst = await prisma.$transaction(async (tx) => {
    // 1. Create the analyst config (core record)
    const newAnalyst = await tx.agentConfig.create({
      data: {
        userId,
        accountId,
        name,
        description: data.description ?? "",
        enabled: true,
        analystPrompt: prompt,
        markets: ["US_EQUITIES"],
        exchanges: universeExchanges,
        sectors: universeSectors,
        industries,
        themes,
        marketCapMin,
        marketCapMax,
        feeds,
        // Watchlist removed from AgentConfig — Thesis(status=WATCHING) is
        // the single store now. Seed theses are minted below.
        exclusionList: combinedExclusions,
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
        tradingEnvironment: "PAPER",
        realMaxPosition: posSize,
        emailAlerts: true,
        weeklyDigestEnabled: true,
        intelligencePolicy: intelligencePolicy as unknown as object,
      },
    });

    // 2. Watchlist-collapse: builder seeds as Thesis(direction=null/WATCHING,
    //    source_kind='BUILDER_SEED') under a fresh BUILDER_SEED ResearchRun.
    //    Thesis is the single store; AnalystWatchlistItem is gone.
    const seedItems: Array<{ symbol: string; reason: string }> =
      structuredWatchlist.length > 0
        ? structuredWatchlist.map((w) => ({
            symbol: w.symbol,
            reason: w.reason,
          }))
        : watchlistSymbols.map((sym) => ({
            symbol: sym,
            reason: "Added during analyst creation",
          }));

    if (seedItems.length > 0) {
      const builderRun = await tx.researchRun.create({
        data: {
          userId,
          accountId,
          agentConfigId: newAnalyst.id,
          source: "BUILDER",
          status: "COMPLETE",
          mode: "BUILDER_SEED",
          environment: "PAPER",
          parameters: {
            note: "Analyst-creation watchlist seed; one null-direction WATCHING thesis per ticker.",
            seedCount: seedItems.length,
          },
          completedAt: new Date(),
        },
        select: { id: true },
      });

      const now = new Date();
      const createdTheses = await Promise.all(
        seedItems.map((w) =>
          tx.thesis.create({
            data: {
              researchRunId: builderRun.id,
              userId,
              accountId,
              ticker: w.symbol,
              source: "BUILDER",
              // P1-24 B4: unresearched watchlist seed → direction=null, status
              // stays WATCHING. Agent promotes null → LONG/SHORT on first review.
              direction: null,
              status: "WATCHING",
              holdDuration: "SWING",
              // PR-9 flat schema: legacy plain-string narrative columns
              // (reasoningSummary, thesisBullets, riskFlags) replaced by
              // JSONB snapshot/bullCase/bearCase. confidenceScore /
              // signalTypes / sourcesUsed dropped — composite lives in
              // scoring (null until first research).
              snapshot: {
                text: w.reason || "Builder-seeded — awaiting first research",
                citations: [],
              },
              modelUsed: "builder",
              sourceKind: "BUILDER_SEED",
              sourceRationale: w.reason || "Builder-seeded during analyst creation",
              nextReviewAt: now,
            },
            select: { id: true, ticker: true },
          }),
        ),
      );

      await tx.thesisUpdate.createMany({
        data: createdTheses.map((t) => ({
          thesisId: t.id,
          type: "CREATED",
          summary: `Builder-seeded ${t.ticker} on analyst creation (awaiting first research)`,
          rationale: "Analyst was created with this ticker on the suggested watchlist. The first daily run will research it.",
          fieldChanges: {},
          runId: builderRun.id,
        })),
      });

      console.log(
        `[analyst] Created ${createdTheses.length} null-direction watchlist theses for analyst ${newAnalyst.id}`,
      );
    }

    // 3. Create domain monitors from domain monitor proposal
    if (data.domainMonitorProposal && data.domainMonitorProposal.sources.length > 0) {
      const proposal = data.domainMonitorProposal;

      for (const src of proposal.sources) {
        const validCategory = (["MARKET", "SECTOR", "COMPANY", "THEMATIC", "SOCIAL", "EVENT"] as const)
          .includes(src.category as SourceCategory) ? src.category : "THEMATIC";
        await tx.monitor.create({
          data: {
            accountId,
            name: src.name,
            type: "DOMAIN",
            method: "perplexity_sonar",
            config: {
              domain: src.domain,
              url: `https://${src.domain}`,
              qualityScore: Math.min(5, Math.max(1, Math.round(src.qualityScore))),
            },
            scope: "ANALYST",
            analystId: newAnalyst.id,
            enabled: true,
            builtIn: false,
            origin: "BUILDER",
            category: validCategory,
          },
        });
      }
      console.log(`[analyst] Created ${proposal.sources.length} domain monitors for analyst ${newAnalyst.id}`);
    }

    // 4. Create search monitors from intelligence queries
    if (data.intelligenceQueries && data.intelligenceQueries.length > 0) {
      for (const q of data.intelligenceQueries) {
        const validCategory = (["MARKET", "SECTOR", "TICKER", "THEMATIC", "EVENT"] as const)
          .includes(q.category as QueryCategory) ? q.category : "THEMATIC";
        await tx.monitor.create({
          data: {
            accountId,
            name: q.query,
            type: "SEARCH",
            method: "perplexity_sonar",
            config: { query: q.query },
            scope: "ANALYST",
            analystId: newAnalyst.id,
            enabled: true,
            builtIn: false,
            origin: "BUILDER",
            category: validCategory,
          },
        });
      }
      console.log(`[analyst] Created ${data.intelligenceQueries.length} search monitors for analyst ${newAnalyst.id}`);
    }

    return newAnalyst;
  });

  console.log(`[analyst] Created analyst id=${analyst.id} name="${name}" policy.holdingsAttn=${intelligencePolicy.holdingsAttention} policy.discoveryAttn=${intelligencePolicy.discoveryAttention}`);
  revalidatePath("/analysts");
  return { id: analyst.id };
}

// ── updateAnalystField (direct inline edit of a single config field) ──────────

type UpdatableField =
  | "name"
  | "description"
  | "directionBias"
  | "minConfidence"
  | "maxPositionSize"
  // Live per-position cap (LIVE only). Set at promotion via PromoteAnalystDialog;
  // editable here so it isn't invisible/uneditable after promotion. place_trade
  // caps live orders at min(maxPositionSize, realMaxPosition) — see
  // lib/agent/tools/place-trade.ts. Ignored in PAPER.
  | "realMaxPosition"
  | "maxOpenPositions"
  // NOTE: maxRiskPct and scheduleTime removed from the editable surface —
  // both are orphan fields at runtime (no code path reads them). If
  // scheduling becomes per-analyst in the future, add scheduleTime back.
  | "holdDurations"
  | "watchlist"
  | "exclusionList"
  | "analystPrompt"
  // ── Universe (B1) ─────────────────────────────────────────
  | "sectors"
  | "industries"
  | "themes"
  | "marketCapMin"
  | "marketCapMax"
  // ── Feeds (firm-aggregate subscription dimension) ────────
  | "feeds"
  // ── Notifications ────────────────────────────────────────
  // Read at runtime by every email path (daily-run-digest, proposal-pending,
  // place-trade open-email, closeTrade close-email, maybe-await-approval).
  | "emailAlerts";

/** Fields whose server payload must be coerced to BigInt for the BigInt? columns. */
const BIGINT_FIELDS: ReadonlySet<UpdatableField> = new Set<UpdatableField>([
  "marketCapMin",
  "marketCapMax",
]);

export async function updateAnalystField(
  id: string,
  field: UpdatableField,
  value: unknown,
): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");
  const accountId = await getAccountId(userId);
  if (!accountId) throw new Error("No account");
  const owned = await prisma.agentConfig.findFirst({
    where: { id, accountId },
    select: { id: true },
  });
  if (!owned) throw new Error("Analyst not found");

  // Normalize BigInt-backed Universe fields. UI sends number | null; Prisma
  // wants BigInt | null.
  let storedValue: unknown = value;
  if (BIGINT_FIELDS.has(field)) {
    if (value === null || value === undefined || value === "") {
      storedValue = null;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      storedValue = BigInt(Math.trunc(value));
    } else if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value);
      storedValue = Number.isFinite(n) ? BigInt(Math.trunc(n)) : null;
    } else {
      storedValue = null;
    }
  }

  // Session A: route universe arrays through the canonical normalizers so
  // inline chip edits can't re-seed the table with non-canonical values.
  // The combobox already emits canonical Title Case, but defensive
  // normalization protects against programmatic callers.
  if (field === "sectors" && Array.isArray(value)) {
    storedValue = normalizeSectors(value as string[]);
  } else if (field === "industries" && Array.isArray(value)) {
    storedValue = normalizeIndustries(value as string[]);
  } else if (field === "themes" && Array.isArray(value)) {
    storedValue = normalizeThemes(value as string[]);
  } else if (field === "feeds" && Array.isArray(value)) {
    storedValue = normalizeFeeds(value as string[]);
  }

  await prisma.agentConfig.update({
    where: { id },
    data: { [field]: storedValue },
  });

  revalidatePath(`/analysts/${id}`);
  revalidatePath("/analysts");
}

// ── Analyst monitor add/remove ──────────────────────────────────────────────
// Mirrors addSegmentMonitor / removeSegmentMonitor (lib/actions/podcast.actions.ts)
// 1:1 — same shape, same Monitor table, same downstream cron path.
// scope: "ANALYST" + analystId (vs PODCAST_SEGMENT + podcastSegmentId for segments).
//
// origin="USER" marks rows the user added directly via the settings sheet.
// The BUILDER-rebuild path filters by origin to avoid clobbering them on
// a config rewrite.

type AddAnalystMonitorInput =
  | { type: "DOMAIN"; name: string; domain: string; qualityScore?: number; reason?: string }
  | { type: "SEARCH"; name?: string; query: string; reason?: string };

export async function addAnalystMonitor(
  analystId: string,
  input: AddAnalystMonitorInput,
) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");
  const accountId = await getAccountId(userId);
  if (!accountId) throw new Error("No account");
  const analyst = await prisma.agentConfig.findFirst({
    where: { id: analystId, accountId },
    select: { id: true },
  });
  if (!analyst) throw new Error("Analyst not found");

  if (input.type === "DOMAIN") {
    const domain = input.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    await prisma.monitor.create({
      data: {
        accountId,
        name: input.name || domain,
        type: "DOMAIN",
        method: "perplexity_sonar",
        config: {
          domain,
          url: `https://${domain}`,
          qualityScore: Math.min(5, Math.max(1, Math.round(input.qualityScore ?? 3))),
          ...(input.reason ? { reason: input.reason } : {}),
        } as object,
        scope: "ANALYST",
        analystId: analyst.id,
        enabled: true,
        builtIn: false,
        origin: "USER",
        category: "THEMATIC",
      },
    });
  } else {
    await prisma.monitor.create({
      data: {
        accountId,
        name: input.name?.trim() || input.query,
        type: "SEARCH",
        method: "perplexity_sonar",
        config: {
          query: input.query,
          ...(input.reason ? { reason: input.reason } : {}),
        } as object,
        scope: "ANALYST",
        analystId: analyst.id,
        enabled: true,
        builtIn: false,
        origin: "USER",
        category: "THEMATIC",
      },
    });
  }
  revalidatePath(`/analysts/${analyst.id}`);
  revalidatePath("/analysts");
}

export async function removeAnalystMonitor(monitorId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");
  const accountId = await getAccountId(userId);
  if (!accountId) throw new Error("No account");
  const monitor = await prisma.monitor.findFirst({
    where: { id: monitorId, accountId },
    select: { id: true, analystId: true },
  });
  if (!monitor) {
    throw new Error("Monitor not found");
  }
  await prisma.monitor.delete({ where: { id: monitorId } });
  if (monitor.analystId) revalidatePath(`/analysts/${monitor.analystId}`);
  revalidatePath("/analysts");
}

// ── updateAnalystWatchlist (add/remove single symbol) ────────────────────────
// Now thin wrappers around addWatchlistItem / removeWatchlistItem from
// lib/actions/watchlist.actions.ts. Returns the live WATCHING symbol list.

import {
  addWatchlistItem,
  removeWatchlistItem,
} from "@/lib/actions/watchlist.actions";

async function getAnalystWatchingSymbols(
  analystId: string,
  accountId: string,
): Promise<string[]> {
  const theses = await prisma.thesis.findMany({
    where: {
      accountId,
      status: "WATCHING",
      researchRun: { agentConfigId: analystId },
    },
    select: { ticker: true },
    orderBy: { createdAt: "desc" },
  });
  return Array.from(new Set(theses.map((t) => t.ticker)));
}

export async function addToWatchlist(
  id: string,
  symbol: string,
): Promise<string[]> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");
  const accountId = await getAccountId(userId);
  if (!accountId) throw new Error("No account");

  await addWatchlistItem(id, symbol, "Added manually", "USER", "NORMAL");
  return getAnalystWatchingSymbols(id, accountId);
}

export async function removeFromWatchlist(
  id: string,
  symbol: string,
): Promise<string[]> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");
  const accountId = await getAccountId(userId);
  if (!accountId) throw new Error("No account");

  await removeWatchlistItem(id, symbol, "Removed manually");
  return getAnalystWatchingSymbols(id, accountId);
}

// ── deleteAnalyst (cascade delete all related data) ─────────────────────────

export async function deleteAnalyst(analystId: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");
  const accountId = await getAccountId(userId);
  if (!accountId) throw new Error("No account");

  // Verify ownership
  const config = await prisma.agentConfig.findFirst({
    where: { id: analystId, accountId },
  });
  if (!config) throw new Error("Analyst not found");

  // 1. Find all runs for this analyst
  const runs = await prisma.researchRun.findMany({
    where: { agentConfigId: analystId },
    select: { id: true },
  });
  const runIds = runs.map((r) => r.id);

  // 2. Find all positions for this analyst
  const positions = await prisma.position.findMany({
    where: { analystId },
    select: { id: true, symbol: true, status: true },
  });
  const positionIds = positions.map((p) => p.id);

  // 3. Close any open Alpaca positions
  const { closePosition: closeAlpacaPos } = await import("@/lib/alpaca");
  const creds = await resolveAlpacaCredentials(config.userId) ?? undefined;
  for (const pos of positions) {
    if (pos.status === "OPEN") {
      try {
        await closeAlpacaPos(pos.symbol, creds).catch(() => {});
      } catch {
        // Best effort — position may not exist
      }
    }
  }

  // 4. Find theses from those runs
  const theses = await prisma.thesis.findMany({
    where: { researchRunId: { in: runIds } },
    select: { id: true },
  });
  const thesisIds = theses.map((t) => t.id);

  // 5. Delete in dependency order (deepest first)
  await prisma.positionEvent.deleteMany({ where: { positionId: { in: positionIds } } });
  await prisma.tradeDecision.deleteMany({ where: { analystId } });
  await prisma.order.deleteMany({ where: { positionId: { in: positionIds } } });
  await prisma.position.deleteMany({ where: { id: { in: positionIds } } });
  await prisma.thesis.deleteMany({ where: { id: { in: thesisIds } } });
  // RunEvent and RunMessage cascade from ResearchRun (onDelete: Cascade)
  await prisma.analystBriefing.deleteMany({ where: { analystId } });
  await prisma.researchRun.deleteMany({ where: { id: { in: runIds } } });
  await prisma.agentConfig.delete({ where: { id: analystId } });

  revalidatePath("/analysts");
  revalidatePath("/trades");
  revalidatePath("/");
}

// ── updateAnalystFromBuilder (apply AI-suggested config to existing analyst) ──

export async function updateAnalystFromBuilder(
  id: string,
  data: Partial<BuilderConfig>
): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");
  const accountId = await getAccountId(userId);
  if (!accountId) throw new Error("No account");
  const owned = await prisma.agentConfig.findFirst({
    where: { id, accountId },
    select: { id: true },
  });
  if (!owned) throw new Error("Analyst not found");

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.analystPrompt !== undefined) updateData.analystPrompt = data.analystPrompt;
  if (data.directionBias !== undefined) updateData.directionBias = data.directionBias;
  if (data.holdDurations !== undefined) updateData.holdDurations = data.holdDurations;
  if (data.sectors !== undefined) updateData.sectors = normalizeSectors(data.sectors);
  if (data.signalTypes !== undefined) updateData.signalTypes = data.signalTypes;
  if (data.minConfidence !== undefined) updateData.minConfidence = data.minConfidence;
  if (data.maxPositionSize !== undefined) updateData.maxPositionSize = data.maxPositionSize;
  if (data.maxOpenPositions !== undefined) updateData.maxOpenPositions = data.maxOpenPositions;
  if (data.minMarketCapTier !== undefined) updateData.minMarketCapTier = data.minMarketCapTier;
  if (data.exclusionList !== undefined) updateData.exclusionList = data.exclusionList;

  // Session 3: Universe payload — writes directly to AgentConfig columns per
  // the Workstream B contract. Any omitted key leaves the existing value
  // untouched. `universe.exclusions` is merged into `exclusionList` (dedup).
  // Session A: sector/industry/theme arrays are run through the canonical
  // normalizers so AgentConfig never stores legacy SCREAMING_SNAKE or Sonar
  // title casing next to a GICS Title Case value.
  if (data.universe !== undefined) {
    const u = data.universe;
    if (Array.isArray(u.sectors)) updateData.sectors = normalizeSectors(u.sectors);
    if (Array.isArray(u.exchanges)) updateData.exchanges = u.exchanges;
    if (Array.isArray(u.industries)) updateData.industries = normalizeIndustries(u.industries);
    if (Array.isArray(u.themes)) updateData.themes = normalizeThemes(u.themes);
    // $5T ceiling — no real company approaches this, so anything above
    // is definitely a "no bound" sentinel the model slipped through. Cap
    // matches the Zod refine in suggest_config.ts.
    const CAP_CEILING = 5e12;
    if (typeof u.marketCapMin === "number" && Number.isFinite(u.marketCapMin)) {
      // 0 is a sentinel "no floor" the model sometimes sends despite the
      // schema instruction to omit. Treat as null.
      updateData.marketCapMin =
        u.marketCapMin === 0 || u.marketCapMin >= CAP_CEILING
          ? null
          : BigInt(Math.round(u.marketCapMin));
    } else if (u.marketCapMin === null) {
      updateData.marketCapMin = null;
    }
    if (typeof u.marketCapMax === "number" && Number.isFinite(u.marketCapMax)) {
      updateData.marketCapMax =
        u.marketCapMax >= CAP_CEILING ? null : BigInt(Math.round(u.marketCapMax));
    } else if (u.marketCapMax === null) {
      updateData.marketCapMax = null;
    }
    if (Array.isArray(u.exclusions) && u.exclusions.length > 0) {
      const base = Array.isArray(data.exclusionList) ? data.exclusionList : [];
      updateData.exclusionList = Array.from(
        new Set([...base, ...u.exclusions].map((s) => s.toUpperCase())),
      );
    }
    if (Array.isArray(u.feeds)) {
      updateData.feeds = normalizeFeeds(u.feeds);
    }
  }

  // Handle structured watchlist updates
  if (data.watchlist !== undefined) {
    const rawWatchlist = Array.isArray(data.watchlist) ? data.watchlist : [];
    const watchlistSymbols: string[] = [];
    const structuredItems: { symbol: string; reason: string; priority: string }[] = [];
    for (const item of rawWatchlist) {
      if (typeof item === "string") {
        watchlistSymbols.push(item.toUpperCase());
      } else if (item && typeof item === "object" && "symbol" in item) {
        const sym = String((item as { symbol: string }).symbol).toUpperCase();
        watchlistSymbols.push(sym);
        structuredItems.push({
          symbol: sym,
          reason: String((item as { reason?: string }).reason ?? "Updated via editor"),
          priority: String((item as { priority?: string }).priority ?? "NORMAL"),
        });
      }
    }
    // Editor watchlist diff against current WATCHING theses.
    // Adds → null-direction WATCHING under a fresh EDITOR_SEED ResearchRun.
    // Removes → status='ARCHIVED' on the paired thesis.
    if (structuredItems.length > 0 || watchlistSymbols.length > 0) {
      const existingWatching = await prisma.thesis.findMany({
        where: {
          status: "WATCHING",
          researchRun: { agentConfigId: id },
        },
        select: { id: true, ticker: true, status: true },
      });
      const newSymbolSet = new Set(watchlistSymbols);
      const toArchive = existingWatching.filter((t) => !newSymbolSet.has(t.ticker));
      const existingSymbolSet = new Set(existingWatching.map((t) => t.ticker));
      const toCreate = (
        structuredItems.length > 0
          ? structuredItems
          : watchlistSymbols.map((s) => ({ symbol: s, reason: "Updated via editor" }))
      ).filter((w) => !existingSymbolSet.has(w.symbol));

      // Archive removed names.
      for (const t of toArchive) {
        try {
          await prisma.thesis.update({
            where: { id: t.id },
            data: {
              // P1-24 B3: walk-away removal retires with reason DROPPED.
              status: "RETIRED",
              retiredReason: "DROPPED",
              closedAt: new Date(),
              closeReason: "Removed via editor chat",
            },
          });
          await prisma.thesisUpdate.create({
            data: {
              thesisId: t.id,
              type: "STATUS_CHANGED",
              summary: `Removed ${t.ticker} from watchlist via editor chat`,
              rationale: "Editor removed this ticker from the analyst's watchlist.",
              fieldChanges: {
                status: { from: t.status, to: "RETIRED" },
                retiredReason: { from: null, to: "DROPPED" },
              },
            },
          });
        } catch (err) {
          console.error(
            `[analyst:editor-update] ARCHIVED FAILED for ${t.ticker} (analyst ${id}):`,
            err,
          );
        }
      }

      // Create newly-added names.
      if (toCreate.length > 0) {
        try {
          const editorRun = await prisma.researchRun.create({
            data: {
              userId,
              accountId,
              agentConfigId: id,
              source: "EDITOR",
              status: "COMPLETE",
              mode: "EDITOR_SEED",
              environment: "PAPER",
              parameters: {
                note: "Editor analyst-update watchlist additions; one null-direction WATCHING thesis per ticker.",
                addCount: toCreate.length,
              },
              completedAt: new Date(),
            },
            select: { id: true },
          });

          const now = new Date();
          for (const w of toCreate) {
            const thesis = await prisma.thesis.create({
              data: {
                researchRunId: editorRun.id,
                userId,
                accountId,
                ticker: w.symbol,
                source: "EDITOR",
                // P1-24 B4: unresearched watchlist seed → direction=null, status
                // stays WATCHING. Agent promotes null → LONG/SHORT on first review.
                direction: null,
                status: "WATCHING",
                holdDuration: "SWING",
                // PR-9 flat schema seed (see builder-seed block above).
                snapshot: {
                  text: w.reason || "Editor-seeded — awaiting first research",
                  citations: [],
                },
                modelUsed: "editor",
                sourceKind: "EDITOR_SEED",
                sourceRationale: w.reason || "Editor-seeded via analyst-edit chat",
                nextReviewAt: now,
              },
              select: { id: true },
            });

            await prisma.thesisUpdate.create({
              data: {
                thesisId: thesis.id,
                type: "CREATED",
                summary: `Editor added ${w.symbol} to watchlist (awaiting first research)`,
                rationale: w.reason,
                fieldChanges: {},
                runId: editorRun.id,
              },
            });
          }
        } catch (err) {
          console.error(
            `[analyst:editor-update] watchlist-seed create FAILED for analyst ${id}:`,
            err,
          );
        }
      }
    }
  }

  // Update intelligence policy on AgentConfig if provided
  if (data.intelligencePolicy) {
    const policyInput = data.intelligencePolicy;
    updateData.intelligencePolicy = {
      ...DEFAULT_INTELLIGENCE_POLICY,
      holdingsAttention: policyInput.holdingsAttention,
      watchlistAttention: policyInput.watchlistAttention,
      discoveryAttention: policyInput.discoveryAttention,
      ...(policyInput.maxSignalsPerRun != null ? { maxSignalsPerRun: policyInput.maxSignalsPerRun } : {}),
      ...(policyInput.maxArtifactReads != null ? { maxArtifactReads: policyInput.maxArtifactReads } : {}),
      ...(policyInput.allowLiveSearch != null ? { allowLiveSearch: policyInput.allowLiveSearch } : {}),
      ...(policyInput.liveSearchBudget != null ? { liveSearchBudget: policyInput.liveSearchBudget } : {}),
    };
  }

  await prisma.agentConfig.update({
    where: { id },
    data: updateData,
  });

  // Create domain monitors from domainMonitorProposal (replace existing BUILDER-origin monitors)
  if (data.domainMonitorProposal && data.domainMonitorProposal.sources.length > 0) {
    // Remove old builder-created domain monitors for this analyst
    await prisma.monitor.deleteMany({
      where: { analystId: id, type: "DOMAIN", origin: "BUILDER" },
    });

    for (const src of data.domainMonitorProposal.sources) {
      const validCategory = (["MARKET", "SECTOR", "COMPANY", "THEMATIC", "SOCIAL", "EVENT"] as const)
        .includes(src.category as SourceCategory) ? src.category : "THEMATIC";
      await prisma.monitor.create({
        data: {
          accountId,
          name: src.name,
          type: "DOMAIN",
          method: "perplexity_sonar",
          config: {
            domain: src.domain,
            url: `https://${src.domain}`,
            qualityScore: Math.min(5, Math.max(1, Math.round(src.qualityScore))),
          },
          scope: "ANALYST",
          analystId: id,
          enabled: true,
          builtIn: false,
          origin: "BUILDER",
          category: validCategory,
        },
      });
    }
    console.log(`[analyst] Replaced domain monitors for analyst ${id}: ${data.domainMonitorProposal.sources.length} created`);
  }

  // Create search monitors from intelligenceQueries — full reset.
  // A rebuild through the Editor is the user intentionally redefining the
  // analyst's search queries from scratch, so we remove BOTH the previous
  // BUILDER-origin monitors AND any BRIEFING_AGENT-origin rows that
  // accumulated from the now-killed post-run auto-generator. Without this
  // second delete, rebuilt analysts still show dozens of stale
  // ticker-specific queries next to their clean new set of 5.
  if (data.intelligenceQueries && data.intelligenceQueries.length > 0) {
    await prisma.monitor.deleteMany({
      where: {
        analystId: id,
        type: "SEARCH",
        origin: { in: ["BUILDER", "BRIEFING_AGENT"] },
      },
    });

    for (const q of data.intelligenceQueries) {
      const validCategory = (["MARKET", "SECTOR", "TICKER", "THEMATIC", "EVENT"] as const)
        .includes(q.category as QueryCategory) ? q.category : "THEMATIC";
      await prisma.monitor.create({
        data: {
          accountId,
          name: q.query,
          type: "SEARCH",
          method: "perplexity_sonar",
          config: { query: q.query },
          scope: "ANALYST",
          analystId: id,
          enabled: true,
          builtIn: false,
          origin: "BUILDER",
          category: validCategory,
        },
      });
    }
    console.log(`[analyst] Replaced search monitors for analyst ${id}: ${data.intelligenceQueries.length} created (any BRIEFING_AGENT legacy rows also purged)`);
  }

  revalidatePath(`/analysts/${id}`);
  revalidatePath("/analysts");
}

/**
 * getAnalystTheses — returns ThesisCardData[] shaped for ThesisMiniCard.
 *
 * Used by the analyst detail page's Theses tab. Pulls the analyst's recent
 * theses (any status, any direction) ordered by updatedAt-desc so the most
 * recently touched bubble to the top — matches the dashboard sort post the
 * createdAt → updatedAt switch.
 */
export async function getAnalystTheses(analystId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id;
  if (!userId) return [];
  const accountId = await getAccountId(userId);
  if (!accountId) return [];

  const rows = await prisma.thesis.findMany({
    where: {
      accountId,
      researchRun: { agentConfigId: analystId },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      ticker: true,
      direction: true,
      status: true,
      scoring: true,
      snapshot: true,
      entryPrice: true,
      targetPrice: true,
      stopLoss: true,
      holdDuration: true,
    },
  });

  return rows.map((t) => {
    const composite = getThesisComposite(t);
    // P1-24: a pass/seed stores direction=null; the card keys its isPass on
    // status=PASSED, so pass null through honestly instead of coercing to PASS.
    const dir =
      t.direction === "LONG" || t.direction === "SHORT"
        ? (t.direction as "LONG" | "SHORT")
        : null;
    const status =
      t.status === "HOLDING" || t.status === "WATCHING" ||
      t.status === "PROMOTED" || t.status === "RETIRED" ||
      t.status === "PASSED"
        ? t.status
        : undefined;
    return {
      thesis_id: t.id,
      ticker: t.ticker,
      direction: dir,
      confidence_score: composite != null ? Math.round(composite * 10) : 0,
      reasoning_summary: getThesisSnapshotText(t),
      entry_price: t.entryPrice,
      target_price: t.targetPrice,
      stop_loss: t.stopLoss,
      hold_duration: t.holdDuration ?? undefined,
      status,
    };
  });
}
