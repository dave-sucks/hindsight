'use client';

import { useState, useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
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

// Vertical marker on the time axis — "started watching" / "entered" / "sold".
// `date` is snapped to the nearest visible candle; markers before the visible
// window are dropped. Not shown on the 1D intraday view (a single session never
// contains the watch/entry date).
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
  /** 1-min bars for the current session — rendered when the 1D tab is active. */
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

// Axis / mark colors — hardcoded hex (SVG stroke/fill can't consume our oklch()
// theme vars).
const AXIS_TICK = '#71717a';
// Off-hours (pre-market / after-hours) shading — a faint lightening of the
// regions outside the 9:30–16:00 regular session.
const OFF_HOURS_FILL = '#e4e4e7';

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

// A buffered price domain so the line always clears the top and bottom edges —
// applied to every range so they read consistently. ~12% of the visible range
// each side, with a floor for near-flat sessions.
function priceDomain(closes: number[]): [number, number] {
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  const pad = Math.max((hi - lo) * 0.12, hi * 0.0025);
  return [lo - pad, hi + pad];
}

// The 1D chart pins its x-axis to the full trading day (7 AM–8 PM ET) so the
// line fills only the elapsed portion — a real "N hours into the day" view —
// and the pre-market (7–9:30) + after-hours (16–20) regions render as shaded
// off-hours bands even when we have no data to draw in them. The clock times
// are anchored to the session date's actual ET offset (DST-safe, no tz lib),
// derived from the first candle's timestamp.
function intradaySessionGeometry(firstISO: string): {
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
  const clock = (h: number, m = 0) =>
    Date.UTC(+o.year, +o.month - 1, +o.day, h, m, 0) + offsetMs;
  const ticks: number[] = [];
  for (let h = 8; h <= 20; h += 2) ticks.push(clock(h));
  return {
    domain: [clock(7), clock(20)],
    ticks,
    rthStart: clock(9, 30),
    rthEnd: clock(16),
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
      // Attach an epoch-ms `x` so the 1D chart uses a real time axis.
      return (intradayCandles ?? []).map((c) => ({
        ...c,
        x: new Date(c.date).getTime(),
      }));
    }
    if (range === 'Trade') {
      // The position's own lifespan: watch → sold (or the latest candle while
      // held), padded a week each side. Candle `date` + span bounds are both
      // YYYY-MM-DD, so string comparison is correct.
      if (!tradeSpan) return candles;
      const start = shiftDay(tradeSpan.start, -7);
      const end = tradeSpan.end ? shiftDay(tradeSpan.end, 7) : '9999-12-31';
      return candles.filter((c) => c.date >= start && c.date <= end);
    }
    return candles.slice(-RANGE_DAYS[range as DailyRange]);
  }, [candles, intradayCandles, range, isIntraday, tradeSpan]);

  // 1D full-day geometry (domain + ticks + regular-session bounds). Null else.
  const intradayGeo = useMemo(() => {
    if (!isIntraday || data.length < 1) return null;
    return intradaySessionGeometry(data[0].date);
  }, [isIntraday, data]);

  // Buffered price (y) domain — same treatment on every range.
  const yDomain = useMemo<[number, number] | undefined>(() => {
    if (data.length < 1) return undefined;
    return priceDomain(data.map((d) => d.close));
  }, [data]);

  // Snap each marker to the nearest visible candle, then stagger labels that
  // land on (or near) the same candle so they don't overprint — Watching and
  // Entry often share a date or sit a day apart.
  const snappedMarkers = useMemo(() => {
    if (isIntraday || !verticalMarkers?.length || data.length < 2) return [];
    const dates = data.map((d) => d.date);
    const firstDate = dates[0];
    const snapped = verticalMarkers
      .map((m) => {
        if (m.date < firstDate) return null; // off the left edge
        const hit = dates.find((d) => d >= m.date) ?? dates[dates.length - 1];
        return { ...m, snapped: hit, idx: dates.indexOf(hit) };
      })
      .filter((m): m is TimeMarker & { snapped: string; idx: number } => m !== null)
      .sort((a, b) => a.idx - b.idx);

    // Two labels collide when their candles are within ~12% of the window.
    const near = Math.max(2, Math.floor(data.length * 0.12));
    let lastIdx = -Infinity;
    let lastStagger = -1;
    return snapped.map((m) => {
      const stagger = m.idx - lastIdx <= near ? lastStagger + 1 : 0;
      lastIdx = m.idx;
      lastStagger = stagger;
      return { ...m, stagger };
    });
  }, [verticalMarkers, data, isIntraday]);

  const hasBody = data.length >= 2;

  // Legacy empty state — only when the 1D pill isn't in play (cards / stock
  // page). When intraday is enabled we always render the frame + pills so the
  // user can switch out of an empty/loading 1D tab.
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
              domain={intradayGeo?.domain ?? ['dataMin', 'dataMax']}
              ticks={intradayGeo?.ticks}
              tick={{ fontSize: 9, fill: AXIS_TICK, fontFamily: 'var(--font-mono)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => formatTimeLabel(v)}
              padding={{ left: 0, right: 0 }}
            />
          ) : (
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9, fill: AXIS_TICK, fontFamily: 'var(--font-mono)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => formatDateLabel(v).toUpperCase()}
              interval={Math.max(1, Math.floor(data.length / 6))}
              // Trade mode ends at the Sold marker (or "now"); pad the right so
              // that edge marker's label isn't clipped against the frame.
              padding={{ left: 0, right: range === 'Trade' ? 44 : 0 }}
            />
          )}

          {/* Hidden price axis — provides the buffered domain (line clears the
              top/bottom edges) without reserving a left gutter, so the line
              full-bleeds to the container edges on every range. Consistent
              across frames; exact prices are available on hover. */}
          <YAxis hide domain={yDomain ?? ['dataMin', 'dataMax']} />

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

          {/* Off-hours bands (1D only): pre-market + after-hours, a faint
              lightening so the regular session stands out even with no data in
              them. Must be DIRECT children (not a fragment) AND declared after
              the axes, or recharts can't resolve their coordinates. */}
          {isIntraday && intradayGeo && yDomain ? (
            <ReferenceArea
              x1={intradayGeo.domain[0]}
              x2={intradayGeo.rthStart}
              y1={yDomain[0]}
              y2={yDomain[1]}
              fill={OFF_HOURS_FILL}
              fillOpacity={0.12}
              stroke="none"
              ifOverflow="visible"
            />
          ) : null}
          {isIntraday && intradayGeo && yDomain ? (
            <ReferenceArea
              x1={intradayGeo.rthEnd}
              x2={intradayGeo.domain[1]}
              y1={yDomain[0]}
              y2={yDomain[1]}
              fill={OFF_HOURS_FILL}
              fillOpacity={0.12}
              stroke="none"
              ifOverflow="visible"
            />
          ) : null}

          {/* Vertical markers — Watching / Entry / Sold. Labels stagger down
              when two land on (or near) the same candle so they don't overprint. */}
          {snappedMarkers.map((m) => (
            <ReferenceLine
              key={`${m.label}-${m.snapped}`}
              x={m.snapped}
              stroke={m.color}
              strokeDasharray="2 3"
              strokeWidth={1}
              label={(props: { viewBox?: { x?: number; y?: number } }) => {
                const vx = props.viewBox?.x ?? 0;
                const vy = props.viewBox?.y ?? 0;
                return (
                  <text
                    x={vx + 4}
                    y={vy + 10 + m.stagger * 12}
                    fill={m.color}
                    fontSize={9}
                    textAnchor="start"
                  >
                    {m.label}
                  </text>
                );
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
            // Intraday: linear so real tick-by-tick movement shows. Daily:
            // monotone reads cleaner over months.
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
        <div className="flex items-center justify-center" style={{ height }}>
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
