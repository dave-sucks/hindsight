"use client";

// ── Intelligence Health Tab ──────────────────────────────────────────────────
// Design rules:
//   Padding  — p-3 everywhere. CardHeader p-3 pb-2. CardContent p-3 pt-0.
//   Text     — 2 sizes only: text-xs (all body/labels/counts), text-xl (stat values)
//   Color    — text-foreground for values/names, text-muted-foreground for labels/meta
//   No colored text (no yellow, no emerald, no destructive on text)
//   No status dots. Either icons or text, not both.
// ─────────────────────────────────────────────────────────────────────────────

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Clock, AlertTriangle, TrendingDown } from "lucide-react";
import type { HealthData } from "@/app/api/intelligence/health/route";
import { SyncHealthPanel } from "@/components/intelligence/sync-health-panel";

// ── Chart config ──────────────────────────────────────────────────────────────

const toolChartConfig = {
  calls: { label: "Calls", color: "var(--brand-blue)" },
} satisfies ChartConfig;

// Shared axis style — keeps chart text consistent with the rest of the card
const AXIS_STYLE = { fontSize: 11, fill: "var(--muted-foreground)" } as const;


// ── Main export ───────────────────────────────────────────────────────────────

interface HealthTabProps {
  data: HealthData | null;
  loading: boolean;
}

export function HealthTab({ data, loading }: HealthTabProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Alpaca↔DB sync heartbeat — the real-money correctness check. Its own
          endpoint, unaffected by the retired pipeline. */}
      <SyncHealthPanel />

      {data && data.toolStats.length > 0 && <ToolStatsChart stats={data.toolStats} />}
      {data && data.recentRuns.length > 0 && <RecentRunsCard runs={data.recentRuns} />}
    </div>
  );
}

// ── Tool stats chart ──────────────────────────────────────────────────────────

function ToolStatsChart({ stats }: { stats: HealthData["toolStats"] }) {
  const top = stats.slice(0, 12);

  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-xs font-medium">Agent Tool Usage</CardTitle>
        <CardDescription className="text-xs">Aggregated across last 14 runs</CardDescription>
      </CardHeader>
      <CardContent className="px-2 pt-0 pb-3 sm:px-3">
        <ChartContainer config={toolChartConfig} className="aspect-auto h-[260px] w-full">
          <BarChart data={top} layout="vertical">
            <CartesianGrid horizontal={false} />
            <XAxis type="number" tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} style={AXIS_STYLE} />
            <YAxis
              type="category"
              dataKey="name"
              width={130}
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              style={AXIS_STYLE}
              tickFormatter={(v: string) =>
                v.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
              }
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value, _name, item) => {
                    const d = item.payload as (typeof top)[number];
                    const errPct = d.calls > 0 ? Math.round((d.errors / d.calls) * 100) : 0;
                    return (
                      <span>
                        {value} calls
                        {errPct > 0 && <span className="text-destructive"> · {errPct}% errors</span>}
                        <span className="text-muted-foreground"> · avg {d.avgLatencyMs}ms</span>
                      </span>
                    );
                  }}
                />
              }
            />
            <Bar dataKey="calls" fill="var(--color-calls)" radius={[0, 4, 4, 0]} maxBarSize={14} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

// ── Recent runs card ──────────────────────────────────────────────────────────

function RecentRunsCard({ runs }: { runs: HealthData["recentRuns"] }) {
  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-xs font-medium">Recent Agent Runs</CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <div className="space-y-1.5">
          {runs.map((run, i) => {
            const label = new Date(run.date).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            const isComplete = run.status === "COMPLETE";
            const isThin = isComplete && run.totalToolCalls < 5;
            const durationMin = run.durationMs > 0 ? Math.round(run.durationMs / 60_000) : null;

            return (
              <div key={i} className="flex items-center gap-2">
                {run.status === "FAILED" ? (
                  <TrendingDown className="h-3 w-3 text-muted-foreground shrink-0" />
                ) : isThin ? (
                  <AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0" />
                ) : isComplete ? (
                  <CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0" />
                ) : (
                  <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                )}
                <span className="flex-1 min-w-0 text-xs truncate">{run.analystName}</span>
                {run.totalToolCalls > 0 && (
                  <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                    {run.totalToolCalls} tools
                  </span>
                )}
                {durationMin !== null && durationMin > 0 && (
                  <span className="text-xs tabular-nums text-muted-foreground shrink-0 hidden sm:block">
                    {durationMin}m
                  </span>
                )}
                <span className="text-xs tabular-nums text-muted-foreground shrink-0 hidden md:block">
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
