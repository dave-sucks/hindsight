"use client";

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PnlBadge } from "@/components/ui/pnl-badge";
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
import { StockLogo } from "@/components/StockLogo";
import { PriceGauge } from "@/components/domain/price-gauge";

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

export type ThesisCardProps = ComponentProps<typeof Card> & ThesisCardData;

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
        <SheetTrigger render={passCardContent} />
        <SheetContent
          side="right"
          className="w-full sm:max-w-xl overflow-y-auto"
        >
          <SheetHeader className="border-b pb-4">
            <div className="flex items-center gap-3">
              <StockLogo ticker={ticker} size="lg" />
              <div>
                <SheetTitle className="text-lg font-bold">
                  {displayName}
                </SheetTitle>
                <span className="text-xs font-mono text-muted-foreground">
                  {ticker}{exchange ? ` · ${exchange}` : ""}
                </span>
              </div>
              <Badge variant={verdict.variant}>
                {verdict.label}
              </Badge>
              <span
                className={cn(
                  "ml-auto flex items-center justify-center rounded-full size-12 text-base font-bold tabular-nums",
                  "bg-muted text-muted-foreground",
                )}
              >
                {confidence_score}
              </span>
            </div>
          </SheetHeader>

          <div className="p-4 space-y-6">
            {signal_types.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {signal_types.map((s) => (
                  <Badge key={s} variant="outline">
                    {s.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
            )}

            {(pass_reason || reasoning_summary) && (
              <div className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pass Reason</span>
                <p className="text-sm leading-relaxed text-foreground/80">
                  {pass_reason || reasoning_summary}
                </p>
              </div>
            )}

            {thesis_bullets.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Analysis</span>
                <div className="space-y-2">
                  {thesis_bullets.map((b, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                      <span className="leading-relaxed">{b}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {risk_flags.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-wide text-amber-500">Risk Factors</span>
                <div className="space-y-2">
                  {risk_flags.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                      <span className="leading-relaxed">{r}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {fundamentals && <FundamentalsContent fundamentals={fundamentals} />}
          </div>
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
      <SheetTrigger render={cardContent} />

      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto"
      >
        {/* ── Header — logo + name + verdict + score ─────────── */}
        <SheetHeader className="pb-0">
          <SheetTitle className="sr-only">{displayName} Thesis</SheetTitle>
        </SheetHeader>

        <div>
          <div className="p-3 border-b">
            <div className="flex items-center gap-3">
              <StockLogo ticker={ticker} size="lg" />
              <div className="flex-1 min-w-0">
                <p className="text-lg font-semibold">{displayName}</p>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {ticker}{exchange ? ` · ${exchange}` : ""}
                </span>
              </div>
              <Badge variant={verdict.variant}>
                {!isPass && <DirIcon className="h-3.5 w-3.5" />}
                {verdict.label}
              </Badge>
              <span
                className={cn(
                  "flex items-center justify-center rounded-full size-9 text-sm font-bold tabular-nums",
                  confidence_score >= 80
                    ? "bg-positive/10 text-positive"
                    : confidence_score >= 60
                      ? "bg-amber-500/15 text-amber-500"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {confidence_score}
              </span>
            </div>
          </div>

          {/* ── Analysis content ─── */}
          <AnalysisContent
            signal_types={signal_types}
            hasEntry={hasEntry}
            hasTarget={hasTarget}
            hasStop={hasStop}
            entry_price={entry_price}
            target_price={target_price}
            stop_loss={stop_loss}
            direction={direction}
            rr={rr}
            reasoning_summary={reasoning_summary}
            thesis_bullets={thesis_bullets}
            risk_flags={risk_flags}
          />

          {/* ── Fundamentals (inline, no tabs) ─── */}
          {fundamentals && (
            <div className="p-3 border-b">
              <FundamentalsContent fundamentals={fundamentals} />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Private: Analysis tab content ─────────────────────────────────────────────

function AnalysisContent({
  signal_types,
  hasEntry,
  hasTarget,
  hasStop,
  entry_price,
  target_price,
  stop_loss,
  direction,
  rr,
  reasoning_summary,
  thesis_bullets,
  risk_flags,
}: {
  signal_types: string[];
  hasEntry: boolean;
  hasTarget: boolean;
  hasStop: boolean;
  entry_price?: number | null;
  target_price?: number | null;
  stop_loss?: number | null;
  direction: string;
  rr: string | null;
  reasoning_summary?: string;
  thesis_bullets: string[];
  risk_flags: string[];
}) {
  return (
    <>
      {/* Price gauge + levels */}
      {hasEntry && (hasTarget || hasStop) && (
        <div className="p-3 border-b space-y-2">
          <PriceGauge
            entry={entry_price!}
            target={target_price}
            stop={stop_loss}
            direction={direction === "SHORT" ? "SHORT" : "LONG"}
          />
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
            <span>
              Entry{" "}
              <span className="tabular-nums font-medium text-foreground/70">${entry_price!.toFixed(2)}</span>
            </span>
            {hasTarget && (
              <span>
                Target{" "}
                <span className="tabular-nums font-medium text-positive">${target_price!.toFixed(2)}</span>
              </span>
            )}
            {hasStop && (
              <span>
                Stop{" "}
                <span className="tabular-nums font-medium text-negative">${stop_loss!.toFixed(2)}</span>
              </span>
            )}
            {rr != null && (
              <span>
                R:R{" "}
                <span
                  className={cn(
                    "tabular-nums font-medium",
                    parseFloat(rr) >= 2
                      ? "text-positive"
                      : parseFloat(rr) >= 1
                        ? "text-foreground/70"
                        : "text-negative",
                  )}
                >
                  {rr}&times;
                </span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Reasoning */}
      {reasoning_summary && (
        <div className="p-3 border-b">
          <p className="text-sm leading-relaxed">{reasoning_summary}</p>
        </div>
      )}

      {/* Bull case */}
      {thesis_bullets.length > 0 && (
        <div className="p-3 border-b space-y-2">
          <p className="text-sm font-medium">Bull Case</p>
          {thesis_bullets.map((b, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-positive" />
              <span className="leading-relaxed">{b}</span>
            </div>
          ))}
        </div>
      )}

      {/* Risks */}
      {risk_flags.length > 0 && (
        <div className="p-3 border-b space-y-2">
          <p className="text-sm font-medium">Risks</p>
          {risk_flags.map((r, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
              <span className="leading-relaxed">{r}</span>
            </div>
          ))}
        </div>
      )}

      {/* Signal types */}
      {signal_types.length > 0 && (
        <div className="p-3 border-b">
          <div className="flex flex-wrap gap-1.5">
            {signal_types.map((s) => (
              <Badge key={s} variant="outline">
                {s.replace(/_/g, " ")}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </>
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
  const { market_cap, pe_ratio, beta, avg_volume, high_52w, low_52w, sector, analyst_consensus } = fundamentals;
  const total = analyst_consensus
    ? analyst_consensus.buy + analyst_consensus.hold + analyst_consensus.sell
    : 0;
  const buyPct = total > 0 ? Math.round((analyst_consensus!.buy / total) * 100) : 0;

  return (
    <>
      {sector && (
        <div className="flex items-center gap-2">
          <Badge variant="outline">{sector}</Badge>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        {market_cap != null && (
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Market Cap</span>
            <p className="text-sm tabular-nums font-medium">{fmtCompact(market_cap)}</p>
          </div>
        )}
        {pe_ratio != null && (
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">P/E Ratio</span>
            <p className="text-sm tabular-nums font-medium">{pe_ratio.toFixed(1)}x</p>
          </div>
        )}
        {beta != null && (
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Beta</span>
            <p className="text-sm tabular-nums font-medium">{beta.toFixed(2)}</p>
          </div>
        )}
        {avg_volume != null && (
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Avg Volume (10d)</span>
            <p className="text-sm tabular-nums font-medium">{fmtVol(avg_volume)}</p>
          </div>
        )}
        {high_52w != null && (
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">52W High</span>
            <p className="text-sm tabular-nums font-medium">${high_52w.toFixed(2)}</p>
          </div>
        )}
        {low_52w != null && (
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">52W Low</span>
            <p className="text-sm tabular-nums font-medium">${low_52w.toFixed(2)}</p>
          </div>
        )}
      </div>

      {analyst_consensus && total > 0 && (
        <div className="space-y-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Analyst Consensus
          </span>
          <div className="flex h-2 w-full overflow-hidden rounded-full">
            <div className="bg-positive" style={{ width: `${(analyst_consensus.buy / total) * 100}%` }} />
            <div className="bg-muted-foreground/30" style={{ width: `${(analyst_consensus.hold / total) * 100}%` }} />
            <div className="bg-negative" style={{ width: `${(analyst_consensus.sell / total) * 100}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{analyst_consensus.buy} Buy</span>
            <span>{analyst_consensus.hold} Hold</span>
            <span>{analyst_consensus.sell} Sell</span>
            <span className={cn("font-medium", buyPct >= 60 ? "text-positive" : buyPct >= 40 ? "text-amber-500" : "text-negative")}>
              {buyPct}% Buy
            </span>
          </div>
        </div>
      )}
    </>
  );
}
