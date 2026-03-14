"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PnlBadge } from "@/components/ui/pnl-badge";
import {
  ExternalLink,
  Newspaper,
  BarChart2,
  Brain,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ThesisCardTrade = {
  id: string;
  realizedPnl: number | null;
  status: string;
  entryPrice: number;
  closePrice: number | null;
};

export type ThesisCardData = {
  id: string;
  ticker: string;
  direction: string;
  confidenceScore: number;
  holdDuration: string;
  signalTypes: string[];
  sector?: string | null;
  reasoningSummary: string;
  thesisBullets?: string[];
  riskFlags?: string[];
  sourcesUsed?: unknown;
  modelUsed?: string | null;
  // Prices
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  trade: ThesisCardTrade | null;
  // Optional enrichment (degrades gracefully if omitted)
  analystName?: string | null;
  createdAt?: string | null;
  currentPrice?: number | null;
  priceChange?: { amount: number; percent: number } | null;
  sharesHeld?: number | null;
};

export type ThesisCardProfile = {
  name: string;
  logo: string;
  exchange: string;
};

type SourceItem = {
  type: string;
  provider: string;
  title: string;
  url?: string | null;
  published_at?: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function parseSources(raw: unknown): SourceItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is SourceItem =>
      s !== null && typeof s === "object" && "title" in s && "type" in s
  );
}

function sourceIcon(type: string) {
  switch (type.toLowerCase()) {
    case "news":
      return <Newspaper className="h-3 w-3" />;
    case "earnings":
    case "financials":
      return <BarChart2 className="h-3 w-3" />;
    default:
      return <Brain className="h-3 w-3" />;
  }
}

function providerInitials(provider: string): string {
  return provider
    .split(/[\s._\-/]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);
}

function formatEntryTime(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "";
  }
}

function formatTarget(targetPrice: number | null, stopLoss: number | null, holdDuration: string): string {
  if (targetPrice != null && stopLoss != null) {
    return `Target $${targetPrice.toFixed(2)} with stop limit $${stopLoss.toFixed(2)}`;
  }
  if (targetPrice != null) return `Target $${targetPrice.toFixed(2)}`;
  if (stopLoss != null) return `Stop limit $${stopLoss.toFixed(2)}`;
  if (holdDuration) return `Hold ${holdDuration}`;
  return "";
}

// ─── ThesisCard ───────────────────────────────────────────────────────────────

