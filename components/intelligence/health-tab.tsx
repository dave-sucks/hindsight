"use client";

// ── Intelligence Health Tab ──────────────────────────────────────────────────
// Design rules:
//   Padding  — p-3 everywhere. CardHeader p-3 pb-2. CardContent p-3 pt-0.
//   Text     — 2 sizes only: text-xs (all body/labels/counts), text-xl (stat values)
//   Color    — text-foreground for values/names, text-muted-foreground for labels/meta
//   No colored text (no yellow, no emerald, no destructive on text)
//   No status dots. Either icons or text, not both.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BarGauge } from "@/components/ui/bar-gauge";
import { CheckCircle2, Clock, AlertTriangle, TrendingDown } from "lucide-react";
import type { HealthData } from "@/app/api/intelligence/health/route";
import { SyncHealthPanel } from "@/components/intelligence/sync-health-panel";

// ── Route label map ────────────────────────────────────────────────────────────

const ROUTE_LABELS: Record<string, string> = {
  DISCOVERY: "Discovery",
  WATCHLIST: "Watchlist",
  POSITION: "Position",
  DIRECT_TICKER: "Direct Ticker",
  SECTOR_MATCH: "Sector Match",
  INDUSTRY_MATCH: "Industry Match",
  THEME_MATCH: "Theme Match",
  CROSS_ANALYST: "Cross-Analyst",
};

// ── Chart configs ──────────────────────────────────────────────────────────────

const signalChartConfig = {
  total: { label: "Total", color: "var(--positive)" },
  routed: { label: "Routed", color: "var(--brand-blue)" },
} satisfies ChartConfig;

const tickerChartConfig = {
  portfolio: { label: "Portfolio", color: "var(--positive)" },
  watchlist: { label: "Watchlist", color: "var(--brand-blue)" },
  discovery: { label: "Discovery", color: "var(--brand-orange)" },
} satisfies ChartConfig;

const toolChartConfig = {
  calls: { label: "Calls", color: "var(--brand-blue)" },
} satisfies ChartConfig;

const ROUTE_CHART_VARS = [
  "var(--positive)",
  "var(--brand-blue)",
  "var(--brand-orange)",
  "var(--chart-1)",
  "var(--chart-2)",
];

// Shared axis style — keeps chart text consistent with the rest of the card
const AXIS_STYLE = { fontSize: 11, fill: "var(--muted-foreground)" } as const;

// ── Skeleton ──────────────────────────────────────────────────────────────────

function HealthSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="p-3 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-12" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
// p-3, no icon box. label = xs muted, value = xl semibold, sub = xs muted.

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tabular-nums mt-1">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ── Coverage bar section ──────────────────────────────────────────────────────

const COVERAGE_ROWS = 8;

function CoverageSection({
  label,
  items,
  total,
}: {
  label: string;
  items: { name: string; count: number }[];
  total: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, COVERAGE_ROWS);
  const remaining = items.length - COVERAGE_ROWS;

  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-medium">{label}</CardTitle>
          <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground/50">—</p>
        ) : (
          <div className="space-y-1.5">
            {visible.map((item) => (
              <div key={item.name} className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">
                  {item.name}
                </span>
                <BarGauge
                  mode="fill"
                  value={total > 0 ? item.count / total : 0}
                  color="muted-foreground"
                  segments={12}
                  className="w-14 shrink-0"
                />
                <span className="text-xs tabular-nums text-muted-foreground w-6 text-right shrink-0">
                  {item.count}
                </span>
              </div>
            ))}
            {remaining > 0 && !expanded && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-muted-foreground"
                onClick={() => setExpanded(true)}
              >
                +{remaining} more
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "< 1h ago";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Main export ───────────────────────────────────────────────────────────────

interface HealthTabProps {
  data: HealthData | null;
  loading: boolean;
}

export function HealthTab({ data, loading }: HealthTabProps) {
  if (loading) return <HealthSkeleton />;
  if (!data) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-xs text-muted-foreground">
          Health data unavailable. Run the pipeline first.
        </p>
      </div>
    );
  }

  const routePct =
    data.totals.signalsToday > 0
      ? Math.round((data.totals.routedToday / data.totals.signalsToday) * 100)
      : null;

  return (
    <div className="space-y-3">
      {/* Alpaca↔DB sync heartbeat — always at top, real-money correctness check */}
      <SyncHealthPanel />

      {/* ── Stat row ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Signals Today"
          value={data.totals.signalsToday}
          sub={`${data.totals.signals7d} this week`}
        />
        <StatCard
          label="Routed Today"
          value={data.totals.routedToday}
          sub={routePct !== null ? `${routePct}% of today's` : "none yet"}
        />
        <StatCard
          label="Active Monitors"
          value={data.totals.activeMonitors}
          sub={`${data.monitorHealth.filter((m) => m.signalCount7d > 0).length} producing signals`}
        />
        <StatCard
          label="Briefs (7d)"
          value={data.totals.briefs7d}
          sub="morning briefs generated"
        />
      </div>

      {/* ── Signal volume ── */}
      <SignalVolumeChart data={data.signalsByDay} />

      {/* ── Route breakdown + top tickers ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <RouteOriginChart breakdown={data.routeBreakdown} />
        <div className="lg:col-span-2">
          <TopTickersChart tickers={data.topTickers} />
        </div>
      </div>

      {/* ── Coverage ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <CoverageSection label="Sectors" items={data.coverage.sectors} total={data.coverage.total} />
        <CoverageSection label="Industries" items={data.coverage.industries} total={data.coverage.total} />
        <CoverageSection label="Themes" items={data.coverage.themes} total={data.coverage.total} />
      </div>

      {/* ── Monitor health + Tool stats ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <MonitorHealthCard monitors={data.monitorHealth} />
        {data.toolStats.length > 0 && <ToolStatsChart stats={data.toolStats} />}
      </div>

      {/* ── Recent runs ── */}
      {data.recentRuns.length > 0 && <RecentRunsCard runs={data.recentRuns} />}
    </div>
  );
}

