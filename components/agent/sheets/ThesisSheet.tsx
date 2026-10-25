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
import { useLivePoll } from "@/hooks/useLivePoll";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PriceTargetsBlock } from "@/components/domain/price-targets-block";
import { ResearchBrief } from "@/components/domain/research-brief";
import { EarningsCard } from "@/components/domain/earnings-card";
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
import { ThesisHeader } from "@/components/domain/thesis-header";
import type { RangeMove } from "@/components/stocks/StockPriceChart";
import { formatCurrency } from "@/lib/format";
import { TickBar, type Tick } from "@/components/ui/gauge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SourceChipData } from "@/components/chat/SourceChip";
import { ThesisTimelineSection } from "@/components/agent/sheets/ThesisTimelineSection";
import { needsActionFlag } from "@/lib/agent/needs-action-line";
import { FlagNotificationIcon } from "@/components/ui/flag-notification-icon";
import { planSanityLabel } from "@/lib/agent/plan-sanity-label";
import { latestNoteView } from "@/lib/thesis/latest-note";
import type { NeedsAction } from "@/lib/agent/needs-action";
import { agentWatchDays } from "@/lib/agent/triggers/agent-watch";
import {
  ThesisTriggersSection,
  type ThesisDossier,
  type ThesisPendingProposal,
  type QuoteResponse,
  type ResolvedEnvelope,
  type ThesisResearchSections,
  type ResearchTextSection,
  type ResearchBulletSection,
} from "@/components/agent/sheets/ThesisTriggersSection";
import type { StockCandle } from "@/lib/actions/finnhub.actions";
import type { EarningsResponse, FilingsResponse } from "@/lib/types/thesis-sheet";
import { describeFilingEvent } from "@/lib/market-data/sec-events";
import type { AnalystCoverageData } from "@/lib/actions/analyst-coverage";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AnalystConsensusWidget,
  researchCitationSources,
} from "@/components/domain/analyst-consensus";
import { SourceCitation } from "@/components/ai-elements/inline-citation";
import { TradeStatement, type TradeStatementGain } from "@/components/ui/trade-statement";
import { ProposalActions } from "@/components/proposals/ProposalActions";
import { buildTradeSentence } from "@/lib/trade-statement";
import {
  EXECUTING_LABEL,
  EXECUTING_TOOLTIP,
  getTradeStatusDisplay,
} from "@/lib/trade-status";
import type { ThesisStatus } from "@/lib/thesis-status";
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
  /** Days between the agent's reviews; null = a plain watch (DAV-225). */
  agent_watch_days?: number | null;
  /**
   * Per-thesis "needs work today" annotation set by get_theses: the lead of
   * the stock's work list. Drives the flag on the read-theses table row.
   * null/undefined means no work needed.
   */
  needs_action?: NeedsAction | null;
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

// StatusPill and ConvictionBadge live in components/domain/thesis-header.tsx —
// the ONE header the sheet and the trade page share.

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

// ── ClampedParagraph ──
// The newest written note at the top of the sheet. Clamped to four lines;
// the whole paragraph is the hit area, hover darkens, click toggles. Same as
// the Activity feed's rows.
function ClampedParagraph({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <p
      className={cn(
        "text-xl font-normal leading-relaxed cursor-pointer transition-colors",
        !open && "line-clamp-4",
        className,
      )}
      onClick={() => setOpen((v) => !v)}
      title={open ? "Collapse" : "Expand"}
    >
      {text}
    </p>
  );
}

