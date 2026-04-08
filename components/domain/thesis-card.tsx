"use client";

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { PnlArrow } from "@/components/ui/pnl-arrow";
import { InfoRow } from "@/components/ui/info-row";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { ButtonGroup, ButtonGroupSeparator } from "@/components/ui/button-group";
import { StockLogo } from "@/components/StockLogo";
import { TickBar, PriceGauge, type Tick } from "@/components/ui/gauge";

import type { SourceChipData } from "../chat/SourceChip";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  status?: "ACTIVE" | "INVALIDATED" | "CLOSED" | "SUPERSEDED";
};

export type ThesisCardProps = ComponentProps<typeof Card> &
  ThesisCardData & {
    /**
     * Optional render-prop replacement for the default card trigger.
     * When provided, it is used as the entire SheetTrigger surface and the
     * built-in card layout is suppressed. The original sheet content is
     * preserved. Used by ThesisMiniCard so the carousel cards open the
     * same sheet that the full ThesisCard opens.
     */
    customTrigger?: React.ReactElement;
  };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rrRatio(entry: number, target: number, stop: number): string {
  const risk = entry - stop;
  if (risk === 0) return "\u2014";
  return ((target - entry) / risk).toFixed(1);
}

/** Derive a human-friendly verdict from direction + confidence */
function verdictLabel(
  direction: "LONG" | "SHORT" | "PASS",
  confidence: number,
): { label: string; variant: "positive" | "negative" | "secondary" } {
  if (direction === "PASS") return { label: "Pass", variant: "secondary" };
  if (direction === "LONG") {
    if (confidence >= 80) return { label: "Strong Buy", variant: "positive" };
    if (confidence >= 60) return { label: "Buy", variant: "positive" };
    return { label: "Lean Buy", variant: "positive" };
  }
  // SHORT
  if (confidence >= 80) return { label: "Strong Sell", variant: "negative" };
  if (confidence >= 60) return { label: "Sell", variant: "negative" };
  return { label: "Lean Sell", variant: "negative" };
}

// ─── Shared sheet body ────────────────────────────────────────────────────────
//
// Single layout used by BOTH the LONG/SHORT branch and the PASS branch of
// ThesisCard. Uses the same patterns as the Trade Details sidebar on the
// trade detail page (components/trades, app/(root)/trades/[id]/page.tsx):
//   - Card + CardContent for grouped fields
//   - InfoRow for label-left / value-right rows
//   - text-sm everywhere; no hardcoded text-[10px] / text-[11px]
//   - text-muted-foreground for labels, text-foreground for values
//   - text-positive / text-negative ONLY for P&L-style values
//   - section headings as "text-sm font-medium" (no uppercase, no tracking)
//
// No full-width section dividers — vertical rhythm comes from `space-y-4`.

function ThesisSheetBody({
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
}: {
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
}) {
  const isPass = direction === "PASS";
  const displayName = company_name ?? ticker;
  const verdict = verdictLabel(direction, confidence_score);
  const DirIcon = direction === "LONG" ? TrendingUp : TrendingDown;
  const summaryText = isPass ? (pass_reason ?? reasoning_summary) : reasoning_summary;

  const hasEntry = entry_price != null;
  const hasTarget = target_price != null;
  const hasStop = stop_loss != null;
  const showLevels = !isPass && hasEntry && (hasTarget || hasStop);

  return (
    <div className="px-4 pb-6 pt-2 space-y-5">
      {/* ── Verdict ButtonGroup ──────────────────────────────── */}
      <div>
        <Tooltip>
          <TooltipTrigger
            render={
              <ButtonGroup className="cursor-default">
                <Badge variant={verdict.variant} className="rounded-r-none">
                  {!isPass && <DirIcon className="h-3 w-3" />}
                  {verdict.label}
                </Badge>
                <ButtonGroupSeparator />
                <Badge variant={verdict.variant} className="rounded-l-none tabular-nums">
                  {confidence_score}%
                </Badge>
              </ButtonGroup>
            }
          />
          <TooltipContent side="bottom" className="text-xs max-w-xs">
            Confidence score — signal quality, data consistency, and directional conviction
          </TooltipContent>
        </Tooltip>
      </div>

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

      {/* ── Price Targets (Polymarket-style) ──────────────────── */}
      {showLevels && (
        <PriceTargetsBlock
          entry={entry_price!}
          target={target_price ?? null}
          stop={stop_loss ?? null}
        />
      )}

      {/* ── Analyst Consensus (Polymarket-style) ──────────────── */}
      {fundamentals?.analyst_consensus &&
        (fundamentals.analyst_consensus.buy +
          fundamentals.analyst_consensus.hold +
          fundamentals.analyst_consensus.sell >
          0) && (
          <AnalystConsensusBlock consensus={fundamentals.analyst_consensus} />
        )}

      {/* ── Fundamentals — plain InfoRow stack, no card ───────── */}
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
    </div>
  );
}

