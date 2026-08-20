"use client";

/**
 * ThesisSheet — standalone sheet body extracted from thesis-card.tsx.
 *
 * Exports:
 *  - ThesisSheetBody: raw content (no Sheet wrapper). Used by ThesisCard.
 *  - ThesisSheet: controlled Sheet wrapping ThesisSheetBody. Used by
 *    ThesisCardRenderer and any surface that needs to open the sheet
 *    programmatically without the card trigger.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PriceTargetsBlock } from "@/components/domain/price-targets-block";
import { ThesisChart } from "@/components/domain/thesis-chart";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { PriceChange } from "@/components/ui/price-change";
import { InfoRow } from "@/components/ui/info-row";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import Link from "next/link";
import { StockIdentityHeader } from "@/components/domain/stock-identity-header";
import { formatCurrency } from "@/lib/format";
import { TickBar, type Tick } from "@/components/ui/gauge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SourceChipData } from "@/components/chat/SourceChip";
import { ThesisTimelineSection } from "@/components/agent/sheets/ThesisTimelineSection";
import {
  ThesisTriggersSection,
  type ThesisDossier,
  type QuoteResponse,
  type ResolvedEnvelope,
  type ThesisResearchSections,
  type ResearchTextSection,
  type ResearchBulletSection,
  type ResearchCitation,
} from "@/components/agent/sheets/ThesisTriggersSection";
import type { StockCandle } from "@/lib/actions/finnhub.actions";
import type { AnalystCoverageData } from "@/lib/actions/analyst-coverage";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AnalystConsensusWidget,
  ResearchCitationChip,
} from "@/components/domain/analyst-consensus";
import { TradeStatement, type TradeStatementGain } from "@/components/ui/trade-statement";
import { ProposalActions } from "@/components/proposals/ProposalActions";
import { buildTradeSentence } from "@/lib/trade-statement";
import {
  getThesisStatusDisplay,
  type ThesisStatus,
} from "@/lib/thesis-status";
import { ChevronDown, Info } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types (canonical definitions — re-exported from thesis-card.tsx) ─────────

export type FundamentalsData = {
  market_cap?: number;
  pe_ratio?: number;
  beta?: number;
  avg_volume?: number;
  high_52w?: number;
  low_52w?: number;
  sector?: string;
  analyst_consensus?: { buy: number; hold: number; sell: number };
};

export type ThesisCardData = {
  /**
   * Persisted Thesis row id. Optional because agent runs render the card
   * inline before the row commits. When present, the sheet shows the
   * Activity timeline section by fetching ThesisUpdate rows.
   */
  thesis_id?: string;
  ticker: string;
  // P1-24: a committed view (LONG/SHORT) or null. A pass stores direction=null
  // and is identified by status=PASSED, not by the direction column.
  direction: "LONG" | "SHORT" | null;
  confidence_score: number;
  reasoning_summary?: string;
  thesis_bullets?: string[];
  risk_flags?: string[];
  entry_price?: number | null;
  target_price?: number | null;
  stop_loss?: number | null;
  hold_duration?: string;
  signal_types?: string[];
  sources?: SourceChipData[];
  pass_reason?: string;
  company_name?: string | null;
  exchange?: string | null;
  fundamentals?: FundamentalsData | null;
  // P1-24: PASSED is the researched-declined status (a pass now stores
  // direction=null). Threaded so the sheet's isPass keys on status.
  status?: "HOLDING" | "RETIRED" | "WATCHING" | "PROMOTED" | "PASSED";
  created_at?: string;
  /**
   * Per-thesis "needs work today" annotation set by get_theses (Fix #2).
   * Trigger-driven only — no hardcoded thresholds. Drives the alert chip
   * on the read-theses table row. null/undefined means no work needed.
   */
  needs_action?:
    | {
        kind: "TRIGGER_FIRED";
        triggerId: string;
        action: string;
        summary: string;
        firedAt: string;
      }
    | {
        kind: "TRIGGER_MATCHING_NOW";
        triggerId: string;
        action: string;
        predicateSummary: string;
        livePrice: number | null;
      }
    | { kind: "REVIEW_DUE"; daysOverdue: number }
    | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function hasFundamentalDetails(f: FundamentalsData): boolean {
  return (
    f.market_cap != null ||
    f.pe_ratio != null ||
    f.beta != null ||
    f.avg_volume != null ||
    f.high_52w != null ||
    f.low_52w != null ||
    !!f.sector
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

// ── StatusPill ──
// Single Badge with status dot + label. One render path, no PnL right
// cell, no per-status branches — same shape that appears on the
// read-theses table, the carousel cards, the trade detail header.

function StatusPill({ status }: { status: ThesisStatus }) {
  const display = getThesisStatusDisplay(status);
  return (
    <Badge variant="secondary" className="gap-1.5 font-normal">
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", display.dotClass)} />
      {display.label}
    </Badge>
  );
}

// ── ConvictionBadge ──
// Conviction Expression v4 — writer's view-strength tier. Sits next to
// StatusPill in the ThesisSheet header. Tooltip surfaces the writer's
// one-sentence rationale (≤200 chars). See
// docs/plans/CONVICTION_EXPRESSION.md §8.
//
// Tier → ShadCN Badge variant (no className overrides per CLAUDE.md):
//   STRONG → positive (highest visibility)
//   HIGH   → positive
//   MEDIUM → secondary
//   LOW    → outline (most muted)
//
// Renders null on unknown tier or pre-v4 legacy rows (conviction null).
function ConvictionBadge({
  conviction,
  rationale,
}: {
  conviction: "STRONG" | "HIGH" | "MEDIUM" | "LOW" | null;
  rationale: string | null;
}) {
  if (!conviction) return null;
  const variant: "positive" | "secondary" | "outline" =
    conviction === "STRONG" || conviction === "HIGH"
      ? "positive"
      : conviction === "MEDIUM"
        ? "secondary"
        : "outline";
  // Sentence-case label: "Strong Conviction" / "High Conviction" /
  // "Medium Conviction" / "Low Conviction". Per principal feedback —
  // bare tier ("HIGH") didn't make clear what the badge represented.
  const label = `${conviction.charAt(0)}${conviction.slice(1).toLowerCase()} Conviction`;
  const badge = <Badge variant={variant}>{label}</Badge>;
  // Wrap in tooltip when a rationale exists; bare badge otherwise.
  if (!rationale) return badge;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="cursor-help inline-flex items-center" />}>
        {badge}
      </TooltipTrigger>
      <TooltipContent>{rationale}</TooltipContent>
    </Tooltip>
  );
}