export function ThesisCard({
  thesis,
  profile,
}: {
  thesis: ThesisCardData;
  profile?: ThesisCardProfile;
}) {
  const [imgError, setImgError] = useState(false);

  const isLong = thesis.direction === "LONG";
  const isPass = thesis.direction === "PASS";
  const trade = thesis.trade;

  // ── Status badge (outline only, colored dot inside) ──
  const tradeStatus = trade?.status;
  const statusLabel =
    tradeStatus === "OPEN" ? "Open"
    : tradeStatus === "WIN" ? "Won"
    : tradeStatus === "LOSS" ? "Lost"
    : tradeStatus === "CLOSED" ? "Closed"
    : tradeStatus === "EVALUATED" ? "Evaluated"
    : isPass ? "Pass"
    : "Pending";

  const dotClass =
    tradeStatus === "OPEN"
      ? "bg-blue-400 animate-pulse"
      : tradeStatus === "WIN"
        ? "bg-positive"
        : tradeStatus === "LOSS"
          ? "bg-negative"
          : tradeStatus === "CLOSED" || tradeStatus === "EVALUATED"
            ? "bg-muted-foreground"
            : "bg-muted-foreground/40";

  // ── Profile ──
  const companyName =
    profile?.name && profile.name !== thesis.ticker ? profile.name : thesis.ticker;
  const exchange = profile?.exchange ?? null;
  const logoUrl = profile?.logo && !imgError ? profile.logo : null;

  // ── Price delta from entry ──
  const displayPrice = thesis.currentPrice ?? thesis.entryPrice;

  // Use provided priceChange or compute from entry vs current
  let deltaAmount: number | null = null;
  let deltaPct: number | null = null;
  if (thesis.priceChange) {
    deltaAmount = thesis.priceChange.amount;
    deltaPct = thesis.priceChange.percent;
  } else if (thesis.currentPrice != null && thesis.entryPrice != null && thesis.entryPrice > 0) {
    deltaAmount = thesis.currentPrice - thesis.entryPrice;
    deltaPct = (deltaAmount / thesis.entryPrice) * 100;
  } else if (trade?.closePrice != null && thesis.entryPrice != null && thesis.entryPrice > 0) {
    deltaAmount = trade.closePrice - thesis.entryPrice;
    deltaPct = (deltaAmount / thesis.entryPrice) * 100;
  }

  const deltaPositive = deltaAmount != null ? deltaAmount >= 0 : null;

  // ── Sources ──
  const sources = parseSources(thesis.sourcesUsed);

  // ── Reasoning capped at ~650 chars ──
  const reasoning =
    thesis.reasoningSummary.length > 650
      ? thesis.reasoningSummary.slice(0, 647) + "…"
      : thesis.reasoningSummary;

  const entryTime = formatEntryTime(thesis.createdAt);
  const targetLine = formatTarget(thesis.targetPrice, thesis.stopLoss, thesis.holdDuration);

  return (
    <>
      {/*
       * Outer wrapper: relative div. Full-card <Link> at z-0,
       * all interactive content at z-10.
       */}
      <div className="relative rounded-lg border bg-background hover:border-foreground/25 transition-colors">
        {/* Full-card link overlay */}
        <Link
          href={`/stocks/${thesis.ticker}`}
          className="absolute inset-0 z-0 rounded-lg"
          aria-label={`View ${thesis.ticker} thesis`}
        />

        <div className="relative z-10 pointer-events-none">

          {/* ── TOP: logo · name · status · price ── */}
          <div className="p-3 border-b">
            <div className="flex items-start justify-between gap-4">

              {/* Left: logo + company name + status badge + ticker subhead */}
              <div className="flex items-center gap-2.5 min-w-0">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={thesis.ticker}
                    onError={() => setImgError(true)}
                    className="h-9 w-9 rounded-md object-contain bg-muted shrink-0 border border-border"
                  />
                ) : (
                  <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0 border border-border">
                    {thesis.ticker.slice(0, 2)}
                  </div>
                )}

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-lg font-brand font-bold text-foreground truncate leading-tight">
                      {companyName}
                    </p>
                    {/* Status badge inline */}
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border border-border text-muted-foreground bg-transparent shrink-0">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotClass}`} />
                      {statusLabel}
                    </span>
                  </div>
                  {/* Ticker · Exchange · Confidence */}
                  <div className="font-mono text-[11px] text-muted-foreground leading-tight mt-0.5 flex items-center gap-1 flex-wrap">
                    <span>{thesis.ticker}</span>
                    {exchange && (
                      <>
                        <span className="opacity-30">·</span>
                        <span>{exchange}</span>
                      </>
                    )}
                    <span className="opacity-30">·</span>
                    <Tooltip>
                      <TooltipTrigger render={<span className="cursor-default pointer-events-auto" />}>
                        {thesis.confidenceScore}%
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs text-xs">
                        Confidence reflects signal quality, data consistency, and the AI&apos;s
                        directional conviction — higher means stronger evidence for this thesis.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>

              {/* Right: price + $delta + %badge — ALL ONE ROW, target below */}
              <div className="shrink-0 text-right">
                <div className="flex items-center gap-2">
                  <p className="text-lg font-medium tabular-nums text-foreground leading-none">
                    {displayPrice != null ? `$${displayPrice.toFixed(2)}` : "—"}
                  </p>
                  {deltaAmount != null && (
                    <span
                      className={`text-lg tabular-nums font-light ${
                        deltaPositive ? "text-positive" : "text-negative"
                      }`}
                    >
                      {deltaPositive ? "+" : "−"}${Math.abs(deltaAmount).toFixed(2)}
                    </span>
                  )}
                  {deltaPct != null && <PnlBadge value={deltaPct} />}
                </div>
                {targetLine && (
                  <p className="text-xs text-muted-foreground mt-1 text-right">
                    {targetLine}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ── SECOND: entry sentence + reasoning ── */}
          <div className="p-3 border-b space-y-1">
            {/* Entry sentence — bigger, foreground */}
            {(() => {
              const ep = trade?.entryPrice ?? thesis.entryPrice;
              if (ep == null) return null;
              const verb = isLong ? "Bought" : "Sold short";
              const sharesText = thesis.sharesHeld != null ? `${thesis.sharesHeld} shares` : "shares";
              return (
                <p className="text-sm text-foreground font-medium">
                  {verb} {sharesText} at <span className="tabular-nums">${ep.toFixed(2)}</span> entry{entryTime && <> at {entryTime}</>}
                </p>
              );
            })()}

            {/* Reasoning */}
            <p className="text-sm font-light text-muted-foreground leading-relaxed">
              {reasoning}
            </p>
          </div>

          {/* ── BOTTOM: sources left · analyst name right ── */}
          <div className="p-3 flex items-center gap-2 min-h-[40px]">

            {/* Sources provider logos → popover */}
            {sources.length > 0 && (
              <Popover>
                <PopoverTrigger
                  className="inline-flex h-6 items-center gap-1.5 text-[11px] px-1.5 -ml-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors pointer-events-auto bg-transparent border-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Negative-margin avatar stack */}
                  <span className="flex items-center -space-x-1.5">
                    {sources.slice(0, 4).map((src, i) => (
                      <span
                        key={i}
                        className="h-4 w-4 rounded-full bg-muted border border-background flex items-center justify-center text-[8px] font-bold text-muted-foreground shrink-0"
                        style={{ zIndex: sources.length - i }}
                        title={src.provider}
                      >
                        {providerInitials(src.provider)}
                      </span>
                    ))}
                  </span>
                  Sources
                </PopoverTrigger>
                <PopoverContent className="w-72 p-2" align="start">
                  <p className="text-[11px] font-medium text-muted-foreground px-1 pb-1.5 border-b mb-1.5">
                    {sources.length} source{sources.length !== 1 ? "s" : ""} used
                  </p>
                  <ul className="space-y-1.5">
                    {sources.map((src, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="mt-0.5 text-muted-foreground shrink-0">
                          {sourceIcon(src.type)}
                        </span>
                        <div className="flex-1 min-w-0">
                          {src.url ? (
                            <a
                              href={src.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] text-foreground hover:underline flex items-center gap-1 leading-snug"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span className="truncate">{src.title}</span>
                              <ExternalLink className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                            </a>
                          ) : (
                            <span className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                              {src.title}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide font-mono">
                            {src.provider}
                            {src.published_at
                              ? ` · ${new Date(src.published_at).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                })}`
                              : ""}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            )}

            {/* Right: analyst name only */}
            {thesis.analystName && (
              <span className="ml-auto text-xs text-muted-foreground">
                {thesis.analystName}
              </span>
            )}
          </div>
        </div>
      </div>

    </>
  );
}
