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
  ReferenceDot,
  ResponsiveContainer,
} from 'recharts';
import { cn } from '@/lib/utils';
import {
  formatDateLabel,
  formatDateTimeLabel,
  formatTimeLabel,
} from '@/components/stocks/chart-format';
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
  /**
   * Hourly bars over the last ~month — when present, the 1W and 1M tabs render
   * these (dense, Perplexity-like) instead of slicing ~3–22 daily closes. Each
   * bar's `date` is a full ISO timestamp; the categorical axis collapses the
   * overnight/weekend gaps. Undefined until the parent lazily fetches it, so
   * 1W/1M fall back to the daily slice in the meantime.
   */
  hourlyCandles?: StockCandle[];
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
// The line is colored green ABOVE and red BELOW the graph's starting price
// (the first visible point), switching mid-line. These are the sRGB hex of the
// app's --positive / --negative tokens (oklch(69.92% .166 144.58) /
// oklch(72.01% .178 11.8)) — SVG can't consume oklch, so we hardcode the exact
// equivalents to match the P&L colors used everywhere else. Keep in sync.
const LINE_GREEN = '#51b857';
const LINE_RED = '#ff6d87';
// Faint uniform color for the entry/target/stop reference lines — the small
// colored dot at the left edge carries the meaning, the line stays quiet.
const REF_LINE = '#71717a';

// ─── Helpers ────────────────────────────────────────────────────────────────

// Label formatters live in ./chart-format (pure module, unit-tested there).
// They are total over `unknown` — recharts can hand a formatter the numeric
// index instead of the category value in transient tooltip frames, which
// took down the whole trade page on 2026-08-19 ("e.includes is not a
// function", first 1W click). Never re-inline them with string-only inputs.

