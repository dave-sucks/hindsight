"use client";

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Calendar, TrendingUp, Users, Target } from "lucide-react";
import type { Catalyst, CatalystType } from "@/lib/discovery/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CatalystTimelineData = {
  catalysts: Catalyst[];
  summary: {
    total: number;
    by_type: Record<CatalystType, number>;
    next_high_impact: string | null;
  };
};

export type CatalystTimelineCardProps = ComponentProps<typeof Card> &
  CatalystTimelineData;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<CatalystType, typeof Calendar> = {
  EARNINGS: Calendar,
  ECONOMIC: TrendingUp,
  INSIDER: Users,
  ANALYST_ACTION: Target,
};

const TYPE_LABELS: Record<CatalystType, string> = {
  EARNINGS: "Earnings",
  ECONOMIC: "Macro",
  INSIDER: "Insider",
  ANALYST_ACTION: "Analyst",
};

const IMPACT_STYLES: Record<string, string> = {
  HIGH: "bg-negative/10 text-negative",
  MEDIUM: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  LOW: "",
};

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getTimeGroup(dateStr: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(dateStr + "T00:00:00");

  const diffMs = date.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / 86400_000);

  if (diffDays < 0) return "Recent";
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays <= 7) return "This Week";
  if (diffDays <= 14) return "Next Week";
  return "Later";
}

// ─── CatalystTimelineCard ─────────────────────────────────────────────────────

export function CatalystTimelineCard({
  catalysts,
  summary,
  className,
  ...cardProps
}: CatalystTimelineCardProps) {
  // Group catalysts by time period
  const groups = new Map<string, Catalyst[]>();
  const groupOrder = ["Recent", "Today", "Tomorrow", "This Week", "Next Week", "Later"];

  for (const c of catalysts) {
    const group = getTimeGroup(c.date);
    const existing = groups.get(group);
    if (existing) existing.push(c);
    else groups.set(group, [c]);
  }

  return (
    <Card className={cn("overflow-hidden p-0", className)} {...cardProps}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40">
        <span className="text-xs font-medium text-muted-foreground">
          Catalysts
        </span>
        <Badge variant="secondary">
          <span className="tabular-nums">{summary.total}</span>
        </Badge>
        {summary.next_high_impact && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            Next high-impact:{" "}
            <span className="font-medium tabular-nums">
              {formatDate(summary.next_high_impact)}
            </span>
          </span>
        )}
      </div>

      {/* Body */}
      <div className="divide-y divide-border/40">
        {catalysts.length === 0 && (
          <p className="px-4 py-3 text-xs text-muted-foreground">
            No catalysts found in the scan window.
          </p>
        )}

        {groupOrder.map((groupName) => {
          const items = groups.get(groupName);
          if (!items?.length) return null;

          return (
            <div key={groupName}>
              {/* Group header */}
              <div className="px-4 py-1.5 bg-muted/30">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {groupName}
                </span>
              </div>

              {/* Catalyst rows */}
              {items.slice(0, 8).map((c, i) => {
                const Icon = TYPE_ICONS[c.catalyst_type];
                return (
                  <div
                    key={`${c.ticker ?? "macro"}-${c.catalyst_type}-${i}`}
                    className="flex items-center gap-2 px-4 py-1.5 text-xs"
                  >
                    {/* Date */}
                    <span className="w-12 shrink-0 tabular-nums text-muted-foreground">
                      {formatDate(c.date)}
                    </span>

                    {/* Type icon + badge */}
                    <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <Badge variant="outline" className="text-[10px] py-0 px-1.5 shrink-0">
                      {TYPE_LABELS[c.catalyst_type]}
                    </Badge>

                    {/* Ticker */}
                    {c.ticker && (
                      <Badge variant="secondary" className="text-[10px] py-0 font-mono shrink-0">
                        {c.ticker}
                      </Badge>
                    )}

                    {/* Impact */}
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-[10px] py-0 shrink-0",
                        IMPACT_STYLES[c.expected_impact],
                      )}
                    >
                      {c.expected_impact}
                    </Badge>

                    {/* Details — truncated */}
                    <span className="truncate text-muted-foreground">
                      {c.details}
                    </span>
                  </div>
                );
              })}
              {items.length > 8 && (
                <div className="px-4 py-1 text-[10px] text-muted-foreground">
                  +{items.length - 8} more
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
