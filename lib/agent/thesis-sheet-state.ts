/**
 * Prisma `select` block for the durable thesis fields that server pages
 * (stocks/[symbol], trades/[id]) read to build their ThesisRowData — status,
 * levels, snapshot, scoring, bull/bear case, horizon, etc. Spread it into a
 * `prisma.thesis.find*({ select: { ...thesisSheetStateSelect, ... } })`.
 *
 * (The old `buildThesisSheetState` builder + its `sheetState` forward-to-sheet
 * path was removed 2026-07-13 — it seeded the sheet synchronously (P2-19) but
 * the sheet always re-fetched anyway, so its only live consumer was a
 * redundant `.status` read. The sheet now hydrates from GET /api/theses/:id.)
 */
export const thesisSheetStateSelect = {
  id: true,
  ticker: true,
  direction: true,
  status: true,
  createdAt: true,
  closedAt: true,
  closeReason: true,
  invalidatedAt: true,
  invalidReason: true,
  retiredReason: true,
  horizon: true,
  entryPrice: true,
  targetPrice: true,
  stopLoss: true,
  targetSizePct: true,
  catalystDate: true,
  triggers: true,
  coreBelief: true,
  keyAssumptions: true,
  invalidationConds: true,
  scoring: true,
  fullResearch: true,
  // V2 flat-schema narrative columns (PR-9)
  snapshot: true,
  recentCatalysts: true,
  fundamentals: true,
  latestEarnings: true,
  catalystsAndEvents: true,
  bullCase: true,
  bearCase: true,
  analystConsensus: true,
  insiderTechnical: true,
  researchUpdatedAt: true,
  sourceKind: true,
  sourceRationale: true,
  sourceSignalIds: true,
  parentThesisId: true,
  // Conviction Expression v4
  conviction: true,
  convictionRationale: true,
  variantView: true,
} as const;
