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
  ThesisResearchSections,
  ThesisScoring,
  TriggersResponse,
} from "@/components/agent/sheets/ThesisTriggersSection";

export type ThesisSheetStateInput = {
  id: string;
  ticker: string;
  status: string;
  closedAt: Date | null;
  closeReason: string | null;
  invalidatedAt: Date | null;
  invalidReason: string | null;
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
  researchSections: unknown;
  researchUpdatedAt: Date | null;
  confidenceScore: number;
  sourceKind: string | null;
  sourceRationale: string | null;
  sourceSignalIds: string[];
  sourcesUsed: unknown;
  parentThesisId: string | null;
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
    closedAt: t.closedAt ? t.closedAt.toISOString() : null,
    closeReason: t.closeReason,
    invalidatedAt: t.invalidatedAt ? t.invalidatedAt.toISOString() : null,
    invalidReason: t.invalidReason,
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
    researchSections: (t.researchSections ?? null) as ThesisResearchSections | null,
    researchUpdatedAt: t.researchUpdatedAt ? t.researchUpdatedAt.toISOString() : null,
    confidenceScore: t.confidenceScore,
    sourceKind: t.sourceKind,
    sourceRationale: t.sourceRationale,
    sourceSignalIds: t.sourceSignalIds ?? [],
    sourcesUsed: t.sourcesUsed,
    parentThesisId: t.parentThesisId,
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
  closedAt: true,
  closeReason: true,
  invalidatedAt: true,
  invalidReason: true,
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
  researchSections: true,
  researchUpdatedAt: true,
  confidenceScore: true,
  sourceKind: true,
  sourceRationale: true,
  sourceSignalIds: true,
  sourcesUsed: true,
  parentThesisId: true,
} as const;
