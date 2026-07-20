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
  /**
   * Position lifespan for the "Trade" pill: start = watch/thesis date, end =
   * sold date (null while still held → windows to the latest candle). When set,
   * the "Trade" range becomes available (full variant only).
   */
  tradeSpan?: { start: string; end: string | null };
  children?: React.ReactNode;
};

// ─── Range config ───────────────────────────────────────────────────────────

const DAILY_RANGES = ['1W', '1M', '3M', '1Y'] as const;
type DailyRange = (typeof DAILY_RANGES)[number];
// "Trade" windows the daily candles to a position's own lifespan (watch → sold,
// or watch → now while held) rather than a fixed trailing day-count.
type Range = '1D' | 'Trade' | DailyRange;

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

// Shift a YYYY-MM-DD by N calendar days (used to pad the Trade window).
function shiftDay(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Intraday candles carry a full ISO timestamp in `date`; label them as ET
// time-of-day (e.g. "9:35 AM") instead of a calendar date.
function formatTimeLabel(v: string | number): string {
  return new Date(v).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// 1D axis geometry, fit to whatever session data we actually have.
//   • x-domain: first bar → last bar (+ a little right breathing room), so the
//     line fills the width and reads — rather than crushing a partial session
//     onto a fixed full-day backdrop (which, without pre-market data, is just a
//     vertical sliver). When a pre-market-capable feed lands, revisit a fixed
//     full-day window here.
//   • y-domain: padded ~25% of the range each side so the line clears the top
//     and bottom edges (a real price axis renders these values).
function intradayAxisGeometry(candles: { date: string; close: number }[]): {
  domain: [number, number];
  ticks: number[];
  yDomain: [number, number];
} {
  const xs = candles.map((c) => new Date(c.date).getTime());
  const firstX = xs[0];
  const lastX = xs[xs.length - 1];
  const span = Math.max(lastX - firstX, 60_000);
  const ticks: number[] = [];
  const N = 5;
  for (let i = 0; i <= N; i++) ticks.push(firstX + ((lastX - firstX) * i) / N);

  const closes = candles.map((c) => c.close);
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  const pad = Math.max((hi - lo) * 0.25, hi * 0.0015);

  return {
    domain: [firstX, lastX + span * 0.04],
    ticks,
    yDomain: [lo - pad, hi + pad],
  };
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
  tradeSpan,
  children,
}: Props) {
  const [range, setRange] = useState<Range>(defaultRange);
  const isIntraday = range === '1D';

  const ranges = useMemo<Range[]>(
    () => [
      ...(showIntraday ? (['1D'] as Range[]) : []),
      ...DAILY_RANGES,
      ...(tradeSpan ? (['Trade'] as Range[]) : []),
    ],
    [showIntraday, tradeSpan],
  );

  const data = useMemo(() => {
    if (isIntraday) {
      // Attach an epoch-ms `x` so the 1D chart can use a real time axis (fixed
      // full-session domain) rather than evenly spacing a handful of bars.
      return (intradayCandles ?? []).map((c) => ({
        ...c,
        x: new Date(c.date).getTime(),
      }));
    }
    if (range === 'Trade') {
      // The position's own lifespan: watch date → sold date (or the latest
      // candle while still held), padded a week each side for context — some
      // "before I was watching" lead-in, and post-sale action to judge the
      // exit. Candle `date` + span bounds are both YYYY-MM-DD, so plain string
      // comparison is correct.
      if (!tradeSpan) return candles;
      const start = shiftDay(tradeSpan.start, -7);
      const end = tradeSpan.end ? shiftDay(tradeSpan.end, 7) : '9999-12-31';
      return candles.filter((c) => c.date >= start && c.date <= end);
    }
    return candles.slice(-RANGE_DAYS[range as DailyRange]);
  }, [candles, intradayCandles, range, isIntraday, tradeSpan]);

  // 1D axis: x fit to the session so far + buffered y-domain. Null otherwise.
  const intradayAxis = useMemo(() => {
    if (!isIntraday || data.length < 2) return null;
    return intradayAxisGeometry(data);
  }, [isIntraday, data]);

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
          {isIntraday ? (
            <XAxis
              dataKey="x"
              type="number"
              scale="time"
              domain={intradayAxis?.domain ?? ['dataMin', 'dataMax']}
              ticks={intradayAxis?.ticks}
              tick={{ fontSize: 9, fill: '#71717a', fontFamily: 'var(--font-mono)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => formatTimeLabel(v)}
              padding={{ left: 0, right: 0 }}
            />
          ) : (
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9, fill: '#71717a', fontFamily: 'var(--font-mono)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => formatDateLabel(v).toUpperCase()}
              interval={Math.max(1, Math.floor(data.length / 6))}
              // Trade mode ends at the Sold marker (or "now"); pad the right so
              // that edge marker's label isn't clipped against the frame.
              padding={{ left: 0, right: range === 'Trade' ? 44 : 0 }}
            />
          )}
          {isIntraday ? (
            <YAxis
              orientation="left"
              domain={intradayAxis?.yDomain ?? ['dataMin', 'dataMax']}
              tick={{ fontSize: 9, fill: '#71717a', fontFamily: 'var(--font-mono)' }}
              tickLine={false}
              axisLine={false}
              width={38}
              tickCount={4}
              tickFormatter={(v: number) => v.toFixed(2)}
            />
          ) : (
            <YAxis hide domain={['dataMin * 0.98', 'dataMax * 1.15']} />
          )}
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
            labelFormatter={(l: string | number) =>
              isIntraday ? formatTimeLabel(l) : formatDateLabel(l as string)
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
            // Intraday: linear, so real tick-by-tick movement (the V-dips and
            // spikes) shows instead of monotone rounding a few bars into a fake
            // smooth curve. Daily: monotone reads cleaner over months.
            type={isIntraday ? 'linear' : 'monotone'}
            dataKey="close"
            stroke={strokeColor}
            strokeWidth={1.5}
            fill="url(#stockGrad)"
            dot={false}
            activeDot={{ r: 3, fill: strokeColor }}
            isAnimationActive={!isIntraday}
          />
        </AreaChart>
      </ResponsiveContainer>
      ) : (
        <div
          className="flex items-center justify-center"
          style={{ height }}
        >
          <p className="text-xs text-muted-foreground">
            {isIntraday
              ? intradayLoading
                ? 'Loading intraday…'
                : 'No intraday data'
              : 'No price data available'}
          </p>
        </div>
      )}
      </div>
    </div>
  );
}