// ── TradeNote ──
// The proposal's own write-up. These run long — the agent explains the level,
// the risk math, the exposure after the buy — and at full length the trade
// block pushed the chart and the triggers off the screen.
//
// Same gesture as the Activity feed's rows: clamped to four lines, the whole
// paragraph is the hit area, hover darkens it so it reads as pressable, click
// toggles. No "Show more" link — the text itself is the control.
function TradeNote({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <p
      className={cn(
        "text-sm text-muted-foreground leading-relaxed cursor-pointer transition-colors hover:text-foreground",
        !open && "line-clamp-4",
      )}
      onClick={() => setOpen((v) => !v)}
      title={open ? "Collapse" : "Expand"}
    >
      {text}
    </p>
  );
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
  pendingProposal: ThesisPendingProposal | null;
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

  // The slot above the statement. While the decision is yours it holds the
  // Review control; once you've approved, the order is at Alpaca and there is
  // nothing left to decide, so the same slot reads a shimmering "Executing"
  // until the fill lands. Leaving it empty was the bug — approving made the
  // control vanish with nothing in its place, and the sheet looked like it
  // had lost the trade (PRAX, 2026-08-31). Same expiry caveat: an order
  // that's already been sent can't lapse, so its "Expires" meta goes too.
  let reviewSlot: ReactNode = null;
  let proposalMeta: string | null = null;
  if (pp?.executing) {
    reviewSlot = (
      <Tooltip>
        <TooltipTrigger
          render={<span className="text-xs shimmer-text cursor-default" />}
        >
          {EXECUTING_LABEL}
        </TooltipTrigger>
        <TooltipContent className="text-xs">{EXECUTING_TOOLTIP}</TooltipContent>
      </Tooltip>
    );
  } else if (pp) {
    reviewSlot = (
      <ProposalActions orderId={pp.orderId} expiresAt={pp.expiresAt} align="end" />
    );
    proposalMeta = pp.expiresAt ? `Expires ${fmtTradeDate(pp.expiresAt)}` : null;
  }

  if (pp && pp.intent === "OPEN") {
    // ── Pending buy (no position held yet) ──
    sentence = buildTradeSentence({
      kind: "proposed-buy",
      qty: pp.quantity,
      entry,
      buyVerb: direction === "SHORT" ? "Short" : "Buy",
      executing: pp.executing,
    });
    review = reviewSlot;
    // Amber is "waiting on you". Once the order is at Alpaca there is nothing
    // to decide, so it takes the same live-and-open blue the holding row uses —
    // from the shared status map, not a colour spelled out here.
    dotClass = getTradeStatusDisplay(pp.executing ? "OPEN" : "PENDING").dotClass;
    note = pp.rationale;
    meta = proposalMeta;
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
      executing: pp.executing,
    });
    review = reviewSlot;
    dotClass = getTradeStatusDisplay(pp.executing ? "OPEN" : "PENDING").dotClass;
    if (pnl != null) gain = { dollar: pnl.unrealizedPnl, pct: pnl.unrealizedPnlPct };
    note = pp.rationale;
    meta = proposalMeta;
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
      {note ? <TradeNote text={note} /> : null}
      {pp && !pp.executing ? <ResearchBrief orderId={pp.orderId} initial={pp.brief ?? null} /> : null}
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

// ── FilingsBlock ───────────────────────────────────────────────────────
// What this company told the SEC in the last month, live off EDGAR when the
// sheet opens — the serious and material filings only, since the routine
// ones (earnings results, press releases, exhibits) are noise on a sheet.
// One line, each filing linked. Renders nothing when there are none, and
// says so plainly when EDGAR couldn't be read — "no filings" would be a
// different claim. See docs/plans/SEC_FILINGS.md §8.

