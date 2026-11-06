'use client';

/**
 * The dashboard's portfolio line, drawn the way the stock chart draws a
 * price (the owner, 2026-11-06): the same frame and pills, a straight line
 * colored green above and red below what the range is measured from, a
 * fill fading to that baseline, three value labels down the left, the
 * cursor's time as a badge on the axis, one line of tooltip.
 *
 * On 1D the axis is the whole trading day (7:00 AM → 6:30 PM ET, the
 * session dead-center, the off-hours as a dot texture), the line runs as
 * far as the day has gone, and the day is measured from the previous
 * session's close, marked "Prev" at the right edge — so the chart agrees
 * with the header's 1 Day P&L and with every stock's own 1D.
 */

import { useId, useMemo } from 'react';
import { Area, ComposedChart, ReferenceArea, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDateLabel, formatDateTimeLabel, formatTimeLabel, splitOffset } from '@/components/stocks/chart-format';
import {
  AXIS_TICK,
  FloatingLabels,
  LINE_GREEN,
  LINE_RED,
  OFF_HOURS_PATTERN,
  OffHoursPattern,
  PLOT_TOP,
  REF_LINE,
  TICK,
  TimeCursor,
  TipBox,
  X_AXIS_HEIGHT,
  floatingLabels,
  intradaySessionGeometry,
  paddedDomain,
} from '@/components/stocks/chart-parts';
import { etDateOf } from '@/lib/market-data/intraday-window';

export type EquityPoint = { date: string; value: number };

type Props = {
  /** The range's points, oldest first. On 1D the first may be the previous session's close (the baseline). */
  points: EquityPoint[];
  /** Whether a point's key can carry a time ("1D" and "1W" read the 15-minute series). */
  range: '1D' | '1W' | '1M' | '1Y' | 'Max';
  /** Dollars or a percent return. */
  unit: 'dollar' | 'percent';
  /** The word before the figure in the tooltip: Value, Gain, Return. */
  name: string;
  /** The live figure of the same quantity, to end today's line at the present minute (1D, dollars). */
  live?: number | null;
  height: number;
};

