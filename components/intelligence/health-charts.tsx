"use client";

// Recharts-backed pieces for /intelligence/health. Server component queries
// live on the page; this file owns the client-only rendering.

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

const GRID_COLOR = "var(--border)";
const AXIS_COLOR = "var(--muted-foreground)";
const BAR_COLOR = "#3b82f6";

interface TipProps {
  active?: boolean;
  payload?: Array<{ value: number; name?: string }>;
  label?: string;
}

function ChartTip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-md px-3 py-2 text-sm shadow-lg">
      {label && <p className="text-xs text-muted-foreground mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="tabular-nums">
          {p.name ? `${p.name}: ` : ""}
          {p.value}
        </p>
      ))}
    </div>
  );
}

export function NoveltyHistogram({
  data,
}: {
  data: { bucket: string; count: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="bucket"
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: AXIS_COLOR }}
          axisLine={false}
          tickLine={false}
          width={32}
        />
        <Tooltip content={<ChartTip />} />
        <Bar dataKey="count" name="Routes" fill={BAR_COLOR} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function FunnelChart({
  data,
}: {
  data: { analyst: string; routed: number; read: number; cited: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 48)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
      >
        <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 10, fill: AXIS_COLOR }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="analyst"
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          axisLine={false}
          tickLine={false}
          width={140}
        />
        <Tooltip content={<ChartTip />} />
        <Bar dataKey="routed" name="Routed" fill="#3b82f6" radius={[0, 3, 3, 0]} />
        <Bar dataKey="read" name="Read" fill="#8b5cf6" radius={[0, 3, 3, 0]} />
        <Bar dataKey="cited" name="Cited" fill="#10b981" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