// ── ActionabilityBadge ──
// Conviction Expression v4 reader-side — the at-a-glance "can I act on
// this now or not" rollup. Driven by `resolved.actionability` from the
// /triggers API. Sits next to StatusPill + ConvictionBadge in the sheet
// header. See docs/plans/CONVICTION_EXPRESSION.md §8.
//
// State → label + variant:
//   ENTER_NOW              → "READY TO BUY"          positive
//   WAIT_FOR_TRIGGER       → "WAITING — <detail>"    secondary
//   PENDING_CATALYST       → "PENDING CATALYST"      secondary
//   ACTIVE_HOLD            → "HOLDING"               secondary
//   STALE_PAST_CATALYST    → "STALE"                 outline
//   SUPERSEDED             → "SUPERSEDED"            outline
//   PROMOTED_DECIDE_TODAY  → "DECIDE TODAY"          positive
//   DEAD                   → null (status pill already conveys this)
//
// triggerDetail is surfaced as the WAITING label suffix when present
// (e.g. "WAITING — needs $92.50, at $90.30 (-2.4%)").
function ActionabilityBadge({
  resolved,
}: {
  resolved: ResolvedEnvelope;
}) {
  if (resolved.actionability === "DEAD") return null;

  let label: string;
  let variant: "positive" | "secondary" | "outline";
  switch (resolved.actionability) {
    case "ENTER_NOW":
      label = "READY TO BUY";
      variant = "positive";
      break;
    case "WAIT_FOR_TRIGGER":
      label = resolved.triggerDetail
        ? `WAITING — ${resolved.triggerDetail}`
        : "WAITING";
      variant = "secondary";
      break;
    case "PENDING_CATALYST":
      label = "PENDING CATALYST";
      variant = "secondary";
      break;
    case "ACTIVE_HOLD":
      label = "HOLDING";
      variant = "secondary";
      break;
    case "STALE_PAST_CATALYST":
      label = "STALE";
      variant = "outline";
      break;
    case "SUPERSEDED":
      label = "SUPERSEDED";
      variant = "outline";
      break;
    case "PROMOTED_DECIDE_TODAY":
      label = "DECIDE TODAY";
      variant = "positive";
      break;
  }

  return <Badge variant={variant}>{label}</Badge>;
}

// ── VariantViewBlock ──
// Conviction Expression v4 — the writer's contrarian take. Renders as a
// peer section (same styling as Key Assumptions + Invalidation
// Conditions), not as a special Card callout. Per principal feedback
// 2026-05-31: variant view "isn't that much more unique than the
// others" — should sit alongside the other writer-judgment sections
// in the natural body flow, not be visually elevated.
//
// Renders null when variantView is null (MEDIUM/LOW theses or pre-v4
// backfill rows). See docs/plans/CONVICTION_EXPRESSION.md §8.
function VariantViewBlock({ variantView }: { variantView: string | null }) {
  if (!variantView || variantView.trim().length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
        Variant View
      </p>
      <p className="text-sm text-foreground leading-relaxed">{variantView}</p>
    </div>
  );
}

// ── PositionRow ──
// Plain text, no card wrapper. Three stacked lines:
//   "Bought {N} shares at ${avg}, now trading at ${current}"
//   +$X ↗ N.NN%                                                (one size up)
//   "{LONG|SHORT} · target ${T} / stop ${S} · {HORIZON} horizon"
//
// The third line is the "intent" suffix — at-a-glance what kind of
// trade this is and where the exits are. Renders only when we have
// horizon/target/stop info to show.

// ── TradeBlock helpers ──

/** Compact "Jun 2" date for the meta line. */
function fmtTradeDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Close reason from close_position is an enum (TARGET / STOP / MANUAL) or
 * PROMOTED from the promote action — sometimes with " — {notes}" appended.
 * Rendering "STOP" raw read as a broken label; humanize the known codes and
 * pass through anything that's already a sentence.
 */
function humanizeCloseReason(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const [head, ...rest] = raw.split(" — ");
  const map: Record<string, string> = {
    STOP: "Stopped out",
    TARGET: "Hit target",
    MANUAL: "Closed manually",
    PROMOTED: "Closed on promotion to live",
  };
  const mapped = map[head.trim().toUpperCase()];
  if (mapped) return rest.length ? `${mapped} — ${rest.join(" — ")}` : mapped;
  return raw;
}

