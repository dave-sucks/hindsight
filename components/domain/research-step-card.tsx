"use client";

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  Globe,
  Loader2,
  Newspaper,
  TrendingUp,
  XCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ResearchStepData = {
  ticker: string;
  provider: string;
  title: string;
  status: "loading" | "done" | "error";
  findings?: string;
  sentiment?: "bullish" | "bearish" | "neutral";
  url?: string;
};

export type ResearchStepCardProps = ComponentProps<typeof Card> &
  ResearchStepData;

// ─── Provider config ──────────────────────────────────────────────────────────

const PROVIDER_CONFIG: Record<
  string,
  { color: string; icon: typeof Globe }
> = {
  finnhub: { color: "text-blue-500", icon: TrendingUp },
  fmp: { color: "text-indigo-500", icon: TrendingUp },
  reddit: { color: "text-orange-500", icon: Newspaper },
  options: { color: "text-purple-500", icon: TrendingUp },
  earnings: { color: "text-amber-500", icon: Newspaper },
  technical: { color: "text-cyan-500", icon: TrendingUp },
  stocktwits: { color: "text-green-500", icon: Newspaper },
  default: { color: "text-muted-foreground", icon: Globe },
};

const SENTIMENT_CONFIG: Record<
  string,
  { label: string; color: string }
> = {
  bullish: { label: "Bullish", color: "text-emerald-500" },
  bearish: { label: "Bearish", color: "text-red-500" },
  neutral: { label: "Neutral", color: "text-muted-foreground" },
};

// ─── ResearchStepCard ─────────────────────────────────────────────────────────

export function ResearchStepCard({
  ticker,
  provider,
  title,
  status,
  findings,
  sentiment,
  url,
  className,
  ...cardProps
}: ResearchStepCardProps) {
  const providerCfg = PROVIDER_CONFIG[provider] ?? PROVIDER_CONFIG.default;
  const ProviderIcon = providerCfg.icon;

  const StatusIcon =
    status === "loading"
      ? Loader2
      : status === "done"
        ? CheckCircle2
        : XCircle;

  const statusColor =
    status === "loading"
      ? "text-muted-foreground"
      : status === "done"
        ? "text-emerald-500"
        : "text-red-500";

  return (
    <Card
      className={cn("overflow-hidden p-0", className)}
      {...cardProps}
    >
      <div className="px-3 py-2 flex items-center gap-2">
        <StatusIcon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            statusColor,
            status === "loading" && "animate-spin"
          )}
        />
        <ProviderIcon
          className={cn("h-3 w-3 shrink-0", providerCfg.color)}
        />
        <span className="text-xs font-mono font-medium text-muted-foreground">
          {ticker}
        </span>
        <span className="text-xs truncate">{title}</span>

        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          {sentiment && (
            <span
              className={cn(
                "text-[10px] font-medium",
                SENTIMENT_CONFIG[sentiment]?.color
              )}
            >
              {SENTIMENT_CONFIG[sentiment]?.label}
            </span>
          )}
          <Badge variant="outline" className="text-[10px]">
            {provider}
          </Badge>
        </div>
      </div>

      {findings && status === "done" && (
        <div className="px-3 pb-2 pt-0">
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
            {findings}
          </p>
        </div>
      )}
    </Card>
  );
}