// ── Signal volume area chart ──────────────────────────────────────────────────

function SignalVolumeChart({ data }: { data: HealthData["signalsByDay"] }) {
  const formatted = useMemo(() => data.map((d) => ({ ...d })), [data]);
  const hasData = formatted.some((d) => d.total > 0);

  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-xs font-medium">Signal Volume</CardTitle>
        <CardDescription className="text-xs">
          Total collected vs routed — last 14 days
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 pt-0 pb-3 sm:px-3">
        {!hasData ? (
          <div className="flex items-center justify-center h-[220px] text-xs text-muted-foreground">
            No signals yet
          </div>
        ) : (
          <ChartContainer config={signalChartConfig} className="aspect-auto h-[220px] w-full">
            <AreaChart data={formatted}>
              <defs>
                <linearGradient id="fillTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-total)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="var(--color-total)" stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="fillRouted" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-routed)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="var(--color-routed)" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                style={AXIS_STYLE}
                tickFormatter={(value: string) =>
                  new Date(value + "T00:00:00Z").toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    timeZone: "UTC",
                  })
                }
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value: string) =>
                      new Date(value + "T00:00:00Z").toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        weekday: "short",
                        timeZone: "UTC",
                      })
                    }
                    indicator="dot"
                  />
                }
              />
              <Area dataKey="total" type="natural" fill="url(#fillTotal)" stroke="var(--color-total)" strokeWidth={1.5} />
              <Area dataKey="routed" type="natural" fill="url(#fillRouted)" stroke="var(--color-routed)" strokeWidth={2} />
              <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ── Route origin donut ────────────────────────────────────────────────────────

