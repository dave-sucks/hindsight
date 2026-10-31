"use server";

import { prisma } from "@/lib/prisma";
import { seedAnalystTriggers } from "@/lib/agent/triggers/seed-analyst";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { getLatestPricesWithMeta } from "@/lib/alpaca";
import type { TradeStatus } from "@/lib/mock-data/trades";
import { pickProposalOrder } from "@/lib/trade-status";
import { reviewCadenceTrigger } from "@/lib/agent/triggers/defaults";
import { agentWatchDays } from "@/lib/agent/triggers/agent-watch";
import { DEFAULT_INTELLIGENCE_POLICY } from "@/lib/intelligence/types";
import type { IntelligencePolicy } from "@/lib/intelligence/types";
import { getAccountId } from "@/lib/auth/account";
import { getHeldOrWatchedSymbols } from "@/lib/agent/watchlist-symbols";
import { NEW_ANALYST_DEFAULTS, normalizeAnalystPatch, watchlistAdds, watchlistReasons } from "@/lib/analyst-settings";
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
  /** Most in one stock — the ceiling for adding to a winner. */
  maxPositionTotal: number;
  /** Risk per trade, % of equity — sizes a buy from the stop distance (DAV-251). */
  riskPct: number;
  analystPrompt: string | null;
  description: string | null;
  sectors: string[];
  signalTypes: string[];
  holdDurations: string[];
  directionBias: string;
  minConfidence: number;
  maxOpenPositions: number;
  /** Per-entry floor; 0 = no floor. Enforced in place_trade. */
  minPositionSize: number;
  maxPositionSize: number;
  exchanges: string[];
  watchlist: string[];
  exclusionList: string[];
  // ── Universe (B1) — narrower discovery fence ─────────────────────
  industries: string[];
  themes: string[];
  marketCapMin: number | null;
  marketCapMax: number | null;
  dailyLossLimit: number;
  scheduleTime: string;
  /**
   * Per-analyst daily-run schedule. ISO weekdays (1=Mon..5=Fri) the morning
   * run executes on; [] / all-of-Mon–Fri = every weekday. The 5-min trigger
   * cron is independent — intraday reactivity fires every day regardless.
   */
  runDaysOfWeek: number[];
  /** The setups this analyst runs, catalog ids; the first is its signature setup (DAV-280). */
  setupIds: string[];
  /** Owner email opt-out for this analyst (new trades, fills, approval requests). */
  emailAlerts: boolean;
  createdAt: Date;
  updatedAt: Date;
  intelligencePolicy: Record<string, unknown> | null;
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
  /** True count of OPEN positions. openTrades is sliced to 3 for display. */
  openPositionCount: number;
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
  // Trade-as-Proposal — populated when this Position has an outstanding
  // order. AnalystTradeRow passes it through to TradeRow, which renders the
  // Review control while the decision is yours and "Executing" once it's sent.
  // See docs/plans/TRADE_AS_PROPOSAL.md §6.
  pendingProposal?: {
    orderId: string;
    intent: "OPEN" | "ADD" | "CLOSE" | "PARTIAL_CLOSE";
    /** Shares this proposal moves — the Order's qty, not the position's. */
    quantity: number;
    /** ISO — when the proposal lapses; drives the Expired state on the Review control. */
    expiresAt?: string;
    /** Approved, at Alpaca, not filled yet (Order.status PENDING). */
    executing?: boolean;
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
  recentTrades: PositionWithThesis[];
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

    const openPositions = configPositions.filter((p) => p.status === "OPEN");

    // openTrades is capped for display — openPositionCount is the real total,
    // so the card badge can't under-report an analyst holding more than 3.
    const openPositionCount = openPositions.length;

    const openTrades: AnalystOpenTrade[] = openPositions
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
      openPositionCount,
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

  const [recentPositions, totalRuns, totalTheses, watchlistTheses] = await Promise.all([
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
        // Trade-as-Proposal — the order this row describes: awaiting your
        // decision (AWAITING_APPROVAL) or already approved and waiting on the
        // fill (PENDING). Both keep the row; only the first offers a Review
        // control. Take a few and let pickProposalOrder rank them — take: 1
        // would let a newly-sent order hide a decision you still owe.
        orders: {
          where: { status: { in: ["AWAITING_APPROVAL", "PENDING"] } },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            status: true,
            intent: true,
            expiresAt: true,
            quantity: true,
          },
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
  ]);

  // Compute stats from all positions for this analyst.
  // PR-9 dropped the legacy `confidenceScore` Int — the conviction signal
  // moved into `scoring.composite` (Json `{ ... composite: number }`).
  // Prisma aggregate can't average a Json field; fetch the scoring blobs
  // and average composites client-side. Cheap on a per-analyst scope.
  const [allPositions, scoringRows] = await Promise.all([
    prisma.position.findMany({
      where: { accountId, analystId },
      select: { outcome: true, realizedPnl: true },
    }),
    prisma.thesis.findMany({
      where: { researchRun: { agentConfigId: analystId }, accountId },
      select: { scoring: true },
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

  // Map Prisma config (Json fields) → typed AnalystConfig
  const mappedConfig: AnalystConfig = {
    id: config.id,
    userId: config.userId,
    name: config.name,
    enabled: config.enabled,
    tradingEnvironment: (config.tradingEnvironment as "PAPER" | "LIVE") ?? "PAPER",
    maxPositionTotal: config.maxPositionTotal,
    riskPct: config.riskPct,
    analystPrompt: config.analystPrompt,
    description: config.description,
    sectors: config.sectors as string[],
    signalTypes: config.signalTypes as string[],
    holdDurations: config.holdDurations as string[],
    directionBias: config.directionBias,
    minConfidence: config.minConfidence,
    maxOpenPositions: config.maxOpenPositions,
    minPositionSize: config.minPositionSize,
    maxPositionSize: config.maxPositionSize,
    exchanges: (config.exchanges as string[]) ?? [],
    watchlist: watchlistTheses.map((t) => t.ticker),
    exclusionList: (config.exclusionList as string[]) ?? [],
    industries: (config.industries as string[]) ?? [],
    themes: (config.themes as string[]) ?? [],
    marketCapMin: config.marketCapMin != null ? Number(config.marketCapMin) : null,
    marketCapMax: config.marketCapMax != null ? Number(config.marketCapMax) : null,
    dailyLossLimit: config.dailyLossLimit,
    scheduleTime: config.scheduleTime,
    runDaysOfWeek: (config.runDaysOfWeek as number[] | undefined) ?? [1, 2, 3, 4, 5],
    setupIds: (config.setupIds as string[] | undefined) ?? [],
    emailAlerts: config.emailAlerts,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    intelligencePolicy: (config.intelligencePolicy as Record<string, unknown>) ?? null,
  };

  const mappedTrades: PositionWithThesis[] = recentPositions.map((p) => {
    const th = p.decisions[0]?.thesis;
    const composite = th ? getThesisComposite(th) : null;
    const proposal = pickProposalOrder(p.orders ?? []);
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
      pendingProposal: proposal
        ? {
            orderId: proposal.order.id,
            intent: (proposal.order.intent ?? "OPEN") as
              | "OPEN"
              | "ADD"
              | "CLOSE"
              | "PARTIAL_CLOSE",
            quantity: proposal.order.quantity ?? p.quantity,
            expiresAt: proposal.order.expiresAt?.toISOString(),
            executing: proposal.executing,
          }
        : undefined,
    };
  });

  return {
    config: mappedConfig,
    recentTrades: mappedTrades,
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
      dailyLossLimit: 300,
      holdDurations: data.holdDurations,
      directionBias: data.directionBias,
      signalTypes: [],
      scheduleTime: "08:00",
      priceCheckFreq: "HOURLY",
      weekendMode: false,
      graduationWinRate: 0.65,
      graduationMinTrades: 50,
      graduationProfitFactor: 1.5,
      tradingEnvironment: "PAPER",
      maxPositionTotal: data.maxPositionSize * 2,
      emailAlerts: true,
      weeklyDigestEnabled: true,
    },
  });
  // The seat's rules from the playbook, on its Triggers tab from day one (DAV-280).
  await seedAnalystTriggers(analyst.id);

  return { id: analyst.id };
}

// ── createAnalystFromBuilder (AI chat builder — richer config) ──────────────

export interface BuilderConfig {
  name: string;
  analystPrompt: string;
  description?: string;
  directionBias: "LONG" | "SHORT" | "BOTH";
  holdDurations: ("DAY" | "SWING" | "POSITION")[];
  /** The setups this analyst runs (DAV-280); the first is its signature setup. */
  setupIds?: string[];
  sectors: string[];
  signalTypes: string[];
  minConfidence: number;
  /** Per-entry floor; omit or 0 for no floor. */
  minPositionSize?: number;
  maxPositionSize: number;
  /** Most in one stock; omit for twice the largest trade. */
  maxPositionTotal?: number;
  /** Risk per trade, % of equity; omit for the default. */
  riskPct?: number;
  maxOpenPositions: number;
  watchlist?: string[];
  exclusionList?: string[];
  intelligencePolicy?: {
    allowLiveSearch?: boolean;
    liveSearchBudget?: number;
  };
  // The rest of the fence; sectors is above.
  industries?: string[];
  themes?: string[];
  marketCapMin?: number | null;
  marketCapMax?: number | null;
}

/** A new analyst before the proposal: what Create checks the proposal against. */
const NEW_ANALYST_ROW = {
  ...NEW_ANALYST_DEFAULTS,
  name: "Untitled Analyst",
  analystPrompt: "General market research analyst",
  description: "",
  setupIds: [] as string[],
  sectors: [] as string[],
  industries: [] as string[],
  themes: [] as string[],
  marketCapMin: null as bigint | null,
  marketCapMax: null as bigint | null,
  exclusionList: [] as string[],
};

export async function createAnalystFromBuilder(
  data: BuilderConfig
): Promise<{ id: string }> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");
  const accountId = await getAccountId(userId);
  if (!accountId) throw new Error("No account");

  // One normalizer for Create, Apply and Settings (lib/analyst-settings.ts):
  // the proposal on top of a new analyst's defaults.
  const fields = { ...NEW_ANALYST_ROW, ...normalizeAnalystPatch(NEW_ANALYST_ROW, data as unknown as Record<string, unknown>) };
  const signals = Array.isArray(data.signalTypes) ? data.signalTypes : [];

  console.log(`[analyst] Creating analyst: name="${fields.name}" sectors=${fields.sectors.join(",") || "all"} bias=${fields.directionBias} posSize=${fields.maxPositionSize} minConf=${fields.minConfidence}`);

  // The watchlist seeds: each name cleaned and once (watchlistAdds), with its reason.
  const reasons = watchlistReasons(data.watchlist);
  const seedItems = watchlistAdds(data.watchlist, []).map((symbol) => ({
    symbol,
    reason: reasons.get(symbol),
  }));

  // Build intelligence policy from builder proposal, merging with defaults
  const policyInput = data.intelligencePolicy;
  const intelligencePolicy: IntelligencePolicy = {
    ...DEFAULT_INTELLIGENCE_POLICY,
    ...(policyInput ? {
      ...(policyInput.allowLiveSearch != null ? { allowLiveSearch: policyInput.allowLiveSearch } : {}),
      ...(policyInput.liveSearchBudget != null ? { liveSearchBudget: policyInput.liveSearchBudget } : {}),
    } : {}),
  };

  // ── Transactional creation: analyst + watchlist ──
  const analyst = await prisma.$transaction(async (tx) => {
    // 1. Create the analyst config (core record)
    const newAnalyst = await tx.agentConfig.create({
      data: {
        userId,
        accountId,
        ...fields,
        enabled: true,
        markets: ["US_EQUITIES"],
        exchanges: ["NASDAQ", "NYSE"],
        // Watchlist removed from AgentConfig — Thesis(status=WATCHING) is
        // the single store now. Seed theses are minted below.
        dailyLossLimit: 300,
        signalTypes: signals,
        scheduleTime: "08:00",
        priceCheckFreq: "HOURLY",
        weekendMode: false,
        graduationWinRate: 0.65,
        graduationMinTrades: 50,
        graduationProfitFactor: 1.5,
        weeklyDigestEnabled: true,
        intelligencePolicy: intelligencePolicy as unknown as object,
      },
    });

    // 2. Watchlist-collapse: builder seeds as Thesis(direction=null/WATCHING,
    //    source_kind='BUILDER_SEED') under a fresh BUILDER_SEED ResearchRun.
    //    Thesis is the single store; AnalystWatchlistItem is gone.
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
              // Seed clock — see the W1 note in watchlist.actions.ts:
              // WATCHING doesn't inherit cadence, so a triggerless seed
              // is invisible forever. 7d = the old account-floor pace.
              triggers: [
                { ...reviewCadenceTrigger(7), source: "DEFAULT" },
              ] as object[],
              sourceKind: "BUILDER_SEED",
              sourceRationale: w.reason || "Builder-seeded during analyst creation",
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
          fieldChanges: {},
          runId: builderRun.id,
        })),
      });

      console.log(
        `[analyst] Created ${createdTheses.length} null-direction watchlist theses for analyst ${newAnalyst.id}`,
      );
    }


    return newAnalyst;
  });
  // The seat's rules from the playbook, on its Triggers tab from day one (DAV-280).
  await seedAnalystTriggers(analyst.id);

  console.log(`[analyst] Created analyst id=${analyst.id} name="${fields.name}" policy.liveSearchBudget=${intelligencePolicy.liveSearchBudget}`);
  revalidatePath("/analysts");
  return { id: analyst.id };
}

