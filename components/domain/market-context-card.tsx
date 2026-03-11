"use client";

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Briefcase,
  TrendingUp,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MarketContextData = {
  regime: "trending_up" | "trending_down" | "range_bound" | "volatile";
  keyLevels?: string;
  sectorRotation?: string;
  portfolioStatus?: {
    openPositions: number;
    capitalDeployed: number;
    capitalAvailable: number;
  };
  todaysApproach: string;
  spxChange?: number;
  vixLevel?: number;
  topSectors?: { name: string; change: number }[];
  bottomSectors?: { name: string; change: number }[];
};

export type MarketContextCardProps = ComponentProps<typeof Card> &
  MarketContextData;

// ─── Regime config ────────────────────────────────────────────────────────────

const REGIME_CONFIG: Record<
  MarketContextData["regime"],
  { label: string; color: string; icon: typeof TrendingUp }
> = {
  trending_up: { label: "Trending Up", color: "text-emerald-500", icon: TrendingUp },
  trending_down: { label: "Trending Down", color: "text-red-500", icon: ArrowDown },
  range_bound: { label: "Range-Bound", color: "text-amber-500", icon: Activity },
  volatile: { label: "Volatile", color: "text-red-400", icon: Activity },
};

// ─── MarketContextCard ────────────────────────────────────────────────────────

export function MarketContextCard({
  regime,
  keyLevels,
  sectorRotation,
  portfolioStatus,
  todaysApproach,
  spxChange,
  vixLevel,
  topSectors = [],
  bottomSectors = [],
  className,
  ...cardProps
}: MarketContextCardProps) {
  const regimeCfg = REGIME_CONFIG[regime];
  const RegimeIcon = regimeCfg.icon;

  return (
    <Card className={cn("overflow-hidden p-0", className)} {...cardProps}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b bg-muted/20">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Market Context</span>
        </div>
        <div className="flex items-center gap-2">
          <RegimeIcon className={cn("h-3.5 w-3.5", regimeCfg.color)} />
          <span className={cn("text-xs font-medium", regimeCfg.color)}>
            {regimeCfg.label}
          </span>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Market stats row */}
        {(spxChange != null || vixLevel != null) && (
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-center">
            {spxChange != null && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                  S&P 500
                </p>
                <p
                  className={cn(
                    "text-sm tabular-nums font-semibold",
                    spxChange >= 0 ? "text-emerald-500" : "text-red-500"
                  )}
                >
                  {spxChange >= 0 ? "+" : ""}
                  {spxChange.toFixed(2)}%
                </p>
              </div>
            )}
            {vixLevel != null && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                  VIX
                </p>
                <p
                  className={cn(
                    "text-sm tabular-nums font-semibold",
                    vixLevel > 25
                      ? "text-red-500"
                      : vixLevel > 18
                        ? "text-amber-500"
                        : "text-muted-foreground"
                  )}
                >
                  {vixLevel.toFixed(1)}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Sector heatmap */}
        {(topSectors.length > 0 || bottomSectors.length > 0) && (
          <div className="space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Sector Rotation
            </span>
            <div className="flex flex-wrap gap-1.5">
              {topSectors.map((s) => (
                <Badge key={s.name} variant="secondary" className="text-[10px] gap-1">
                  <ArrowUp className="h-2.5 w-2.5 text-emerald-500" />
                  {s.name}
                  <span className="tabular-nums text-emerald-500">
                    +{s.change.toFixed(1)}%
                  </span>
                </Badge>
              ))}
              {bottomSectors.map((s) => (
                <Badge key={s.name} variant="secondary" className="text-[10px] gap-1">
                  <ArrowDown className="h-2.5 w-2.5 text-red-500" />
                  {s.name}
                  <span className="tabular-nums text-red-500">
                    {s.change.toFixed(1)}%
                  </span>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Portfolio status */}
        {portfolioStatus && (
          <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted/40 p-3 text-center">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                Positions
              </p>
              <p className="text-sm tabular-nums font-semibold">
                {portfolioStatus.openPositions}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                Deployed
              </p>
              <p className="text-sm tabular-nums font-semibold">
                ${portfolioStatus.capitalDeployed.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                Available
              </p>
              <p className="text-sm tabular-nums font-semibold">
                ${portfolioStatus.capitalAvailable.toLocaleString()}
              </p>
            </div>
          </div>
        )}

        {/* Key levels */}
        {keyLevels && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {keyLevels}
          </p>
        )}

        {/* Today's approach */}
        <div className="rounded-md border-l-2 border-primary/30 pl-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
            Today&apos;s Approach
          </p>
          <p className="text-sm text-foreground/80 leading-relaxed">
            {todaysApproach}
          </p>
        </div>
      </div>
    </Card>
  );
}
