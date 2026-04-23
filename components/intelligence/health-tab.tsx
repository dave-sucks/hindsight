"use client";

// ── Intelligence Health Tab ──────────────────────────────────────────────────
// Shows the real health of the intelligence pipeline:
//   - Stat row: signals today, routed, monitors active, briefs generated
//   - Area chart: signal volume over 14 days (total vs routed)
//   - Pie: route reason code breakdown (Discovery vs Watchlist vs Position vs ...)
//   - Bar: top tickers by signal volume, colored by kind
//   - Monitor health list: last run time + 7-day signal count
//   - Coverage: sector / industry / theme bars (from signals)
//   - Tool stats: agent run tool usage bar chart + run history
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarGauge } from "@/components/ui/bar-gauge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Signal,
  Radar,
  Globe,
  Activity,
  Search,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Cpu,
} from "lucide-react";
import type { HealthData } from "@/app/api/intelligence/health/route";

// ── Colour tokens ─────────────────────────────────────────────────────────────

const COLORS = {
  portfolio: "#10b981",  // emerald-500
  watchlist: "#3b82f6",  // blue-500
  discovery: "#a855f7",  // purple-500
  routed: "#6366f1",     // indigo-500
  total: "#64748b",      // slate-500
  grid: "var(--border)",
  axis: "var(--muted-foreground)",
};

const ROUTE_COLORS: Record<string, string> = {
  DISCOVERY: "#a855f7",
  WATCHLIST: "#3b82f6",
  POSITION: "#10b981",
  DIRECT_TICKER: "#f59e0b",
  SECTOR_MATCH: "#6366f1",
  INDUSTRY_MATCH: "#8b5cf6",
  THEME_MATCH: "#ec4899",
  CROSS_ANALYST: "#14b8a6",
};

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

// ── Tooltip helpers ───────────────────────────────────────────────────────────

interface TooltipPayloadItem {
  value: number;
  name?: string;
  color?: string;
  dataKey?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-md px-3 py-2 text-xs shadow-lg space-y-0.5">
      {label && (
        <p className="text-muted-foreground mb-1 font-medium">{label}</p>
      )}
      {payload.map((p, i) => (
        <p key={i} className="tabular-nums" style={{ color: p.color }}>
          {p.name ? `${p.name}: ` : ""}
          {p.value.toLocaleString()}
        </p>
      ))}
    </div>
  );
}

function PieTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload?: { code: string; count: number };
    value?: number;
  }>;
}) {
  if (!active || !payload?.length || !payload[0]?.payload) return null;
  const { code, count } = payload[0].payload;
  return (
    <div className="bg-card border border-border rounded-md px-3 py-2 text-xs shadow-lg">
      <p className="font-medium">{ROUTE_LABELS[code] ?? code}</p>
      <p className="tabular-nums text-muted-foreground">{count} routes</p>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  trend,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
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
              trend === "up"
                ? "bg-emerald-500/10 text-emerald-500"
                : trend === "down"
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

// ── Skeleton ──────────────────────────────────────────────────────────────────

function HealthSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="p-6 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Skeleton className="h-56 lg:col-span-2 rounded-lg" />
        <Skeleton className="h-56 rounded-lg" />
      </div>
      <Skeleton className="h-48 rounded-lg" />
    </div>
  );
}

// ── Monitor status dot ────────────────────────────────────────────────────────

function MonitorStatusDot({
  lastRunAt,
  signalCount7d,
  enabled,
}: {
  lastRunAt: string | null;
  signalCount7d: number;
  enabled: boolean;
}) {
  if (!enabled)
    return (
      <span className="h-2 w-2 rounded-full bg-muted-foreground/30 shrink-0" />
    );
  if (!lastRunAt)
    return (
      <span className="h-2 w-2 rounded-full bg-yellow-500 shrink-0" title="Never run" />
    );

  const ageMs = Date.now() - new Date(lastRunAt).getTime();
  const stale = ageMs > 36 * 60 * 60 * 1000; // >36h

  if (stale)
    return (
      <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" title="Stale" />
    );
  if (signalCount7d === 0)
    return (
      <span className="h-2 w-2 rounded-full bg-yellow-500 shrink-0" title="No signals in 7d" />
    );
  return (
    <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" title="Healthy" />
  );
}

