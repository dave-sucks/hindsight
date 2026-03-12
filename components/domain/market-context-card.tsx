"use client";

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  Activity,
  ArrowDown,
  ArrowUp,
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

// ─── MarketContextCard — compact ─────────────────────────────────────────────

export function MarketContextCard({
  regime,
  keyLevels,
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
  const hasData = spxChange != null || vixLevel != null;

  return (
    <Card className={cn("overflow-hidden p-0", className)} {...cardProps}>
      {/* Header row */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40">
        <span className="text-xs font-medium text-muted-foreground">Market</span>
        <Badge
          variant="secondary"
          className={cn("text-[10px] gap-1 py-0", regimeCfg.color)}
        >
          <RegimeIcon className="h-2.5 w-2.5" />
          {regimeCfg.label}
        </Badge>

        {/* Inline SPX + VIX */}
        {hasData && (
          <div className="ml-auto flex items-center gap-3 text-xs">
            {spxChange != null && (
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground">SPX</span>
                <span
                  className={cn(
                    "tabular-nums font-semibold",
                    spxChange >= 0 ? "text-emerald-500" : "text-red-500",
                  )}
                >
                  {spxChange >= 0 ? "+" : ""}{spxChange.toFixed(2)}%
                </span>
              </span>
            )}
            {vixLevel != null && (
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground">VIX</span>
                <span
                  className={cn(
                    "tabular-nums font-semibold",
                    vixLevel > 25 ? "text-red-500" : vixLevel > 18 ? "text-amber-500" : "text-muted-foreground",
                  )}
                >
                  {vixLevel.toFixed(1)}
                </span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Sector chips + portfolio (compact) */}
      <div className="px-4 py-2.5 space-y-2">
        {/* Sector heatmap chips */}
        {(topSectors.length > 0 || bottomSectors.length > 0) && (
          <div className="flex flex-wrap gap-1">
            {topSectors.map((s) => (
              <span
                key={s.name}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium"
              >
                <ArrowUp className="h-2 w-2 text-emerald-500" />
                <span className="text-muted-foreground">{s.name}</span>
                <span className="tabular-nums text-emerald-500">+{s.change.toFixed(1)}%</span>
              </span>
            ))}
            {bottomSectors.map((s) => (
              <span
                key={s.name}
                className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium"
              >
                <ArrowDown className="h-2 w-2 text-red-500" />
                <span className="text-muted-foreground">{s.name}</span>
                <span className="tabular-nums text-red-500">{s.change.toFixed(1)}%</span>
              </span>
            ))}
          </div>
        )}

        {/* Portfolio status — inline */}
        {portfolioStatus && (
          <div className="flex items-center gap-4 text-xs">
            <span>
              <span className="text-muted-foreground">Positions</span>{" "}
              <span className="tabular-nums font-medium">{portfolioStatus.openPositions}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Deployed</span>{" "}
              <span className="tabular-nums font-medium">${portfolioStatus.capitalDeployed.toLocaleString()}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Available</span>{" "}
              <span className="tabular-nums font-medium">${portfolioStatus.capitalAvailable.toLocaleString()}</span>
            </span>
          </div>
        )}

        {/* Today's approach — only show if non-empty */}
        {todaysApproach && todaysApproach.trim() && (
          <p className="text-xs text-muted-foreground leading-relaxed border-l-2 border-primary/20 pl-2.5">
            {todaysApproach}
          </p>
        )}

        {/* Key levels */}
        {keyLevels && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {keyLevels}
          </p>
        )}
      </div>
    </Card>
  );
}