// ── updateAnalystField (direct inline edit of a single config field) ──────────

type UpdatableField =
  | "name"
  | "description"
  | "directionBias"
  | "minConfidence"
  // Position-size band. minPositionSize is the floor (0 = off); place_trade
  // rejects an entry below it rather than resizing — see Guardrail 5b in
  // lib/agent/tools/place-trade.ts and lib/agent/position-sizing.ts.
  | "minPositionSize"
  | "maxPositionSize"
  // Most in one stock — how far adding to a winner may grow a position.
  | "maxPositionTotal"
  // Risk per trade, % of equity — the one sizing setting (DAV-251).
  | "riskPct"
  | "maxOpenPositions"
  // NOTE: scheduleTime is an orphan field (no code path reads it). If
  // scheduling becomes per-analyst in the future, add it back.
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
  // ── Schedule ─────────────────────────────────────────────
  // Per-analyst daily-run days (ISO weekdays 1=Mon..5=Fri). Read by the
  // morning-research cron gate (lib/inngest/functions/morning-research.ts).
  | "runDaysOfWeek"
  // ── The setups this analyst runs (DAV-280) — catalog ids, first = signature.
  | "setupIds"
  // ── Notifications ────────────────────────────────────────
  // Read at runtime by every email path (daily-run-digest, proposal-pending,
  // place-trade open-email, closeTrade close-email, maybe-await-approval).
  | "emailAlerts";

