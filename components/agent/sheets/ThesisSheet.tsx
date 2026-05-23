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

import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { PnlArrow } from "@/components/ui/pnl-arrow";
import { PriceChange } from "@/components/ui/price-change";
import { InfoRow } from "@/components/ui/info-row";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StockLogo } from "@/components/StockLogo";
import { TickBar, PriceGauge, type Tick } from "@/components/ui/gauge";
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
  type ThesisSourcesUsedItem,
} from "@/components/agent/sheets/ThesisTriggersSection";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getThesisStatusDisplay,
  type ThesisStatus,
} from "@/lib/thesis-status";
import { ChevronDown } from "lucide-react";
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
  status?: "ACTIVE" | "INVALIDATED" | "CLOSED" | "SUPERSEDED" | "WATCHING";
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

function fmtCompact(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtVol(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toFixed(0);
}

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

// ── PositionRow ──
// Plain text, no card wrapper. Three stacked lines:
//   "Bought {N} shares at ${avg}, now trading at ${current}"
//   +$X ↗ N.NN%                                                (one size up)
//   "{LONG|SHORT} · target ${T} / stop ${S} · {HORIZON} horizon"
//
// The third line is the "intent" suffix — at-a-glance what kind of
// trade this is and where the exits are. Renders only when we have
// horizon/target/stop info to show.

function PositionRow({
  position,
  pnl,
  direction,
  horizon,
  targetPrice,
  stopLoss,
}: {
  position: NonNullable<TriggersResponse["position"]>;
  pnl: QuoteResponse["positionPnl"] | null;
  direction: "LONG" | "SHORT" | "PASS";
  horizon?: string | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
}) {
  // `position` (cost basis + qty) comes from /triggers; `pnl` (live price
  // + market value + unrealized PnL) comes from /quote. The two land at
  // different times — the row renders shares+cost immediately and adds
  // the "now trading at $X · +N%" once /quote resolves.
  return (
    <div className="space-y-1">
      <p className="text-sm tabular-nums leading-relaxed">
        Bought {position.quantity.toFixed(1)} shares at{" "}
        <span className="font-medium">${position.avgCost.toFixed(2)}</span>
        {pnl != null ? (
          <>
            , now trading at{" "}
            <span className="font-medium">${pnl.currentPrice.toFixed(2)}</span>
          </>
        ) : null}
      </p>
      {pnl != null ? (
        <PriceChange
          dollarChange={pnl.unrealizedPnl}
          percentChange={pnl.unrealizedPnlPct}
          size="base"
        />
      ) : null}
      <IntentSuffix
        direction={direction}
        horizon={horizon}
        targetPrice={targetPrice}
        stopLoss={stopLoss}
      />
    </div>
  );
}

// ── WatchingRow ──
// The non-held analogue of PositionRow. Renders when status === 'WATCHING'.
// One actionable headline:
//   "Watching for entry above ${target}"     (or "below" for SHORT)
//   "Watching — previously rejected"         (PASS)
//
// The dot-separated IntentSuffix (direction · target/stop · horizon) was
// removed on 2026-05-18 (THESIS_CLEANUP PR-2) because every piece of it
// renders elsewhere on the sheet:
//   • target → already in the headline + PriceTargetsBlock slider
//   • stop   → PriceTargetsBlock slider
//   • horizon → Schedule section below
//   • direction → StatusPill + headline framing ("entry above" = LONG)
// Keeping it produced three target/stop renders stacked vertically.

function WatchingRow({
  direction,
  targetPrice,
}: {
  direction: "LONG" | "SHORT" | "PASS";
  targetPrice?: number | null;
}) {
  const headline = (() => {
    if (direction === "PASS") return "Watching — previously rejected";
    if (direction === "SHORT" && targetPrice != null) {
      return (
        <>
          Watching for entry below{" "}
          <span className="font-medium tabular-nums">
            ${targetPrice.toFixed(2)}
          </span>
        </>
      );
    }
    if (direction === "LONG" && targetPrice != null) {
      return (
        <>
          Watching for entry above{" "}
          <span className="font-medium tabular-nums">
            ${targetPrice.toFixed(2)}
          </span>
        </>
      );
    }
    return "Watching";
  })();

  return <p className="text-sm leading-relaxed">{headline}</p>;
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

function BulletSection({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
}) {
  // Section header uses the xs-uppercase-tracking pattern shared with
  // the rest of the app (coverage-tab, sync-health-panel, etc). Bullets
  // are plain foreground (no opacity) — the visual weight comes from
  // the eyebrow header above, not from dimming the body.
  return (
    <div className="space-y-2">
      <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        {icon}
        {title}
      </p>
      <ul className="list-disc pl-4 marker:text-muted-foreground/50 space-y-1">
        {items.map((b, i) => (
          <li key={i} className="text-sm text-foreground leading-relaxed">
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
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
  // Wraps the shared InfoRow primitive (same one used by the Schedule
  // section) so per-dim padding + label weight + description placement
  // match the Horizon row exactly. The gauge replaces InfoRow's text
  // value slot via `children`.
  return (
    <InfoRow label={label} description={dim.note ?? undefined}>
      <ScoringGauge score={dim.score} max={max} />
    </InfoRow>
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
  // 10 thin vertical strokes with a fixed 2px gap between them. Width
  // auto-fits to the contents (~38px) instead of being stretched by
  // justify-between, so the gap math is deterministic and won't smear
  // when the container is narrow.
  const COUNT = 10;
  const fillRatio = max > 0 ? Math.max(0, Math.min(1, score / max)) : 0;
  const filledTicks = Math.round(fillRatio * COUNT);
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: COUNT }, (_, i) => (
        <span
          key={i}
          className={cn(
            "w-0.5 h-3 rounded-full",
            i < filledTicks ? "bg-foreground/75" : "bg-muted-foreground/25",
          )}
        />
      ))}
    </div>
  );
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

// ── ParentThesisChip ───────────────────────────────────────────────────
// When the current thesis chains from a prior one (direction flip — e.g.
// the prior LONG got INVALIDATED and a fresh SHORT replaced it), surface
// a short chip pointing at the parent. Added 2026-05-18 (THESIS_CLEANUP
// PR-6) — `parentThesisId` was previously fetched and ignored.
function ParentThesisChip({ parentId }: { parentId: string }) {
  // The chain pointer doesn't have a per-thesis route today — the
  // /stocks/[symbol] page shows the full ticker history. Link there.
  // The short id suffix (last 8 chars) matches how thesis ids surface
  // elsewhere in the UI.
  const shortId = parentId.slice(-8);
  return (
    <Badge variant="outline" className="font-mono text-[10px]">
      Replaces #{shortId}
    </Badge>
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

// ── SourcesStrip ───────────────────────────────────────────────────────
// Favicon row for the analyst-cited `sourcesUsed` array — mirrors the
// strip on `/stocks/[symbol]` thesis rows. Hidden when the column is
// empty or shaped unexpectedly. Added 2026-05-18 (THESIS_CLEANUP PR-6).
//
// The column is permissive (JSON, written by both agent + manual paths
// with varied shapes), so we validate defensively and skip items that
// don't have at least a url to render.
function SourcesStrip({ sourcesUsed }: { sourcesUsed: unknown }) {
  if (!Array.isArray(sourcesUsed) || sourcesUsed.length === 0) return null;
  const items = (sourcesUsed as ThesisSourcesUsedItem[]).filter(
    (s): s is ThesisSourcesUsedItem & { url: string } =>
      typeof s?.url === "string" && s.url.length > 0,
  );
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
        Sources
      </p>
      <div className="flex flex-wrap gap-2">
        {items.map((s, i) => {
          let domain = "";
          try {
            domain = new URL(s.url).hostname.replace(/^www\./, "");
          } catch {
            domain = s.url;
          }
          return (
            <a
              key={i}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="no-underline"
            >
              <Badge variant="outline" className="font-mono text-[10px]">
                {s.provider ?? domain}
              </Badge>
            </a>
          );
        })}
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
  if (status !== "CLOSED" && status !== "INVALIDATED" && status !== "ARCHIVED") {
    return null;
  }
  // INVALIDATED tracks its own date/reason fields; CLOSED + ARCHIVED both
  // reuse closedAt/closeReason (ARCHIVED is "walked away" without a trade
  // outcome — semantically a close of the watching cycle).
  const isInvalid = status === "INVALIDATED";
  const date = isInvalid ? invalidatedAt : closedAt;
  const reason = isInvalid ? invalidReason : closeReason;
  if (!date && !reason) return null;
  const title =
    status === "CLOSED"
      ? "Position closed"
      : status === "INVALIDATED"
        ? "Thesis invalidated"
        : "Thesis archived";
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

  // Display order + labels. Matches docs/plans/THESIS_RESEARCH_V2.md §4.4.
  const RENDER_ORDER: Array<{ key: keyof ThesisResearchSections; label: string }> = [
    { key: "snapshot", label: "Snapshot" },
    { key: "recentCatalysts", label: "Recent Catalysts" },
    { key: "fundamentals", label: "Fundamentals" },
    { key: "latestEarnings", label: "Latest Earnings" },
    { key: "catalystsAndEvents", label: "Catalysts & Events" },
    { key: "bullCase", label: "Bull Case" },
    { key: "bearCase", label: "Bear Case" },
    { key: "analystConsensusSynthesis", label: "Analyst Consensus" },
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
}: {
  entry: number;
  target: number | null;
  stop: number | null;
}) {
  const lo = Math.min(stop ?? Number.POSITIVE_INFINITY, entry, target ?? Number.POSITIVE_INFINITY);
  const hi = Math.max(stop ?? Number.NEGATIVE_INFINITY, entry, target ?? Number.NEGATIVE_INFINITY);
  const safeLo = Number.isFinite(lo) ? lo : entry * 0.95;
  const safeHi = Number.isFinite(hi) ? hi : entry * 1.05;
  const span = safeHi - safeLo || entry * 0.1;
  const COUNT = 60;
  const EDGE_PAD = 3;
  const usable = COUNT - EDGE_PAD * 2 - 1;
  const entryIdx = Math.round(EDGE_PAD + ((entry - safeLo) / span) * usable);
  const entryPct = entryIdx / (COUNT - 1);

  return (
    <Card className="bg-muted/40 p-2 gap-6">
      <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
        Price Targets
      </p>

      <div className="space-y-2">
        <div className="relative h-4">
          <span
            className="absolute -translate-x-1/2 text-xs font-medium tabular-nums whitespace-nowrap"
            style={{ left: `${entryPct * 100}%` }}
          >
            ${entry.toFixed(2)}
          </span>
        </div>

        <PriceGauge entry={entry} target={target} stop={stop} />

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{stop != null ? `Stop $${stop.toFixed(2)}` : "Stop —"}</span>
          <span>{target != null ? `Target $${target.toFixed(2)}` : "Target —"}</span>
        </div>
      </div>
    </Card>
  );
}

function AnalystConsensusBlock({
  consensus,
}: {
  consensus: { buy: number; hold: number; sell: number };
}) {
  const { buy, hold, sell } = consensus;
  const total = buy + hold + sell;
  const buyPct = total > 0 ? buy / total : 0;
  const verdict =
    buyPct >= 0.7
      ? { label: "Strong Buy", variant: "positive" as const }
      : buyPct >= 0.5
        ? { label: "Buy", variant: "positive" as const }
        : buyPct >= 0.3
          ? { label: "Hold", variant: "secondary" as const }
          : { label: "Sell", variant: "negative" as const };

  const ticks: Tick[] = Array.from({ length: total }, (_, i) => ({
    color:
      i < sell
        ? "bg-negative"
        : i < sell + hold
          ? "bg-muted-foreground/40"
          : "bg-positive",
    tall: true,
  }));

  return (
    <Card className="bg-muted/40 p-2 gap-6">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
          Analyst Consensus
        </p>
        <Badge variant={verdict.variant} className="font-normal">
          {verdict.label}
        </Badge>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">
          Based on {total} {total === 1 ? "analyst" : "analysts"}
        </p>

        <TickBar ticks={ticks} />

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-positive" />
            {buy} Bullish
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-muted-foreground/40" />
            {hold} Neutral
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-negative" />
            {sell} Bearish
          </span>
        </div>
      </div>
    </Card>
  );
}

function FundamentalsContent({ fundamentals }: { fundamentals: FundamentalsData }) {
  const { market_cap, pe_ratio, beta, avg_volume, high_52w, low_52w, sector } = fundamentals;
  return (
    <div className="flex flex-col gap-1">
      {sector && <InfoRow label="Sector" value={sector} />}
      {market_cap != null && (
        <InfoRow label="Market Cap" value={fmtCompact(market_cap)} mono />
      )}
      {pe_ratio != null && (
        <InfoRow label="P/E Ratio" value={`${pe_ratio.toFixed(1)}x`} mono />
      )}
      {beta != null && <InfoRow label="Beta" value={beta.toFixed(2)} mono />}
      {avg_volume != null && (
        <InfoRow label="Avg Volume (10d)" value={fmtVol(avg_volume)} mono />
      )}
      {high_52w != null && low_52w != null && (
        <InfoRow
          label="52W Range"
          mono
          value={`$${low_52w.toFixed(2)} – $${high_52w.toFixed(2)}`}
          border={false}
        />
      )}
    </div>
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
  status?: "ACTIVE" | "WATCHING" | "CLOSED" | "INVALIDATED" | "SUPERSEDED";
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
  confidence_score,
  reasoning_summary,
  pass_reason,
  thesis_bullets,
  risk_flags,
  entry_price,
  target_price,
  stop_loss,
  signal_types,
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

  return (
    <div className="px-4 pb-6 pt-2 space-y-5">
      {liveStatus ? (
        <StatusPill status={liveStatus} />
      ) : stateLoading ? (
        <Skeleton className="h-5 w-20" />
      ) : null}

      {/* ── Terminal-status reason ──────────────────────────── */}
      {/* When the thesis ended (CLOSED / INVALIDATED / ARCHIVED), surface
          the reason + date right at the top so the user doesn't have to
          dig through the activity timeline to find out what happened.
          Previously these fields were fetched but never rendered. */}
      <TerminalStatusAlert
        status={liveStatus}
        closedAt={state?.closedAt ?? null}
        closeReason={state?.closeReason ?? null}
        invalidatedAt={state?.invalidatedAt ?? null}
        invalidReason={state?.invalidReason ?? null}
      />

      {/* ── Parent thesis chain pointer ────────────────────── */}
      {/* When this thesis supersedes an earlier one on the same ticker
          (direction flip — e.g. LONG INVALIDATED → fresh SHORT), surface
          a chip linking to the parent. Critical for audit + history. */}
      {state?.parentThesisId ? (
        <ParentThesisChip parentId={state.parentThesisId} />
      ) : null}

      {/* ── Stock identity + live price ──────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <StockLogo ticker={ticker} size="lg" />
          <div className="flex-1 min-w-0">
            <p className="text-lg font-semibold truncate">{displayName}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {ticker}
              {exchange ? ` · ${exchange}` : ""}
            </p>
          </div>
        </div>
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

      {/* ── Position row (only when ACTIVE + open Position exists) ── */}
      {/* Mirrors the dashboard ThesisRow position pattern: shares @
          cost, market value, live P&L. Intent suffix (direction · target/
          stop · horizon) appended so a glance tells you the whole trade
          structure. */}
      {position && liveStatus === "ACTIVE" ? (
        <PositionRow
          position={position}
          pnl={quote?.positionPnl ?? null}
          direction={direction}
          horizon={state?.horizon ?? null}
          targetPrice={state?.targetPrice ?? target_price ?? null}
          stopLoss={state?.stopLoss ?? stop_loss ?? null}
        />
      ) : null}

      {/* ── Watching row (status WATCHING, no open position) ── */}
      {/* The non-held analogue of PositionRow. Communicates the same
          shape: state, direction, levels, horizon. For LONG watching,
          the headline frames the target price as the entry trigger
          ("Watching for entry above $X"). */}
      {liveStatus === "WATCHING" && !position ? (
        <WatchingRow
          direction={direction}
          targetPrice={state?.targetPrice ?? target_price ?? null}
        />
      ) : null}

      {/* The Most-Recent-Trigger banner that previously lived here was
          removed 2026-05-18. The same data still surfaces inside the
          Activity timeline at the bottom of the sheet — duplicating it
          at the top made the header heavier than it needed to be. */}

      {/* ── Core Belief headline ─────────────────────────────── */}
      {/* The ONE durable claim — promoted to the top as a font-bigger
          headline above the reasoning summary + bull/bear bullets. NOT
          a card wrapper; just typography. Skeleton holds two muted lines
          while /triggers is still in flight so the layout doesn't jump
          when the belief lands. */}
      {state?.coreBelief ? (
        <p className="text-base font-medium leading-relaxed">
          {state.coreBelief}
        </p>
      ) : stateLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-3/4" />
        </div>
      ) : null}

      {/* ── Summary ───────────────────────────────────────────── */}
      {summaryText && (
        <p className="text-sm leading-relaxed">{summaryText}</p>
      )}

      {/* ── Bullish View ──────────────────────────────────────── */}
      {thesis_bullets.length > 0 && (
        <BulletSection
          title="Bullish View"
          icon={<PnlArrow direction="up" className="size-4" />}
          items={thesis_bullets}
        />
      )}

      {/* ── Bearish View ──────────────────────────────────────── */}
      {risk_flags.length > 0 && (
        <BulletSection
          title="Bearish View"
          icon={<PnlArrow direction="down" className="size-4" />}
          items={risk_flags}
        />
      )}

      {/* ── Sources ──────────────────────────────────────────── */}
      {/* Analyst-cited web sources (`sourcesUsed`) — mirrors the favicon
          strip on `/stocks/[symbol]` thesis rows. Distinct from per-section
          inline citations in researchSections (those come from the V2
          deep-research synthesis model). Hidden when sourcesUsed is empty
          or shaped unexpectedly. */}
      <SourcesStrip sourcesUsed={state?.sourcesUsed ?? null} />

      {/* The mid-sheet "Core Belief" card was removed 2026-05-18 — the
          one-sentence durable claim is now rendered as a bigger-font
          headline at the top of the sheet, above the reasoning summary.
          Keeping a second copy here was pure duplication. */}

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

      {/* ── Cause for Concern (invalidationConds) ──────────────── */}
      {/* ≥2 concrete trip-wires that would END the trade if they happen.
          The DB column is still `invalidationConds` — only the user-facing
          label changed (2026-05-19). The trade evaluator grades exits
          against these on close; the daily-run prompt uses them to decide
          when a signal counts as thesis-breaking. */}
      {state?.invalidationConds && state.invalidationConds.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
            Cause for Concern
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
        <BulletListSkeleton title="Cause for Concern" rows={2} />
      ) : null}

      {/* ── Scoring breakdown (4-dim composite) ───────────────── */}
      {/* Restyled 2026-05-18 to match the Schedule section's left/right
          InfoRow pattern: per-dim label on the left, score on the right,
          bottom border + the agent's one-sentence justification note on
          its own full-width line beneath. No uppercase, no rounded card
          container. Composite + (transitional) confidence sit in the
          section header. */}
      {state?.scoring ? (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
              Composite Score
            </p>
            <div className="flex items-baseline gap-3">
              {typeof state?.confidenceScore === "number" ? (
                <p className="text-xs text-muted-foreground tabular-nums">
                  Confidence{" "}
                  <span className="font-semibold text-foreground">
                    {state.confidenceScore}%
                  </span>
                </p>
              ) : null}
              {state.scoringComposite != null && (
                <p className="text-sm font-semibold tabular-nums">
                  {state.scoringComposite}/10
                </p>
              )}
            </div>
          </div>
          <div>
            <ScoringRow label="Trend strength" dim={state.scoring.trendStrength} max={3} />
            <ScoringRow label="Relative strength" dim={state.scoring.relativeStrength} max={3} />
            <ScoringRow label="Entry quality" dim={state.scoring.entryQuality} max={2} />
            <ScoringRow label="Catalyst freshness" dim={state.scoring.catalystFreshness} max={2} />
          </div>
        </div>
      ) : stateLoading ? (
        <CompositeScoreSkeleton />
      ) : null}

      {/* ── Research Synthesis (deep research) ───────────────── */}
      {/* Multi-section synthesis produced by the thesis-writer agent
          (THESIS_RESEARCH_V2 Phase 1). Null on every legacy row and on
          rows minted before Phase 1 ships, so this whole block hides
          itself for now and lights up once the agent starts writing.
          Each section is a Collapsible — opens individually so the user
          can dive into one section without scrolling past the others. */}
      {state?.researchSections && (
        <ResearchSectionsAccordion
          sections={state.researchSections}
          updatedAt={state.researchUpdatedAt}
        />
      )}

      {/* ── Price Targets ─────────────────────────────────────── */}
      {showLevels && (
        <PriceTargetsBlock
          entry={entry_price!}
          target={target_price ?? null}
          stop={stop_loss ?? null}
        />
      )}

      {/* ── Analyst Consensus ─────────────────────────────────── */}
      {fundamentals?.analyst_consensus &&
        (fundamentals.analyst_consensus.buy +
          fundamentals.analyst_consensus.hold +
          fundamentals.analyst_consensus.sell >
          0) && (
          <AnalystConsensusBlock consensus={fundamentals.analyst_consensus} />
        )}

      {/* ── Fundamentals ──────────────────────────────────────── */}
      {fundamentals && hasFundamentalDetails(fundamentals) && (
        <div className="space-y-2">
          <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
            Fundamentals
          </p>
          <FundamentalsContent fundamentals={fundamentals} />
        </div>
      )}

      {/* The Signal Types badge row (e.g. the small "momentum" chip) was
          removed 2026-05-18. The taxonomy is derivable from sourceSignalIds
          when needed and isn't load-bearing for any agent decision. The
          column itself drops in PR-9 alongside the V2 schema cutover. */}

      {/* ── Triggers + Schedule ───────────────────────────────── */}
      {/* Same gating as the timeline below — only shows once the row
          is persisted. Renders the structured trigger predicates, the
          horizon, nextReviewAt, scaling plan, etc. so you can see at
          a glance what events would warrant a re-evaluation. Reuses
          the same data we fetched above for the status header. */}
      {thesis_id ? (
        <ThesisTriggersSection thesisId={thesis_id} data={state} />
      ) : null}

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
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
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
