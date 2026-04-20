"use client";

import { useState, useEffect, useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { EducationEmptyState } from "@/components/domain/education-card";
import { SignalRow } from "@/components/intelligence/signal-feed";
import { FindingDetailDialog } from "@/components/intelligence/finding-detail";
import {
  RoutingStatsStrip,
  ROUTE_GROUP_CODES,
  type RouteGroup,
} from "@/components/analysts/RoutingStatsStrip";
import type { Signal } from "@/components/intelligence/types";

interface AnalystFindingsTabProps {
  analystId: string;
}

// ── AnalystFindingsTab ──────────────────────────────────────────────────────
// Same signal card as /intelligence — SignalRow shared from signal-feed. The
// analyst-specific bits (routing stats + reason-group filter) live in the
// strip above the list; per-card decoration stays off so both pages look
// identical when viewed side-by-side.

export function AnalystFindingsTab({ analystId }: AnalystFindingsTabProps) {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Signal | null>(null);
  const [activeGroup, setActiveGroup] = useState<RouteGroup | null>(null);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ analystId, limit: "50" });
    if (activeGroup) {
      const codes = ROUTE_GROUP_CODES[activeGroup];
      if (codes.length > 0) qs.set("routeReasonCode", codes.join(","));
    }
    fetch(`/api/intelligence/signals?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setSignals)
      .finally(() => setLoading(false));
  }, [analystId, activeGroup]);

  const handleSelect = useCallback((signal: Signal) => {
    setSelected(signal);
  }, []);

  return (
    <>
      <div className="space-y-4">
        <RoutingStatsStrip
          analystId={analystId}
          days={30}
          activeGroup={activeGroup}
          onGroupChange={setActiveGroup}
        />

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        ) : signals.length === 0 ? (
          activeGroup ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No routes in this bucket over the last 30 days.
            </p>
          ) : (
            <EducationEmptyState stateKey="analyst-findings" />
          )
        ) : (
          <div className="space-y-2">
            {signals.map((signal) => (
              <SignalRow key={signal.id} signal={signal} onSelect={handleSelect} />
            ))}
          </div>
        )}
      </div>

      <FindingDetailDialog
        signal={selected}
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </>
  );
}
