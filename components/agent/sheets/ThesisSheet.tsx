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
import { useRouter } from "next/navigation";
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
import { describeTriggerFire } from "@/lib/agent/triggers/format";
import type { SourceChipData } from "@/components/chat/SourceChip";
import { ThesisTimelineSection } from "@/components/agent/sheets/ThesisTimelineSection";
import {
  ThesisTriggersSection,
  type TriggersResponse,
  type ThesisResearchSections,
  type ResearchTextSection,
  type ResearchBulletSection,
  type ResearchCitation,
  type ThesisSourcesUsedItem,
} from "@/components/agent/sheets/ThesisTriggersSection";
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
  direction,
  horizon,
  targetPrice,
  stopLoss,
}: {
  position: NonNullable<TriggersResponse["position"]>;
  direction: "LONG" | "SHORT" | "PASS";
  horizon?: string | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
}) {
  return (
    <div className="space-y-1">
      <p className="text-sm tabular-nums leading-relaxed">
        Bought {position.quantity.toFixed(1)} shares at{" "}
        <span className="font-medium">${position.avgCost.toFixed(2)}</span>
        {position.currentPrice != null ? (
          <>
            , now trading at{" "}
            <span className="font-medium">
              ${position.currentPrice.toFixed(2)}
            </span>
          </>
        ) : null}
      </p>
      {position.unrealizedPnl != null ? (
        <PriceChange
          dollarChange={position.unrealizedPnl}
          percentChange={position.unrealizedPnlPct}
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

// ── TriggerFiredBanner ──
// Most-recent TRIGGER_FIRED audit row for THIS thesis across the past
// 7d (NOT scoped to the run that opened the sheet — answers "is this
// thesis being acted on" globally). Card shape mirrors the Price
// Targets card below it: same bg-muted/40, p-2, gap-6, header line.
//
// Body composes the sentence at render time from the trigger's
// predicate + action so the user reads English ("Price below $5.92 —
// review") regardless of what the producer wrote in `fire.summary`.

function TriggerFiredBanner({
  fire,
  triggers,
}: {
  fire: NonNullable<TriggersResponse["recentFire"]>;
  triggers: TriggersResponse["triggers"];
}) {
  const router = useRouter();
  const trigger = triggers.find((t) => t.id === fire.triggerId);
  // Fall back to the producer's persisted summary if we can't find the
  // matching trigger row (predicate may have been edited / removed).
  const sentence = trigger
    ? describeTriggerFire(trigger as Parameters<typeof describeTriggerFire>[0])
    : fire.summary;

  return (
    <Card className="bg-muted/40 p-2 gap-6">
      <p className="text-sm font-medium">Most recent trigger</p>

      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse shrink-0 mt-1.5" />
          <p className="text-sm leading-relaxed flex-1 min-w-0">{sentence}</p>
        </div>

        <div className="flex items-center gap-2 pl-3.5 text-xs text-muted-foreground">
          <span>{relativeTime(fire.timestamp)}</span>
          {fire.runId ? (
            <>
              <span className="opacity-40">·</span>
              <button
                type="button"
                onClick={() => router.push(`/runs/${fire.runId}`)}
                className="hover:underline hover:text-foreground transition-colors"
              >
                View run →
              </button>
            </>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

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
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium flex items-center gap-1.5">
        {icon}
        {title}
      </p>
      <ul className="list-disc pl-4 marker:text-muted-foreground/40 space-y-1">
        {items.map((b, i) => (
          <li key={i} className="text-sm text-muted-foreground leading-relaxed">
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * ScoringRow — one row of the 4-dimension composite breakdown. Shows
 * dimension label, score / max, and the agent's one-sentence justification
 * note. Renders nothing if the dimension is missing on the thesis (older
 * rows minted before the scoring rubric shipped).
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
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground w-32 shrink-0">
        {label}
      </span>
      <span className="text-sm font-medium tabular-nums w-12 shrink-0">
        {dim.score}/{max}
      </span>
      {dim.note && (
        <span className="text-xs text-muted-foreground leading-relaxed flex-1">
          {dim.note}
        </span>
      )}
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

// ── ProvenanceRow ──────────────────────────────────────────────────────
// One-line provenance summary surfaced just above the reasoning summary.
// Format: "Sourced via ROUTED_SIGNAL · 3 signals" — the source kind is a
// chip, signal count shows when there were any. The `sourceRationale`
// one-liner sits next to the chip. Added 2026-05-18 (THESIS_CLEANUP PR-6).
function ProvenanceRow({
  sourceKind,
  rationale,
  signalCount,
}: {
  sourceKind: string;
  rationale: string | null;
  signalCount: number;
}) {
  // Human-readable label for each source kind. The raw enum values are
  // shouty (ROUTED_SIGNAL) — soften for display while keeping them
  // recognizable for hit-rate audit views.
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
  return (
    <div className="flex flex-wrap items-baseline gap-2 text-xs text-muted-foreground">
      <span>Sourced via</span>
      <Badge variant="secondary" className="font-normal">
        {label}
      </Badge>
      {signalCount > 0 ? (
        <span>
          · {signalCount} signal{signalCount === 1 ? "" : "s"}
        </span>
      ) : null}
      {rationale ? (
        <span className="opacity-80">· {rationale}</span>
      ) : null}
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
      <p className="text-sm font-medium">Sources</p>
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
// list of independently-collapsible sections. The thesis-writer agent
// produces a known set of section keys; this renderer maps each to a
// human-readable label and walks `text + citations` OR `bullets[]` content
// shapes. Unknown extra keys are skipped — the synthesis model can add
// sections without a UI deploy.
function ResearchSectionsAccordion({
  sections,
  updatedAt,
}: {
  sections: ThesisResearchSections;
  updatedAt: string | null;
}) {
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
  const populated = RENDER_ORDER.filter(({ key }) => {
    const section = sections[key];
    if (!section) return false;
    if ("text" in section && section.text) return true;
    if ("bullets" in section && section.bullets && section.bullets.length > 0) return true;
    return false;
  });
  if (populated.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">Research Synthesis</p>
        {updatedAt ? (
          <p className="text-xs text-muted-foreground">
            Updated {relativeTime(updatedAt)}
          </p>
        ) : null}
      </div>
      <div className="rounded-lg border divide-y">
        {populated.map(({ key, label }) => {
          const section = sections[key]!;
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
  if ("bullets" in section) {
    return (
      <ul className="space-y-1.5">
        {section.bullets.map((b, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-muted-foreground select-none">•</span>
            <span className="flex-1">
              {b.text}
              {b.citation ? <ResearchCitationChip citation={b.citation} /> : null}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <p>
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
      <p className="text-sm font-medium">Price Targets</p>

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
        <p className="text-sm font-medium">Analyst Consensus</p>
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
}: ThesisSheetBodyProps) {
  const isPass = direction === "PASS";
  const displayName = company_name ?? ticker;
  const summaryText = isPass ? (pass_reason ?? reasoning_summary) : reasoning_summary;

  const hasEntry = entry_price != null;
  const hasTarget = target_price != null;
  const hasStop = stop_loss != null;
  const showLevels = !isPass && hasEntry && (hasTarget || hasStop);

  // Fetch durable thesis state once when we have an id. Drives the
  // status pill, position row, and trigger-fired banner. The triggers
  // + schedule section reuses this same data via prop drilling so we
  // don't double-fetch.
  const [state, setState] = useState<TriggersResponse | null>(null);
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
    return () => {
      cancelled = true;
    };
  }, [thesis_id]);

  // Status comes from the row that opened the sheet; the API fetch
  // refines it (live PnL, terminal reasons). If neither has a value the
  // pill simply doesn't render — no defensive default.
  const liveStatus = (state?.status ?? status) as ThesisStatus | undefined;
  const position = state?.position ?? null;
  const recentFire = state?.recentFire ?? null;

  return (
    <div className="px-4 pb-6 pt-2 space-y-5">
      {liveStatus ? <StatusPill status={liveStatus} /> : null}

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
        {/* Live current price + day's change. Mirrors the stock-detail
            page's header pattern (one font size smaller). Renders for
            every status — WATCHING, ACTIVE, terminal — so the user can
            always see where the stock is right now, separate from the
            mint-time entry price below. */}
        {state?.currentPrice != null && (
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">
              ${state.currentPrice.toFixed(2)}
            </span>
            {state.dayChange != null && (
              <PriceChange
                dollarChange={state.dayChange}
                percentChange={state.dayChangePct}
                size="base"
              />
            )}
          </div>
        )}
      </div>

      {/* ── Position row (only when ACTIVE + open Position exists) ── */}
      {/* Mirrors the dashboard ThesisRow position pattern: shares @
          cost, market value, live P&L. Intent suffix (direction · target/
          stop · horizon) appended so a glance tells you the whole trade
          structure. */}
      {position && liveStatus === "ACTIVE" ? (
        <PositionRow
          position={position}
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

      {/* ── Trigger fired banner ─────────────────────────────── */}
      {/* Surfaces the most-recent TRIGGER_FIRED audit row from the past
          7 days. Crystal clear what happened + when + a link to the
          run the agent took action in. */}
      {recentFire ? (
        <TriggerFiredBanner fire={recentFire} triggers={state?.triggers ?? []} />
      ) : null}

      {/* ── Provenance row ─────────────────────────────────── */}
      {/* Where this thesis came from + the analyst's one-line rationale
          + the count of cited Signal rows. Lets the user audit "is this
          from the intelligence pipeline (signal-driven) or did the agent
          reach for it on a web search?" — useful for hit-rate analysis
          by source kind. Hidden when sourceKind is missing (legacy rows
          predating the V3 Fix 5 provenance column). */}
      {state?.sourceKind ? (
        <ProvenanceRow
          sourceKind={state.sourceKind}
          rationale={state.sourceRationale}
          signalCount={state.sourceSignalIds.length}
        />
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

      {/* ── Core Belief ───────────────────────────────────────── */}
      {/* The ONE-sentence durable claim — distinct from reasoningSummary
          (current-state framing) which appears above. Surfaced because
          the trade-evaluator grades exits against this, and the tactical
          agent uses it to decide whether a trigger fire is thesis-breaking
          or noise. Previously hidden; now load-bearing in the UI. */}
      {state?.coreBelief && (
        <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Core Belief
          </p>
          <p className="text-sm leading-relaxed">{state.coreBelief}</p>
        </div>
      )}

      {/* ── Key Assumptions ───────────────────────────────────── */}
      {/* ≥2 falsifiable premises that must remain true for the core belief
          to hold. The daily-run prompt reads these against fresh signals
          to decide when an assumption has flipped. */}
      {state?.keyAssumptions && state.keyAssumptions.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Key Assumptions</p>
          <ul className="space-y-1.5 text-sm leading-relaxed">
            {state.keyAssumptions.map((a, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-muted-foreground select-none">•</span>
                <span className="flex-1">{a}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Invalidation Conditions ───────────────────────────── */}
      {/* ≥2 concrete trip-wires that would prove the thesis wrong. Distinct
          from Bearish View / riskFlags — these are the specific rules the
          trade evaluator grades against on close and the daily-run prompt
          uses to decide when a signal counts as thesis-breaking. Surfaced
          on 2026-05-18 (THESIS_CLEANUP PR-2) — previously fetched and
          dropped on the floor. */}
      {state?.invalidationConds && state.invalidationConds.length > 0 && (
        <div className="space-y-2">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Invalidation Conditions</p>
            <p className="text-xs text-muted-foreground">
              What would prove this thesis wrong
            </p>
          </div>
          <ul className="space-y-1.5 text-sm leading-relaxed">
            {state.invalidationConds.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-muted-foreground select-none">•</span>
                <span className="flex-1">{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Scoring breakdown (4-dim composite) ───────────────── */}
      {/* The decision-framework scoring that drove WATCHING vs PASS.
          Composite ≥4 → mint WATCHING; <4 → mint PASS+ARCHIVED. Notes
          cite concrete evidence per dimension. Surfaced verbatim so the
          user can audit the agent's reasoning. */}
      {state?.scoring && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium">Composite Score</p>
            <div className="flex items-baseline gap-3">
              {/* Confidence chip — agent's overall 0-100 trade conviction.
                  Both confidence ≥ minConfidence AND composite ≥ 7 gate
                  place_trade, so they belong side-by-side. Phase 2 collapses
                  these onto one number; until then both are visible. */}
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
          <div className="space-y-1.5 rounded-lg border p-3">
            <ScoringRow label="Trend strength" dim={state.scoring.trendStrength} max={3} />
            <ScoringRow label="Relative strength" dim={state.scoring.relativeStrength} max={3} />
            <ScoringRow label="Entry quality" dim={state.scoring.entryQuality} max={2} />
            <ScoringRow label="Catalyst freshness" dim={state.scoring.catalystFreshness} max={2} />
          </div>
        </div>
      )}

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
          <p className="text-sm font-medium">Fundamentals</p>
          <FundamentalsContent fundamentals={fundamentals} />
        </div>
      )}

      {/* ── Signal types ──────────────────────────────────────── */}
      {signal_types.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {signal_types.map((s) => (
            <Badge key={s} variant="outline" className="font-normal">
              {s.replace(/_/g, " ").toLowerCase()}
            </Badge>
          ))}
        </div>
      )}

      {/* ── Triggers + Schedule ───────────────────────────────── */}
      {/* Same gating as the timeline below — only shows once the row
          is persisted. Renders the structured trigger predicates, the
          horizon, nextReviewAt, scaling plan, etc. so you can see at
          a glance what events would warrant a re-evaluation. Reuses
          the same data we fetched above for the status header. */}
      {thesis_id ? (
        <ThesisTriggersSection thesisId={thesis_id} data={state} />
      ) : null}

      {/* ── Activity timeline ─────────────────────────────────── */}
      {/* Renders only when we have a persisted thesis id. Agent-run inline
          theses don't pass one — the row commits async, so we'd have
          nothing to fetch. Once the row exists, every other surface
          (run detail, trades page, stocks page) passes thesis_id and the
          timeline appears. */}
      {thesis_id ? <ThesisTimelineSection thesisId={thesis_id} /> : null}
    </div>
  );
}

// ─── ThesisSheet — controlled standalone sheet ────────────────────────────────

interface ThesisSheetProps extends ThesisCardData {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ThesisSheet({ open, onOpenChange, ...data }: ThesisSheetProps) {
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
        />
      </SheetContent>
    </Sheet>
  );
}