/** The stored values a Settings or editor change is checked against. */
const STORED_FOR_PATCH = { name: true, analystPrompt: true, minPositionSize: true, maxPositionSize: true, maxPositionTotal: true } as const;

export async function updateAnalystField(
  id: string,
  field: UpdatableField,
  value: unknown,
): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");
  const accountId = await getAccountId(userId);
  if (!accountId) throw new Error("No account");
  const stored = await prisma.agentConfig.findFirst({
    where: { id, accountId },
    select: { id: true, ...STORED_FOR_PATCH },
  });
  if (!stored) throw new Error("Analyst not found");

  // The same normalizer as Create and Apply. It can move a second money
  // setting to fit the one just set (lib/analyst-settings.ts).
  const data = normalizeAnalystPatch(stored, { [field]: value });
  if (Object.keys(data).length > 0) {
    await prisma.agentConfig.update({ where: { id }, data });
  }

  revalidatePath(`/analysts/${id}`);
  revalidatePath("/analysts");
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
  const stored = await prisma.agentConfig.findFirst({
    where: { id, accountId },
    select: { id: true, ...STORED_FOR_PATCH },
  });
  if (!stored) throw new Error("Analyst not found");

  // One normalizer for Create, Apply and Settings (lib/analyst-settings.ts).
  const updateData: Record<string, unknown> = normalizeAnalystPatch(stored, data as unknown as Record<string, unknown>);
  if (data.signalTypes !== undefined) updateData.signalTypes = data.signalTypes;

  // Adds → null-direction WATCHING under a fresh EDITOR_SEED ResearchRun, the
  // names the change list showed (watchlistAdds). A name left out is kept: a
  // watch is dropped from its own page or by a run.
  if (data.watchlist !== undefined) {
    const reasons = watchlistReasons(data.watchlist);
    const toCreate = watchlistAdds(data.watchlist, await getHeldOrWatchedSymbols(id)).map((symbol) => ({
      symbol,
      reason: reasons.get(symbol),
    }));

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
              // Seed clock — same W1 rule as the builder seed above.
              triggers: [
                { ...reviewCadenceTrigger(7), source: "DEFAULT" },
              ] as object[],
              sourceKind: "EDITOR_SEED",
              sourceRationale: w.reason || "Editor-seeded via analyst-edit chat",
            },
            select: { id: true },
          });

          await prisma.thesisUpdate.create({
            data: {
              thesisId: thesis.id,
              type: "CREATED",
              // A title, never a paragraph: the reason is the seed's snapshot.
              summary: `Editor added ${w.symbol} to watchlist (awaiting first research)`,
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

  // Update intelligence policy on AgentConfig if provided
  if (data.intelligencePolicy) {
    const policyInput = data.intelligencePolicy;
    updateData.intelligencePolicy = {
      ...DEFAULT_INTELLIGENCE_POLICY,
      ...(policyInput.allowLiveSearch != null ? { allowLiveSearch: policyInput.allowLiveSearch } : {}),
      ...(policyInput.liveSearchBudget != null ? { liveSearchBudget: policyInput.liveSearchBudget } : {}),
    };
  }

  await prisma.agentConfig.update({
    where: { id },
    data: updateData,
  });


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
      createdAt: true,
      triggers: true,
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
      created_at: t.createdAt.toISOString(),
      agent_watch_days: agentWatchDays(t.triggers),
    };
  });
}
