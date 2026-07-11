/**
 * Build the `TriggersResponse` shape used by ThesisSheet from a Prisma
 * Thesis row, server-side. Mirrors the transformation in
 * `app/api/theses/[id]/triggers/route.ts` so pages that already have
 * the thesis selected from Prisma (watchlist sidebar, stocks/[symbol],
 * trades/[id]) can forward initial state to <ThesisSheet> via the
 * `sheetState` field on ThesisRowData (P2-19) — no skeletons-then-fetch
 * on sheet open.
 *
 * The forwarded state has `position: null` even on ACTIVE rows; the
 * client-side /triggers refresh fills that in. Forwarding the position
 * here would mean every page joining Position rows per-thesis, which
 * isn't worth the extra query for an info row the user sees a beat later.
 */
import { triggersArraySchema } from "@/lib/agent/triggers/schema";
import type {
  ResearchBulletSection,
  ResearchTextSection,
  ThesisScoring,
  TriggersResponse,
} from "@/components/agent/sheets/ThesisTriggersSection";

export type ThesisSheetStateInput = {
  id: string;
  ticker: string;
  status: string;
  direction: string | null;
  createdAt: Date;
  closedAt: Date | null;
  closeReason: string | null;
  invalidatedAt: Date | null;
  invalidReason: string | null;
  retiredReason: string | null;
  horizon: string | null;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  targetSizePct: number | null;
  catalystDate: Date | null;
  maxHoldDays: number | null;
  nextReviewAt: Date | null;
  triggers: unknown;
  coreBelief: string | null;
  keyAssumptions: string[];
  invalidationConds: string[];
  scoring: unknown;
  fullResearch: unknown;
  // V2 flat-schema narrative columns (PR-9). All Json? on the row.
  snapshot: unknown;
  recentCatalysts: unknown;
  fundamentals: unknown;
  latestEarnings: unknown;
  catalystsAndEvents: unknown;
  bullCase: unknown;
  bearCase: unknown;
  analystConsensus: unknown;
  insiderTechnical: unknown;
  researchUpdatedAt: Date | null;
  sourceKind: string | null;
  sourceRationale: string | null;
  sourceSignalIds: string[];
  parentThesisId: string | null;
  // Conviction Expression v4 — writer-side fields.
  conviction: string | null;
  convictionRationale: string | null;
  variantView: string | null;
};

type Scoring4Dim = {
  trendStrength?: unknown;
  relativeStrength?: unknown;
  entryQuality?: unknown;
  catalystFreshness?: unknown;
  composite?: number | null;
};

export function buildThesisSheetState(t: ThesisSheetStateInput): TriggersResponse {
  const parsed = triggersArraySchema.safeParse(t.triggers);
  // Schema-parsed triggers have an optional `id`; the consumer-side Trigger
  // type expects `id` required. Mirrors the same upcast that happens when
  // the /triggers API response is JSON-parsed client-side.
  const triggers = (parsed.success ? parsed.data : []) as TriggersResponse["triggers"];

  const topLevelScoring = (t.scoring ?? null) as Scoring4Dim | null;
  const legacyFullResearch = (t.fullResearch ?? null) as
    | { scoring?: Scoring4Dim; scoringComposite?: number | null }
    | null;
  const scoring: Scoring4Dim | null =
    topLevelScoring ??
    (legacyFullResearch?.scoring
      ? {
          ...legacyFullResearch.scoring,
          composite: legacyFullResearch.scoringComposite ?? null,
        }
      : null);
  const scoringComposite =
    topLevelScoring?.composite ?? legacyFullResearch?.scoringComposite ?? null;

  return {
    thesisId: t.id,
    ticker: t.ticker,
    status: t.status,
    direction: t.direction,
    createdAt: t.createdAt.toISOString(),
    closedAt: t.closedAt ? t.closedAt.toISOString() : null,
    closeReason: t.closeReason,
    invalidatedAt: t.invalidatedAt ? t.invalidatedAt.toISOString() : null,
    invalidReason: t.invalidReason,
    retiredReason: t.retiredReason,
    horizon: t.horizon,
    entryPrice: t.entryPrice,
    targetPrice: t.targetPrice,
    stopLoss: t.stopLoss,
    targetSizePct: t.targetSizePct,
    catalystDate: t.catalystDate ? t.catalystDate.toISOString() : null,
    maxHoldDays: t.maxHoldDays,
    nextReviewAt: t.nextReviewAt ? t.nextReviewAt.toISOString() : null,
    triggers,
    position: null,
    coreBelief: t.coreBelief,
    keyAssumptions: t.keyAssumptions ?? [],
    invalidationConds: t.invalidationConds ?? [],
    scoring: scoring as ThesisScoring | null,
    scoringComposite,
    snapshot: (t.snapshot ?? null) as ResearchTextSection | null,
    recentCatalysts: (t.recentCatalysts ?? null) as ResearchTextSection | null,
    fundamentals: (t.fundamentals ?? null) as ResearchTextSection | null,
    latestEarnings: (t.latestEarnings ?? null) as ResearchBulletSection | null,
    catalystsAndEvents: (t.catalystsAndEvents ?? null) as ResearchBulletSection | null,
    bullCase: (t.bullCase ?? null) as ResearchBulletSection | null,
    bearCase: (t.bearCase ?? null) as ResearchBulletSection | null,
    analystConsensus: (t.analystConsensus ?? null) as ResearchTextSection | null,
    insiderTechnical: (t.insiderTechnical ?? null) as ResearchTextSection | null,
    researchUpdatedAt: t.researchUpdatedAt ? t.researchUpdatedAt.toISOString() : null,
    sourceKind: t.sourceKind,
    sourceRationale: t.sourceRationale,
    sourceSignalIds: t.sourceSignalIds ?? [],
    parentThesisId: t.parentThesisId,
    // Conviction Expression v4
    conviction: (t.conviction ?? null) as TriggersResponse["conviction"],
    convictionRationale: t.convictionRationale,
    variantView: t.variantView,
  };
}

/**
 * Prisma `select` block matching `ThesisSheetStateInput`. Inline this
 * inside any `prisma.thesis.findMany({ select: { ... } })` that needs
 * to forward state via `buildThesisSheetState`.
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
  maxHoldDays: true,
  nextReviewAt: true,
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
