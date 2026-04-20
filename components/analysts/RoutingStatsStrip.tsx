"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ROUTE_REASON_LABELS,
  ROUTE_REASON_TOOLTIPS,
  type RouteReasonCode,
} from "@/components/intelligence/types";

interface RoutingStats {
  total: number;
  legacy: number;
  byReason: Partial<Record<RouteReasonCode, number>>;
  since: string | null;
}

// Display order — DISCOVERY first (most editorially meaningful), then the
// specific-dimension matches, then ticker routes, then cross-analyst.
const DISPLAY_ORDER: RouteReasonCode[] = [
  "DISCOVERY",
  "SECTOR_MATCH",
  "INDUSTRY_MATCH",
  "THEME_MATCH",
  "WATCHLIST",
  "POSITION",
  "DIRECT_TICKER",
  "CROSS_ANALYST",
];

interface RoutingStatsStripProps {
  analystId: string;
  days?: number;
  /** Active reason filter — when set, the matching chip renders filled. */
  activeReason?: RouteReasonCode | null;
  /** Click a chip to filter the Findings list below. Null = clear. */
  onReasonClick?: (code: RouteReasonCode | null) => void;
}

export function RoutingStatsStrip({
  analystId,
  days = 30,
  activeReason = null,
  onReasonClick,
}: RoutingStatsStripProps) {
  const [stats, setStats] = useState<RoutingStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/analysts/${analystId}/routing-stats?days=${days}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [analystId, days]);

  if (loading) {
    return (
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-20" />
      </div>
    );
  }

  if (!stats || stats.total === 0) {
    return (
      <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
        0 routes in the last {days} days — this analyst&apos;s fence doesn&apos;t
        match any recent signals. Check sectors / industries / themes in the
        Config tab.
      </div>
    );
  }

  const shown = DISPLAY_ORDER.filter((code) => (stats.byReason[code] ?? 0) > 0);

  return (
    <TooltipProvider>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Routes · {days}d
          </span>
          <Tooltip>
            <TooltipTrigger render={<span className="cursor-help" />}>
              <Info className="h-3 w-3 text-muted-foreground/70" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              How many recent signals the router sent to this analyst, broken
              down by why they matched. Click a chip to filter the list below.
            </TooltipContent>
          </Tooltip>
        </div>
        <span className="text-sm tabular-nums font-medium">{stats.total}</span>

        {shown.map((code) => {
          const count = stats.byReason[code] ?? 0;
          const isActive = activeReason === code;
          return (
            <Tooltip key={code}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => onReasonClick?.(isActive ? null : code)}
                    className={cn(
                      "transition-colors",
                      !onReasonClick && "cursor-default",
                    )}
                  >
                    <Badge
                      variant={isActive ? "default" : "secondary"}
                      className="gap-1.5"
                    >
                      <span>{ROUTE_REASON_LABELS[code]}</span>
                      <span className="tabular-nums">{count}</span>
                    </Badge>
                  </button>
                }
              />
              <TooltipContent className="max-w-xs text-xs">
                {ROUTE_REASON_TOOLTIPS[code]}
              </TooltipContent>
            </Tooltip>
          );
        })}

        {stats.legacy > 0 && (
          <Tooltip>
            <TooltipTrigger render={<span className="cursor-help" />}>
              <Badge variant="secondary" className="gap-1.5 opacity-60">
                <span>Legacy</span>
                <span className="tabular-nums">{stats.legacy}</span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              Routes from before the router tagged reason codes. Left in place
              for historical context only.
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