// ── TradeBlock ──
// The ONE trade section in the sheet. Every state — pending proposal,
// holding, closed — renders through the SAME container and the SAME slot
// layout below (heading · optional Review · P&L · note · meta). Only the
// slot values differ per state; the JSX is shared, so the states are
// guaranteed to be visually identical blocks. The headings follow one
// consistent grammar:
//   • pending buy      → "Proposed: Buy N shares at $entry"
//   • holding          → "Bought N shares at $entry, now trading at $current"
//   • closed           → "Bought N shares at $entry, closed at $closePrice"
//   • held + pending   → "Proposed: Bought N shares at $entry, <verb> at $current"
// The meta line carries the timestamp per state (Opened / Closed / Expires).
// `position` (cost basis + qty + dates) comes from /triggers; `pnl` (live
// price + unrealized P&L) from /quote — the two land at different times, so
// the P&L line appears once /quote resolves. See TRADE_AS_PROPOSAL.md §6.
function TradeBlock({
  position,
  pnl,
  pendingProposal,
  direction,
}: {
  position: NonNullable<ThesisDossier["position"]>;
  pnl: QuoteResponse["positionPnl"] | null;
  pendingProposal: {
    orderId: string;
    intent: "OPEN" | "ADD" | "CLOSE" | "PARTIAL_CLOSE";
    quantity: number;
    expiresAt: string | null;
    rationale: string | null;
  } | null;
  direction: "LONG" | "SHORT" | null;
}) {
  const pp = pendingProposal;
  const entry = position.avgCost;
  const current = pnl?.currentPrice ?? null;

  // The sentence is built by the SHARED buildTradeSentence, and the row is the
  // SHARED <TradeStatement> — the exact same component + visual the trade detail
  // page uses (dot + font-medium sentence + inline gain). This block only picks
  // the per-state inputs (sentence / dot color / gain / Review / note / meta);
  // the look is not re-implemented here.
  let sentence: string | null;
  let review: ReactNode = null;
  let gain: TradeStatementGain | null = null;
  let dotClass = "bg-muted-foreground/40";
  let note: string | null = null;
  let meta: string | null = null;

  if (pp && pp.intent === "OPEN") {
    // ── Pending buy (no position held yet) ──
    sentence = buildTradeSentence({
      kind: "proposed-buy",
      qty: pp.quantity,
      entry,
      buyVerb: direction === "SHORT" ? "Short" : "Buy",
    });
    review = <ProposalActions orderId={pp.orderId} align="end" />;
    dotClass = "bg-amber-500";
    note = pp.rationale;
    meta = pp.expiresAt ? `Expires ${fmtTradeDate(pp.expiresAt)}` : null;
  } else if (pp) {
    // ── Held + pending sell / add / trim ──
    // Action leads, entry context trails: "Proposed: Sell at $45.41, bought
    // 100 shares at $40.93". Adds/trims carry the proposal's own share count.
    sentence = buildTradeSentence({
      kind: "proposed-exit",
      qty: position.quantity,
      entry,
      current,
      exitVerb:
        pp.intent === "ADD" ? "add" : pp.intent === "CLOSE" ? "close" : "trim",
      proposalQty: pp.quantity,
    });
    review = <ProposalActions orderId={pp.orderId} align="end" />;
    dotClass = "bg-amber-500";
    if (pnl != null) gain = { dollar: pnl.unrealizedPnl, pct: pnl.unrealizedPnlPct };
    note = pp.rationale;
    meta = pp.expiresAt ? `Expires ${fmtTradeDate(pp.expiresAt)}` : null;
  } else if (position.closed) {
    // ── Closed ──
    sentence = buildTradeSentence({
      kind: "closed",
      qty: position.quantity,
      entry,
      closePrice: position.closePrice,
    });
    dotClass = "bg-muted-foreground/40";
    if (position.realizedPnl != null)
      gain = { dollar: position.realizedPnl, pct: position.realizedPnlPct ?? 0 };
    note = humanizeCloseReason(position.closeReason);
    meta = position.closedAt ? `Closed ${fmtTradeDate(position.closedAt)}` : null;
  } else {
    // ── Holding ──
    sentence = buildTradeSentence({
      kind: "holding",
      qty: position.quantity,
      entry,
      current,
    });
    dotClass = "bg-positive";
    if (pnl != null) gain = { dollar: pnl.unrealizedPnl, pct: pnl.unrealizedPnlPct };
    meta =
      `Opened ${fmtTradeDate(position.openedAt)}` +
      (position.daysHeld > 0 ? ` · ${position.daysHeld}d held` : "");
  }

  return (
    <div className="rounded-lg border px-4 py-3 space-y-1.5">
      {/* Review sits on its own row ABOVE the statement, left-aligned — the
          statement row is always the same shape (dot + sentence left, P&L
          right), never squeezed by an action control. */}
      {review ? <div className="flex justify-start">{review}</div> : null}
      <TradeStatement dotClass={dotClass} sentence={sentence} gain={gain} />
      {note ? (
        <p className="text-sm text-muted-foreground leading-relaxed">{note}</p>
      ) : null}
      {/* Meta line doubles as the path to the trade detail page — the old
          standalone "View trade →" under the sheet header is gone (principal
          feedback: the banner already exists exactly when a trade exists). */}
      {meta || position.id ? (
        <p className="text-xs text-muted-foreground">
          {meta}
          {position.id ? (
            <>
              {meta ? " · " : null}
              <Link
                href={`/trades/${position.id}`}
                className="hover:text-foreground hover:underline underline-offset-2"
              >
                View trade →
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

// WatchingRow ("Watching for entry above $X") was deleted in this redesign.
// The headline is now coreBelief — the standing opinion — and the actual
// entry condition is read from the ENTER trigger below it. The derived
// headline duplicated trigger data, often got stale, and pre-empted the
// belief text from being the visual anchor.

// ── Composite tier badge variant ──
// Same Badge palette as AnalystVerdictBadge so the header right-side reads
// the same across the price/consensus/composite trio:
//   ≥7   → positive (green, like "Strong Buy")
//   4-7  → secondary (neutral gray)
//   <4   → negative (red)

function compositeTierVariant(
  score: number,
): "positive" | "secondary" | "negative" {
  if (score >= 7) return "positive";
  if (score >= 4) return "secondary";
  return "negative";
}

// The TriggerFiredBanner that previously lived here was deleted on
// 2026-05-19 when the recent-trigger banner was removed from the sheet
// header (2026-05-18). The component had no remaining call sites and
// its `recentFire` query in /triggers added ~100-200ms to every sheet
// open for data that already lives in the Activity timeline below.

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/**
 * ScoringRow — one row of the 4-dimension composite breakdown.
 *
 * Restyled 2026-05-18 to mirror the Schedule section's InfoRow pattern:
 * sentence-case label on the left, `score/max` on the right, bottom
 * border between rows, and the agent's one-sentence justification note
 * rendered as a full-width muted line directly underneath. Renders
 * nothing if the dimension is missing on the thesis (older rows minted
 * before the scoring rubric shipped).
 */
/**
 * ScoringRow — one row of the 4-dimension composite breakdown.
 *
 * The underlying rubric is intentionally coarse (caps of 3/3/2/2) — it
 * exists as a forcing function for the agent to grade 4 named dimensions
 * rather than write "I like this." It is NOT a sophisticated quant
 * rubric. The gauge below visualizes the score as filled segments rather
 * than "2/3" text so the coarseness reads as a deliberate scale instead
 * of "we couldn't pick more granular numbers."
 *
 * Each dim renders as `max` segments, `score` of them filled, the
 * remainder hollow. Half-integer scores (the agent occasionally emits
 * 1.5/3 on edge calls) fill the rounded count + render the half-segment
 * as a 50%-opacity fill so 1.5/3 reads as one fully-on + one half-lit +
 * one hollow.
 */
function ScoringRow({
  label,
  dim,
  max,
}: {
  label: string;
  dim?: { score: number; note?: string };
  max: number;
}) {
  if (!dim) return null;
  // Plain row — label + Info-icon tooltip on the left, gauge on the right.
  // No InfoRow wrapper because the per-row border-b doesn't belong inside
  // the gray Composite Score card (it visually competed with the bar).
  return (
    <div className="flex items-center justify-between gap-3 min-h-7 text-sm">
      <span className="font-light text-foreground inline-flex items-center gap-1">
        {label}
        {dim.note ? (
          <Tooltip>
            <TooltipTrigger render={<span className="cursor-help inline-flex items-center" />}>
              <Info className="h-3 w-3 text-muted-foreground/70" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{dim.note}</TooltipContent>
          </Tooltip>
        ) : null}
      </span>
      <ScoringGauge score={dim.score} max={max} />
    </div>
  );
}

/**
 * ScoringGauge — score visualization as a fill bar built on the same
 * TickBar primitive as the Price Targets gauge below. Identical density,
 * identical tick height, identical color palette — the two gauges should
 * be visually interchangeable in style.
 *
 * Mirrors PriceGauge's defaults: 60 ticks, height 16, w-0.5 strokes,
 * `bg-foreground` for the filled portion and `bg-muted-foreground/25`
 * for the empty portion. The fill ratio is `score / max` so the bar
 * works regardless of the dim's max (3 or 2): `1/2` → 30 filled,
 * `2/3` → 40 filled (rounded), `1.5/3` → 30 filled.
 *
 * Per-dim score numbers are intentionally not rendered — the gauge is
 * the visual; the only number on the screen is the composite `/10` at
 * the section header.
 */
function ScoringGauge({ score, max }: { score: number; max: number }) {
  // 10 ticks rendered through the shared TickBar primitive — same w-0.5
  // strokes + gray-empty / foreground-filled palette as PriceGauge. Uses
  // the base (shorter) tick height — full `tall` height made the gauge
  // overpower the row label. Width tightened to w-20 so the ticks sit
  // dense enough to read as a single gauge instead of an inflated grid.
  const COUNT = 10;
  const fillRatio = max > 0 ? Math.max(0, Math.min(1, score / max)) : 0;
  const filledTicks = Math.round(fillRatio * COUNT);
  const ticks: Tick[] = Array.from({ length: COUNT }, (_, i) => ({
    color: i < filledTicks ? "bg-foreground" : "bg-muted-foreground/40",
  }));
  return <TickBar ticks={ticks} className="w-16 shrink-0" />;
}

// Per-block skeletons were deleted 2026-06-02. The sheet now does a single
// atomic load (see the ThesisSheetBody effect + the `loaded` gate): one full
// skeleton while every fetch is in flight, then the whole body renders once
// with complete data. Each block renders iff its value is present — no
// tri-state (`real : loading-skeleton : null`), no partial-paint window.

// ── TradeStructureBlock ───────────────────────────────────────────────
// Compact single-row block of trade-shape mechanics: next review (with
// the absolute date in tooltip), max hold (TRADE horizon only — see
// THESIS_ARCHITECTURE §7), target size as % of portfolio. Renders nothing
// when there's no data — and renders ONLY the cells that have values, so
// COMPOUNDER theses (no max hold) and theses without a target size don't
// produce empty slots. Lives in this file so it can be reordered next to
// price-targets without touching ThesisTriggersSection.

function fmtRelativeDate(iso: string): string {
  const d = new Date(iso);
  const diffMs = d.getTime() - Date.now();
  const diffDays = Math.round(diffMs / 86_400_000);
  const dateLabel = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (diffDays === 0) return `${dateLabel} · today`;
  if (diffDays > 0) return `${dateLabel} · ${diffDays}d`;
  return `${dateLabel} · ${Math.abs(diffDays)}d ago`;
}

const HORIZON_TOOLTIP: Record<string, string> = {
  CATALYST: "Exit on the catalyst event (good or bad), or 30 days past the catalyst date.",
  TARGET: "Open-ended hold. Exit only at target, stop, or thesis invalidation.",
  TRADE: "Bounded short-term trade. Exit on stop, target, or maxHoldDays reached.",
  COMPOUNDER: "Multi-year hold. Exits only when invalidation triggers fire — never auto-exits on time.",
};

function TradeStructureBlock({
  state,
}: {
  state: {
    horizon: string | null;
    nextReviewAt: string | null;
    maxHoldDays: number | null;
    targetSizePct: number | null;
    resolved?: ResolvedEnvelope | null;
  };
}) {
  const hasHorizon = state.horizon != null;
  const hasNextReview = state.nextReviewAt != null;
  const showMaxHold = state.horizon === "TRADE" && state.maxHoldDays != null;
  const hasSize = state.targetSizePct != null;
  // Conviction Expression v4 — actionability rollup. Lives in Trade
  // Structure (not as a top-of-sheet badge per principal feedback) —
  // it's "execution context" alongside Horizon / Next review / Size.
  const hasStatus =
    state.resolved != null && state.resolved.actionability !== "DEAD";

  if (!hasHorizon && !hasNextReview && !showMaxHold && !hasSize && !hasStatus)
    return null;

  const cells: { label: string; value: React.ReactNode; tooltip?: string }[] = [];
  // Status first — it's the "should I act on this right now" answer
  // that should anchor reading the row.
  if (hasStatus && state.resolved) {
    const r = state.resolved;
    let statusValue: React.ReactNode;
    switch (r.actionability) {
      case "ENTER_NOW":
        statusValue = "Ready to buy";
        break;
      case "WAIT_FOR_TRIGGER":
        statusValue = r.triggerDetail
          ? `Waiting — ${r.triggerDetail}`
          : "Waiting on trigger";
        break;
      case "PENDING_CATALYST":
        statusValue = "Catalyst pending";
        break;
      case "ACTIVE_HOLD":
        statusValue = "Holding";
        break;
      case "STALE_PAST_CATALYST":
        statusValue = "Past catalyst — review";
        break;
      case "SUPERSEDED":
        statusValue = "Superseded by newer thesis";
        break;
      case "PROMOTED_DECIDE_TODAY":
        // Promoted is a daily-run forcing function (paper position was
        // force-closed at promotion; user said yes to live money). Use
        // the affirmative tone — same `text-emerald-500` ProposalActions
        // uses for approved actions — to carry urgency through the
        // status cell instead of inventing a third header badge.
        statusValue = (
          <span className="text-emerald-500">Decide today — re-enter / wait / kill</span>
        );
        break;
      default:
        statusValue = r.actionability;
    }
    cells.push({ label: "Status", value: statusValue });
  }
  if (hasHorizon) {
    cells.push({
      label: "Horizon",
      value: state.horizon,
      tooltip: HORIZON_TOOLTIP[state.horizon!] ?? undefined,
    });
  }
  if (hasNextReview) {
    cells.push({
      label: "Next review",
      value: fmtRelativeDate(state.nextReviewAt!),
      tooltip: new Date(state.nextReviewAt!).toLocaleString(),
    });
  }
  if (showMaxHold) {
    cells.push({
      label: "Max hold",
      value: `${state.maxHoldDays} days`,
    });
  }
  if (hasSize) {
    cells.push({
      label: "Target size",
      value: `${state.targetSizePct}% of portfolio`,
    });
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
        Trade Structure
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        {cells.map((c, i) => (
          <span key={c.label} className="inline-flex items-center gap-1.5">
            {i > 0 && <span className="text-muted-foreground/40">·</span>}
            <span className="text-muted-foreground">{c.label}</span>
            {c.tooltip ? (
              <Tooltip>
                <TooltipTrigger render={<span className="font-medium tabular-nums cursor-default" />}>
                  {c.value}
                </TooltipTrigger>
                <TooltipContent className="text-xs">{c.tooltip}</TooltipContent>
              </Tooltip>
            ) : (
              <span className="font-medium tabular-nums">{c.value}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── ProvenanceFooter ───────────────────────────────────────────────────
// Where this thesis came from. Rendered as a junior trailing entry that
// LINES UP WITH the activity timeline above — same `flex gap-3` outer,
// same `size-1.5 rounded-full` rail dot, same `flex-1 min-w-0` body.
// Visually it reads as the last row in the timeline list rather than a
// floating footer. Matches the structure in ThesisTimelineSection.
function ProvenanceFooter({
  sourceKind,
  rationale,
  signalCount,
}: {
  sourceKind: string;
  rationale: string | null;
  signalCount: number;
}) {
  const labelByKind: Record<string, string> = {
    ROUTED_SIGNAL: "Routed signal",
    WEB_SEARCH: "Web search",
    WATCHLIST_REVIEW: "Watchlist review",
    POSITION_REVIEW: "Position review",
    USER_ADDED: "Manual add",
    BUILDER_SEED: "Analyst create",
    EDITOR_SEED: "Editor chat",
  };
  const label = labelByKind[sourceKind] ?? sourceKind;
  // Two-line layout matching the activity timeline entries above:
  //   • Sourced via Web search                ← text-sm, foreground
  //     1 signal · Found via read_signals…    ← text-xs, muted
  // The dot column is the same width as the timeline rail so this row
  // lines up exactly with the entries above it.
  const subline = [
    signalCount > 0
      ? `${signalCount} signal${signalCount === 1 ? "" : "s"}`
      : null,
    rationale ?? null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center shrink-0">
        <div className="size-1.5 rounded-full bg-muted-foreground/40 mt-1.5" />
      </div>
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-sm leading-snug">Sourced via {label}</p>
        {subline ? (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {subline}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── TerminalStatusAlert ─────────────────────────────────────────────────
// Renders a single Alert when the thesis is in a terminal state. Tells
// the user *why* the thesis ended + when, so the rest of the sheet
// (entry levels, triggers, etc.) reads as history rather than as live
// state. Added 2026-05-18 (THESIS_CLEANUP PR-2) — both reasons were
// fetched but never rendered.
function TerminalStatusAlert({
  status,
  retiredReason,
  closedAt,
  closeReason,
  invalidatedAt,
  invalidReason,
}: {
  status: ThesisStatus | undefined;
  retiredReason: string | null;
  closedAt: string | null;
  closeReason: string | null;
  invalidatedAt: string | null;
  invalidReason: string | null;
}) {
  // CLOSED is deliberately NOT handled here. A closed position renders
  // inside TradeBlock ("Bought N @ $X, closed at $Y" + realized P&L + close
  // reason) — the single source of truth for the closed trade state. This
  // banner exists only for terminal states with NO trade to show:
  // INVALIDATED (thesis disproven) and ARCHIVED (walked away from the
  // watchlist without ever trading).
  // P1-24 B3: legacy INVALIDATED/ARCHIVED collapse into RETIRED + retiredReason.
  // Show the banner only for the no-trade terminals: legacy INVALIDATED /
  // ARCHIVED, or RETIRED with reason INVALIDATED / DROPPED. RETIRED+SOLD has a
  // real trade (TradeBlock owns it) and RETIRED+REPLACED is shown via
  // supersession — skip both, same as CLOSED.
  const retiredNoTrade =
    status === "RETIRED" &&
    (retiredReason === "INVALIDATED" || retiredReason === "DROPPED");
  if (!retiredNoTrade) {
    return null;
  }
  // RETIRED+INVALIDATED tracks invalidatedAt/invalidReason; RETIRED+DROPPED
  // ("walked away" without a trade outcome) reuses closedAt/closeReason.
  const isInvalid = retiredReason === "INVALIDATED";
  const date = isInvalid ? invalidatedAt : closedAt;
  const reason = isInvalid ? invalidReason : closeReason;
  if (!date && !reason) return null;
  const title = isInvalid ? "Thesis invalidated" : "Thesis archived";
  const formattedDate = date
    ? new Date(date).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;
  return (
    <Alert>
      <AlertTitle>{title}{formattedDate ? ` · ${formattedDate}` : ""}</AlertTitle>
      {reason ? <AlertDescription>{reason}</AlertDescription> : null}
    </Alert>
  );
}

// ── ResearchSectionsAccordion ───────────────────────────────────────────
// Renders the deep-research synthesis (THESIS_RESEARCH_V2 Phase 1) as a
// list of independently-collapsible sections.
//
// Defensive against the two shape-drift modes observed in production:
//   1. Key naming. write_thesis_research's parser emits camelCase keys
//      (bullCase, bearCase, latestEarnings, ...). But the thesis-writer
//      AGENT often reconstructs sections itself with snake_case keys
//      (bull_case, bear_case, latest_earnings, analyst_consensus,
//      insider_and_technical, catalysts_and_events) — the same names that
//      appear as ## headers in the synthesis prompt. Observed on the
//      2026-05-20 $MU thesis (cmpetjrw5...). We accept BOTH conventions
//      and map them to one canonical key.
//   2. Value shape. The canonical shape is { text, citations } or
//      { bullets[] }. But the agent often passes section values as raw
//      strings (just the section's prose). When the renderer did
//      `"text" in section` on a string value, JS throws "Cannot use 'in'
//      operator to search for 'text' in <string>" and the WHOLE thesis
//      sheet crashes. We normalize string values into { text: <string> }
//      so the rest of the renderer keeps working.
//
// The agent-side fix (have the worker pass write_thesis_research's parsed
// output verbatim) is a separate change. This renderer needs to be
// robust regardless, because every existing thesis with a string value
// is permanently broken until normalized at read time.
function ResearchSectionsAccordion({
  sections,
  updatedAt,
}: {
  // Accept `unknown` at the input boundary — the DB column is Json? and
  // the agent may have stored any shape. We normalize defensively inside.
  sections: ThesisResearchSections | Record<string, unknown> | null | undefined;
  updatedAt: string | null;
}) {
  // ── Section key aliases ────────────────────────────────────────────
  // Map every variant the agent has been observed to produce → canonical
  // camelCase key. Add new aliases here when a new variant appears in
  // production; existing theses don't need to be backfilled.
  const KEY_ALIASES: Record<string, keyof ThesisResearchSections> = {
    snapshot: "snapshot",
    recent_catalysts: "recentCatalysts",
    recentCatalysts: "recentCatalysts",
    fundamentals: "fundamentals",
    latest_earnings: "latestEarnings",
    latestEarnings: "latestEarnings",
    catalysts_and_events: "catalystsAndEvents",
    catalystsAndEvents: "catalystsAndEvents",
    bull_case: "bullCase",
    bullCase: "bullCase",
    bear_case: "bearCase",
    bearCase: "bearCase",
    analyst_consensus: "analystConsensusSynthesis",
    analyst_consensus_synthesis: "analystConsensusSynthesis",
    analystConsensus: "analystConsensusSynthesis",
    analystConsensusSynthesis: "analystConsensusSynthesis",
    insider_and_technical: "insiderTechnicalSetup",
    insider_technical_setup: "insiderTechnicalSetup",
    insiderTechnical: "insiderTechnicalSetup",
    insiderTechnicalSetup: "insiderTechnicalSetup",
  };

  // ── Normalize a single section value ───────────────────────────────
  const normalizeSection = (
    value: unknown,
  ): ResearchTextSection | ResearchBulletSection | null => {
    if (value == null) return null;
    // String-shaped section (most common drift) → wrap as { text }.
    if (typeof value === "string") {
      return value.trim().length > 0 ? { text: value } : null;
    }
    if (typeof value !== "object") return null;
    const obj = value as Record<string, unknown>;
    // Bullet shape: { bullets: ResearchBullet[] }.
    if (Array.isArray(obj.bullets)) {
      const bullets = obj.bullets.filter(
        (b): b is { text: string; citation?: unknown } =>
          typeof b === "object" && b !== null && typeof (b as { text?: unknown }).text === "string",
      );
      return bullets.length > 0
        ? ({ bullets } as ResearchBulletSection)
        : null;
    }
    // Text shape: { text, citations? }.
    if (typeof obj.text === "string" && obj.text.length > 0) {
      const citations = Array.isArray(obj.citations) ? obj.citations : undefined;
      return { text: obj.text, ...(citations ? { citations } : {}) } as ResearchTextSection;
    }
    return null;
  };

  // ── Normalize the whole sections object ────────────────────────────
  const normalized: Partial<ThesisResearchSections> = {};
  if (sections && typeof sections === "object") {
    for (const [rawKey, rawValue] of Object.entries(sections)) {
      const canonical = KEY_ALIASES[rawKey];
      if (!canonical) continue;
      // Last-write wins on key collision (e.g. both `bull_case` and
      // `bullCase` present — vanishingly unlikely but defined here).
      const sec = normalizeSection(rawValue);
      if (sec) normalized[canonical] = sec as never;
    }
  }

  // Display order + labels. Snapshot + Analyst Consensus are promoted out
  // of the accordion to tier-1 always-visible blocks (Snapshot as prose
  // under Core Belief; Analyst Consensus as a structured widget). Order
  // here matches the user-facing accordion grouping spec — Bull/Bear come
  // first since they're the most opened sections.
  const RENDER_ORDER: Array<{ key: keyof ThesisResearchSections; label: string }> = [
    { key: "bullCase", label: "Bull Case" },
    { key: "bearCase", label: "Bear Case" },
    { key: "recentCatalysts", label: "Recent Catalysts" },
    { key: "catalystsAndEvents", label: "Catalysts & Events" },
    { key: "fundamentals", label: "Fundamentals" },
    { key: "latestEarnings", label: "Latest Earnings" },
    { key: "insiderTechnicalSetup", label: "Insider & Technical" },
  ];

  // Filter to only sections that are actually populated; if none, hide the
  // whole block. Synthesis output is variable — don't render empty shells.
  const populated = RENDER_ORDER.filter(({ key }) => normalized[key] != null);
  if (populated.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
          Research Synthesis
        </p>
        {updatedAt ? (
          <p className="text-xs text-muted-foreground">
            Updated {relativeTime(updatedAt)}
          </p>
        ) : null}
      </div>
      <div className="rounded-lg border divide-y">
        {populated.map(({ key, label }) => {
          const section = normalized[key]!;
          return (
            <Collapsible key={key}>
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm font-medium hover:bg-muted/30 transition-colors data-[panel-open]:bg-muted/20">
                <span>{label}</span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform data-[panel-open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="px-3 pb-3 text-sm leading-relaxed">
                <ResearchSectionContent section={section} />
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}

function ResearchSectionContent({
  section,
}: {
  section: ResearchTextSection | ResearchBulletSection;
}) {
  // Bullets shape. Guard inside the map for bullet-text drift too —
  // some bullets may be raw strings in older theses.
  if ("bullets" in section) {
    return (
      <ul className="space-y-1.5">
        {section.bullets.map((b, i) => {
          const bulletText =
            typeof b === "string"
              ? (b as string)
              : typeof b?.text === "string"
                ? b.text
                : "";
          const citation =
            typeof b === "object" && b !== null && "citation" in b
              ? b.citation
              : undefined;
          if (!bulletText) return null;
          return (
            <li key={i} className="flex gap-2">
              <span className="text-muted-foreground select-none">•</span>
              <span className="flex-1 whitespace-pre-wrap">
                {bulletText}
                {citation ? <ResearchCitationChip citation={citation} /> : null}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <p className="whitespace-pre-wrap">
      {section.text}
      {section.citations && section.citations.length > 0 ? (
        <span className="ml-1 inline-flex flex-wrap gap-1">
          {section.citations.map((c, i) => (
            <ResearchCitationChip key={i} citation={c} />
          ))}
        </span>
      ) : null}
    </p>
  );
}

// ResearchCitationChip + AnalystConsensusWidget moved to
// components/domain/analyst-consensus.tsx — the ONE Street-view widget shared
// with the stock page sidebar. Imported above.

// ─── ThesisSheetBody ──────────────────────────────────────────────────────────

// One skeleton for the ENTIRE sheet — shown while the atomic load is in flight.
// Mirrors the real layout (identity header, price line, trade block, thesis
// paragraph, chart) so there's no layout jump when the real content swaps in.
function ThesisSheetSkeleton() {
  return (
    <div className="px-4 pb-6 pt-2 space-y-5">
      {/* Identity header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 rounded-lg shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
        {/* Price line */}
        <Skeleton className="h-6 w-40" />
      </div>
      {/* Trade block */}
      <Skeleton className="h-20 w-full rounded-lg" />
      {/* Thesis paragraph */}
      <div className="space-y-2">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-11/12" />
        <Skeleton className="h-5 w-3/4" />
      </div>
      {/* Chart */}
      <Skeleton className="h-[300px] w-full rounded-lg" />
    </div>
  );
}

// The sheet's ENTIRE contract: which thesis. Everything rendered is fetched by
// thesis_id — the durable dossier (GET /api/theses/:id) gates the paint, then
// the live layers (quote, candles, coverage) hydrate their own regions. No
// row-snapshot props, no second source. (Callers still hand ThesisSheet full
// ThesisCardData for back-compat; the wrapper forwards only these two fields.)
export interface ThesisSheetBodyProps {
  /** Persisted Thesis id — the sheet loads everything by this. */
  thesis_id?: string;
  /** Only used before/without a load: skeleton a11y + the error state. */
  ticker: string;
}

export function ThesisSheetBody({ thesis_id, ticker }: ThesisSheetBodyProps) {
  // ── Durable-first paint, progressive live hydration ──────────────────────
  // The sheet fires FOUR requests on open, but only the durable dossier gates
  // the paint. Everything price/vendor-dependent hydrates its own region after
  // the body is already readable, so the slowest vendor never blocks the sheet:
  //   • GET /api/theses/:id                  → dossier (DB only) — GATES paint
  //   • GET /api/theses/:id/quote            → price + PnL + resolved (Finnhub)
  //   • GET /api/stocks/candles?symbols=…    → price chart (Alpaca)
  //   • GET /api/theses/:id/analyst-coverage → consensus (FMP — the slow one)
  // Each live layer has its own loading flag driving a region-level skeleton.
  const [state, setState] = useState<ThesisDossier | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [candles, setCandles] = useState<StockCandle[] | null>(null);
  const [candlesLoading, setCandlesLoading] = useState(true);
  const [coverage, setCoverage] = useState<AnalystCoverageData | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(true);
  // Bumped after a trigger edit so the dossier re-fetches and the open sheet
  // reflects the new value without a manual reopen (live layers don't move).
  const [refreshKey, setRefreshKey] = useState(0);

  // Re-gate (show the skeletons) only when a DIFFERENT thesis opens — NOT on a
  // refreshKey bump from a trigger edit, which swaps the dossier in place. Clear
  // the live data too, not just the loading flags: otherwise an in-place
  // thesis_id switch briefly renders the PREVIOUS thesis's price/chart/coverage
  // (the coverage gate keys on `!coverage`, so a stale value suppresses its
  // skeleton).
  useEffect(() => {
    setLoaded(false);
    setQuote(null);
    setCandles(null);
    setCoverage(null);
    setQuoteLoading(true);
    setCandlesLoading(true);
    setCoverageLoading(true);
  }, [thesis_id]);

  // Durable dossier — the ONLY fetch that gates the paint. Re-runs on a
  // trigger edit (refreshKey) to swap the new triggers in place.
  useEffect(() => {
    if (!thesis_id) return;
    let cancelled = false;
    fetch(`/api/theses/${thesis_id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: ThesisDossier | null) => {
        if (cancelled) return;
        setState(json);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [thesis_id, refreshKey]);

  // Live layers — each hydrates its own region and none gate the paint. Quote
  // ALSO re-fetches on refreshKey: it carries the `resolved` envelope, whose
  // actionability is computed from the thesis's triggers, so a trigger edit
  // must re-resolve it (candles/coverage don't move on a trigger edit).
  useEffect(() => {
    if (!thesis_id) return;
    let cancelled = false;
    // Note: quoteLoading is NOT set here — it's true initially + re-asserted by
    // the thesis-change reset effect. A refreshKey refetch (trigger edit) then
    // updates price + resolved in place without flashing the header skeleton.
    fetch(`/api/theses/${thesis_id}/quote`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: QuoteResponse | null) => {
        if (!cancelled) setQuote(json);
      })
      .catch(() => {
        if (!cancelled) setQuote(null);
      })
      .finally(() => {
        if (!cancelled) setQuoteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [thesis_id, refreshKey]);

  useEffect(() => {
    if (!thesis_id) return;
    // No ticker → nothing to chart; clear the loading flag so the chart region
    // doesn't sit on an eternal skeleton (the reset effect set it true).
    if (!ticker) {
      setCandlesLoading(false);
      return;
    }
    let cancelled = false;
    setCandlesLoading(true);
    fetch(`/api/stocks/candles?symbols=${encodeURIComponent(ticker)}&days=400`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { candles?: Record<string, StockCandle[]> } | null) => {
        if (cancelled) return;
        setCandles(json?.candles?.[ticker.toUpperCase()] ?? null);
      })
      .catch(() => {
        if (!cancelled) setCandles(null);
      })
      .finally(() => {
        if (!cancelled) setCandlesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [thesis_id, ticker]);

  useEffect(() => {
    if (!thesis_id) return;
    let cancelled = false;
    setCoverageLoading(true);
    fetch(`/api/theses/${thesis_id}/analyst-coverage`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: AnalystCoverageData | null) => {
        if (!cancelled) setCoverage(json);
      })
      .catch(() => {
        if (!cancelled) setCoverage(null);
      })
      .finally(() => {
        if (!cancelled) setCoverageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [thesis_id]);

  // Skeleton until the DURABLE dossier settles, an honest error if it failed.
  // Past these two gates `state` is non-null, so the body renders from durable
  // DB data; the live regions fill in as their fetches land. A sheet without a
  // persisted id (e.g. a failed record_thesis card) has nothing to load —
  // that's the error state, not an eternal skeleton.
  if (!loaded && thesis_id) {
    return <ThesisSheetSkeleton />;
  }
  if (!state) {
    return (
      <div className="px-4 py-16 text-center space-y-1">
        <p className="text-sm font-medium">Couldn&apos;t load this thesis</p>
        <p className="text-xs text-muted-foreground">
          {ticker} — the thesis data failed to load. Close and reopen the sheet to retry.
        </p>
      </div>
    );
  }

  // ── Derived — durable from `state`, live from the hydration states ────────
  const resolved = quote?.resolved ?? null;
  const liveStatus = state.status as ThesisStatus;
  const position = state.position;
  // P1-24: a pass is identified by status=PASSED (direction is null on a pass).
  const isPass = state.status === "PASSED";
  const direction: "LONG" | "SHORT" | null =
    state.direction === "LONG" || state.direction === "SHORT"
      ? state.direction
      : null;
  const entryPrice = state.entryPrice;
  const targetPrice = state.targetPrice;
  const stopLoss = state.stopLoss;
  const showLevels =
    !isPass && entryPrice != null && (targetPrice != null || stopLoss != null);
  // Identity ships in the payload (StockInfo cache via quote); the bare ticker
  // is the degenerate case when the identity lookup itself failed.
  const displayName = quote?.companyName ?? ticker;
  // Legacy mint-time consensus: pre-PR-9 rows stored FundamentalsData (with
  // analyst_consensus) in the same Thesis.fundamentals column that now holds
  // the research section. Same column, one read — shape-sniffed for old rows.
  const mintConsensus =
    (state.fundamentals as { analyst_consensus?: { buy: number; hold: number; sell: number } } | null)
      ?.analyst_consensus ?? null;

  // Conviction Expression v4 — writer's tier verdict + rationale + variantView.
  // Null on pre-v4 (legacy) or PASS/PENDING rows (which skip conviction).
  const conviction = (state.conviction ?? null) as
    | "STRONG"
    | "HIGH"
    | "MEDIUM"
    | "LOW"
    | null;
  const convictionRationale = state.convictionRationale ?? null;
  const variantView = state.variantView ?? null;

  return (
    <div className="px-4 pb-6 pt-2 space-y-5">

      {/* ── Terminal-status reason ──────────────────────────── */}
      {/* When the thesis ended (CLOSED / INVALIDATED / ARCHIVED), surface
          the reason + date right at the top so the user doesn't have to
          dig through the activity timeline to find out what happened.
          Previously these fields were fetched but never rendered. */}
      {/* Terminal non-trade states only (INVALIDATED / ARCHIVED). CLOSED is
          NOT shown here — it renders inside TradeBlock below as the single
          closed-trade state. TerminalStatusAlert returns null for CLOSED /
          ACTIVE / WATCHING, so rendering it unconditionally is safe: no
          loading-window race, and structurally impossible to double up with
          the closed trade block. */}
      <TerminalStatusAlert
        status={liveStatus}
        retiredReason={state.retiredReason ?? null}
        closedAt={state.closedAt ?? null}
        closeReason={state.closeReason ?? null}
        invalidatedAt={state.invalidatedAt ?? null}
        invalidReason={state.invalidReason ?? null}
      />

      {/* ── Stock identity + live price ──────────────────────── */}
      {/* StockIdentityHeader is the SAME component the trade detail page uses,
          so the two surfaces read identically. Name + logo link to
          /stocks/[ticker] (the broad view); the path to the trade detail page
          lives in the trade block's meta line inside the Thesis tab. The
          Review control for a pending proposal lives inside the trade block. */}
      <div className="space-y-2">
        <StockIdentityHeader
          ticker={ticker}
          // Identity rides in the payload (StockInfo cache) — one source.
          displayName={displayName}
          exchange={quote?.exchange ?? null}
          badges={
            <>
              <StatusPill status={liveStatus} />
              <ConvictionBadge conviction={conviction} rationale={convictionRationale} />
            </>
          }
        />
        {/* Live current price + day's change. Comes from the separate
            /quote endpoint (slow — Finnhub call) so this block usually
            paints after the rest of the sheet body. Skeleton while
            /quote is still in flight; nothing if it returned null
            (Finnhub failure). */}
        {/* Live price hydrates from /quote after the dossier paints: skeleton
            while in flight, the price line once it lands, nothing if Finnhub
            failed (currentPrice null). */}
        {quoteLoading ? (
          <Skeleton className="h-7 w-32" />
        ) : quote?.currentPrice != null ? (
          <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
            <span className="text-xl font-semibold tabular-nums">
              {formatCurrency(quote.currentPrice)}
            </span>
            {quote.dayChange != null && (
              <PriceChange
                dollarChange={quote.dayChange}
                percentChange={quote.dayChangePct}
                size="xl"
              />
            )}
          </div>
        ) : null}
      </div>

      {/* ── Tabs: Thesis (the dossier) | Activity (the audit log) ── */}
      {/* Only identity + live price stay fixed above (principal feedback
          2026-08-19); the belief, trade block, and everything else split
          into the dossier view and the P1-33 activity timeline (trigger
          fires → runs → outcomes). Same Tabs idiom as AgentChat. */}
      <Tabs defaultValue={0}>
        <TabsList>
          <TabsTrigger value={0}>Thesis</TabsTrigger>
          <TabsTrigger value={1}>Activity</TabsTrigger>
        </TabsList>

        <TabsContent value={0} className="space-y-5">

      {/* ── Core Belief headline ─────────────────────────────── */}
      {/* The ONE durable claim — a falsifiable prediction (≤30 words) the
          trade evaluator grades on close. Large + normal weight so it
          reads as the load-bearing claim, and it leads the tab body: main
          summary first, then the trade row, then the chart. */}
      {state.coreBelief ? (
        <p className="text-xl font-normal leading-relaxed">
          {state.coreBelief}
        </p>
      ) : null}

      {/* ── Trade block (one unified, state-aware section) ── */}
      {/* The single place the trade lives. Headline morphs by state:
          held → "Bought N @ $X, now $Y" + P&L; pending buy → "Proposed:
          buy N @ $X"; held + pending sell/add/trim → the holding line PLUS
          the proposed action + rationale + Review dropdown, all in one
          grouped block. Its meta line carries the "View trade →" link.
          See docs/plans/TRADE_AS_PROPOSAL.md §6. */}
      {position ? (
        <TradeBlock
          position={position}
          pnl={quote?.positionPnl ?? null}
          pendingProposal={state.position?.pendingProposal ?? null}
          direction={direction}
        />
      ) : null}

      {/* ── Price chart (annotated) ───────────────────────────── */}
      {/* Full price line with Entry/Target/Stop lines + "Watching"/"Entry"
          markers, when candles are loaded. The entry/target/stop GAUGE lives
          further down with the Price Targets / Consensus / Composite card
          cluster. See docs/plans/THESIS_VISUALIZATION.md. */}
      {!isPass && candlesLoading ? (
        <Skeleton className="h-[300px] w-full rounded-lg" />
      ) : !isPass && candles && candles.length >= 2 ? (
        <ThesisChart
          ticker={ticker}
          candles={candles}
          direction={direction === "SHORT" ? "SHORT" : "LONG"}
          entryPrice={entryPrice}
          avgCost={position?.avgCost ?? null}
          targetPrice={targetPrice}
          stopLoss={stopLoss}
          current={quote?.currentPrice ?? null}
          addedAt={state.createdAt}
          enteredAt={position?.openedAt ?? null}
          soldAt={position?.closedAt ?? null}
          variant="full"
        />
      ) : null}

      {/* ── Triggers (moved up — they're the standing opinion in action) ── */}
      {thesis_id ? (
        <ThesisTriggersSection
          thesisId={thesis_id}
          data={state}
          direction={direction}
          editable={
            !isPass && (liveStatus === "HOLDING" || liveStatus === "WATCHING")
          }
          onChanged={() => setRefreshKey((k) => k + 1)}
        />
      ) : null}

      {/* ── Snapshot ──────────────────────────────────────────── */}
      {/* Descriptive summary paragraph (the analyst's "where this name
          is right now" prose). Lives at tier-1 so it surfaces alongside
          Core Belief — Belief says what WILL happen, Snapshot says what
          IS happening. Citations render as inline chips. Skeleton while
          /triggers is in flight. */}
      {state.snapshot ? (
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {state.snapshot.text}
          {state.snapshot.citations && state.snapshot.citations.length > 0 ? (
            <span className="ml-1 inline-flex flex-wrap gap-1">
              {state.snapshot.citations.map((c, i) => (
                <ResearchCitationChip key={i} citation={c} />
              ))}
            </span>
          ) : null}
        </p>
      ) : null}

      {/* (The old props-fed "Pass reason" paragraph is gone — a PASSED
          thesis's reasoning lives in the Snapshot section above, straight
          from the payload.) */}

      {/* ── Card cluster: Price Targets → Analyst Consensus → Composite ── */}

      {/* Price Targets — the entry/target/current/stop gauge (same visual
          the mini-cards show). Lives here with the other assessment cards,
          not next to the chart. */}
      {showLevels && entryPrice != null ? (
        <PriceTargetsBlock
          entry={entryPrice}
          target={targetPrice}
          stop={stopLoss}
          current={quote?.currentPrice ?? null}
          direction={direction === "SHORT" ? "SHORT" : "LONG"}
        />
      ) : null}

      {/* Analyst Consensus — Buy/Hold/Sell distribution + price-target range
          vs current. Coverage (FMP — the slow vendor) hydrates on its own
          boundary so it never blocks the chart; skeleton until it lands.
          mintConsensus is the legacy pre-PR-9 shape read off the dossier. */}
      {coverageLoading && !coverage ? (
        <Skeleton className="h-40 w-full rounded-lg" />
      ) : (
        <AnalystConsensusWidget
          coverage={coverage}
          fallbackConsensus={mintConsensus}
          narrative={state.analystConsensus ?? null}
          currentPrice={quote?.currentPrice ?? null}
        />
      )}

      {/* Composite Score — 4-dim scoring breakdown. Composite is the single
          conviction number after PR-9 (legacy `confidenceScore` int dropped). */}
      {state.scoring ? (
        <Card className="bg-muted/40 p-2 gap-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
              Composite Score
            </p>
            {state.scoringComposite != null && (
              <Badge
                variant={compositeTierVariant(state.scoringComposite)}
                className="font-normal tabular-nums"
              >
                {state.scoringComposite}/10
              </Badge>
            )}
          </div>
          <div className="space-y-0.5">
            <ScoringRow label="Trend strength" dim={state.scoring.trendStrength} max={3} />
            <ScoringRow label="Relative strength" dim={state.scoring.relativeStrength} max={3} />
            <ScoringRow label="Entry quality" dim={state.scoring.entryQuality} max={2} />
            <ScoringRow label="Catalyst freshness" dim={state.scoring.catalystFreshness} max={2} />
          </div>
        </Card>
      ) : null}

      {/* ── Trade Structure ───────────────────────────────────── */}
      {/* Next review · Max hold (TRADE-horizon only per architecture) ·
          Target size. Extracted from the prior "Schedule" block in
          ThesisTriggersSection so it can sit next to price targets where
          it belongs — these are the trade-shape mechanics that pair with
          entry/target/stop, not metadata about the trigger pile. */}
      {state ? (
        <TradeStructureBlock state={{ ...state, resolved }} />
      ) : null}

      {/* ── Variant View (Conviction Expression v4) ─────────── */}
      {/* The writer's contrarian take — "consensus thinks X, I think Y."
          Required on STRONG/HIGH conviction theses; renders only when
          populated. Sits alongside Key Assumptions + Invalidation as
          a peer "writer's judgment" section per principal feedback. */}
      <VariantViewBlock variantView={variantView} />

      {/* ── Key Assumptions ───────────────────────────────────── */}
      {/* ≥2 falsifiable premises that must remain true for the core belief
          to hold. The daily-run prompt reads these against fresh signals
          to decide when an assumption has flipped. */}
      {state.keyAssumptions && state.keyAssumptions.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
            Key Assumptions
          </p>
          <ul className="space-y-1.5">
            {state.keyAssumptions.map((a, i) => (
              <li
                key={i}
                className="flex gap-2 text-sm text-foreground leading-relaxed"
              >
                <span className="text-muted-foreground/50 select-none">•</span>
                <span className="flex-1">{a}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ── Invalidation Conditions (invalidationConds) ──────── */}
      {/* ≥2 concrete trip-wires that would END the trade if they happen.
          The trade evaluator grades exits against these on close; the
          daily-run prompt uses them to decide when a signal counts as
          thesis-breaking. */}
      {state.invalidationConds && state.invalidationConds.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
            Invalidation Conditions
          </p>
          <ul className="space-y-1.5">
            {state.invalidationConds.map((c, i) => (
              <li
                key={i}
                className="flex gap-2 text-sm text-foreground leading-relaxed"
              >
                <span className="text-muted-foreground/50 select-none">•</span>
                <span className="flex-1">{c}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ── Research Synthesis accordions ───────────────────── */}
      {/* Multi-section synthesis produced by the thesis-writer agent
          (THESIS_RESEARCH_V2 Phase 1). Snapshot and Analyst Consensus
          are promoted out of the accordion to tier-1 always-visible
          blocks above; this collapsible holds the deep-research sections
          (Bull/Bear Case, Recent Catalysts, Catalysts & Events,
          Fundamentals, Latest Earnings, Insider & Technical) — all
          collapsed by default. */}
      {state && (
        <ResearchSectionsAccordion
          sections={{
            recentCatalysts: state.recentCatalysts ?? undefined,
            fundamentals: state.fundamentals ?? undefined,
            latestEarnings: state.latestEarnings ?? undefined,
            catalystsAndEvents: state.catalystsAndEvents ?? undefined,
            bullCase: state.bullCase ?? undefined,
            bearCase: state.bearCase ?? undefined,
            insiderTechnicalSetup: state.insiderTechnical ?? undefined,
          }}
          updatedAt={state.researchUpdatedAt}
        />
      )}

      {/* The header-level fundamentals chip block (Sector / Market Cap /
          Beta / Volume / 52W Range / signal-type chips) was removed —
          that data now lives inside the Fundamentals accordion above.
          The at-a-glance need is covered by the Snapshot prose + Analyst
          Consensus widget. */}

        </TabsContent>

        {/* ── Activity tab: timeline + provenance footer ───────── */}
        {/* The audit log (P1-33 slice 1): trigger fires, which run handled
            each, exact level moves, and proposal outcomes read from the
            Order table. Provenance is rendered INSIDE the same container
            so it joins the timeline as one continuous list. */}
        <TabsContent value={1} className="space-y-5">
          {thesis_id ? (
            <div className="space-y-3">
              <ThesisTimelineSection thesisId={thesis_id} />
              {state.sourceKind ? (
                <ProvenanceFooter
                  sourceKind={state.sourceKind}
                  rationale={state.sourceRationale}
                  signalCount={state.sourceSignalIds.length}
                />
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No activity yet — this thesis hasn&apos;t been persisted.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── ThesisSheet — controlled standalone sheet ────────────────────────────────

// Accepts full ThesisCardData for caller back-compat, but the sheet loads
// everything by id — only thesis_id + ticker are actually consumed.
interface ThesisSheetProps extends ThesisCardData {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ThesisSheet({ open, onOpenChange, ...data }: ThesisSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" size="xl" floating>
        <SheetHeader className="pb-0">
          <SheetTitle className="sr-only">{data.ticker} Thesis</SheetTitle>
        </SheetHeader>
        <ThesisSheetBody thesis_id={data.thesis_id} ticker={data.ticker} />
      </SheetContent>
    </Sheet>
  );
}