const money = (v: number, digits = 2) =>
  `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const pct = (v: number, digits = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;

function ValueTip({ active, payload, name, unit }: { active?: boolean; payload?: Array<{ payload?: { value?: number } }>; name: string; unit: Props['unit'] }) {
  const v = payload?.[0]?.payload?.value;
  if (!active || v == null) return null;
  return (
    <TipBox>
      <span className="text-muted-foreground">{name} </span>
      {unit === 'dollar' ? money(v) : pct(v)}
    </TipBox>
  );
}

export function EquityChart({ points, range, unit, name, live, height }: Props) {
  const uid = useId().replace(/:/g, '');
  const lineGradient = `eq-line-${uid}`;
  const fillGradient = `eq-fill-${uid}`;

  // 1D on a timed series: today's points on a clock axis, measured from the
  // point before them (the previous session's close). The live figure ends
  // the line at the present minute when it is later than the last point.
  const intraday = range === '1D' && points.length > 0 && points[points.length - 1].date.includes('T');
  const { data, baseline, prior } = useMemo(() => {
    if (!intraday) return { data: points, baseline: points[0]?.value ?? 0, prior: null as number | null };
    const day = etDateOf(points[points.length - 1].date);
    const first = points.findIndex((p) => etDateOf(p.date) === day);
    const prior = first > 0 ? points[first - 1].value : null;
    const today = points.slice(first).map((p) => ({ ...p, x: new Date(p.date).getTime() }));
    const now = Date.now();
    if (live != null && live > 0 && today.length > 0 && etDateOf(new Date(now)) === day && now > today[today.length - 1].x) {
      today.push({ date: new Date(now).toISOString(), value: live, x: now });
    }
    return { data: today, baseline: prior ?? today[0]?.value ?? 0, prior };
  }, [points, intraday, live]);

  const geo = useMemo(() => (intraday && data.length > 0 ? intradaySessionGeometry(data[0].date) : null), [intraday, data]);
  const yDomain = useMemo<[number, number]>(() => {
    const values = data.map((d) => d.value);
    if (prior != null) values.push(prior);
    if (values.length === 0) return [0, 1];
    return paddedDomain(values, unit === 'percent' ? 0.05 : undefined);
  }, [data, prior, unit]);

  if (data.length < 2) return null;

  const [yLo, yHi] = yDomain;
  const offset = splitOffset(yLo, yHi, baseline);
  const last = data[data.length - 1].value;
  const endColor = last >= baseline ? LINE_GREEN : LINE_RED;
  const timed = data.some((d) => d.date.includes('T'));
  const labels = floatingLabels(yDomain, height, (v) => (unit === 'dollar' ? money(v, 0) : pct(v, 1)));

  return (
    <>
      <FloatingLabels labels={labels} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: PLOT_TOP, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <OffHoursPattern />
            {/* The split at the baseline, in the plot's own pixels, so it sits on the scale whatever the line spans. */}
            <linearGradient id={lineGradient} gradientUnits="userSpaceOnUse" x1={0} y1={PLOT_TOP} x2={0} y2={height - X_AXIS_HEIGHT}>
              <stop offset={0} stopColor={LINE_GREEN} />
              <stop offset={offset} stopColor={LINE_GREEN} />
              <stop offset={offset} stopColor={LINE_RED} />
              <stop offset={1} stopColor={LINE_RED} />
            </linearGradient>
            <linearGradient id={fillGradient} gradientUnits="userSpaceOnUse" x1={0} y1={PLOT_TOP} x2={0} y2={height - X_AXIS_HEIGHT}>
              <stop offset={0} stopColor={LINE_GREEN} stopOpacity={0.18} />
              <stop offset={offset} stopColor={LINE_GREEN} stopOpacity={0.02} />
              <stop offset={offset} stopColor={LINE_RED} stopOpacity={0.02} />
              <stop offset={1} stopColor={LINE_RED} stopOpacity={0.18} />
            </linearGradient>
          </defs>

          {intraday && geo ? (
            <XAxis dataKey="x" type="number" domain={geo.domain} ticks={geo.ticks} tick={TICK} tickLine={false} axisLine={false} tickFormatter={(v) => formatTimeLabel(v)} padding={{ left: 0, right: 0 }} />
          ) : (
            <XAxis
              dataKey="date"
              tick={TICK}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => formatDateLabel(v).toUpperCase()}
              interval={Math.max(1, Math.floor(data.length / 6))}
              padding={{ left: 0, right: 0 }}
            />
          )}
          <YAxis hide domain={yDomain} />

          <Tooltip
            isAnimationActive={false}
            content={<ValueTip name={name} unit={unit} />}
            wrapperStyle={{ outline: 'none' }}
            cursor={<TimeCursor labelOf={(d) => (intraday ? formatTimeLabel(d.x as number) : timed ? formatDateTimeLabel(d.date as string) : formatDateLabel(d.date as string))} />}
          />

          {/* Pre-market and after-hours as the dot texture; direct children, after the axes, or recharts can't place them. */}
          {intraday && geo ? <ReferenceArea x1={geo.domain[0]} x2={geo.rthStart} y1={yLo} y2={yHi} fill={`url(#${OFF_HOURS_PATTERN})`} stroke="none" ifOverflow="visible" /> : null}
          {intraday && geo ? <ReferenceArea x1={geo.rthEnd} x2={geo.domain[1]} y1={yLo} y2={yHi} fill={`url(#${OFF_HOURS_PATTERN})`} stroke="none" ifOverflow="visible" /> : null}

          {/* Yesterday's close: a dot at the right edge at the value the day is measured from, "Prev" beside it. */}
          {intraday && geo && prior != null ? (
            <ReferenceDot
              x={geo.domain[1]}
              y={prior}
              r={0}
              ifOverflow="visible"
              shape={(props: { cx?: number; cy?: number }) => {
                const cx = (props.cx ?? 0) - 4;
                const cy = props.cy ?? 0;
                return (
                  <g>
                    <circle cx={cx} cy={cy} r={3} fill={REF_LINE} fillOpacity={0.9} stroke="none" />
                    <text x={cx - 7} y={cy + 3.5} fill={AXIS_TICK} fontSize={9} textAnchor="end" fontFamily="var(--font-mono)">
                      {`Prev ${unit === 'dollar' ? money(prior) : pct(prior)}`}
                    </text>
                  </g>
                );
              }}
            />
          ) : null}

          <Area
            type="linear"
            dataKey="value"
            stroke={`url(#${lineGradient})`}
            strokeWidth={1.5}
            fill={`url(#${fillGradient})`}
            baseValue={baseline}
            dot={false}
            activeDot={{ r: 3, fill: endColor }}
            isAnimationActive={!intraday}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </>
  );
}
