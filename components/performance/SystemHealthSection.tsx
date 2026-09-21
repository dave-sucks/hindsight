"use client";

/**
 * The system panels that used to be the intelligence page's Health tab:
 * the Alpaca ↔ DB sync check, agent tool usage, and the recent runs list.
 *
 * They are about how the machine ran, not about the market, so they landed
 * here when /intelligence was folded into /market. Same `HealthTab`
 * component, same endpoint — it fetches when this section first renders,
 * below everything a person actually comes to Performance to read.
 */

import { useEffect, useState } from "react";
import { HealthTab } from "@/components/intelligence/health-tab";
import type { HealthData } from "@/app/api/intelligence/health/route";

export function SystemHealthSection() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/intelligence/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((json: HealthData | null) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        /* the panels render their own empty state */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-medium">System</h2>
        <p className="text-sm text-muted-foreground">
          Whether the book matches Alpaca, what the agents called, and how the last runs went.
        </p>
      </div>
      <HealthTab data={data} loading={loading} />
    </section>
  );
}
