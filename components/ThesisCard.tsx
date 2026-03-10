"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TradeReviewSheet } from "@/components/TradeReviewSheet";
import {
  CheckCircle,
  XCircle,
  ExternalLink,
  Newspaper,
  BarChart2,
  Brain,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
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
  // Full variant only
  thesisBullets?: string[];
  riskFlags?: string[];
  sourcesUsed?: unknown;
  modelUsed?: string | null;
  // Prices
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  trade: ThesisCardTrade | null;
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
      return <Newspaper className="h-3 w-3 shrink-0 text-muted-foreground" />;
    case "earnings":
    case "financials":
      return <BarChart2 className="h-3 w-3 shrink-0 text-muted-foreground" />;
    default:
      return <Brain className="h-3 w-3 shrink-0 text-muted-foreground" />;
  }
}

// ─── ThesisCard ───────────────────────────────────────────────────────────────

export function ThesisCard({
  thesis,
  profile,
  variant = "compact",
}: {
  thesis: ThesisCardData;
  profile?: ThesisCardProfile;
  variant?: "compact" | "full";
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);

  const isLong = thesis.direction === "LONG";
  const isShort = thesis.direction === "SHORT";
  const isPass = thesis.direction === "PASS";

  const dirClass = isLong
    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : isShort
      ? "bg-red-500/10 text-red-600 dark:text-red-400"
      : "bg-muted text-muted-foreground";

  const trade = thesis.trade;
  const pnl = trade?.realizedPnl ?? null;
  const pnlColor =
    pnl != null ? (pnl >= 0 ? "text-emerald-500" : "text-red-500") : "";
  const alreadyTraded = trade !== null;

  const tradeStatusClass =
    trade?.status === "OPEN"
      ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
      : trade?.status === "CLOSED" || trade?.status === "WIN"
        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        : trade?.status === "LOSS"
          ? "bg-red-500/10 text-red-600 dark:text-red-400"
          : "";

  const confidenceClass =
    thesis.confidenceScore >= 70
      ? "text-emerald-500"
      : thesis.confidenceScore >= 50
        ? "text-amber-500"
        : "text-red-500";

  const companyName =
    profile?.name && profile.name !== thesis.ticker ? profile.name : null;
  const exchange = profile?.exchange ?? null;
  const logoUrl = profile?.logo && !imgError ? profile.logo : null;
  const subtitle = [companyName, exchange].filter(Boolean).join(" · ");

  const sources = variant === "full" ? parseSources(thesis.sourcesUsed) : [];

  return (
    <>
      <div className="rounded-lg border bg-background flex flex-col hover:border-foreground/25 transition-colors">
        {/* Body */}
        <div className="p-3 flex-1 space-y-2">
          {/* Header row */}
          <div className="flex items-start gap-2.5">
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
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Link
                  href={`/research/${thesis.id}`}
                  className="font-semibold text-sm text-foreground hover:underline leading-tight"
                >
                  {thesis.ticker}
                </Link>
                <span className="ml-auto flex items-center gap-1.5 shrink-0">
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-full leading-none ${dirClass}`}
                  >
                    {thesis.direction}
                  </span>
                  {trade && (
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full leading-none ${tradeStatusClass}`}
                    >
                      {trade.status}
                    </span>
                  )}
                </span>
              </div>
              {subtitle && (
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight truncate">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          {/* Reasoning summary — clamped in compact, full in detail */}
          <p
            className={`text-xs text-muted-foreground leading-relaxed ${
              variant === "compact" ? "line-clamp-2" : ""
            }`}
          >
            {thesis.reasoningSummary}
          </p>

          {/* Full variant: bullets, risks, signal tags, sources, model */}
          {variant === "full" && (
            <>
              {(thesis.thesisBullets ?? []).length > 0 && (
                <ul className="space-y-1">
                  {(thesis.thesisBullets ?? []).map((bullet, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <CheckCircle className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" />
                      <span className="text-xs text-muted-foreground">
                        {bullet}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {(thesis.riskFlags ?? []).length > 0 && (
                <ul className="space-y-1">
                  {(thesis.riskFlags ?? []).map((flag, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <XCircle className="h-3 w-3 text-red-500 mt-0.5 shrink-0" />
                      <span className="text-xs text-muted-foreground">
                        {flag}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {thesis.signalTypes.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {thesis.signalTypes.map((s) => (
                    <Badge
                      key={s}
                      variant="outline"
                      className="text-[10px] px-1.5 py-0"
                    >
                      {s.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </div>
              )}

              {sources.length > 0 && (
                <div>
                  <Separator className="mb-2" />
                  <button
                    onClick={() => setSourcesExpanded((v) => !v)}
                    className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full"
                  >
                    <Newspaper className="h-3 w-3" />
                    <span>
                      {sources.length} source
                      {sources.length !== 1 ? "s" : ""} read
                    </span>
                    <span className="ml-auto">
                      {sourcesExpanded ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </span>
                  </button>
                  {sourcesExpanded && (
                    <ul className="mt-2 space-y-1.5">
                      {sources.map((src, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          {sourceIcon(src.type)}
                          <div className="flex-1 min-w-0">
                            {src.url ? (
                              <a
                                href={src.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] text-foreground hover:underline flex items-center gap-1 leading-snug"
                              >
                                <span className="truncate">{src.title}</span>
                                <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                              </a>
                            ) : (
                              <span className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                                {src.title}
                              </span>
                            )}
                            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">
                              {src.provider}
                              {src.published_at
                                ? ` · ${new Date(src.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                                : ""}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {thesis.modelUsed && (
                <p className="text-[10px] text-muted-foreground/50 font-mono">
                  {thesis.modelUsed}
                </p>
              )}
            </>
          )}
        </div>

        {/* Price stats bar */}
        <div className="border-t px-3 py-2 grid grid-cols-4 gap-2 bg-muted/20">
          {(
            [
              { label: "Entry", value: thesis.entryPrice, color: "text-foreground" },
              { label: "Target", value: thesis.targetPrice, color: "text-emerald-500" },
              { label: "Stop", value: thesis.stopLoss, color: "text-red-500" },
            ] as const
          ).map(({ label, value, color }) => (
            <div key={label}>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide leading-none">
                {label}
              </p>
              <p className={`text-xs font-semibold tabular-nums mt-0.5 ${color}`}>
                {value != null ? `$${value.toFixed(2)}` : "—"}
              </p>
            </div>
          ))}
          <div>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide leading-none">
              Conf.
            </p>
            <p className={`text-xs font-semibold tabular-nums mt-0.5 ${confidenceClass}`}>
              {thesis.confidenceScore}%
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-3 py-2 flex items-center justify-between">
          <div>
            {pnl != null ? (
              <span className={`text-xs font-semibold tabular-nums ${pnlColor}`}>
                {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} P&L
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                {thesis.holdDuration}
              </span>
            )}
          </div>
          {!alreadyTraded && !isPass ? (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[11px] gap-1 px-2"
              onClick={() => setSheetOpen(true)}
            >
              {isLong ? (
                <TrendingUp className="h-3 w-3 text-emerald-500" />
              ) : (
                <TrendingDown className="h-3 w-3 text-red-500" />
              )}
              Trade
            </Button>
          ) : alreadyTraded && trade ? (
            <Button
              render={<Link href={`/trades/${trade.id}`} />}
              size="sm"
              variant="ghost"
              className="h-6 text-[11px] px-2"
            >
              View →
            </Button>
          ) : null}
        </div>
      </div>

      <TradeReviewSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        thesis={{
          id: thesis.id,
          ticker: thesis.ticker,
          direction: thesis.direction,
          entryPrice: thesis.entryPrice,
          targetPrice: thesis.targetPrice,
          stopLoss: thesis.stopLoss,
          confidenceScore: thesis.confidenceScore,
          holdDuration: thesis.holdDuration,
        }}
      />
    </>
  );
}