// Shift a YYYY-MM-DD by N calendar days (used to pad the Trade window).
function shiftDay(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

// The 1D chart pins its x-axis to a clock window CENTERED on the regular
// session: 2.5h of off-hours on each side (7:00 AM → 6:30 PM ET, with RTH
// 9:30–16:00 dead-center), so the session sits balanced with equal dead space
// left and right rather than lopsided. The pre-market + after-hours regions
// render as a faint dot texture even with no data. Clock times are anchored to
// the session date's actual ET offset (DST-safe, no tz lib) from the first bar.
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
  for (let h = 8; h <= 18; h += 2) ticks.push(clock(h));
  return {
    domain: [clock(7), clock(18, 30)],
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
  hourlyCandles,
  onRangeChange,
  tradeSpan,
  children,
}: Props) {
  const [range, setRange] = useState<Range>(defaultRange);
  const isIntraday = range === '1D';
  // 1W / 1M render the hourly series when the parent has fetched it; until then
  // they fall back to the daily slice (so there's no empty beat on selection).
  const isHourly =
    (range === '1W' || range === '1M') && !!hourlyCandles && hourlyCandles.length >= 2;

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
    if (isHourly && hourlyCandles) {
      // 1M = the full ~month of hourly bars; 1W = its last 7 calendar days.
      // Bars keep their ISO-timestamp `date` and flow through the categorical
      // axis, which collapses the overnight/weekend gaps (matching Perplexity).
      if (range === '1M') return hourlyCandles;
      const lastTs = new Date(hourlyCandles[hourlyCandles.length - 1].date).getTime();
      const cutoff = lastTs - 7 * 24 * 60 * 60 * 1000;
      return hourlyCandles.filter((c) => new Date(c.date).getTime() >= cutoff);
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
  }, [candles, intradayCandles, hourlyCandles, range, isIntraday, isHourly, tradeSpan]);

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

  // Color split: the line is green above / red below the graph's STARTING
  // price (first visible point), switching mid-line. baselineOffset is where
  // that price sits in the vertical (0 = top/high, 1 = bottom/low).
  const baseline = hasBody ? data[0].close : 0;
  const lastClose = hasBody ? data[data.length - 1].close : 0;
  const [yLo, yHi] = yDomain ?? [baseline - 1, baseline + 1];
  const baselineOffset = Math.min(
    0.999,
    Math.max(0.001, (yHi - baseline) / (yHi - yLo || 1)),
  );
  const endColor = lastClose >= baseline ? LINE_GREEN : LINE_RED;

  // Left edge x-value for the reference-line dots (numeric epoch for 1D, the
  // first candle date for daily/Trade). Undefined when there's no data yet —
  // e.g. the 1D tab before intraday bars load — so we never deref data[0].
  const leftX = !hasBody
    ? undefined
    : isIntraday
      ? intradayGeo?.domain[0]
      : data[0].date;

  // Floating price labels (overlaid, so the plot still full-bleeds). Positioned
  // from the buffered domain over the plot band (top margin 40, x-axis ~28).
  // Uniform decimal precision across the axis (so it's 129/107/85, not
  // 129/107/85.01), keyed to the top value's magnitude.
  const priceDigits = yHi >= 100 ? 0 : yHi >= 1 ? 2 : 4;
  const priceLabels = yDomain
    ? [0.16, 0.5, 0.84].map((f) => ({
        value: (yHi - f * (yHi - yLo)).toLocaleString(undefined, {
          minimumFractionDigits: priceDigits,
          maximumFractionDigits: priceDigits,
        }),
        top: 40 + f * (height - 40 - 28),
      }))
    : [];

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

      {/* Floating price labels — overlaid on the left so the plot still
          full-bleeds (a reserved y-axis gutter would push the line off the
          edges). Non-interactive so they never block chart hover. */}
      {hasBody && priceLabels.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-10">
          {priceLabels.map((p) => (
            <span
              key={p.value + p.top}
              className="absolute left-1.5 text-[9px] font-mono text-muted-foreground/70"
              style={{ top: p.top }}
            >
              {p.value}
            </span>
          ))}
        </div>
      )}

      {hasBody ? (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 40, right: 0, bottom: 0, left: 0 }}>
          <defs>
            {/* Off-hours dot texture — matches the dashboard chart's grid, so
                pre/post-market read as a subtle pattern, not a gray slab. */}
            <pattern
              id="offHoursDots"
              width={7}
              height={7}
              patternUnits="userSpaceOnUse"
            >
              <circle cx={1} cy={1} r={1} fill={AXIS_TICK} fillOpacity={0.35} />
            </pattern>
            {/* Line color split at the graph's starting price. */}
            <linearGradient id="lineSplit" x1="0" y1="0" x2="0" y2="1">
              <stop offset={0} stopColor={LINE_GREEN} />
              <stop offset={baselineOffset} stopColor={LINE_GREEN} />
              <stop offset={baselineOffset} stopColor={LINE_RED} />
              <stop offset={1} stopColor={LINE_RED} />
            </linearGradient>
            {/* Area fill split — filled between the line and the baseline,
                green above / red below, fading toward the baseline. */}
            <linearGradient id="fillSplit" x1="0" y1="0" x2="0" y2="1">
              <stop offset={0} stopColor={LINE_GREEN} stopOpacity={0.18} />
              <stop offset={baselineOffset} stopColor={LINE_GREEN} stopOpacity={0.02} />
              <stop offset={baselineOffset} stopColor={LINE_RED} stopOpacity={0.02} />
              <stop offset={1} stopColor={LINE_RED} stopOpacity={0.18} />
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
              isIntraday
                ? formatTimeLabel(l)
                : isHourly
                  ? formatDateTimeLabel(l)
                  : formatDateLabel(l)
            }
            labelStyle={{ color: 'var(--muted-foreground)' }}
          />

          {/* Off-hours bands (1D only): pre-market + after-hours, filled with a
              faint DOT TEXTURE (not a gray slab) so they read as "no session
              here" without glaring. Must be DIRECT children (not a fragment)
              AND after the axes, or recharts can't resolve their coordinates. */}
          {isIntraday && intradayGeo && yDomain ? (
            <ReferenceArea
              x1={intradayGeo.domain[0]}
              x2={intradayGeo.rthStart}
              y1={yDomain[0]}
              y2={yDomain[1]}
              fill="url(#offHoursDots)"
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
              fill="url(#offHoursDots)"
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

          {/* Entry / target / stop — quiet faint lines; a small colored dot at
              the left edge (green target / red stop / neutral entry) carries the
              meaning without the loud full-width labels. */}
          {referenceLines?.map((line) => (
            <ReferenceLine
              key={line.label}
              y={line.price}
              stroke={REF_LINE}
              strokeOpacity={0.4}
              strokeDasharray="2 4"
              strokeWidth={1}
              ifOverflow="hidden"
            />
          ))}
          {referenceLines?.map((line) => (
            <ReferenceDot
              key={`${line.label}-dot`}
              x={leftX}
              y={line.price}
              r={2.5}
              fill={line.color}
              stroke="none"
              ifOverflow="hidden"
            />
          ))}

          <Area
            // Linear on every range — straight segments between real closes,
            // matching Perplexity/finance-chart convention. (Monotone splined
            // daily closes into smooth "rolling hills" that read nothing like
            // the actual day-to-day movement.) Filled to the starting-price
            // baseline and colored green above / red below it.
            type="linear"
            dataKey="close"
            stroke="url(#lineSplit)"
            strokeWidth={1.5}
            fill="url(#fillSplit)"
            baseValue={baseline}
            dot={false}
            activeDot={{ r: 3, fill: endColor }}
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
