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
import Link from "next/link";
import { StockLogo } from "@/components/StockLogo";
import { TickBar, PriceGauge, type Tick } from "@/components/ui/gauge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SourceChipData } from "@/components/chat/SourceChip";
import { ThesisTimelineSection } from "@/components/agent/sheets/ThesisTimelineSection";
import {
  ThesisTriggersSection,
  type TriggersResponse,
  type QuoteResponse,
  type ThesisResearchSections,
  type ResearchTextSection,
  type ResearchBulletSection,
  type ResearchCitation,
} from "@/components/agent/sheets/ThesisTriggersSection";
import { Skeleton } from "@/components/ui/skeleton";
import { ProposalActions } from "@/components/proposals/ProposalActions";
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
  direction: "LONG" | "SHORT" | "PASS";
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
  status?: "ACTIVE" | "INVALIDATED" | "CLOSED" | "SUPERSEDED" | "WATCHING" | "PROMOTED";
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
  resolved: NonNullable<TriggersResponse["resolved"]>;
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

// ── TradeBlock ──
// The ONE trade section in the sheet. Every state — pending proposal,
// holding, closed — renders through the SAME container and the SAME slot
// layout below (heading · optional Review · P&L · note · expiry). Only the
// four slot values differ per state; the JSX is shared, so the states are
// guaranteed to be visually identical blocks (no "one's in a box, one isn't").
//   • holding         → "Bought N shares at $X, now trading at $Y" + P&L
//   • closed          → "Bought N shares at $X, closed at $Y" + realized P&L
//                        + close reason
//   • pending buy     → "Proposed: buy N shares at $X" + reason + Review
//   • pending sell/add → "Proposed: <verb> N shares at $Y" + P&L + reason
//                        + Review
// `position` (cost basis + qty) comes from /triggers; `pnl` (live price +
// unrealized P&L) from /quote — the two land at different times, so the
// P&L line appears once /quote resolves. See docs/plans/TRADE_AS_PROPOSAL.md §6.
function TradeBlock({
  position,
  pnl,
  pendingProposal,
  direction,
}: {
  position: NonNullable<TriggersResponse["position"]>;
  pnl: QuoteResponse["positionPnl"] | null;
  pendingProposal: {
    orderId: string;
    intent: "OPEN" | "ADD" | "CLOSE" | "PARTIAL_CLOSE";
    quantity: number;
    expiresAt: string | null;
    rationale: string | null;
  } | null;
  direction: "LONG" | "SHORT" | "PASS";
}) {
  const pp = pendingProposal;
  const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  const entry = position.avgCost.toFixed(2);
  const heldQty = position.quantity.toFixed(1);
  const current = pnl?.currentPrice;

  // Four slots — filled per state, rendered through one shared layout below.
  let heading: string;
  let review: ReactNode = null;
  let pnlNode: ReactNode = null;
  let note: string | null = null;
  let expiry: string | null = null;

  if (pp) {
    // ── Pending proposal ──
    const isBuy = pp.intent === "OPEN";
    const verb = isBuy
      ? direction === "SHORT"
        ? "short"
        : "buy"
      : pp.intent === "ADD"
        ? "add"
        : pp.intent === "CLOSE"
          ? "close"
          : "trim";
    heading = isBuy
      ? `Proposed: ${verb} ${fmtQty(pp.quantity)} shares at $${entry}`
      : `Proposed: ${verb} ${fmtQty(pp.quantity)} shares${current != null ? ` at $${current.toFixed(2)}` : ""}`;
    review = <ProposalActions orderId={pp.orderId} align="end" />;
    // Running P&L for sells / adds / trims (the name is held); a fresh buy
    // has no position yet, so no P&L line.
    if (!isBuy && pnl != null) {
      pnlNode = (
        <PriceChange
          dollarChange={pnl.unrealizedPnl}
          percentChange={pnl.unrealizedPnlPct}
          size="base"
        />
      );
    }
    note = pp.rationale;
    expiry = pp.expiresAt
      ? new Date(pp.expiresAt).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      : null;
  } else if (position.closed) {
    // ── Closed ──
    heading =
      `Bought ${heldQty} shares at $${entry}` +
      (position.closePrice != null
        ? `, closed at $${position.closePrice.toFixed(2)}`
        : "");
    if (position.realizedPnl != null) {
      pnlNode = (
        <PriceChange
          dollarChange={position.realizedPnl}
          percentChange={position.realizedPnlPct ?? 0}
          size="base"
        />
      );
    }
    note = position.closeReason ?? null;
  } else {
    // ── Holding ──
    heading =
      `Bought ${heldQty} shares at $${entry}` +
      (pnl != null ? `, now trading at $${pnl.currentPrice.toFixed(2)}` : "");
    if (pnl != null) {
      pnlNode = (
        <PriceChange
          dollarChange={pnl.unrealizedPnl}
          percentChange={pnl.unrealizedPnlPct}
          size="base"
        />
      );
    }
  }

  return (
    <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium tabular-nums flex-1 min-w-0">
          {heading}
        </p>
        {review}
      </div>
      {pnlNode}
      {note ? (
        <p className="text-sm text-muted-foreground leading-relaxed">{note}</p>
      ) : null}
      {expiry ? (
        <p className="text-xs text-muted-foreground">Expires {expiry}</p>
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

// ── IntentSuffix ──
// Single line of dot-separated metadata appended to PositionRow and
// WatchingRow: direction · target/stop · horizon. Hides cleanly when
// any piece is missing — never renders an empty container.

function IntentSuffix({
  direction,
  horizon,
  entryPrice,
  targetPrice,
  stopLoss,
  forWatching,
}: {
  direction: "LONG" | "SHORT" | "PASS";
  horizon?: string | null;
  entryPrice?: number | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  forWatching?: boolean;
}) {
  const parts: React.ReactNode[] = [];

  // Direction. PASS surfaces only on watching rows (held positions are
  // always LONG/SHORT, never PASS).
  if (direction !== "PASS" || forWatching) {
    parts.push(<span key="dir" className="font-medium">{direction}</span>);
  }

  // Target / stop, joined into one token. Show whichever is set.
  if (targetPrice != null || stopLoss != null) {
    parts.push(
      <span key="ts" className="tabular-nums">
        {targetPrice != null ? `target $${targetPrice.toFixed(2)}` : null}
        {targetPrice != null && stopLoss != null ? " / " : null}
        {stopLoss != null ? `stop $${stopLoss.toFixed(2)}` : null}
      </span>,
    );
  }

  // Entry reference shown only for watching, only when no target (target
  // is the entry trigger; entry is the analyst's reference point).
  if (forWatching && entryPrice != null && targetPrice == null) {
    parts.push(
      <span key="entry" className="tabular-nums">
        ref entry ${entryPrice.toFixed(2)}
      </span>,
    );
  }

  // Horizon — render the bare label; the description sits in the
  // Schedule section below.
  if (horizon) {
    parts.push(
      <span key="hz">
        <span className="font-medium">{horizon}</span> horizon
      </span>,
    );
  }

  if (parts.length === 0) return null;

  return (
    <p className="text-xs text-muted-foreground leading-relaxed">
      {parts.flatMap((p, i) => (i === 0 ? [p] : [<span key={`s${i}`} className="opacity-50"> · </span>, p]))}
    </p>
  );
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

// ── Skeleton placeholders for /triggers-dependent blocks ──────────────
// The sheet fires /triggers + /quote in parallel. While /triggers is in
// flight, blocks that depend on state (Core Belief, Key Assumptions,
// Invalidation Conditions, Composite Score) render these placeholders so
// the layout doesn't reflow when the data lands. Each skeleton holds
// roughly the same vertical space as the populated block.

function BulletListSkeleton({ title, rows }: { title: string; rows: number }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="space-y-1.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-muted-foreground/50 select-none">•</span>
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

function CompositeScoreSkeleton() {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
          Composite Score
        </p>
        <Skeleton className="h-4 w-16" />
      </div>
      <div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border-b border-border py-2 space-y-1">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-2 w-24 shrink-0" />
            </div>
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

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
    resolved?: TriggersResponse["resolved"];
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
  closedAt,
  closeReason,
  invalidatedAt,
  invalidReason,
}: {
  status: ThesisStatus | undefined;
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
  if (status !== "INVALIDATED" && status !== "ARCHIVED") {
    return null;
  }
  // INVALIDATED tracks its own date/reason fields; ARCHIVED ("walked away"
  // without a trade outcome) reuses closedAt/closeReason.
  const isInvalid = status === "INVALIDATED";
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

function ResearchCitationChip({ citation }: { citation: ResearchCitation }) {
  const label = citation.domain ?? citation.title ?? "source";
  const inner = (
    <Badge variant="secondary" className="ml-1 align-baseline font-mono text-[10px]">
      {label}
    </Badge>
  );
  if (!citation.url) return inner;
  return (
    <a
      href={citation.url}
      target="_blank"
      rel="noopener noreferrer"
      className="no-underline"
    >
      {inner}
    </a>
  );
}

function PriceTargetsBlock({
  entry,
  target,
  stop,
  current,
  direction,
}: {
  entry: number;
  target: number | null;
  stop: number | null;
  /** Live current price from /quote. Null while in-flight or on failure. */
  current: number | null;
  /** Drives P&L tinting on the gauge. */
  direction: "LONG" | "SHORT";
}) {
  // 2026-05-31: Per P1-3 fix (PRICE_LEVEL_SEMANTICS plan), the gauge now
  // consistently shows 4 markers — Stop / Entry / Current / Target —
  // regardless of status. Same labels, same field meanings, every state.
  // Entry = where you'd buy (WATCHING) or where you bought (ACTIVE, set
  // by place_trade fill). Target = where you'd take profit. Stop = where
  // the thesis breaks. No status-conditional labeling.
  const lo = Math.min(
    stop ?? Number.POSITIVE_INFINITY,
    entry,
    current ?? Number.POSITIVE_INFINITY,
    target ?? Number.POSITIVE_INFINITY,
  );
  const hi = Math.max(
    stop ?? Number.NEGATIVE_INFINITY,
    entry,
    current ?? Number.NEGATIVE_INFINITY,
    target ?? Number.NEGATIVE_INFINITY,
  );
  const safeLo = Number.isFinite(lo) ? lo : entry * 0.95;
  const safeHi = Number.isFinite(hi) ? hi : entry * 1.05;
  const span = safeHi - safeLo || entry * 0.1;
  const COUNT = 60;
  const EDGE_PAD = 3;
  const usable = COUNT - EDGE_PAD * 2 - 1;
  // Top-label positioning: prefer current price (the live marker) when
  // we have it, fall back to entry (the writer's anchor).
  const labelValue = current ?? entry;
  const labelIdx = Math.round(EDGE_PAD + ((labelValue - safeLo) / span) * usable);
  const labelPct = labelIdx / (COUNT - 1);

  return (
    <Card className="bg-muted/40 p-2 gap-6">
      <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
        Price Targets
      </p>

      <div className="space-y-2">
        <div className="relative h-4">
          <span
            className="absolute -translate-x-1/2 text-xs font-medium tabular-nums whitespace-nowrap"
            style={{ left: `${labelPct * 100}%` }}
          >
            ${labelValue.toFixed(2)}
          </span>
        </div>

        <PriceGauge
          entry={entry}
          target={target}
          stop={stop}
          current={current}
          direction={direction}
        />

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{stop != null ? `Stop $${stop.toFixed(2)}` : "Stop —"}</span>
          <span>Entry ${entry.toFixed(2)}</span>
          {current != null ? <span>Current ${current.toFixed(2)}</span> : null}
          <span>{target != null ? `Target $${target.toFixed(2)}` : "Target —"}</span>
        </div>
      </div>
    </Card>
  );
}

// ── AnalystCoverageData ────────────────────────────────────────────────
// Response shape from /api/theses/:id/analyst-coverage. Returns null when
// the fetch fails or FMP returns nothing — the widget then falls back to
// the stored fundamentals.analyst_consensus shape (from thesis mint time).
interface AnalystCoverageData {
  ticker: string;
  consensus: {
    buy: number;
    hold: number;
    sell: number;
    unknown: number;
    total: number;
  } | null;
  priceTargets: {
    low: number | null;
    average: number;
    median: number | null;
    high: number | null;
    numAnalysts: number | null;
  } | null;
  errors?: string[];
}

/**
 * AnalystConsensusWidget — single consolidated visual for the Street's
 * view on the stock. One bar, one badge, one collapsible:
 *
 *   • Header badge: consensus rating (Buy / Hold / Sell) with the implied
 *     upside % to the consensus average target appended ("Buy +37.1%").
 *     Tooltip explains the math.
 *
 *   • Distribution bar: 60-tick proportional bar showing how the covering
 *     firms split across Bearish / Neutral / Bullish (red / grey / green).
 *     The lowest bear target ($ value, red text) sits above the leftmost
 *     red tick; the highest bull target ($, green text) above the
 *     rightmost green tick — so the bar reads as both "rating distribution"
 *     and "price target range" in a single visual. The average target
 *     anchors the bottom-right corner of the key row.
 *
 *   • Collapsible synthesis narrative — the prose summary from the
 *     `analystConsensus` JSONB column, behind a "Show more" toggle so the
 *     widget stays compact by default.
 *
 * Fresh FMP/Finnhub fetch on sheet open via /api/theses/:id/analyst-coverage.
 * The stored `fundamentals.analyst_consensus` shape is the legacy mint-time
 * fallback for when the live fetch fails.
 */
function AnalystConsensusWidget({
  thesisId,
  fallbackConsensus,
  narrative,
  currentPrice,
}: {
  thesisId: string | undefined;
  fallbackConsensus: { buy: number; hold: number; sell: number } | null;
  narrative: ResearchTextSection | null | undefined;
  currentPrice: number | null;
}) {
  const [coverage, setCoverage] = useState<AnalystCoverageData | null>(null);
  useEffect(() => {
    if (!thesisId) return;
    let cancelled = false;
    fetch(`/api/theses/${thesisId}/analyst-coverage`)
      .then(async (r) => {
        if (!r.ok) return;
        const json = (await r.json()) as AnalystCoverageData;
        if (!cancelled) setCoverage(json);
      })
      .catch(() => {
        /* non-fatal — widget falls back to stored consensus */
      });
    return () => {
      cancelled = true;
    };
  }, [thesisId]);

  // Source consensus: prefer fresh fetch; fall back to stored values from
  // mint time. Either may be null — render an empty state in that case.
  const consensus = coverage?.consensus
    ? {
        buy: coverage.consensus.buy,
        hold: coverage.consensus.hold,
        sell: coverage.consensus.sell,
        total:
          coverage.consensus.buy +
          coverage.consensus.hold +
          coverage.consensus.sell,
      }
    : fallbackConsensus
      ? {
          buy: fallbackConsensus.buy,
          hold: fallbackConsensus.hold,
          sell: fallbackConsensus.sell,
          total:
            fallbackConsensus.buy +
            fallbackConsensus.hold +
            fallbackConsensus.sell,
        }
      : null;

  const priceTargets = coverage?.priceTargets ?? null;
  const impliedUpsidePct =
    priceTargets && currentPrice != null && currentPrice > 0
      ? ((priceTargets.average - currentPrice) / currentPrice) * 100
      : null;
  const hasAnyData =
    (consensus && consensus.total > 0) || priceTargets != null || narrative != null;
  if (!hasAnyData) return null;

  return (
    <Card className="bg-muted/40 p-2 gap-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
          Analyst Consensus
        </p>
        {consensus ? (
          <AnalystVerdictBadge
            consensus={consensus}
            impliedUpsidePct={impliedUpsidePct}
            avgTarget={priceTargets?.average ?? null}
            currentPrice={currentPrice}
          />
        ) : null}
      </div>

      {consensus && consensus.total > 0 ? (
        <ConsensusDistributionRow
          consensus={consensus}
          priceTargets={priceTargets}
        />
      ) : null}

      {narrative ? <ConsensusNarrative narrative={narrative} /> : null}
    </Card>
  );
}

function AnalystVerdictBadge({
  consensus,
  impliedUpsidePct,
  avgTarget,
  currentPrice,
}: {
  consensus: { buy: number; hold: number; sell: number; total: number };
  impliedUpsidePct: number | null;
  avgTarget: number | null;
  currentPrice: number | null;
}) {
  const { buy, total } = consensus;
  const buyPct = total > 0 ? buy / total : 0;
  const verdict =
    buyPct >= 0.7
      ? { label: "Strong Buy", variant: "positive" as const }
      : buyPct >= 0.5
        ? { label: "Buy", variant: "positive" as const }
        : buyPct >= 0.3
          ? { label: "Hold", variant: "secondary" as const }
          : { label: "Sell", variant: "negative" as const };
  const upsideSuffix =
    impliedUpsidePct != null
      ? ` ${impliedUpsidePct >= 0 ? "+" : ""}${impliedUpsidePct.toFixed(1)}%`
      : "";
  const tooltipBody =
    avgTarget != null && currentPrice != null
      ? `Consensus rating across ${total} covering firms. ${impliedUpsidePct != null ? `${impliedUpsidePct >= 0 ? "+" : ""}${impliedUpsidePct.toFixed(1)}%` : "—"} is the implied move from the current price ($${currentPrice.toFixed(2)}) to the average 12-month price target ($${avgTarget.toFixed(2)}).`
      : `Consensus rating across ${total} covering firms.`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge variant={verdict.variant} className="font-normal cursor-help">
            {verdict.label}
            {upsideSuffix}
          </Badge>
        }
      />
      <TooltipContent>{tooltipBody}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Largest-remainder (Hamilton) apportionment: distribute exactly `slots`
 * across the input buckets in proportion to their counts. Every bucket
 * with a non-zero count gets at least 1 slot (a tiny minority bucket
 * shouldn't disappear from the bar). Returns a same-length array of
 * integer slot counts that always sums to exactly `slots`.
 */
function allocateSlots(counts: number[], slots: number): number[] {
  const total = counts.reduce((s, c) => s + c, 0);
  if (total === 0) return counts.map(() => 0);
  const exact = counts.map((c) => (c / total) * slots);
  const out = exact.map(Math.floor);
  // Hand out remainders to whichever buckets have the largest fractional
  // shortfall, until the slots add up exactly.
  let remaining = slots - out.reduce((s, n) => s + n, 0);
  const byRemainder = exact
    .map((e, i) => ({ i, r: e - Math.floor(e) }))
    .sort((a, b) => b.r - a.r);
  for (const { i } of byRemainder) {
    if (remaining <= 0) break;
    out[i]++;
    remaining--;
  }
  // Minimum-1 nudge for non-zero buckets that rounded to 0. Steal from
  // the largest bucket so the sum stays exactly `slots`.
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > 0 && out[i] === 0) {
      let maxIdx = 0;
      for (let j = 1; j < out.length; j++) if (out[j] > out[maxIdx]) maxIdx = j;
      if (out[maxIdx] > 1) {
        out[maxIdx]--;
        out[i]++;
      }
    }
  }
  return out;
}

function ConsensusDistributionRow({
  consensus,
  priceTargets,
}: {
  consensus: { buy: number; hold: number; sell: number; total: number };
  priceTargets: {
    low: number | null;
    average: number;
    median: number | null;
    high: number | null;
    numAnalysts: number | null;
  } | null;
}) {
  const { buy, hold, sell, total } = consensus;
  // Fixed-width 60-tick bar with segments sized by proportion of each
  // bucket. Prior approach (1 tick per analyst) looked anemic at 2 analysts
  // and bled together at 50+ — proportional renders identically at any
  // analyst count. Order across the bar: Sell (red) → Hold (grey) → Buy
  // (green), L→R.
  const [sellSlots, holdSlots, buySlots] = allocateSlots([sell, hold, buy], 60);

  // The leftmost-bear and rightmost-bull ticks get an extra-tall treatment
  // so they read as the range endpoints when paired with the low/high
  // price-target labels above the bar.
  const lastBullIdx = sellSlots + holdSlots + buySlots - 1;
  const ticks: Tick[] = Array.from({ length: 60 }, (_, i) => {
    const isLeftmostBear = sell > 0 && i === 0;
    const isRightmostBull = buy > 0 && i === lastBullIdx;
    const color =
      i < sellSlots
        ? "bg-negative"
        : i < sellSlots + holdSlots
          ? "bg-muted-foreground/40"
          : "bg-positive";
    return isLeftmostBear || isRightmostBull
      ? { color, heightPx: 22 }
      : { color, tall: true };
  });

  return (
    <div className="space-y-1.5">
      {/* Low/high price-target labels above the bar's endpoints. Red on the
          left = most bearish firm's 12-mo. target; green on the right =
          most bullish firm's target. The "Bear Target / Bull Target" prefix
          spells out what the $ value represents — without it the numbers
          looked like statistical aggregates of nothing in particular. */}
      {priceTargets && (priceTargets.low != null || priceTargets.high != null) ? (
        <div className="flex items-end justify-between text-xs tabular-nums">
          <span className="text-negative">
            {priceTargets.low != null
              ? `Bear Target $${priceTargets.low.toFixed(2)}`
              : ""}
          </span>
          <span className="text-positive">
            {priceTargets.high != null
              ? `Bull Target $${priceTargets.high.toFixed(2)}`
              : ""}
          </span>
        </div>
      ) : null}

      <TickBar ticks={ticks} />

      {/* Bottom row: distribution key on the left, average target on the
          right. Key order matches the bar L→R: Bearish (red) → Neutral
          (grey) → Bullish (green). Avg is the single "consensus number"
          — kept in muted text so it reads as label-weight, not a
          competing headline. */}
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-negative" />
            {sell} Bearish
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-muted-foreground/40" />
            {hold} Neutral
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-positive" />
            {buy} Bullish
          </span>
        </div>
        {priceTargets ? (
          <span className="tabular-nums">
            Avg ${priceTargets.average.toFixed(2)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ConsensusNarrative({
  narrative,
}: {
  narrative: ResearchTextSection;
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <span>Synthesis</span>
        <ChevronDown className="size-3.5 transition-transform data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 text-sm leading-relaxed">
        <p className="whitespace-pre-wrap">
          {narrative.text}
          {narrative.citations && narrative.citations.length > 0 ? (
            <span className="ml-1 inline-flex flex-wrap gap-1">
              {narrative.citations.map((c, i) => (
                <ResearchCitationChip key={i} citation={c} />
              ))}
            </span>
          ) : null}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── ThesisSheetBody ──────────────────────────────────────────────────────────

export interface ThesisSheetBodyProps {
  /** Persisted Thesis id. When supplied, the Activity timeline renders. */
  thesis_id?: string;
  ticker: string;
  direction: "LONG" | "SHORT" | "PASS";
  confidence_score: number;
  reasoning_summary?: string;
  pass_reason?: string;
  thesis_bullets: string[];
  risk_flags: string[];
  entry_price?: number | null;
  target_price?: number | null;
  stop_loss?: number | null;
  hold_duration?: string;
  signal_types: string[];
  company_name?: string | null;
  exchange?: string | null;
  fundamentals?: FundamentalsData | null;
  /** Lifecycle status from the row that opened the sheet. Used as the
   *  initial StatusPill value so first paint matches the durable state
   *  with no flicker. The triggers API fetch refines position/PnL data. */
  status?: "ACTIVE" | "WATCHING" | "PROMOTED" | "CLOSED" | "INVALIDATED" | "SUPERSEDED";
  /**
   * Pre-fetched /triggers payload from the parent (P2-19). When supplied,
   * the sheet renders status / belief / scoring / sources / research
   * synthesis synchronously instead of skeletons-then-fetch. The /triggers
   * background fetch still fires to pick up live trigger updates +
   * position changes, but every state-dependent block paints on open.
   */
  initialState?: TriggersResponse;
}

export function ThesisSheetBody({
  thesis_id,
  ticker,
  direction,
  reasoning_summary,
  pass_reason,
  entry_price,
  target_price,
  stop_loss,
  company_name,
  exchange,
  fundamentals,
  status,
  initialState,
}: ThesisSheetBodyProps) {
  const isPass = direction === "PASS";
  const displayName = company_name ?? ticker;
  const summaryText = isPass ? (pass_reason ?? reasoning_summary) : reasoning_summary;

  const hasEntry = entry_price != null;
  const hasTarget = target_price != null;
  const hasStop = stop_loss != null;
  const showLevels = !isPass && hasEntry && (hasTarget || hasStop);

  // Fetch durable thesis state once when we have an id. Drives the
  // Two parallel fetches so the slow Finnhub call doesn't block the rest
  // of the sheet (split on 2026-05-19). `state` (the DB-side data) lands
  // in ~50ms and refines status / belief / scoring / triggers / activity;
  // `quote` (the live Finnhub call) lands whenever Finnhub does and
  // refines only the price block + position PnL. Skeleton placeholders
  // below cover the gap so the layout doesn't jump.
  //
  // When `initialState` is forwarded by the parent (P2-19), seed `state`
  // with it so every state-dependent block paints on open. The fetch
  // below still runs to refresh — the row's data may be a few seconds
  // stale on triggers / position. `quote` always has to round-trip
  // (Finnhub) so the price block keeps its skeleton until that lands.
  const [state, setState] = useState<TriggersResponse | null>(initialState ?? null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  useEffect(() => {
    if (!thesis_id) return;
    let cancelled = false;
    fetch(`/api/theses/${thesis_id}/triggers`)
      .then(async (r) => {
        if (!r.ok) return;
        const json = (await r.json()) as TriggersResponse;
        if (!cancelled) setState(json);
      })
      .catch(() => {
        /* non-fatal — header gracefully degrades */
      });
    fetch(`/api/theses/${thesis_id}/quote`)
      .then(async (r) => {
        if (!r.ok) return;
        const json = (await r.json()) as QuoteResponse;
        if (!cancelled) setQuote(json);
      })
      .catch(() => {
        /* non-fatal — price block + PnL just stay null */
      });
    return () => {
      cancelled = true;
    };
  }, [thesis_id]);

  // Status comes from the row that opened the sheet; the API fetch
  // refines it (live PnL, terminal reasons). If neither has a value the
  // pill simply doesn't render — no defensive default.
  const liveStatus = (state?.status ?? status) as ThesisStatus | undefined;
  const position = state?.position ?? null;
  // `state` is non-null after /triggers resolves (loading is true while it's
  // still in flight). Drives the skeleton placeholders for state-dependent
  // blocks (status pill, core belief, key assumptions, scoring, etc).
  const stateLoading = state == null && thesis_id != null;

  // Conviction Expression v4 — writer's tier verdict + rationale +
  // variantView. Pulled from /triggers state. Renders null when the
  // thesis is pre-v4 (legacy) or PASS/PENDING (which skip conviction).
  const conviction = (state?.conviction ?? null) as
    | "STRONG"
    | "HIGH"
    | "MEDIUM"
    | "LOW"
    | null;
  const convictionRationale = state?.convictionRationale ?? null;
  const variantView = state?.variantView ?? null;

  return (
    <div className="px-4 pb-6 pt-2 space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {liveStatus ? (
          <StatusPill status={liveStatus} />
        ) : stateLoading ? (
          <Skeleton className="h-5 w-20" />
        ) : null}
        <ConvictionBadge
          conviction={conviction}
          rationale={convictionRationale}
        />
        {/* ActionabilityBadge intentionally NOT rendered on the sheet
            header. The actionability rollup is most useful in list-scan
            views (watchlist, read-theses table, runs feed) where you're
            comparing many rows. In the sheet you're deep-reading one
            thesis and the same info is already conveyed by status +
            triggers + live price + position. Adding it here made the
            header noisy and surfaced misleading SUPERSEDED on rows that
            had a cross-analyst PASS (now also scope-fixed in the API).
            See docs/plans/CONVICTION_EXPRESSION.md §8 — kept ONLY for
            list views per principal feedback 2026-05-31. */}
      </div>

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
        closedAt={state?.closedAt ?? null}
        closeReason={state?.closeReason ?? null}
        invalidatedAt={state?.invalidatedAt ?? null}
        invalidReason={state?.invalidReason ?? null}
      />

      {/* ── Stock identity + live price ──────────────────────── */}
      {/* Company name + ticker are a Link to /stocks/[ticker] — the
          sheet is a focused view of one thesis; clicking the stock
          identity takes you to the broader stock page (TradingView
          chart, all theses on this ticker, etc.). Hover-underline
          conveys affordance without disrupting the typography.
          The Review control for a pending proposal lives inside the trade
          block below, not here — one unified trade section per state. */}
      <div className="space-y-2">
        <Link
          href={`/stocks/${ticker}`}
          className="flex items-center gap-3 group/stocklink"
        >
          <StockLogo ticker={ticker} size="lg" />
          <div className="flex-1 min-w-0">
            <p className="text-lg font-semibold truncate group-hover/stocklink:underline underline-offset-4">
              {displayName}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              {ticker}
              {exchange ? ` · ${exchange}` : ""}
            </p>
          </div>
        </Link>
        {/* Live current price + day's change. Comes from the separate
            /quote endpoint (slow — Finnhub call) so this block usually
            paints after the rest of the sheet body. Skeleton while
            /quote is still in flight; nothing if it returned null
            (Finnhub failure). */}
        {quote?.currentPrice != null ? (
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-medium tabular-nums">
              ${quote.currentPrice.toFixed(2)}
            </span>
            {quote.dayChange != null && (
              <PriceChange
                dollarChange={quote.dayChange}
                percentChange={quote.dayChangePct}
                size="sm"
              />
            )}
          </div>
        ) : quote == null ? (
          <div className="flex items-baseline gap-3">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-3 w-16" />
          </div>
        ) : null}
      </div>

      {/* ── Trade block (one unified, state-aware section) ── */}
      {/* The single place the trade lives. Headline morphs by state:
          held → "Bought N @ $X, now $Y" + P&L; pending buy → "Proposed:
          buy N @ $X"; held + pending sell/add/trim → the holding line PLUS
          the proposed action + rationale + Review dropdown, all in one
          grouped block. No separate floating sections.
          See docs/plans/TRADE_AS_PROPOSAL.md §6. */}
      {position ? (
        <TradeBlock
          position={position}
          pnl={quote?.positionPnl ?? null}
          pendingProposal={state?.position?.pendingProposal ?? null}
          direction={direction}
        />
      ) : null}

      {/* The Most-Recent-Trigger banner that previously lived here was
          removed 2026-05-18. The same data still surfaces inside the
          Activity timeline at the bottom of the sheet — duplicating it
          at the top made the header heavier than it needed to be. */}

      {/* ── Core Belief headline ─────────────────────────────── */}
      {/* The ONE durable claim — a falsifiable prediction (≤30 words) the
          trade evaluator grades on close. Large + normal weight so it
          reads as the load-bearing claim. The buggy "Watching for entry
          above $X" header it replaced was a stale derivation that
          duplicated what the ENTER trigger already says correctly below. */}
      {state?.coreBelief ? (
        <p className="text-xl font-normal leading-relaxed">
          {state.coreBelief}
        </p>
      ) : stateLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-3/4" />
        </div>
      ) : null}

      {/* ── Triggers (moved up — they're the standing opinion in action) ── */}
      {thesis_id ? (
        <ThesisTriggersSection thesisId={thesis_id} data={state} />
      ) : null}

      {/* ── Snapshot ──────────────────────────────────────────── */}
      {/* Descriptive summary paragraph (the analyst's "where this name
          is right now" prose). Lives at tier-1 so it surfaces alongside
          Core Belief — Belief says what WILL happen, Snapshot says what
          IS happening. Citations render as inline chips. Skeleton while
          /triggers is in flight. */}
      {state?.snapshot ? (
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
      ) : stateLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : null}

      {/* ── Pass reason ───────────────────────────────────────── */}
      {/* Only renders for PASS direction — explains why the thesis was
          rejected. LONG/SHORT theses rely on Snapshot above for the
          equivalent descriptive context. */}
      {isPass && summaryText && (
        <p className="text-sm leading-relaxed">{summaryText}</p>
      )}

      {/* ── Scoring breakdown (4-dim composite) ───────────────── */}
      {/* Restyled 2026-05-18 to match the Schedule section's left/right
          InfoRow pattern: per-dim label on the left, score on the right,
          bottom border + the agent's one-sentence justification note on
          its own full-width line beneath. Composite is the single
          conviction number after PR-9 (legacy `confidenceScore` int
          dropped). */}
      {state?.scoring ? (
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
      ) : stateLoading ? (
        <CompositeScoreSkeleton />
      ) : null}

      {/* ── Price Targets (the agent's entry/target/stop + live current) ─ */}
      {/* Gauge consistently shows Stop · Entry · Current · Target across
          every status — no status-conditional labels. Current is live
          from /quote (null while in-flight). See PRICE_LEVEL_SEMANTICS. */}
      {showLevels && (
        <PriceTargetsBlock
          entry={entry_price!}
          target={target_price ?? null}
          stop={stop_loss ?? null}
          current={quote?.currentPrice ?? null}
          direction={direction === "SHORT" ? "SHORT" : "LONG"}
        />
      )}

      {/* ── Analyst Consensus widget ──────────────────────────── */}
      {/* Buy/Hold/Sell distribution + Low/Avg/Median/High price target
          range vs current. Fresh FMP fetch on open; falls back to the
          stored fundamentals.analyst_consensus shape (mint-time) when
          the fetch fails or returns empty. Narrative behind a
          collapsible. */}
      <AnalystConsensusWidget
        thesisId={thesis_id}
        fallbackConsensus={fundamentals?.analyst_consensus ?? null}
        narrative={state?.analystConsensus ?? null}
        currentPrice={quote?.currentPrice ?? null}
      />

      {/* ── Trade Structure ───────────────────────────────────── */}
      {/* Next review · Max hold (TRADE-horizon only per architecture) ·
          Target size. Extracted from the prior "Schedule" block in
          ThesisTriggersSection so it can sit next to price targets where
          it belongs — these are the trade-shape mechanics that pair with
          entry/target/stop, not metadata about the trigger pile. */}
      {state ? <TradeStructureBlock state={state} /> : null}

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
      {state?.keyAssumptions && state.keyAssumptions.length > 0 ? (
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
      ) : stateLoading ? (
        <BulletListSkeleton title="Key Assumptions" rows={2} />
      ) : null}

      {/* ── Invalidation Conditions (invalidationConds) ──────── */}
      {/* ≥2 concrete trip-wires that would END the trade if they happen.
          The trade evaluator grades exits against these on close; the
          daily-run prompt uses them to decide when a signal counts as
          thesis-breaking. */}
      {state?.invalidationConds && state.invalidationConds.length > 0 ? (
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
      ) : stateLoading ? (
        <BulletListSkeleton title="Invalidation Conditions" rows={2} />
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

      {/* ── Activity timeline + provenance footer ────────────── */}
      {/* Renders only when we have a persisted thesis id. Provenance is
          rendered INSIDE this container (rather than as a sibling) so
          it visually joins the timeline as one continuous list with
          consistent dot alignment + tight vertical spacing — not two
          stacked sections with the outer space-y-5 gap between them. */}
      {thesis_id ? (
        <div className="space-y-3">
          <ThesisTimelineSection thesisId={thesis_id} />
          {state?.sourceKind ? (
            <ProvenanceFooter
              sourceKind={state.sourceKind}
              rationale={state.sourceRationale}
              signalCount={state.sourceSignalIds.length}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── ThesisSheet — controlled standalone sheet ────────────────────────────────

interface ThesisSheetProps extends ThesisCardData {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Pre-fetched /triggers payload forwarded from a parent that already
   * has the data (watchlist row, stock page row, trade detail row). See
   * P2-19 — eliminates skeletons-then-fetch on sheet open.
   */
  initialState?: TriggersResponse;
}

export function ThesisSheet({ open, onOpenChange, initialState, ...data }: ThesisSheetProps) {
  const displayName = data.company_name ?? data.ticker;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" size="xl" floating>
        <SheetHeader className="pb-0">
          <SheetTitle className="sr-only">{displayName} Thesis</SheetTitle>
        </SheetHeader>
        <ThesisSheetBody
          thesis_id={data.thesis_id}
          ticker={data.ticker}
          direction={data.direction}
          confidence_score={data.confidence_score}
          reasoning_summary={data.reasoning_summary}
          pass_reason={data.pass_reason}
          thesis_bullets={data.thesis_bullets ?? []}
          risk_flags={data.risk_flags ?? []}
          entry_price={data.entry_price}
          target_price={data.target_price}
          stop_loss={data.stop_loss}
          hold_duration={data.hold_duration}
          signal_types={data.signal_types ?? []}
          company_name={data.company_name}
          exchange={data.exchange}
          fundamentals={data.fundamentals}
          status={data.status}
          initialState={initialState}
        />
      </SheetContent>
    </Sheet>
  );
}