// ── Bullet section (Bull Case / Risks) ──────────────────────────────────────

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

// ── Price targets — uses shared PriceGauge ─────────────────────────────────

function PriceTargetsBlock({
  entry,
  target,
  stop,
}: {
  entry: number;
  target: number | null;
  stop: number | null;
}) {
  // Compute the entry's horizontal position so the floating "$X.XX" label
  // sits above the entry stroke (not in a generic header). Mirrors the
  // bounds logic in PriceGauge so they always line up.
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
        {/* Floating entry label, anchored above the entry tick */}
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

// ── Polymarket-style analyst consensus ──────────────────────────────────────

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

  // One stroke per analyst, sell → hold → buy from left to right.
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

function hasFundamentalDetails(f: FundamentalsData): boolean {
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

// ─── ThesisCard ───────────────────────────────────────────────────────────────

export function ThesisCard({
  ticker,
  direction,
  confidence_score,
  reasoning_summary,
  thesis_bullets = [],
  risk_flags = [],
  entry_price,
  target_price,
  stop_loss,
  hold_duration,
  signal_types = [],
  sources: _sources = [],
  pass_reason,
  company_name,
  exchange,
  fundamentals,
  status,
  customTrigger,
  className,
  ...cardProps
}: ThesisCardProps) {
  const isLong = direction === "LONG";
  const isPass = direction === "PASS";

  const DirIcon = isLong ? TrendingUp : TrendingDown;

  const hasEntry = entry_price != null;
  const hasTarget = target_price != null;
  const hasStop = stop_loss != null;

  const rr =
    hasEntry && hasTarget && hasStop
      ? rrRatio(entry_price!, target_price!, stop_loss!)
      : null;

  const displayName = company_name ?? ticker;
  const verdict = verdictLabel(direction, confidence_score);

  // ── Shared header for ALL states ──────────────────────────────
  const header = (
    <div className="px-3 py-2 w-full border-b bg-muted flex items-center justify-between gap-4">
      {/* Left: logo + name + confidence with tooltip */}
      <div className="flex items-center gap-2 min-w-0">
        <StockLogo ticker={ticker} size="sm" />
        <span className="text-sm font-brand font-semibold text-foreground truncate">
          {displayName}
        </span>
        <Tooltip>
          <TooltipTrigger render={<span className="text-sm tabular-nums text-muted-foreground cursor-default" />}>
            {confidence_score}%
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Confidence score — signal quality, data consistency, and directional conviction
          </TooltipContent>
        </Tooltip>
      </div>
      {/* Right: status + verdict badge */}
      <div className="flex items-center gap-1.5">
        {status && status !== "ACTIVE" && (
          <Badge variant="outline">
            {status}
          </Badge>
        )}
        <Badge variant={verdict.variant}>
          {!isPass && <DirIcon className="h-3.5 w-3.5" />}
          {verdict.label}
        </Badge>
      </div>
    </div>
  );

  // ── PASS state — clickable card with sheet for full details ──
  if (isPass) {
    const passCardContent = (
      <Card
        className={cn(
          "overflow-hidden p-0 gap-0 cursor-pointer transition-colors hover:border-foreground/25",
          className,
        )}
        {...cardProps}
      >
        {header}
        {(pass_reason || reasoning_summary) && (
          <div className="px-3 py-2">
            <p className="text-sm font-light text-muted-foreground leading-relaxed line-clamp-2">
              {pass_reason || reasoning_summary}
              <span className="text-foreground/50 ml-1">&hellip; details</span>
            </p>
          </div>
        )}
      </Card>
    );

    return (
      <Sheet>
        <SheetTrigger render={customTrigger ?? passCardContent} />
        <SheetContent
          side="right"
          className="w-full sm:max-w-xl overflow-y-auto"
        >
          <SheetHeader className="pb-0">
            <SheetTitle className="sr-only">{displayName} Thesis</SheetTitle>
          </SheetHeader>

          <ThesisSheetBody
            ticker={ticker}
            direction={direction}
            confidence_score={confidence_score}
            reasoning_summary={reasoning_summary}
            pass_reason={pass_reason}
            thesis_bullets={thesis_bullets}
            risk_flags={risk_flags}
            entry_price={entry_price}
            target_price={target_price}
            stop_loss={stop_loss}
            hold_duration={hold_duration}
            signal_types={signal_types}
            company_name={company_name}
            exchange={exchange}
            fundamentals={fundamentals}
          />
        </SheetContent>
      </Sheet>
    );
  }

  // ── LONG/SHORT — same header + price rows + reasoning → sheet ──
  const cardContent = (
    <Card
      className={cn(
        "overflow-hidden p-0 gap-0 cursor-pointer transition-colors hover:border-foreground/25",
        className,
      )}
      {...cardProps}
    >
      {header}
      {/* ── Price rows ────────────────────────────────────────── */}
      {(hasEntry || hasTarget || hasStop) && (
        <div className="flex flex-col">
          {hasEntry && (
            <div className="px-3 py-1 flex items-center border-b">
              <span className="text-sm font-light text-muted-foreground grow">Entry</span>
              <span className="text-sm font-medium tabular-nums text-foreground">${entry_price!.toFixed(2)}</span>
            </div>
          )}
          {hasTarget && (
            <div className="px-3 py-1 flex items-center gap-2 border-b">
              <span className="text-sm font-light text-muted-foreground grow">Target</span>
              {hasEntry && (
                <PnlBadge value={((target_price! - entry_price!) / entry_price!) * 100} />
              )}
              <span className="text-sm font-medium tabular-nums text-positive">${target_price!.toFixed(2)}</span>
            </div>
          )}
          {hasStop && (
            <div className="px-3 py-1 flex items-center gap-2 border-b">
              <span className="text-sm font-light text-muted-foreground grow">Stop</span>
              {hasEntry && (
                <PnlBadge value={((stop_loss! - entry_price!) / entry_price!) * 100} />
              )}
              <span className="text-sm font-medium tabular-nums text-negative">${stop_loss!.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}
      {/* ── Meta line + reasoning preview ─────────────────────── */}
      <div className="px-3 pt-2 pb-0">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
          <span>{direction}</span>
          {hold_duration && (
            <>
              <span className="opacity-30">&middot;</span>
              <span>{hold_duration}</span>
            </>
          )}
          {rr != null && (
            <>
              <span className="opacity-30">&middot;</span>
              <span>{rr}&times; R:R</span>
            </>
          )}
        </span>
      </div>
      {reasoning_summary && (
        <div className="px-3 pt-1 pb-2">
          <p className="text-sm font-light text-muted-foreground leading-relaxed line-clamp-3">
            {reasoning_summary}
            <span className="text-foreground/50 ml-1">&hellip; read more</span>
          </p>
        </div>
      )}
    </Card>
  );

  return (
    <Sheet>
      <SheetTrigger render={customTrigger ?? cardContent} />

      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto"
      >
        <SheetHeader className="pb-0">
          <SheetTitle className="sr-only">{displayName} Thesis</SheetTitle>
        </SheetHeader>

        <ThesisSheetBody
          ticker={ticker}
          direction={direction}
          confidence_score={confidence_score}
          reasoning_summary={reasoning_summary}
          pass_reason={pass_reason}
          thesis_bullets={thesis_bullets}
          risk_flags={risk_flags}
          entry_price={entry_price}
          target_price={target_price}
          stop_loss={stop_loss}
          hold_duration={hold_duration}
          signal_types={signal_types}
          company_name={company_name}
          exchange={exchange}
          fundamentals={fundamentals}
        />
      </SheetContent>
    </Sheet>
  );
}

// ── Private: Fundamentals tab content ─────────────────────────────────────────

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