function FilingsBlock({ data }: { data: FilingsResponse }) {
  const worthALook = data.filings.filter((f) => f.tier !== "CONTEXT");
  if (!data.error && worthALook.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
        Filings
      </p>
      {data.error ? (
        <p className="text-sm text-muted-foreground">SEC filings unavailable — {data.error}.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          {worthALook.slice(0, 4).map((f, i) => (
            <span key={f.accession} className="inline-flex items-center gap-1.5">
              {i > 0 && <span className="text-muted-foreground/40">·</span>}
              <span className="text-muted-foreground tabular-nums">
                {new Date(`${f.filedDate}T00:00:00Z`).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                })}
              </span>
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "font-medium underline-offset-4 hover:underline",
                  f.tier === "RED" ? "text-red-500" : "text-foreground",
                )}
              >
                {describeFilingEvent(f)}
              </a>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// TradeStructureBlock (Status · Horizon · Next review · Size) was deleted
// 2026-09-30. Dave: "For trade structure. No. lol. We just dont need it."
// Next review was a row of derived restatements: the review clock is a
// review-clock trigger and shows in the trigger list, the horizon is on
// the thesis body, and "Status" was an internal actionability enum nobody
// could name. Nothing here had a reader.

/**
 * The top of the sheet: what is going on with this stock, right now.
 *
 * Three lines, in this order, and nothing else:
 *   1. the flag, named — `needsActionFlag`, one fixed sentence per enum
 *      case. Absent when nothing is flagged; "nothing is flagged" is not
 *      news and it used to take a line at the top of every stock.
 *   2. the newest thing an analyst WROTE about this stock — the rationale
 *      off the latest run-authored update. This is the block: it is the
 *      only part of the page that says what the situation is today.
 *   3. who wrote it and when, plus how old that is once it is stale.
 *
 * What this replaced (2026-09-30): "LATEST · Updated · 1h" over the frozen
 * core belief. Dave: "I like that I show the Core Belief. That is a
 * paragraph. It is helpful. The issue is it is not point in time." The
 * belief still renders — below the trade, labelled as the standing claim.
 *
 * The paragraph is only as good as what the run wrote; the header cannot
 * fix unreadable text, and the writing standard is tracked separately.
 */
function LatestNoteBlock({
  status,
  latestUpdate,
  needsAction,
  situations,
  quoteLoading,
  quoteFailed,
  analystName,
  /** Text already shown verbatim in the trade block — never repeated here. */
  suppressText,
}: {
  status: string;
  latestUpdate: ThesisDossier["latestUpdate"];
  needsAction: NeedsAction | null;
  /** Every situation the stock is in, lead first; the ones the lead didn't put it in follow the flag. */
  situations: Array<{ name: string; lead: boolean }>;
  quoteLoading: boolean;
  /** The live layer came back empty — we do not KNOW whether anything is flagged. */
  quoteFailed: boolean;
  analystName: string | null;
  suppressText: string | null;
}) {
  const note = latestUpdate?.rationale?.trim() || latestUpdate?.summary?.trim() || null;
  // A pending proposal prints its own rationale in the trade block right
  // below. When the newest written note IS that rationale, showing it twice
  // made the sheet read as two agents saying the same thing.
  const sameAsTrade =
    note != null &&
    suppressText != null &&
    note.replace(/\s+/g, " ") === suppressText.replace(/\s+/g, " ");
  const text = sameAsTrade ? null : note;

  // ONE flag line. `planSanity` used to stack under it — a second, unrelated
  // system (is this PLAN coherent?) painting the same amber as the work flag
  // (why will a run pick this up?), in prose written for the agent to read.
  // It renders beside the triggers now, where its numbers live.
  const flag = needsAction ? needsActionFlag(needsAction) : null;
  const also = situations.filter((x) => !x.lead).map((x) => x.name);
  const view = latestNoteView({
    status,
    hasNote: text != null,
    hasReasons: flag != null || also.length > 0,
    quoteLoading,
    quoteFailed,
  });
  if (!view) return null;

  return (
    <div className="space-y-2">
      {view.flags === "hidden" ? null : view.flags === "loading" ? (
        <Skeleton className="h-4 w-56" />
      ) : view.flags === "reasons" ? (
        // The lead flag, then the other situations the stock is in. With no
        // work flag, the situations alone are why the morning read lists it.
        <p className="flex items-center gap-1.5 text-sm text-foreground">
          <FlagNotificationIcon className="size-4 shrink-0" />
          <span>
            Flagged for review — {flag ? flag.name : also.join(", ")}
            {flag?.detail ? <>: {flag.detail}</> : null}
            {flag && also.length > 0 ? <span className="text-muted-foreground"> · also: {also.join(", ")}</span> : null}
          </span>
        </p>
      ) : view.flags === "unchecked" ? (
        // The flags are computed against the live price. Without one we do
        // not know whether this stock is flagged, and saying "nothing" would
        // be a clean-looking answer to a question we could not ask.
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t reach the live price, so the work flags couldn&apos;t be checked.
        </p>
      ) : null}

      {view.showNote && text ? (
        <>
          <ClampedParagraph text={text} />
          <WrittenByLine latestUpdate={latestUpdate} analystName={analystName} />
        </>
      ) : null}
    </div>
  );
}

/**
 * Who wrote the newest note and when — one line, directly under that note.
 * Past a fortnight it says how old it is: a month-old paragraph reads as
 * current otherwise.
 */
function WrittenByLine({
  latestUpdate,
  analystName,
}: {
  latestUpdate: ThesisDossier["latestUpdate"];
  analystName: string | null;
}) {
  if (!latestUpdate) return null;
  const writtenAt = new Date(latestUpdate.timestamp);
  if (!Number.isFinite(writtenAt.getTime())) return null;
  const daysOld = Math.floor((Date.now() - writtenAt.getTime()) / 86_400_000);
  return (
    <p className="text-xs text-muted-foreground">
      {analystName ? `${analystName} · ` : ""}
      written {writtenAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
      {daysOld >= 14 ? ` · ${daysOld} days ago` : ""}
    </p>
  );
}

/** "Written Sep 13 at $38.38": the date the research writer wrote the belief, and the price its own pull read. */
function WrittenUpLine({ writtenUp }: { writtenUp: ThesisDossier["writtenUp"] }) {
  if (!writtenUp) return null;
  const at = new Date(writtenUp.at);
  if (!Number.isFinite(at.getTime())) return null;
  return (
    <p className="text-xs text-muted-foreground tabular-nums">
      Written {at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
      {writtenUp.price != null ? ` at $${writtenUp.price.toFixed(2)}` : ""}
    </p>
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

  // Display order + labels. The snapshot is not shown (a later run's edit
  // read as current); Analyst Consensus has its own widget. Order here matches the user-facing accordion grouping spec — Bull/Bear come
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
                {bulletText}{" "}
                <SourceCitation sources={researchCitationSources(citation ? [citation] : [])} />
              </span>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <p className="whitespace-pre-wrap">
      {section.text}{" "}
      <SourceCitation sources={researchCitationSources(section.citations)} />
    </p>
  );
}

// AnalystConsensusWidget lives in components/domain/analyst-consensus.tsx —
// the ONE Street-view widget shared with the stock page sidebar.

// ─── ThesisSheetBody ──────────────────────────────────────────────────────────

// One skeleton for the ENTIRE sheet — shown while the atomic load is in flight.
// Mirrors the real layout (identity header, price line, trade block, thesis
// paragraph, chart) so there's no layout jump when the real content swaps in.
/** The body's skeleton: price line, trade block, chart, paragraph. */
export function ThesisBodySkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-20 w-full rounded-lg" />
      <Skeleton className="h-[300px] w-full rounded-lg" />
      <div className="space-y-2">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-11/12" />
        <Skeleton className="h-5 w-3/4" />
      </div>
    </div>
  );
}

function ThesisSheetSkeleton() {
  return (
    <div className="px-4 pb-6 pt-2 space-y-5">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 rounded-lg shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
        <ThesisBodySkeleton />
      </div>
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

/** Everything the sheet loads for one thesis, by id. */
export interface ThesisSheetData {
  state: ThesisDossier | null;
  loaded: boolean;
  quote: QuoteResponse | null;
  quoteLoading: boolean;
  earnings: EarningsResponse | null;
  filings: FilingsResponse | null;
  candles: StockCandle[] | null;
  candlesLoading: boolean;
  coverage: AnalystCoverageData | null;
  coverageLoading: boolean;
  /** Re-fetch the dossier + quote after a trigger edit or a send-to-agent. */
  refresh: () => void;
}

/**
 * The sheet's data, as a hook, so the sheet and the trade page load the same
 * thesis the same way. Durable-first paint, progressive live hydration:
 *   • GET /api/theses/:id                  → dossier (DB only) — GATES paint
 *   • GET /api/theses/:id/quote            → price + PnL + resolved (Finnhub)
 *   • GET /api/stocks/candles?symbols=…    → price chart (Alpaca)
 *   • GET /api/theses/:id/analyst-coverage → consensus (FMP — the slow one)
 * Each live layer has its own loading flag driving a region-level skeleton.
 */
export function useThesisSheetData(thesis_id: string | undefined, ticker: string): ThesisSheetData {
  const [state, setState] = useState<ThesisDossier | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(true);
  // Earnings + filings: own regions, never gate the paint, no skeleton (the
  // block simply appears when the vendor answers; absence is a valid state).
  const [earnings, setEarnings] = useState<EarningsResponse | null>(null);
  const [filings, setFilings] = useState<FilingsResponse | null>(null);
  const [candles, setCandles] = useState<StockCandle[] | null>(null);
  const [candlesLoading, setCandlesLoading] = useState(true);
  const [coverage, setCoverage] = useState<AnalystCoverageData | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(true);
  // Bumped after a trigger edit so the dossier re-fetches and the open sheet
  // reflects the new value without a manual reopen (live layers don't move).
  const [refreshKey, setRefreshKey] = useState(0);
  // The header price re-pulls on the live cadence while the sheet is open.
  const [liveTick, setLiveTick] = useState(0);
  useLivePoll(() => setLiveTick((n) => n + 1));

  // Re-gate (show the skeletons) only when a DIFFERENT thesis opens — NOT on a
  // refreshKey bump from a trigger edit, which swaps the dossier in place. Clear
  // the live data too, not just the loading flags: otherwise an in-place
  // thesis_id switch briefly renders the PREVIOUS thesis's price/chart/coverage.
  useEffect(() => {
    setLoaded(false);
    setQuote(null);
    setCandles(null);
    setCoverage(null);
    setEarnings(null);
    setFilings(null);
    setQuoteLoading(true);
    setCandlesLoading(true);
    setCoverageLoading(true);
  }, [thesis_id]);

  useEffect(() => {
    if (!thesis_id) return;
    let cancelled = false;
    fetch(`/api/theses/${thesis_id}/earnings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: EarningsResponse | null) => {
        if (!cancelled) setEarnings(json);
      })
      .catch(() => {
        /* absent block is the failure state */
      });
    return () => {
      cancelled = true;
    };
  }, [thesis_id]);

  useEffect(() => {
    if (!thesis_id) return;
    let cancelled = false;
    fetch(`/api/theses/${thesis_id}/filings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: FilingsResponse | null) => {
        if (!cancelled) setFilings(json);
      })
      .catch(() => {
        /* absent block is the failure state */
      });
    return () => {
      cancelled = true;
    };
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

  // Quote ALSO re-fetches on refreshKey: it carries the `resolved` envelope,
  // whose actionability is computed from the thesis's triggers, so a trigger
  // edit must re-resolve it (candles/coverage don't move on a trigger edit).
  // quoteLoading is NOT set here — a refetch updates price + resolved in
  // place without flashing the header skeleton.
  useEffect(() => {
    if (!thesis_id) return;
    let cancelled = false;
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
  }, [thesis_id, refreshKey, liveTick]);

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

  return {
    state,
    loaded,
    quote,
    quoteLoading,
    earnings,
    filings,
    candles,
    candlesLoading,
    coverage,
    coverageLoading,
    refresh: () => setRefreshKey((k) => k + 1),
  };
}

/** The period a move is over, said after the number in the price row. */
const MOVE_PERIOD: Record<string, string> = {
  "1D": "today",
  "1W": "past week",
  "1M": "past month",
  "3M": "past 3 months",
  "1Y": "past year",
  Trade: "this trade",
};

// ─── ThesisBody ──────────────────────────────────────────────────────────────
// Everything under the header, in this order on both the sheet and the trade
// page: the price with the chart's selected move · the trade banner · the
// tabs · the chart · the newest note · the triggers · the rest.
//   surface "sheet": the trade banner shows for a held or closed position.
//   surface "page":  the page's right-hand card carries the position, so the
//                    banner shows only while a proposal waits on you; the
//                    Price Targets block is the sidebar's too.
export function ThesisBody({
  data,
  thesis_id,
  ticker,
  surface,
}: {
  data: ThesisSheetData & { state: ThesisDossier };
  thesis_id?: string;
  ticker: string;
  surface: "sheet" | "page";
}) {
  const { state, quote, quoteLoading, earnings, filings, candles, candlesLoading, coverage, coverageLoading, refresh } = data;
  // What the chart's selected range shows; the price row prints it.
  const [move, setMove] = useState<RangeMove | null>(null);

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
  // `state.levels` is what fires; entryPrice/targetPrice/stopLoss are the
  // cache and are passed only so the card can flag a number no trigger backs.
  // See docs/plans/LEVELS_AS_TRIGGERS.md.
  const entryPrice = state.levels?.entry?.price ?? state.entryPrice;
  const targetPrice = state.targetPrice;
  const stopLoss = state.stopLoss;
  const floorLevel = state.levels?.floor ?? null;
  const targetLevel = state.levels?.target ?? null;
  // Show the block when there is either a live level or a stored number worth
  // flagging — a decorative stop is exactly what the reader needs to see.
  const showLevels =
    !isPass &&
    entryPrice != null &&
    (targetLevel != null ||
      floorLevel != null ||
      targetPrice != null ||
      stopLoss != null);
  // Legacy mint-time consensus: pre-PR-9 rows stored FundamentalsData (with
  // analyst_consensus) in the same Thesis.fundamentals column that now holds
  // the research section. Same column, one read — shape-sniffed for old rows.
  const mintConsensus =
    (state.fundamentals as { analyst_consensus?: { buy: number; hold: number; sell: number } } | null)
      ?.analyst_consensus ?? null;
  const variantView = state.variantView ?? null;

  // The price row's move. On 1D it is the quote's own day change — the live
  // price against yesterday's close, the same number the ticker tape shows.
  // On every other range it is what the chart shows for that stretch.
  const dayMove =
    quote?.dayChange != null ? { dollars: quote.dayChange, pct: quote.dayChangePct } : null;
  const shownMove =
    move == null || move.range === "1D"
      ? (dayMove ?? (move ? { dollars: move.dollars, pct: move.pct } : null))
      : { dollars: move.dollars, pct: move.pct };
  const period = MOVE_PERIOD[move?.range ?? "1D"] ?? "";

  const pendingProposal = position?.pendingProposal ?? null;
  const showBanner = position != null && (surface === "sheet" || pendingProposal != null);

  return (
    <div className="space-y-5">
      {/* ── Live price + the selected range's move ───────────── */}
      {/* Hydrates from /quote after the dossier paints: skeleton while in
          flight, nothing if the vendor failed (currentPrice null). */}
      {quoteLoading ? (
        <Skeleton className="h-7 w-32" />
      ) : quote?.currentPrice != null ? (
        <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
          <span className="text-xl font-semibold tabular-nums">
            {formatCurrency(quote.currentPrice)}
          </span>
          {shownMove ? (
            <span className="flex items-baseline gap-1.5">
              <PriceChange dollarChange={shownMove.dollars} percentChange={shownMove.pct} size="xl" />
              <span className="text-sm text-muted-foreground">{period}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      {/* ── The trade, above the tabs ─────────────────────────── */}
      {/* Held or merely proposed, it sits with the identity and the price,
          over both tabs. On the page the right-hand card carries the held
          trade, so only a proposal shows here. */}
      {showBanner && position ? (
        <TradeBlock
          position={position}
          pnl={quote?.positionPnl ?? null}
          pendingProposal={pendingProposal}
          direction={direction}
        />
      ) : null}

      {/* ── Tabs: Thesis (the dossier) | Activity (the audit log) ── */}
      <Tabs defaultValue={0}>
        <TabsList>
          <TabsTrigger value={0}>Thesis</TabsTrigger>
          <TabsTrigger value={1}>Activity</TabsTrigger>
        </TabsList>

        <TabsContent value={0} className="space-y-5">

      {/* ── Price chart (annotated) ───────────────────────────── */}
      {/* Full price line with Entry/Target/Stop lines + "Watching"/"Entry"
          markers. Its selected range's move prints in the price row above,
          not inside the chart. */}
      {!isPass && candlesLoading ? (
        <Skeleton className="h-[300px] w-full rounded-lg" />
      ) : !isPass && candles && candles.length >= 2 ? (
        <ThesisChart
          ticker={ticker}
          candles={candles}
          direction={direction === "SHORT" ? "SHORT" : "LONG"}
          entryPrice={entryPrice}
          avgCost={position?.avgCost ?? null}
          levels={state.levels ?? null}
          targetPrice={targetPrice}
          stopLoss={stopLoss}
          current={quote?.currentPrice ?? null}
          addedAt={state.createdAt}
          enteredAt={position?.openedAt ?? null}
          soldAt={position?.closedAt ?? null}
          variant="full"
          onChange={setMove}
          showChange={false}
        />
      ) : null}

      {/* ── What just happened, and whether it needs work (DAV-304) ── */}
      {/* Under the chart it comments on, above the triggers it leads to. */}
      <LatestNoteBlock
        status={state.status}
        latestUpdate={state.latestUpdate}
        needsAction={quote?.needsAction ?? null}
        situations={quote?.situations ?? []}
        quoteLoading={quoteLoading}
        quoteFailed={!quoteLoading && quote == null}
        analystName={state.analystName}
        suppressText={showBanner ? (pendingProposal?.rationale ?? null) : null}
      />

      {/* ── Triggers (the standing opinion in action) ── */}
      {thesis_id ? (
        <ThesisTriggersSection
          thesisId={thesis_id}
          data={state}
          direction={direction}
          editable={
            !isPass && (liveStatus === "HOLDING" || liveStatus === "WATCHING")
          }
          onChanged={refresh}
        />
      ) : null}

      {/* ── Plan checks ──────────────────────────────────────────── */}
      {/* Arithmetic on the plan above — does it have a buy level, is the stop
          inside normal daily noise, does the reward clear 2:1. The label is
          which check failed; the sentence under it is the agent's own. */}
      {resolved?.planSanity && resolved.planSanity.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
            Plan checks
          </p>
          {resolved.planSanity.map((f, i) => (
            <div key={i} className="space-y-0.5">
              <p className="text-sm text-foreground">{planSanityLabel(f.kind)}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{f.text}</p>
            </div>
          ))}
        </div>
      ) : null}

      {/* ── Core belief, dated by the write-up that set it ─────── */}
      {state.coreBelief ? (
        <div className="space-y-2">
          <p className="text-xl font-normal leading-relaxed">{state.coreBelief}</p>
          <WrittenUpLine writtenUp={state.writtenUp} />
        </div>
      ) : null}

      {/* ── Card cluster: Price Targets → Analyst Consensus → Composite ── */}
      {/* Price Targets — the entry/target/current/stop gauge. The page's
          sidebar renders the same block, so it shows here on the sheet only. */}
      {surface === "sheet" && showLevels && entryPrice != null ? (
        <PriceTargetsBlock
          entry={entryPrice}
          target={targetLevel}
          stop={floorLevel}
          storedTarget={targetPrice}
          storedStop={stopLoss}
          current={quote?.currentPrice ?? null}
          direction={direction === "SHORT" ? "SHORT" : "LONG"}
        />
      ) : null}

      {/* Analyst Consensus — coverage (FMP — the slow vendor) hydrates on its
          own boundary so it never blocks the chart; skeleton until it lands. */}
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

      {/* Composite Score — 4-dim scoring breakdown. */}
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

      {/* ── Earnings ─────────────────────────────────────────── */}
      {earnings ? <EarningsCard data={earnings} /> : null}

      {filings ? <FilingsBlock data={filings} /> : null}

      {/* ── Variant View ─────────────────────────────────────── */}
      <VariantViewBlock variantView={variantView} />

      {/* ── Key Assumptions ───────────────────────────────────── */}
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

      {/* ── Invalidation Conditions ──────────────────────────── */}
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
        updatedAt={state.writtenUp?.at ?? state.researchUpdatedAt}
      />

        </TabsContent>

        {/* ── Activity tab: timeline + provenance footer ───────── */}
        <TabsContent value={1} className="space-y-5">
          {thesis_id ? (
            <ThesisTimelineSection
              thesisId={thesis_id}
              provenance={
                state.sourceKind
                  ? {
                      sourceKind: state.sourceKind,
                      rationale: state.sourceRationale ?? null,
                    }
                  : null
              }
            />
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

// ─── ThesisSheetBody ──────────────────────────────────────────────────────────
// The sheet: the terminal-state alert, then the shared header, then the body.
export function ThesisSheetBody({ thesis_id, ticker }: ThesisSheetBodyProps) {
  const data = useThesisSheetData(thesis_id, ticker);

  // Skeleton until the DURABLE dossier settles, an honest error if it failed.
  // A sheet without a persisted id (e.g. a failed record_thesis card) has
  // nothing to load — that's the error state, not an eternal skeleton.
  if (!data.loaded && thesis_id) {
    return <ThesisSheetSkeleton />;
  }
  const state = data.state;
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

  return (
    <div className="px-4 pb-6 pt-2 space-y-5">
      {/* Terminal non-trade states only (INVALIDATED / DROPPED): why the thesis
          ended + when, so the rest reads as history. Returns null otherwise. */}
      <TerminalStatusAlert
        status={state.status as ThesisStatus}
        retiredReason={state.retiredReason ?? null}
        closedAt={state.closedAt ?? null}
        closeReason={state.closeReason ?? null}
        invalidatedAt={state.invalidatedAt ?? null}
        invalidReason={state.invalidReason ?? null}
      />
      <div className="space-y-2">
        <ThesisHeader
          ticker={ticker}
          // Identity rides in the payload (StockInfo cache via quote) — one
          // source; the bare ticker is the degenerate case when that failed.
          displayName={data.quote?.companyName ?? ticker}
          exchange={data.quote?.exchange ?? null}
          status={state.status}
          agentWatchDays={agentWatchDays(state.triggers)}
          conviction={(state.conviction ?? null) as "STRONG" | "HIGH" | "MEDIUM" | "LOW" | null}
          convictionRationale={state.convictionRationale ?? null}
          analystId={state.analystId}
          thesisId={thesis_id}
          onSent={data.refresh}
        />
        <ThesisBody data={{ ...data, state }} thesis_id={thesis_id} ticker={ticker} surface="sheet" />
      </div>
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
