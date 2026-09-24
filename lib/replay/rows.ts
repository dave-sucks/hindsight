/**
 * rows.ts — production-shaped rows for the replay harness (DAV-311).
 *
 * Every builder returns a row the tools can actually read: the columns they
 * select, with the relations they join nested inline (the prisma double does
 * not join — see prisma-double.ts). Override anything; the defaults exist so
 * a test names only the three or four fields its case is about.
 *
 * Defaults are a healthy, boring row. If a test passes without overriding
 * anything, it is testing the boring case — which is usually a sign the case
 * has not been written yet.
 */

import type { Row } from "@/lib/replay/prisma-double";

export const REPLAY_USER_ID = "user_replay";
export const REPLAY_ACCOUNT_ID = "account_replay";
export const REPLAY_ANALYST_ID = "analyst_replay";
export const REPLAY_RUN_ID = "run_replay";

/** Days before `now`, as a Date — keeps fixtures off the wall clock. */
export const daysAgo = (n: number, now = new Date()) =>
  new Date(now.getTime() - n * 86_400_000);

export interface ThesisRowOverrides extends Row {
  id?: string;
  ticker?: string;
  status?: string;
  direction?: string | null;
  analystId?: string;
}

/**
 * A Thesis as `update_thesis` / `get_theses` select it, with `researchRun`
 * nested so an analyst-scoped `where` and a `select: { researchRun: … }`
 * both resolve.
 */
export function thesisRow(over: ThesisRowOverrides = {}): Row {
  const analystId = (over.analystId as string) ?? REPLAY_ANALYST_ID;
  const { analystId: _drop, ...rest } = over;
  void _drop;
  return {
    id: "thesis_replay",
    userId: REPLAY_USER_ID,
    accountId: REPLAY_ACCOUNT_ID,
    ticker: "AAA",
    status: "WATCHING",
    direction: "LONG",
    horizon: "TARGET",
    setupId: "BASE_BREAKOUT",
    coreBelief: "A falsifiable one-sentence claim.",
    keyAssumptions: ["assumption one", "assumption two"],
    invalidationConds: ["invalidation one", "invalidation two"],
    snapshot: { text: "snapshot", citations: [] },
    bullCase: { bullets: [{ text: "bull" }], citations: [] },
    bearCase: { bullets: [{ text: "bear" }], citations: [] },
    recentCatalysts: null,
    fundamentals: null,
    latestEarnings: null,
    catalystsAndEvents: null,
    analystConsensus: null,
    insiderTechnical: null,
    researchData: null,
    entryPrice: 100,
    targetPrice: 130,
    stopLoss: 90,
    triggers: [],
    triggerState: {},
    scoring: { composite: 7 },
    conviction: "MEDIUM",
    convictionRationale: "reasonable",
    variantView: null,
    catalystDate: null,
    retiredReason: null,
    closedAt: null,
    closeReason: null,
    invalidatedAt: null,
    invalidReason: null,
    parentThesisId: null,
    promotedAt: null,
    paperTenureDays: null,
    paperRealizedPnl: null,
    paperReviewCount: null,
    sourceKind: "WEB_SEARCH",
    sourceSignalIds: [],
    lastReviewedAt: null,
    researchUpdatedAt: daysAgo(3),
    createdAt: daysAgo(30),
    updatedAt: daysAgo(1),
    // Joined inline: the double projects relations off the row.
    researchRun: { agentConfigId: analystId, agentConfig: { name: "Replay Analyst", setupIds: [] } },
    ...rest,
  };
}

export function positionRow(over: Row = {}): Row {
  return {
    id: "position_replay",
    userId: REPLAY_USER_ID,
    accountId: REPLAY_ACCOUNT_ID,
    analystId: REPLAY_ANALYST_ID,
    symbol: "AAA",
    direction: "LONG",
    status: "OPEN",
    quantity: 100,
    initialQty: 100,
    avgCost: 100,
    peakPrice: null,
    environment: "PAPER",
    openedAt: daysAgo(10),
    closedAt: null,
    closePrice: null,
    realizedPnl: null,
    outcome: null,
    closeReason: null,
    closeSource: null,
    agentEvaluation: null,
    orders: [],
    events: [],
    ...over,
  };
}

export function thesisUpdateRow(over: Row = {}): Row {
  return {
    id: "thesis_update_replay",
    thesisId: "thesis_replay",
    type: "UPDATED",
    summary: "Updated AAA thesis",
    rationale: null,
    fieldChanges: {},
    priceAtTime: null,
    triggerId: null,
    runId: REPLAY_RUN_ID,
    tradeId: null,
    signalIds: [],
    timestamp: daysAgo(1),
    ...over,
  };
}

export function agentConfigRow(over: Row = {}): Row {
  return {
    id: REPLAY_ANALYST_ID,
    accountId: REPLAY_ACCOUNT_ID,
    userId: REPLAY_USER_ID,
    name: "Replay Analyst",
    enabled: true,
    minConfidence: 60,
    minPositionSize: 3000,
    maxPositionSize: 14000,
    maxPositionTotal: 0,
    maxOpenPositions: 6,
    setupIds: [],
    triggers: [],
    watchlist: [],
    exclusionList: [],
    ...over,
  };
}

export function accountRow(over: Row = {}): Row {
  return {
    id: REPLAY_ACCOUNT_ID,
    name: "Replay Account",
    triggers: [],
    setupOverrides: null,
    ...over,
  };
}
