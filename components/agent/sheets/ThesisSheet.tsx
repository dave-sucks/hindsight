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
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PnlArrow } from "@/components/ui/pnl-arrow";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { InfoRow } from "@/components/ui/info-row";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ButtonGroup, ButtonGroupSeparator } from "@/components/ui/button-group";
import { StockLogo } from "@/components/StockLogo";
import { TickBar, PriceGauge, type Tick } from "@/components/ui/gauge";
import { Bell } from "lucide-react";
import type { SourceChipData } from "@/components/chat/SourceChip";
import { ThesisTimelineSection } from "@/components/agent/sheets/ThesisTimelineSection";
import {
  ThesisTriggersSection,
  type TriggersResponse,
} from "@/components/agent/sheets/ThesisTriggersSection";
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
// Lifecycle-led: the durable answer to "what is this thesis right now?"
// Left cell = STATUS (Holding / Watching / Closed / Invalidated). Right
// cell varies by status — live P&L for Holdings, confidence% for
// Watching, terminal reason for Closed/Invalidated. Status comes from the
// caller's known thesis row on first paint (no flicker); the API fetch
// only refines it (live PnL%, terminal reason text).

type LiveStatus = "ACTIVE" | "WATCHING" | "CLOSED" | "INVALIDATED" | "SUPERSEDED";

function StatusPill({
  liveStatus,
  position,
  closeReason,
  invalidReason,
}: {
  liveStatus: LiveStatus | null;
  position: TriggersResponse["position"];
  closeReason: string | null;
  invalidReason: string | null;
}) {
  // Don't paint until status is resolved — avoids the Holding→Watching
  // flicker when ThesisCardData arrives without status (older persisted
  // RunMessages, or any path that doesn't carry the field). The pill is
  // a small surface; its absence for a frame is preferable to a wrong
  // initial value.
  if (liveStatus == null) return null;

  // Same secondary variant for every status — neutral background, the
  // colored dot does the lifecycle work. Mirrors ReadThesesTable.
  let leftLabel: string;
  let dotClass: string;

  switch (liveStatus) {
    case "ACTIVE":
      leftLabel = "Holding";
      dotClass = "bg-positive";
      break;
    case "WATCHING":
      leftLabel = "Watching";
      dotClass = "bg-blue-500";
      break;
    case "CLOSED":
      leftLabel = "Closed";
      dotClass = "bg-muted-foreground/60";
      break;
    case "INVALIDATED":
      leftLabel = "Invalidated";
      dotClass = "bg-negative";
      break;
    case "SUPERSEDED":
      leftLabel = "Superseded";
      dotClass = "bg-muted-foreground/40";
      break;
  }

  // Right cell only renders for statuses with actionable run-context info:
  // live PnL% for Holding, terminal reason text for Closed/Invalidated.
  // Watching has no right cell — confidence is metadata at thesis creation,
  // not a run-context signal. Direction + confidence still appear inside
  // the body (Bullish/Bearish view + bullets).
  let rightNode: React.ReactNode = null;
  if (liveStatus === "ACTIVE" && position?.unrealizedPnlPct != null) {
    const pct = position.unrealizedPnlPct;
    const sign = pct >= 0 ? "+" : "";
    rightNode = (
      <span
        className={cn(
          "tabular-nums",
          pct >= 0 ? "text-positive" : "text-negative",
        )}
      >
        {sign}
        {pct.toFixed(2)}%
      </span>
    );
  } else if (liveStatus === "CLOSED" && closeReason) {
    rightNode = (
      <span className="truncate max-w-[14rem]" title={closeReason}>
        {closeReason.slice(0, 40)}
      </span>
    );
  } else if (liveStatus === "INVALIDATED" && invalidReason) {
    rightNode = (
      <span className="truncate max-w-[14rem]" title={invalidReason}>
        {invalidReason.slice(0, 40)}
      </span>
    );
  }

  // Single-cell variant when there's no right node — keeps the pill narrow
  // and the visual density matches ReadThesesTable / ThesisMiniCard.
  if (rightNode == null) {
    return (
      <div>
        <Badge variant="secondary" className="gap-1.5 font-normal">
          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotClass)} />
          {leftLabel}
        </Badge>
      </div>
    );
  }

  return (
    <div>
      <ButtonGroup className="cursor-default">
        <Badge variant="secondary" className="rounded-r-none gap-1.5 font-normal">
          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotClass)} />
          {leftLabel}
        </Badge>
        <ButtonGroupSeparator />
        <Badge variant="secondary" className="rounded-l-none font-normal">
          {rightNode}
        </Badge>
      </ButtonGroup>
    </div>
  );
}

// ── PositionRow ──
// Mirrors the dashboard ThesisRow's "position row" pattern: shares @
// cost, market value, live P&L. Renders only when status='ACTIVE' and
// an open Position is matched on (analyst, ticker).

