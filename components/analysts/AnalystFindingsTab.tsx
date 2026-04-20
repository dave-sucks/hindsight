"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PnlArrow } from "@/components/ui/pnl-arrow";
import { EducationEmptyState } from "@/components/domain/education-card";
import {
  Favicon,
} from "@/components/intelligence/signal-feed";
import { FindingDetailDialog } from "@/components/intelligence/finding-detail";
import { RoutingStatsStrip } from "@/components/analysts/RoutingStatsStrip";
import type { RouteReasonCode, Signal } from "@/components/intelligence/types";
import {
  ROUTE_REASON_LABELS,
  relativeTime,
} from "@/components/intelligence/types";

// ── AnalystFindingsTab ──────────────────────────────────────────────────────

interface AnalystFindingsTabProps {
  analystId: string;
}

export function AnalystFindingsTab({ analystId }: AnalystFindingsTabProps) {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Signal | null>(null);
  const [reasonFilter, setReasonFilter] = useState<RouteReasonCode | null>(null);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ analystId, limit: "50" });
    if (reasonFilter) qs.set("routeReasonCode", reasonFilter);
    fetch(`/api/intelligence/signals?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setSignals)
      .finally(() => setLoading(false));
  }, [analystId, reasonFilter]);

  const handleSelect = useCallback((signal: Signal) => {
    setSelected(signal);
  }, []);

  return (
    <>
      <div className="space-y-4">
        <RoutingStatsStrip
          analystId={analystId}
          days={30}
          activeReason={reasonFilter}
          onReasonClick={setReasonFilter}
        />

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        ) : signals.length === 0 ? (
          reasonFilter ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No {ROUTE_REASON_LABELS[reasonFilter]} routes in the last 30 days.
            </p>
          ) : (
            <EducationEmptyState stateKey="analyst-findings" />
          )
        ) : (
          <div className="space-y-2">
            {signals.map((signal) => {
              const sentimentDir =
                signal.sentiment === "BULLISH" ? "up" as const
                : signal.sentiment === "BEARISH" ? "down" as const
                : null;
              const primaryDomain = extractDomain(signal.sourceUrls);
              // Surface the route reason for THIS analyst only — the route
              // row scoped to analystId is the one the strip is counting.
              const myRoute = signal.routes.find((r) => r.analystId === analystId);
              const reasonCode = myRoute?.routeReasonCode ?? null;

              return (
                <Card
                  key={signal.id}
                  className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => handleSelect(signal)}
                >
                  <div className="space-y-2">
                    <div className="flex items-start gap-3">
                      <p className="text-sm font-medium leading-tight flex-1 min-w-0">
                        {signal.headline}
                      </p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {signal.tickers.length > 0 && (
                          <span className="text-xs font-mono font-medium text-muted-foreground">
                            {signal.tickers.length === 1
                              ? signal.tickers[0]
                              : signal.tickers.slice(0, 2).join(", ")}
                            {signal.tickers.length > 2 && ` +${signal.tickers.length - 2}`}
                          </span>
                        )}
                        {sentimentDir && (
                          <PnlArrow direction={sentimentDir} className="h-4 w-4" />
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {signal.summary}
                    </p>
                    <div className="flex items-center gap-1.5">
                      {primaryDomain && <Favicon domain={primaryDomain} />}
                      {signal.sourceNames[0] && (
                        <span className="text-xs text-muted-foreground">{signal.sourceNames[0]}</span>
                      )}
                      {reasonCode && (
                        <Badge variant="secondary" className="ml-1">
                          {ROUTE_REASON_LABELS[reasonCode]}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground tabular-nums ml-auto shrink-0">
                        {relativeTime(signal.createdAt)}
                      </span>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Shared detail dialog — same universe tags + routing rows as the
          Intelligence Findings tab, so per-analyst provenance matches. */}
      <FindingDetailDialog
        signal={selected}
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </>
  );
}

function extractDomain(urls: string[]): string | null {
  for (const url of urls) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { /* skip */ }
  }
  return null;
}