function RouteOriginChart({ breakdown }: { breakdown: HealthData["routeBreakdown"] }) {
  const top5 = breakdown.slice(0, 5);
  const total = top5.reduce((s, r) => s + r.count, 0);

  const routeConfig = useMemo(() => {
    const cfg: ChartConfig = {};
    top5.forEach((r, i) => {
      cfg[r.code] = {
        label: ROUTE_LABELS[r.code] ?? r.code,
        color: ROUTE_CHART_VARS[i] ?? "var(--chart-5)",
      };
    });
    return cfg;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakdown]);

  const chartData = top5.map((r, i) => ({
    ...r,
    label: ROUTE_LABELS[r.code] ?? r.code,
    fill: ROUTE_CHART_VARS[i] ?? "var(--chart-5)",
  }));

  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-xs font-medium">Route Origins</CardTitle>
        <CardDescription className="text-xs">Last 7 days</CardDescription>
      </CardHeader>
      <CardContent className="px-2 pt-0 pb-3 sm:px-3">
        {total === 0 ? (
          <div className="flex items-center justify-center h-[180px] text-xs text-muted-foreground">
            No routes yet
          </div>
        ) : (
          <ChartContainer config={routeConfig} className="mx-auto aspect-square max-h-[180px]">
            <PieChart>
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel nameKey="code" />} />
              <Pie data={chartData} dataKey="count" nameKey="code" innerRadius="55%" outerRadius="80%" paddingAngle={2}>
                {chartData.map((entry, i) => (
                  <Cell key={entry.code} fill={ROUTE_CHART_VARS[i] ?? "var(--chart-5)"} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
        )}
        {total > 0 && (
          <div className="space-y-1 mt-2">
            {chartData.map((r) => (
              <div key={r.code} className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: r.fill }} />
                <span className="flex-1 text-xs text-muted-foreground truncate">{r.label}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {Math.round((r.count / total) * 100)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Top tickers bar chart ─────────────────────────────────────────────────────

function TopTickersChart({ tickers }: { tickers: HealthData["topTickers"] }) {
  const chartData = tickers.map((t) => ({ ticker: t.ticker, count: t.count, kind: t.kind }));

  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-xs font-medium">Top Tickers by Signal Volume</CardTitle>
        <CardDescription className="text-xs">Last 7 days</CardDescription>
      </CardHeader>
      <CardContent className="px-2 pt-0 pb-3 sm:px-3">
        {tickers.length === 0 ? (
          <div className="flex items-center justify-center h-[200px] text-xs text-muted-foreground">
            No ticker data yet
          </div>
        ) : (
          <ChartContainer config={tickerChartConfig} className="aspect-auto h-[260px] w-full">
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} style={AXIS_STYLE} />
              <YAxis type="category" dataKey="ticker" width={44} tickLine={false} axisLine={false} tickMargin={4} style={AXIS_STYLE} />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    formatter={(value, _name, item) => {
                      const kind = (item.payload as { kind: string })?.kind ?? "";
                      const kindLabel = kind === "portfolio" ? "Portfolio" : kind === "watchlist" ? "Watchlist" : "Discovery";
                      return (
                        <span>
                          {value} signals{" "}
                          <span className="text-muted-foreground">· {kindLabel}</span>
                        </span>
                      );
                    }}
                  />
                }
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={14}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={`var(--color-${entry.kind})`} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
        {tickers.length > 0 && (
          <div className="flex items-center gap-4 mt-2">
            {(["portfolio", "watchlist", "discovery"] as const).map((k) => (
              <span key={k} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="h-2 w-2 rounded-sm shrink-0" style={{ backgroundColor: `var(--color-${k})` }} />
                {k.charAt(0).toUpperCase() + k.slice(1)} ({tickers.filter((t) => t.kind === k).length})
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Monitor health card ───────────────────────────────────────────────────────

const MONITOR_INITIAL = 10;

function monitorScore(m: HealthData["monitorHealth"][number]): number {
  if (!m.enabled) return 10;
  if (!m.lastRunAt) return 0;
  if (Date.now() - new Date(m.lastRunAt).getTime() > 36 * 3600 * 1000) return 1;
  if (m.signalCount7d === 0) return 2;
  return 9;
}

function MonitorHealthCard({ monitors }: { monitors: HealthData["monitorHealth"] }) {
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(
    () => [...monitors].sort((a, b) => monitorScore(a) - monitorScore(b)),
    [monitors]
  );

  const visible = expanded ? sorted : sorted.slice(0, MONITOR_INITIAL);
  const remaining = sorted.length - MONITOR_INITIAL;

  const neverRunCount = monitors.filter((m) => m.enabled && !m.lastRunAt).length;
  const staleCount = monitors.filter(
    (m) => m.enabled && m.lastRunAt && Date.now() - new Date(m.lastRunAt).getTime() > 36 * 3600 * 1000
  ).length;

  const headerMeta = [
    neverRunCount > 0 && `${neverRunCount} never run`,
    staleCount > 0 && `${staleCount} stale`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs font-medium">Monitor Health</CardTitle>
          {headerMeta && (
            <span className="text-xs text-muted-foreground shrink-0">{headerMeta}</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {monitors.length === 0 ? (
          <p className="text-xs text-muted-foreground">No monitors configured.</p>
        ) : (
          <div className="space-y-1.5">
            {visible.map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <span className={`flex-1 min-w-0 truncate text-xs ${!m.enabled ? "text-muted-foreground/40" : ""}`}>
                  {m.name}
                </span>
                {m.signalCount7d > 0 && (
                  <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                    {m.signalCount7d}
                  </span>
                )}
                <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">
                  {!m.enabled
                    ? "disabled"
                    : m.lastRunAt
                    ? relativeTime(m.lastRunAt)
                    : "never run"}
                </span>
              </div>
            ))}
            {remaining > 0 && !expanded && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-muted-foreground"
                onClick={() => setExpanded(true)}
              >
                +{remaining} more
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
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