function PositionRow({
  position,
  stopLoss,
  targetPrice,
}: {
  position: NonNullable<TriggersResponse["position"]>;
  stopLoss: number | null;
  targetPrice: number | null;
}) {
  const $ = (n: number) => `$${n.toFixed(2)}`;
  const $k = (n: number) =>
    `$${n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  return (
    <div className="rounded-lg border bg-positive/10 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border border-border text-muted-foreground shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-positive" />
          OPEN
        </span>
        <span className="text-sm">
          {position.quantity} shares @{" "}
          <span className="tabular-nums font-medium">
            {$(position.avgCost)}
          </span>
          {targetPrice != null && targetPrice > 0 ? (
            <>
              , targeting{" "}
              <span className="tabular-nums font-medium">
                {$(targetPrice)}
              </span>
            </>
          ) : null}
        </span>
        <div className="flex items-center gap-2 ml-auto">
          {position.marketValue != null ? (
            <span className="text-sm tabular-nums font-medium">
              {$k(position.marketValue)}
            </span>
          ) : null}
          {position.unrealizedPnlPct != null ? (
            <PnlBadge value={position.unrealizedPnlPct} />
          ) : null}
        </div>
      </div>
      {stopLoss != null && stopLoss > 0 ? (
        <p className="text-xs text-muted-foreground mt-0.5">
          Stop at <span className="tabular-nums">{$(stopLoss)}</span> ·{" "}
          {position.daysHeld}d held
        </p>
      ) : (
        <p className="text-xs text-muted-foreground mt-0.5">
          {position.daysHeld}d held
        </p>
      )}
    </div>
  );
}

// ── TriggerFiredBanner ──
// Surfaces the most-recent TRIGGER_FIRED audit row from the past 7d.
// One liner: predicate that fired + relative time + link to the run
// the agent took action in. The full detail lives in the Activity
// timeline below.

function TriggerFiredBanner({
  fire,
}: {
  fire: NonNullable<TriggersResponse["recentFire"]>;
}) {
  const router = useRouter();
  const ago = relativeTime(fire.timestamp);
  return (
    <button
      type="button"
      onClick={() => {
        if (fire.runId) router.push(`/runs/${fire.runId}`);
      }}
      className={cn(
        "w-full text-left rounded-lg border border-amber-500/40 bg-amber-500/10",
        "px-3 py-2 flex items-start gap-2.5 transition-colors",
        fire.runId ? "hover:bg-amber-500/15 cursor-pointer" : "cursor-default",
      )}
    >
      <Bell className="size-4 text-amber-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">Trigger fired</span>
          <span className="text-xs text-muted-foreground">{ago}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
          {fire.summary}
        </p>
        {fire.runId ? (
          <p className="text-[11px] text-amber-500 mt-1">View run →</p>
        ) : null}
      </div>
    </button>
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

  // Initial value comes from the row that opened the sheet — no flicker.
  // The API fetch refines it with live PnL and terminal reasons. Null
  // until either source resolves; StatusPill renders nothing in that
  // window so we never paint a wrong-default like Holding green.
  const liveStatus = (state?.status ?? status ?? null) as LiveStatus | null;
  const position = state?.position ?? null;
  const recentFire = state?.recentFire ?? null;

  return (
    <div className="px-4 pb-6 pt-2 space-y-5">
      {/* ── Status pill ButtonGroup (replaces Strong Buy/% verdict) ── */}
      {/* Status is the durable lifecycle state (Holding / Watching /
          Closed / Invalidated). The right cell is the verdict at a
          glance — for Holding it's live PnL%, for Watching it's the
          confidence-derived label, for Closed/Invalidated it's the
          terminal reason. Conviction% moves to a secondary stat below. */}
      <StatusPill
        liveStatus={liveStatus}
        position={position}
        closeReason={state?.closeReason ?? null}
        invalidReason={state?.invalidReason ?? null}
      />

      {/* ── Stock identity ───────────────────────────────────── */}
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

      {/* ── Position row (only when ACTIVE + open Position exists) ── */}
      {/* Mirrors the dashboard ThesisRow position pattern: shares @
          cost, market value, live P&L. Stop line below when set. */}
      {position && liveStatus === "ACTIVE" ? (
        <PositionRow position={position} stopLoss={stop_loss ?? null} targetPrice={target_price ?? null} />
      ) : null}

      {/* ── Trigger fired banner ─────────────────────────────── */}
      {/* Surfaces the most-recent TRIGGER_FIRED audit row from the past
          7 days. Crystal clear what happened + when + a link to the
          run the agent took action in. */}
      {recentFire ? <TriggerFiredBanner fire={recentFire} /> : null}

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
