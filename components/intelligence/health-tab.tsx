"use client";

// ── Intelligence Health Tab ──────────────────────────────────────────────────
// Unified card design system:
//   Frame   — <Card> (no className overrides)
//   Header  — <CardHeader className="p-4 pb-2"> + <CardTitle className="text-sm font-medium">
//   Content — <CardContent className="p-4 pt-0">  (charts: px-2 pt-0 pb-4 sm:px-4)
//   Stats   — <CardContent className="p-4"> (no header; value=2xl, label=xs uppercase)
// Typography (4 styles only):
//   1. text-sm font-medium                            — card titles
//   2. text-2xl font-semibold tabular-nums            — stat values
//   3. text-xs text-muted-foreground                  — body / descriptions
//   4. text-xs tabular-nums text-muted-foreground     — inline counts
//   + text-xs font-medium uppercase tracking-wide text-muted-foreground — stat labels
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BarGauge } from "@/components/ui/bar-gauge";
import { cn } from "@/lib/utils";
import {
  Signal,
  Radar,
  Globe,
  Activity,
  Search,
  TrendingUp,
  CheckCircle2,
  Clock,
  AlertTriangle,
  TrendingDown,
} from "lucide-react";
import type { HealthData } from "@/app/api/intelligence/health/route";

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
// Brand-aware: uses the app's own CSS variables, NOT shadcn purple var(--chart-N).

const signalChartConfig = {
  total: {
    label: "Total",
    color: "var(--positive)",        // green — all signals collected
  },
  routed: {
    label: "Routed",
    color: "var(--brand-blue)",      // blue — made it to an analyst
  },
} satisfies ChartConfig;

const tickerChartConfig = {
  portfolio: {
    label: "Portfolio",
    color: "var(--positive)",        // green — you own it
  },
  watchlist: {
    label: "Watchlist",
    color: "var(--brand-blue)",      // blue — you're watching it
  },
  discovery: {
    label: "Discovery",
    color: "var(--brand-orange)",    // orange — new find
  },
} satisfies ChartConfig;

const toolChartConfig = {
  calls: {
    label: "Calls",
    color: "var(--brand-blue)",
  },
} satisfies ChartConfig;

const ROUTE_CHART_VARS = [
  "var(--positive)",
  "var(--brand-blue)",
  "var(--brand-orange)",
  "var(--chart-1)",
  "var(--chart-2)",
];

// ── Skeleton ──────────────────────────────────────────────────────────────────

function HealthSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="p-4 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
// No CardHeader — all content in CardContent p-4.
// The "flip" the user asked for: label is xs uppercase, value is 2xl bold.

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  healthy,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  healthy?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <p className="text-2xl font-semibold tabular-nums mt-1">{value}</p>
            {sub && (
              <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
            )}
          </div>
          <div
            className={cn(
              "h-8 w-8 rounded-md flex items-center justify-center shrink-0",
              healthy === true
                ? "bg-emerald-500/10 text-emerald-500"
                : healthy === false
                ? "bg-red-500/10 text-red-500"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
        </div>
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
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{label}</CardTitle>
          <span className="text-xs tabular-nums text-muted-foreground">
            {items.length}
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
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

// ── Monitor status dot ────────────────────────────────────────────────────────

function MonitorDot({
  lastRunAt,
  signalCount7d,
  enabled,
}: {
  lastRunAt: string | null;
  signalCount7d: number;
  enabled: boolean;
}) {
  if (!enabled)
    return <span className="h-2 w-2 rounded-full bg-muted-foreground/30 shrink-0" />;
  if (!lastRunAt)
    return <span className="h-2 w-2 rounded-full bg-yellow-500 shrink-0" />;
  const stale = Date.now() - new Date(lastRunAt).getTime() > 36 * 3600 * 1000;
  if (stale)
    return <span className="h-2 w-2 rounded-full bg-destructive shrink-0" />;
  if (signalCount7d === 0)
    return <span className="h-2 w-2 rounded-full bg-yellow-500 shrink-0" />;
  return <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "< 1h ago";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function monitorScore(m: HealthData["monitorHealth"][number]): number {
  if (!m.enabled) return 10;
  if (!m.lastRunAt) return 0;
  const stale = Date.now() - new Date(m.lastRunAt).getTime() > 36 * 3600 * 1000;
  if (stale) return 1;
  if (m.signalCount7d === 0) return 2;
  return 9;
}

function MonitorTypeIcon({ type }: { type: string }) {
  if (type === "DOMAIN") return <Globe className="h-3 w-3 text-muted-foreground shrink-0" />;
  if (type === "API") return <Activity className="h-3 w-3 text-muted-foreground shrink-0" />;
  return <Search className="h-3 w-3 text-muted-foreground shrink-0" />;
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
        <p className="text-sm text-muted-foreground">
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
    <div className="space-y-4">
      {/* ── Stat row ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Signals Today"
          value={data.totals.signalsToday}
          sub={`${data.totals.signals7d} this week`}
          icon={Signal}
          healthy={data.totals.signalsToday > 0}
        />
        <StatCard
          label="Routed Today"
          value={data.totals.routedToday}
          sub={routePct !== null ? `${routePct}% of today's signals` : "none yet"}
          icon={TrendingUp}
          healthy={data.totals.routedToday > 0}
        />
        <StatCard
          label="Active Monitors"
          value={data.totals.activeMonitors}
          sub={`${data.monitorHealth.filter((m) => m.signalCount7d > 0).length} producing signals`}
          icon={Radar}
        />
        <StatCard
          label="Briefs (7d)"
          value={data.totals.briefs7d}
          sub="morning briefs generated"
          icon={Activity}
          healthy={data.totals.briefs7d > 0}
        />
      </div>

      {/* ── Signal volume area chart ── */}
      <SignalVolumeChart data={data.signalsByDay} />

      {/* ── Route breakdown + top tickers ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <RouteOriginChart breakdown={data.routeBreakdown} />
        <div className="lg:col-span-2">
          <TopTickersChart tickers={data.topTickers} />
        </div>
      </div>

      {/* ── Signal coverage — 3 cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <CoverageSection
          label="Sectors"
          items={data.coverage.sectors}
          total={data.coverage.total}
        />
        <CoverageSection
          label="Industries"
          items={data.coverage.industries}
          total={data.coverage.total}
        />
        <CoverageSection
          label="Themes"
          items={data.coverage.themes}
          total={data.coverage.total}
        />
      </div>

      {/* ── Monitor health + Tool stats ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MonitorHealthCard monitors={data.monitorHealth} />
        {data.toolStats.length > 0 && (
          <ToolStatsChart stats={data.toolStats} />
        )}
      </div>

      {/* ── Recent runs ── */}
      {data.recentRuns.length > 0 && (
        <RecentRunsCard runs={data.recentRuns} />
      )}
    </div>
  );
}

// ── Signal volume area chart ──────────────────────────────────────────────────

function SignalVolumeChart({ data }: { data: HealthData["signalsByDay"] }) {
  const formatted = useMemo(() => data.map((d) => ({ ...d })), [data]);
  const hasData = formatted.some((d) => d.total > 0);

  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-medium">Signal Volume</CardTitle>
        <CardDescription className="text-xs">
          Total signals collected vs routed — last 14 days
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 pt-0 pb-4 sm:px-4">
        {!hasData ? (
          <div className="flex items-center justify-center h-[250px] text-sm text-muted-foreground">
            No signals yet
          </div>
        ) : (
          <ChartContainer config={signalChartConfig} className="aspect-auto h-[250px] w-full">
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
                tickFormatter={(value: string) => {
                  const d = new Date(value + "T00:00:00Z");
                  return d.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    timeZone: "UTC",
                  });
                }}
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
              {/* total is background — rendered first, independent (no stackId) */}
              <Area
                dataKey="total"
                type="natural"
                fill="url(#fillTotal)"
                stroke="var(--color-total)"
                strokeWidth={1.5}
              />
              {/* routed renders on top — shows what fraction got to analysts */}
              <Area
                dataKey="routed"
                type="natural"
                fill="url(#fillRouted)"
                stroke="var(--color-routed)"
                strokeWidth={2}
              />
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
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-medium">Route Origins</CardTitle>
        <CardDescription className="text-xs">
          Last 7 days — how signals were matched
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 pt-0 pb-4 sm:px-4">
        {total === 0 ? (
          <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
            No routes yet
          </div>
        ) : (
          <ChartContainer config={routeConfig} className="mx-auto aspect-square max-h-[200px]">
            <PieChart>
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent hideLabel nameKey="code" />}
              />
              <Pie
                data={chartData}
                dataKey="count"
                nameKey="code"
                innerRadius="55%"
                outerRadius="80%"
                paddingAngle={2}
              >
                {chartData.map((entry, i) => (
                  <Cell key={entry.code} fill={ROUTE_CHART_VARS[i] ?? "var(--chart-5)"} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
        )}
        {total > 0 && (
          <div className="space-y-1 mt-2">
            {chartData.map((r) => {
              const pct = Math.round((r.count / total) * 100);
              return (
                <div key={r.code} className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: r.fill }}
                  />
                  <span className="flex-1 text-xs text-muted-foreground truncate">
                    {r.label}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {pct}%
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Top tickers bar chart ─────────────────────────────────────────────────────

function TopTickersChart({ tickers }: { tickers: HealthData["topTickers"] }) {
  const chartData = tickers.map((t) => ({
    ticker: t.ticker,
    count: t.count,
    kind: t.kind,
  }));

  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-medium">Top Tickers by Signal Volume</CardTitle>
        <CardDescription className="text-xs">Last 7 days</CardDescription>
      </CardHeader>
      <CardContent className="px-2 pt-0 pb-4 sm:px-4">
        {tickers.length === 0 ? (
          <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
            No ticker data yet
          </div>
        ) : (
          <ChartContainer
            config={tickerChartConfig}
            className="aspect-auto h-[280px] w-full"
          >
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid horizontal={false} />
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="ticker"
                width={48}
                tickLine={false}
                axisLine={false}
                tickMargin={4}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    formatter={(value, _name, item) => {
                      const kind = (item.payload as { kind: string })?.kind ?? "";
                      const kindLabel =
                        kind === "portfolio"
                          ? "Portfolio"
                          : kind === "watchlist"
                          ? "Watchlist"
                          : "Discovery";
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
              <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={16}>
                {chartData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={`var(--color-${entry.kind})`}
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
        {tickers.length > 0 && (
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            {(["portfolio", "watchlist", "discovery"] as const).map((k) => (
              <span key={k} className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-sm"
                  style={{ backgroundColor: `var(--color-${k})` }}
                />
                {k.charAt(0).toUpperCase() + k.slice(1)}{" "}
                ({tickers.filter((t) => t.kind === k).length})
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

function MonitorHealthCard({
  monitors,
}: {
  monitors: HealthData["monitorHealth"];
}) {
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(
    () => [...monitors].sort((a, b) => monitorScore(a) - monitorScore(b)),
    [monitors]
  );

  const visible = expanded ? sorted : sorted.slice(0, MONITOR_INITIAL);
  const remaining = sorted.length - MONITOR_INITIAL;

  const neverRunCount = monitors.filter((m) => m.enabled && !m.lastRunAt).length;
  const staleCount = monitors.filter((m) => {
    if (!m.enabled || !m.lastRunAt) return false;
    return Date.now() - new Date(m.lastRunAt).getTime() > 36 * 3600 * 1000;
  }).length;

  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">Monitor Health</CardTitle>
          <div className="flex items-center gap-1.5">
            {neverRunCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-yellow-500 mr-1.5" />
                {neverRunCount} never run
              </Badge>
            )}
            {staleCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                {staleCount} stale
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {monitors.length === 0 ? (
          <p className="text-xs text-muted-foreground">No monitors configured.</p>
        ) : (
          <div className="space-y-2">
            {visible.map((m) => (
              <div key={m.id} className="flex items-center gap-2 py-0.5">
                <MonitorDot
                  lastRunAt={m.lastRunAt}
                  signalCount7d={m.signalCount7d}
                  enabled={m.enabled}
                />
                <MonitorTypeIcon type={m.type} />
                <span
                  className={cn(
                    "flex-1 min-w-0 truncate text-xs",
                    !m.enabled && "text-muted-foreground/50"
                  )}
                >
                  {m.name}
                </span>
                {m.signalCount7d > 0 && (
                  <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                    {m.signalCount7d}
                  </span>
                )}
                {m.lastRunAt ? (
                  <span className="text-xs tabular-nums text-muted-foreground/50 shrink-0 hidden sm:block">
                    {relativeTime(m.lastRunAt)}
                  </span>
                ) : m.enabled ? (
                  <span className="text-xs text-yellow-500 shrink-0">never run</span>
                ) : null}
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
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-medium">Agent Tool Usage</CardTitle>
        <CardDescription className="text-xs">
          Aggregated across last 14 runs
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 pt-0 pb-4 sm:px-4">
        <ChartContainer config={toolChartConfig} className="aspect-auto h-[280px] w-full">
          <BarChart data={top} layout="vertical">
            <CartesianGrid horizontal={false} />
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={130}
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              tickFormatter={(v: string) =>
                v
                  .split("_")
                  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                  .join(" ")
              }
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value, _name, item) => {
                    const d = item.payload as (typeof top)[number];
                    const errPct =
                      d.calls > 0 ? Math.round((d.errors / d.calls) * 100) : 0;
                    return (
                      <span>
                        {value} calls{" "}
                        {errPct > 0 && (
                          <span className="text-destructive">· {errPct}% errors</span>
                        )}
                        <span className="text-muted-foreground ml-1">
                          · avg {d.avgLatencyMs}ms
                        </span>
                      </span>
                    );
                  }}
                />
              }
            />
            <Bar dataKey="calls" fill="var(--color-calls)" radius={[0, 4, 4, 0]} maxBarSize={16} />
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
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-medium">Recent Agent Runs</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="space-y-2">
          {runs.map((run, i) => {
            const date = new Date(run.date);
            const label = date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            const isComplete = run.status === "COMPLETE";
            const isThin = isComplete && run.totalToolCalls < 5;
            const durationMin =
              run.durationMs > 0 ? Math.round(run.durationMs / 60_000) : null;

            return (
              <div key={i} className="flex items-center gap-2 py-0.5">
                {run.status === "FAILED" ? (
                  <TrendingDown className="h-3 w-3 text-destructive shrink-0" />
                ) : isThin ? (
                  <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0" />
                ) : isComplete ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                ) : (
                  <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                )}
                <span className="flex-1 min-w-0 text-xs truncate">
                  {run.analystName}
                </span>
                {run.totalToolCalls > 0 && (
                  <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                    {run.totalToolCalls} tools
                  </span>
                )}
                {durationMin !== null && durationMin > 0 && (
                  <span className="text-xs tabular-nums text-muted-foreground/60 shrink-0 hidden sm:block">
                    {durationMin}m
                  </span>
                )}
                <span className="text-xs tabular-nums text-muted-foreground/50 shrink-0 hidden md:block">
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
