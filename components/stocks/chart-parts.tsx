'use client';

/**
 * The pieces every line chart in the app shares, so the stock chart and the
 * dashboard's equity chart read as one design (the owner, 2026-11-06): the
 * frame with its pills top-left and a control top-right, the plot band, the
 * tick style, the green/red split colors, the hover cursor with its time
 * badge on the axis, the 1D clock window with its off-hours dot texture, and
 * the padded value scale with the three floating labels down the left.
 *
 * SVG stroke/fill can't consume our oklch() theme vars, so the two line
 * colors are the sRGB hex of --positive / --negative. Keep in sync.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { INTRADAY_WINDOW_ET } from '@/lib/market-data/intraday-window';

// The plot band: the pills row sits in the top margin, the x-axis (recharts'
// default 30px) at the bottom. Gradients and the floating labels are placed
// from these, so the split and the labels sit on the scale.
export const PLOT_TOP = 40;
export const X_AXIS_HEIGHT = 30;

export const LINE_GREEN = '#51b857';
export const LINE_RED = '#ff6d87';
export const AXIS_TICK = 'var(--muted-foreground)';
/** The faint color of a reference line or a marker dot. */
export const REF_LINE = 'var(--muted-foreground)';
export const TICK = { fontSize: 9, fill: AXIS_TICK, fontFamily: 'var(--font-mono)' };

/** The chart's box: a bordered, rounded frame; the pills top-left and one control top-right, over the plot. */
export function ChartFrame({
  frameless = false,
  controls,
  aside,
  before,
  className,
  children,
}: {
  frameless?: boolean;
  controls?: ReactNode;
  aside?: ReactNode;
  /** Something above the plot inside the frame (the trade page's banner). */
  before?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('rounded-lg overflow-hidden', !frameless && 'border', className)}>
      {before}
      <div className="relative">
        {controls ? <div className="absolute top-3 left-3 z-10">{controls}</div> : null}
        {aside ? <div className="absolute top-3 right-3 z-10">{aside}</div> : null}
        {children}
      </div>
    </div>
  );
}

/**
 * The hover cursor (the owner, 2026-11-05, after Apple's and Google's
 * charts): the vertical line, and the point's time as a small badge sitting
 * on the x-axis under it, over the tick labels. Recharts clones this element
 * with `points` (the line's top and bottom), the plot's `left` and `width`,
 * and the active `payload`.
 */
export function TimeCursor({
  points,
  payload,
  labelOf,
  left = 0,
  width = 0,
}: {
  points?: Array<{ x: number; y: number }>;
  payload?: Array<{ payload?: Record<string, unknown> }>;
  labelOf: (d: Record<string, unknown>) => string;
  left?: number;
  width?: number;
}) {
  if (!points || points.length < 2) return null;
  const [top, bottom] = points;
  const d = payload?.[0]?.payload;
  const label = d ? labelOf(d) : '';
  // Mono at 9px runs about 5.6px a character; clamp the badge inside the plot.
  const w = Math.max(28, label.length * 5.6 + 12);
  const h = 16;
  const x = Math.min(Math.max(top.x - w / 2, left), Math.max(left, left + width - w));
  const y = bottom.y + (X_AXIS_HEIGHT - h) / 2;
  return (
    <g pointerEvents="none">
      <line x1={top.x} y1={top.y} x2={bottom.x} y2={bottom.y} stroke="var(--muted-foreground)" strokeWidth={1} />
      {label ? (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={4} fill="var(--popover)" stroke="var(--border)" />
          <text
            x={x + w / 2}
            y={y + h / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={9}
            fontFamily="var(--font-mono)"
            fill="var(--foreground)"
          >
            {label}
          </text>
        </g>
      ) : null}
    </g>
  );
}

/** The one-line tooltip box: a muted word, then the figure. */
export function TipBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground tabular-nums whitespace-nowrap shadow-sm">
      {children}
    </div>
  );
}

/** The off-hours dot texture, as a `<pattern>` for `<defs>`; `fill="url(#offHoursDots)"` paints it. */
export const OFF_HOURS_PATTERN = 'offHoursDots';
export function OffHoursPattern() {
  return (
    <pattern id={OFF_HOURS_PATTERN} width={7} height={7} patternUnits="userSpaceOnUse">
      <circle cx={1} cy={1} r={1} fill={AXIS_TICK} fillOpacity={0.35} />
    </pattern>
  );
}

/**
 * The 1D chart's clock window, CENTERED on the regular session: 2.5h of
 * off-hours on each side (7:00 AM → 6:30 PM ET, with 9:30–16:00
 * dead-center), so the session sits balanced. Ticks every two hours from
 * 8 AM. Clock times are anchored to the session date's actual ET offset
 * (DST-safe, no tz lib) from the first point.
 */
export function intradaySessionGeometry(firstISO: string): {
  domain: [number, number];
  ticks: number[];
  rthStart: number;
  rthEnd: number;
} {
  const first = new Date(firstISO);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const o: Record<string, string> = {};
  for (const p of dtf.formatToParts(first)) o[p.type] = p.value;
  const etAsUtc = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second);
  const offsetMs = first.getTime() - etAsUtc; // UTC = ET wall + offsetMs
  const clock = (h: number, m = 0) => Date.UTC(+o.year, +o.month - 1, +o.day, h, m, 0) + offsetMs;
  const ticks: number[] = [];
  for (let h = 8; h <= 18; h += 2) ticks.push(clock(h));
  const minutes = (m: number) => clock(Math.floor(m / 60), m % 60);
  return {
    domain: [minutes(INTRADAY_WINDOW_ET.start), minutes(INTRADAY_WINDOW_ET.end)],
    ticks,
    rthStart: clock(9, 30),
    rthEnd: clock(16),
  };
}

/**
 * A buffered value domain so the line always clears the top and bottom
 * edges: ~12% of the visible range each side, with a floor for a flat
 * stretch (a quarter of a percent of the top value by default).
 */
export function paddedDomain(values: number[], minPad?: number): [number, number] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.12, minPad ?? Math.abs(hi) * 0.0025);
  return [lo - pad, hi + pad];
}

/** Three labels down the left of the plot band, at 16%, 50% and 84% of the scale. */
export function floatingLabels(
  [yLo, yHi]: [number, number],
  height: number,
  format: (v: number) => string,
): Array<{ value: string; top: number }> {
  return [0.16, 0.5, 0.84].map((f) => ({
    value: format(yHi - f * (yHi - yLo)),
    top: PLOT_TOP + f * (height - PLOT_TOP - X_AXIS_HEIGHT),
  }));
}

/** The three labels, overlaid on the left so the plot still full-bleeds; never block the hover. */
export function FloatingLabels({ labels }: { labels: Array<{ value: string; top: number }> }) {
  if (labels.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {labels.map((p) => (
        <span key={p.value + p.top} className="absolute left-1.5 text-[9px] font-mono text-muted-foreground/70" style={{ top: p.top }}>
          {p.value}
        </span>
      ))}
    </div>
  );
}
