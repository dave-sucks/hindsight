'use client';

import { useState, useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { cn } from '@/lib/utils';
import type { StockCandle } from '@/lib/actions/finnhub.actions';

// ─── Types ──────────────────────────────────────────────────────────────────

type PriceReferenceLine = {
  price: number;
  color: string;
  label: string;
  dashed?: boolean;
};

// Vertical marker on the time axis — "started watching" / "entered here".
// `date` is snapped to the nearest visible candle; markers whose date falls
// before the visible window are dropped (off-range). Suppressed on the 1D
// intraday view — a watch/entry date is never inside a single session window.
type TimeMarker = {
  date: string;
  color: string;
  label: string;
};

type Props = {
  candles: StockCandle[];
  referenceLines?: PriceReferenceLine[];
  verticalMarkers?: TimeMarker[];
  /** Hide the range pills (used by the compact card chart, fixed window). */
  showControls?: boolean;
  /** Initial range. Defaults to 3M. */
  defaultRange?: Range;
  /** Chart body height in px. Defaults to 300. */
  height?: number;
  /** Drop the outer border (when embedded inside another card). */
  frameless?: boolean;
  /**
   * Expose the "1D" intraday pill. When true, `intradayCandles` supplies the
   * bars for that tab (fetched lazily by the parent — undefined until loaded).
   * Off by default so cards and the stock page keep their daily-only pills.
   */
  showIntraday?: boolean;
  /** 5-min bars for the current session — rendered when the 1D tab is active. */
  intradayCandles?: StockCandle[];
  /** True while the parent is (re)fetching the intraday series. */
  intradayLoading?: boolean;
  /** Fired on every pill click so the parent can start/stop intraday polling. */
  onRangeChange?: (range: Range) => void;
  children?: React.ReactNode;
};

// ─── Range config ───────────────────────────────────────────────────────────

const DAILY_RANGES = ['1W', '1M', '3M', '1Y'] as const;
type DailyRange = (typeof DAILY_RANGES)[number];
type Range = '1D' | DailyRange;

const RANGE_DAYS: Record<DailyRange, number> = {
  '1W': 5,
  '1M': 22,
  '3M': 66,
  '1Y': 252,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Intraday candles carry a full ISO timestamp in `date`; label them as ET
// time-of-day (e.g. "9:35 AM") instead of a calendar date.
function formatTimeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

export function StockPriceChart({
  candles,
  referenceLines,
  verticalMarkers,
  showControls = true,
  defaultRange = '3M',
  height = 300,
  frameless = false,
  showIntraday = false,
  intradayCandles,
  intradayLoading = false,
  onRangeChange,
  children,
}: Props) {
  const [range, setRange] = useState<Range>(defaultRange);
  const isIntraday = range === '1D';

  const ranges = useMemo<Range[]>(
    () => (showIntraday ? ['1D', ...DAILY_RANGES] : [...DAILY_RANGES]),
    [showIntraday],
  );

  const data = useMemo(() => {
    if (isIntraday) return intradayCandles ?? [];
    return candles.slice(-RANGE_DAYS[range as DailyRange]);
  }, [candles, intradayCandles, range, isIntraday]);

  // Snap each marker to the nearest visible candle date (Recharts only places
  // a vertical ReferenceLine on an x-value that exists in `data`). Markers
  // dated before the visible window are dropped — their event is off-range.
  // Intraday has no such markers (a single session never contains the
  // watch/entry date), so skip entirely.
  const snappedMarkers = useMemo(() => {
    if (isIntraday || !verticalMarkers?.length || data.length < 2) return [];
    const firstDate = data[0].date;
    const dates = data.map((d) => d.date);
    return verticalMarkers
      .map((m) => {
        if (m.date < firstDate) return null; // off the left edge of the window
        // nearest candle date >= marker date (markers rarely land on a
        // non-trading day; fall back to the last date if past the window).
        const hit = dates.find((d) => d >= m.date) ?? dates[dates.length - 1];
        return { ...m, snapped: hit };
      })
      .filter((m): m is TimeMarker & { snapped: string } => m !== null);
  }, [verticalMarkers, data, isIntraday]);

  const hasBody = data.length >= 2;

  // Legacy empty state — only when the 1D pill isn't in play (cards / stock
  // page). Keeps the original bordered "no data" panel with no pills. When
  // intraday is enabled we always render the frame + pills below so the user
  // can switch back out of an empty/loading 1D tab.
  if (!hasBody && !showIntraday) {
    return (
      <div
        className={cn(
          'relative rounded-lg overflow-hidden h-[300px] flex items-center justify-center',
          !frameless && 'border',
        )}
        style={{
          backgroundImage:
            'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)',
          backgroundSize: '18px 18px',
          backgroundColor: 'hsl(var(--muted)/0.3)',
        }}
      >
        <p className="text-xs text-muted-foreground">No price data available</p>
      </div>
    );
  }

  const firstClose = hasBody ? data[0].close : 0;
  const lastClose = hasBody ? data[data.length - 1].close : 0;
  const isUp = lastClose >= firstClose;
  // Use hex colors — CSS variables are oklch() which don't work in SVG stroke/fill
  const strokeColor = isUp ? '#22c55e' : '#ef4444';

  const handleRange = (r: Range) => {
    setRange(r);
    onRangeChange?.(r);
  };

  return (
    <div
      className={cn('rounded-lg overflow-hidden', !frameless && 'border')}
      style={{
        backgroundImage:
          'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)',
        backgroundSize: '18px 18px',
        backgroundColor: 'hsl(var(--muted)/0.3)',
      }}
    >
      {children}
      <div className="relative">
      {/* Range pills — absolute top-left of chart area */}
      {showControls && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-0.5 bg-background/80 backdrop-blur-sm rounded-md border px-1 py-0.5">
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => handleRange(r)}
              className={cn(
                'px-2 py-0.5 text-xs rounded transition-colors',
                range === r
                  ? 'bg-muted text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {r}
            </button>
          ))}
        </div>
      )}

      {hasBody ? (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 40, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="stockGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={strokeColor} stopOpacity={0.2} />
              <stop offset="95%" stopColor={strokeColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 9, fill: '#71717a', fontFamily: 'var(--font-mono)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) =>
              isIntraday ? formatTimeLabel(v) : formatDateLabel(v).toUpperCase()
            }
            interval={Math.max(1, Math.floor(data.length / 6))}
            padding={{ left: 0, right: 0 }}
          />
          <YAxis hide domain={['dataMin * 0.98', 'dataMax * 1.15']} />
          <Tooltip
            contentStyle={{
              background: 'var(--popover)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '12px',
              color: 'var(--popover-foreground)',
            }}
            formatter={(v: number) => [
              `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              'Close',
            ]}
            labelFormatter={(l: string) =>
              isIntraday ? formatTimeLabel(l) : formatDateLabel(l)
            }
            labelStyle={{ color: 'var(--muted-foreground)' }}
          />
          {/* Vertical markers — "started watching" / "entered here" */}
          {snappedMarkers.map((m) => (
            <ReferenceLine
              key={`${m.label}-${m.snapped}`}
              x={m.snapped}
              stroke={m.color}
              strokeDasharray="2 3"
              strokeWidth={1}
              label={{
                value: m.label,
                position: 'insideTopLeft',
                fontSize: 9,
                fill: m.color,
              }}
            />
          ))}
          {/* Reference lines for trade entry/target/stop */}
          {referenceLines?.map((line) => (
            <ReferenceLine
              key={line.label}
              y={line.price}
              stroke={line.color}
              strokeDasharray={line.dashed !== false ? '4 4' : undefined}
              strokeWidth={1}
              label={{
                value: `${line.label} $${line.price.toFixed(2)}`,
                position: 'right',
                fontSize: 9,
                fill: line.color,
              }}
            />
          ))}
          <Area
            type="monotone"
            dataKey="close"
            stroke={strokeColor}
            strokeWidth={1.5}
            fill="url(#stockGrad)"
            dot={false}
            activeDot={{ r: 3, fill: strokeColor }}
          />
        </AreaChart>
      </ResponsiveContainer>
      ) : (
        <div
          className="flex items-center justify-center"
          style={{ height }}
        >
          <p className="text-xs text-muted-foreground">
            {intradayLoading ? 'Loading intraday…' : 'No intraday data'}
          </p>
        </div>
      )}
      </div>
    </div>
  );
}