function relativeTime(isoStr: string): string {
  const ms = Date.now() - new Date(isoStr).getTime();
  const h = Math.floor(ms / (60 * 60 * 1000));
  if (h < 1) return "< 1h ago";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ── Coverage section (compact inline bars) ────────────────────────────────────

const COVERAGE_INITIAL_ROWS = 8;

function CoverageBar({
  label,
  items,
  total,
}: {
  label: string;
  items: { name: string; count: number }[];
  total: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, COVERAGE_INITIAL_ROWS);
  const remaining = items.length - COVERAGE_INITIAL_ROWS;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}{" "}
        <span className="normal-case tabular-nums">{items.length}</span>
      </p>
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
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface HealthTabProps {
  data: HealthData | null;
  loading: boolean;
}

export function HealthTab({ data, loading }: HealthTabProps) {
  if (loading) return <HealthSkeleton />;

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-muted-foreground">
          Health data unavailable. Run the pipeline first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Stat row ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Signals Today"
          value={data.totals.signalsToday}
          sub={`${data.totals.signals7d} this week`}
          icon={Signal}
          trend={data.totals.signalsToday > 0 ? "up" : "neutral"}
        />
        <StatCard
          label="Routed Today"
          value={data.totals.routedToday}
          sub={
            data.totals.signalsToday > 0
              ? `${Math.round((data.totals.routedToday / data.totals.signalsToday) * 100)}% of today's`
              : "none yet"
          }
          icon={TrendingUp}
          trend={data.totals.routedToday > 0 ? "up" : "neutral"}
        />
        <StatCard
          label="Active Monitors"
          value={data.totals.activeMonitors}
          sub={`${data.monitorHealth.filter((m) => m.signalCount7d > 0).length} producing signals`}
          icon={Radar}
          trend="neutral"
        />
        <StatCard
          label="Briefs (7d)"
          value={data.totals.briefs7d}
          sub="morning briefs generated"
          icon={Activity}
          trend={data.totals.briefs7d > 0 ? "up" : "neutral"}
        />
      </div>

      {/* ── Signal volume + Route breakdown ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Area chart — signal volume over 14 days */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Signal Volume — 14 Days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SignalAreaChart data={data.signalsByDay} />
          </CardContent>
        </Card>

        {/* Donut — route reason breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Route Origins (7d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RouteDonut breakdown={data.routeBreakdown} />
          </CardContent>
        </Card>
      </div>

      {/* ── Top tickers ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Top Tickers by Signal Volume (7d)
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              <span style={{ color: COLORS.portfolio }}>■</span> Portfolio{" "}
              <span style={{ color: COLORS.watchlist }}>■</span> Watchlist{" "}
              <span style={{ color: COLORS.discovery }}>■</span> Discovery
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TopTickersChart tickers={data.topTickers} />
        </CardContent>
      </Card>

      {/* ── Coverage + Monitor health ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Coverage */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Signal Coverage (7d)
              {data.coverage.orphanCount > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {data.coverage.orphanCount} orphaned
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.coverage.total === 0 ? (
              <p className="text-sm text-muted-foreground">
                No signals in the last 7 days.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <CoverageBar
                  label="Sectors"
                  items={data.coverage.sectors}
                  total={data.coverage.total}
                />
                <CoverageBar
                  label="Industries"
                  items={data.coverage.industries}
                  total={data.coverage.total}
                />
                <CoverageBar
                  label="Themes"
                  items={data.coverage.themes}
                  total={data.coverage.total}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Monitor health */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Monitor Health</CardTitle>
          </CardHeader>
          <CardContent>
            <MonitorHealthList monitors={data.monitorHealth} />
          </CardContent>
        </Card>
      </div>

      {/* ── Tool stats + Run history ── */}
      {(data.toolStats.length > 0 || data.recentRuns.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.toolStats.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">
                  Agent Tool Usage (last 14 runs)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ToolStatsChart stats={data.toolStats} />
              </CardContent>
            </Card>
          )}
          {data.recentRuns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">
                  Recent Agent Runs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <RecentRunsList runs={data.recentRuns} />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ── Signal area chart ─────────────────────────────────────────────────────────

function SignalAreaChart({
  data,
}: {
  data: HealthData["signalsByDay"];
}) {
  const formatted = useMemo(
    () =>
      data.map((d) => {
        const date = new Date(d.date + "T00:00:00Z");
        const label = date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        });
        return { ...d, label };
      }),
    [data]
  );

  const maxVal = Math.max(...formatted.map((d) => d.total), 1);

  return (
    <div className="h-44">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={formatted}
          margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
        >
          <defs>
            <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={COLORS.total} stopOpacity={0.3} />
              <stop offset="95%" stopColor={COLORS.total} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradRouted" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={COLORS.routed} stopOpacity={0.4} />
              <stop offset="95%" stopColor={COLORS.routed} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: COLORS.axis }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: COLORS.axis }}
            tickLine={false}
            axisLine={false}
            domain={[0, maxVal]}
            allowDecimals={false}
          />
          <Tooltip content={<ChartTooltip />} />
          <Area
            type="monotone"
            dataKey="total"
            name="Total"
            stroke={COLORS.total}
            strokeWidth={1.5}
            fill="url(#gradTotal)"
            dot={false}
          />
          <Area
            type="monotone"
            dataKey="routed"
            name="Routed"
            stroke={COLORS.routed}
            strokeWidth={1.5}
            fill="url(#gradRouted)"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Route donut ───────────────────────────────────────────────────────────────

function RouteDonut({ breakdown }: { breakdown: HealthData["routeBreakdown"] }) {
  const total = breakdown.reduce((s, r) => s + r.count, 0);

  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-44 text-sm text-muted-foreground">
        No routes yet
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={breakdown}
              cx="50%"
              cy="50%"
              innerRadius="55%"
              outerRadius="80%"
              dataKey="count"
              nameKey="code"
              paddingAngle={2}
            >
              {breakdown.map((entry, i) => (
                <Cell
                  key={entry.code}
                  fill={ROUTE_COLORS[entry.code] ?? `hsl(${i * 45}, 60%, 55%)`}
                />
              ))}
            </Pie>
            <Tooltip content={<PieTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {/* Legend */}
      <div className="space-y-1">
        {breakdown.slice(0, 6).map((r) => {
          const color =
            ROUTE_COLORS[r.code] ?? "var(--muted-foreground)";
          const pct = Math.round((r.count / total) * 100);
          return (
            <div key={r.code} className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="flex-1 text-xs text-muted-foreground truncate">
                {ROUTE_LABELS[r.code] ?? r.code}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Top tickers bar chart ─────────────────────────────────────────────────────

function TopTickersChart({ tickers }: { tickers: HealthData["topTickers"] }) {
  if (tickers.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        No ticker data yet
      </div>
    );
  }

  const chartData = tickers.map((t) => ({
    ticker: t.ticker,
    count: t.count,
    fill:
      t.kind === "portfolio"
        ? COLORS.portfolio
        : t.kind === "watchlist"
        ? COLORS.watchlist
        : COLORS.discovery,
  }));

  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 10, fill: COLORS.axis }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="ticker"
            width={48}
            tick={{ fontSize: 10, fill: COLORS.axis }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0];
              const row = tickers.find((t) => t.ticker === d.payload?.ticker);
              return (
                <div className="bg-card border border-border rounded-md px-3 py-2 text-xs shadow-lg">
                  <p className="font-medium">${d.payload?.ticker}</p>
                  <p className="tabular-nums text-muted-foreground">
                    {d.value} signals
                  </p>
                  {row && (
                    <p
                      className="capitalize mt-0.5"
                      style={{ color: d.payload?.fill }}
                    >
                      {row.kind}
                    </p>
                  )}
                </div>
              );
            }}
          />
          <Bar dataKey="count" radius={[0, 3, 3, 0]} maxBarSize={18}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Monitor health list ───────────────────────────────────────────────────────

const MONITOR_INITIAL = 12;

function MonitorHealthList({
  monitors,
}: {
  monitors: HealthData["monitorHealth"];
}) {
  const [expanded, setExpanded] = useState(false);

  // Sort: unhealthy first (never run or stale, no signals)
  const sorted = useMemo(() => {
    return [...monitors].sort((a, b) => {
      const scoreA = monitorScore(a);
      const scoreB = monitorScore(b);
      return scoreA - scoreB;
    });
  }, [monitors]);

  const visible = expanded ? sorted : sorted.slice(0, MONITOR_INITIAL);
  const remaining = sorted.length - MONITOR_INITIAL;

  if (monitors.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No monitors configured.</p>
    );
  }

  return (
    <div className="space-y-2">
      {visible.map((m) => (
        <div key={m.id} className="flex items-center gap-2 py-1">
          <MonitorStatusDot
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
          {m.lastRunAt && (
            <span className="text-xs tabular-nums text-muted-foreground/50 shrink-0 hidden sm:block">
              {relativeTime(m.lastRunAt)}
            </span>
          )}
          {!m.lastRunAt && m.enabled && (
            <span className="text-xs text-yellow-500 shrink-0">never run</span>
          )}
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
  );
}

function monitorScore(m: HealthData["monitorHealth"][number]): number {
  if (!m.enabled) return 10;
  if (!m.lastRunAt) return 0; // never run = worst
  const ageMs = Date.now() - new Date(m.lastRunAt).getTime();
  if (ageMs > 36 * 60 * 60 * 1000) return 1; // stale
  if (m.signalCount7d === 0) return 2; // ran but no signals
  return 9; // healthy
}

function MonitorTypeIcon({ type }: { type: string }) {
  if (type === "DOMAIN")
    return <Globe className="h-3 w-3 text-orange-500 shrink-0" />;
  if (type === "API")
    return <Activity className="h-3 w-3 text-purple-500 shrink-0" />;
  return <Search className="h-3 w-3 text-blue-500 shrink-0" />;
}

// ── Tool stats chart ──────────────────────────────────────────────────────────

function ToolStatsChart({ stats }: { stats: HealthData["toolStats"] }) {
  const top = stats.slice(0, 12);

  return (
    <div className="space-y-3">
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={top}
            layout="vertical"
            margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 10, fill: COLORS.axis }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={120}
              tick={{ fontSize: 9, fill: COLORS.axis }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: string) =>
                v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
              }
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof stats)[number];
                const errRate =
                  d.calls > 0
                    ? Math.round((d.errors / d.calls) * 100)
                    : 0;
                return (
                  <div className="bg-card border border-border rounded-md px-3 py-2 text-xs shadow-lg space-y-0.5">
                    <p className="font-medium">
                      {d.name
                        .replace(/_/g, " ")
                        .replace(/\b\w/g, (c) => c.toUpperCase())}
                    </p>
                    <p className="tabular-nums text-muted-foreground">
                      {d.calls} calls · {errRate}% errors
                    </p>
                    <p className="tabular-nums text-muted-foreground">
                      avg {d.avgLatencyMs}ms
                    </p>
                  </div>
                );
              }}
            />
            <Bar
              dataKey="calls"
              fill={COLORS.routed}
              radius={[0, 3, 3, 0]}
              maxBarSize={16}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Error highlights */}
      {top.some((t) => t.errors > 0) && (
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Errors
          </p>
          {top
            .filter((t) => t.errors > 0)
            .map((t) => (
              <div key={t.name} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
                <span className="text-xs text-muted-foreground truncate flex-1">
                  {t.name.replace(/_/g, " ")}
                </span>
                <span className="text-xs tabular-nums text-red-500 shrink-0">
                  {t.errors} err
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ── Recent runs list ──────────────────────────────────────────────────────────

function RecentRunsList({ runs }: { runs: HealthData["recentRuns"] }) {
  return (
    <div className="space-y-2">
      {runs.map((run, i) => {
        const date = new Date(run.date);
        const label = date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        const isHealthy = run.status === "COMPLETE" && run.totalToolCalls >= 5;
        const durationMin =
          run.durationMs > 0 ? Math.round(run.durationMs / 60000) : null;

        return (
          <div key={i} className="flex items-center gap-2 py-1">
            {run.status === "COMPLETE" ? (
              isHealthy ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
              ) : (
                <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0" />
              )
            ) : run.status === "FAILED" ? (
              <TrendingDown className="h-3 w-3 text-red-500 shrink-0" />
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
  );
}
