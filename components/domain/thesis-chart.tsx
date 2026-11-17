'use client';

import { useEffect, useState } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { StockPriceChart, type RangeMove } from '@/components/stocks/StockPriceChart';
import type { StockCandle } from '@/lib/actions/finnhub.actions';
import type { PriceLine } from '@/lib/agent/triggers/price-levels';

// Reference-line / marker colors. Hardcoded hex (not CSS vars) because the
// chart renders to SVG and our theme vars are oklch(), which SVG stroke/fill
// can't consume — same constraint StockPriceChart documents.
const ENTRY = '#a1a1aa'; // zinc-400
const TARGET = '#24AF54'; // --positive (app green)
const STOP = '#FC7029'; // --negative (app red)
const WATCH = '#a1a1aa'; // zinc-400 (muted "started watching" mark)
const SOLD = '#e4e4e7'; // zinc-200 (brighter — the "closed the book" exit mark)

type ThesisChartProps = {
  ticker: string;
  candles: StockCandle[];
  direction: 'LONG' | 'SHORT' | null;
  /** What we paid (Position.avgCost) — the line a holding is drawn from. */
  avgCost?: number | null;
  /** One line per trigger at a typed price, labelled with its own sentence (`priceLines`). Absent: none. */
  priceLines?: PriceLine[] | null;
  /** Live current price (drives the gauge fallback + day color). */
  current: number | null;
  /** Thesis.createdAt — "started watching" vertical marker (full only). */
  addedAt?: string | null;
  /** Position.openedAt — "entered" vertical marker (full only). */
  enteredAt?: string | null;
  /** Position.closedAt — "sold" vertical marker + end of the Trade window. */
  soldAt?: string | null;
  /**
   * full — sheet / trade page: range pills, vertical add/entry markers, 3M.
   * card — feed card: fixed 1M window, no controls, no vertical markers.
   */
  variant: 'full' | 'card';
  /**
   * Drop the chart's own border, for when a parent wrapper owns it (e.g. the
   * trade page groups the trade-sentence banner + chart in one bordered box).
   * Defaults to the variant's behavior (card = frameless, full = bordered).
   * The chart is JUST a chart — no children/slot; siblings live in the wrapper.
   */
  frameless?: boolean;
  /** The selected range's move, for a parent that prints it in its price row. */
  onChange?: (change: RangeMove | null) => void;
  /** Draw the move inside the chart, top-right. Defaults to on. */
  showChange?: boolean;
};

/**
 * One annotated price chart shared across the thesis sheet, the thesis cards,
 * and the trade detail page. One horizontal line per price trigger, labelled
 * with its sentence, and "Paid" on a holding; vertical "Watching" / "Bought" /
 * "Sold" markers only on the full variant (the card's short fixed window
 * usually predates the buy). Renders nothing with neither a chart nor a line.
 */
export function ThesisChart({
  ticker,
  candles,
  direction,
  avgCost,
  priceLines,
  current,
  addedAt,
  enteredAt,
  soldAt,
  variant,
  frameless,
  onChange,
  showChange,
}: ThesisChartProps) {
  const dir: 'LONG' | 'SHORT' = direction === 'SHORT' ? 'SHORT' : 'LONG';
  const lines = priceLines ?? [];

  // Intraday "1D" tab — full variant only. Lazily fetch 5-min bars for the
  // current session the moment the user selects 1D, then re-poll every 30s
  // while that tab stays active (cheap IEX re-fetch — no equity WS needed).
  // Switch away or unmount → the interval is cleared. Cards keep daily-only.
  const enableIntraday = variant === 'full';
  // The sheet opens on today (1D); a sold position opens on its own Trade
  // window; the card keeps its month. Opening on three months hid the day's
  // move behind a click (Dave, 2026-09-30).
  const initialRange: '1D' | '1M' | 'Trade' | '3M' =
    variant === 'card' ? '1M' : soldAt ? 'Trade' : enableIntraday ? '1D' : '3M';
  const [intraday, setIntraday] = useState<StockCandle[] | undefined>(undefined);
  // The prior session's close, from the same quote the header reads — the 1D
  // line is colored against it so the two agree.
  const [intradayPrevClose, setIntradayPrevClose] = useState<number | null>(null);
  const [intradayLoading, setIntradayLoading] = useState(false);
  const [is1D, setIs1D] = useState(initialRange === '1D');

  useEffect(() => {
    if (!is1D) return;
    let cancelled = false;
    const load = async () => {
      setIntradayLoading(true);
      try {
        const res = await fetch(
          `/api/stocks/intraday?symbol=${encodeURIComponent(ticker)}`,
        );
        const json = (await res.json()) as { candles?: StockCandle[]; prevClose?: number | null };
        if (!cancelled) {
          setIntraday(Array.isArray(json.candles) ? json.candles : []);
          setIntradayPrevClose(typeof json.prevClose === 'number' && json.prevClose > 0 ? json.prevClose : null);
        }
      } catch {
        if (!cancelled) setIntraday([]);
      } finally {
        if (!cancelled) setIntradayLoading(false);
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [is1D, ticker]);

  // Hourly bars for 1W / 1M — fetched once the moment either short range is
  // first selected (full variant only). Unlike 1D these move slowly, so no
  // 30s poll; one fetch covers both ranges (StockPriceChart slices 1W from the
  // ~month of hourly bars). Reset on ticker change so a re-keyed chart refetches.
  const [hourly, setHourly] = useState<StockCandle[] | undefined>(undefined);
  const [wantHourly, setWantHourly] = useState(false);
  // 1W reads 15-minute bars — the hourly series gave a week ~35 points.
  const [week, setWeek] = useState<StockCandle[] | undefined>(undefined);
  const [wantWeek, setWantWeek] = useState(false);

  useEffect(() => {
    setHourly(undefined);
    setWantHourly(false);
    setWeek(undefined);
    setWantWeek(false);
  }, [ticker]);

  useEffect(() => {
    if (!wantWeek || week !== undefined) return; // fetch once per ticker
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/stocks/hourly?symbol=${encodeURIComponent(ticker)}&timeframe=15Min&days=8`,
        );
        const json = (await res.json()) as { candles?: StockCandle[] };
        if (!cancelled) setWeek(Array.isArray(json.candles) ? json.candles : []);
      } catch {
        if (!cancelled) setWeek([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wantWeek, week, ticker]);

  useEffect(() => {
    if (!wantHourly || hourly !== undefined) return; // fetch once per ticker
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/stocks/hourly?symbol=${encodeURIComponent(ticker)}`,
        );
        const json = (await res.json()) as { candles?: StockCandle[] };
        if (!cancelled) setHourly(Array.isArray(json.candles) ? json.candles : []);
      } catch {
        if (!cancelled) setHourly([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wantHourly, hourly, ticker]);

  // No candles: nothing. The plan is the triggers and these lines; there is no second drawing of it.
  if (candles.length < 2) return null;

  // THREE lines: entry, the floor, the target. The same three the Price
  // Targets card shows, so the card and the chart cannot disagree.
  //
  // An earlier version drew EVERY price level, which on a held name meant
  // five: the hard floor, the trailing floor, the target, and the 10%-gain
  // and 12%-drawdown account rules projected into prices. All of them real,
  // all of them fire — and unreadable. A percentage rule is not a line on a
  // chart; it belongs in the trigger list.
  //
  // What DID survive from that attempt is the number itself: the floor drawn
  // here is the one that binds, so on EME it is the 8% trail at $794.76
  // rather than the $753 someone typed underneath it.
  // What we paid, then one line per price trigger, each labelled with its own sentence.
  const referenceLines = [
    ...(avgCost != null ? [{ price: avgCost, color: ENTRY, label: `Paid $${avgCost.toFixed(2)}`, dashed: true }] : []),
    ...lines.map((l) => ({
      price: l.price,
      color: l.action === 'ENTER' ? ENTRY : l.action === 'EXIT' || l.action === 'STOP_WATCHING' ? STOP : TARGET,
      label: l.says,
      dashed: true,
    })),
  ];

  // Vertical markers on BOTH variants — StockPriceChart drops any marker whose
  // date falls before the visible window, so on the card's fixed window they
  // simply appear only when the watch/entry date lands inside it.
  const verticalMarkers = [
    addedAt ? { date: addedAt.slice(0, 10), color: WATCH, label: 'Watching' } : null,
    enteredAt ? { date: enteredAt.slice(0, 10), color: ENTRY, label: 'Bought' } : null,
    soldAt ? { date: soldAt.slice(0, 10), color: SOLD, label: 'Sold' } : null,
  ].filter((m): m is NonNullable<typeof m> => m !== null);

  // "Trade" window — the position's own lifespan (full variant only). Starts at
  // the watch date (falls back to entry), ends at the sold date or stays open
  // (null → windows to the latest candle while held). Powers the Trade pill;
  // a sold thesis opens on it so the whole story is visible at a glance.
  const watchStart = (addedAt ?? enteredAt)?.slice(0, 10) ?? null;
  const tradeSpan =
    variant === 'full' && watchStart
      ? { start: watchStart, end: soldAt ? soldAt.slice(0, 10) : null }
      : undefined;

  // The full chart stands a fifth taller on desktop (the owner, 2026-11-05).
  const isMobile = useIsMobile();
  const fullHeight = isMobile ? 300 : 360;

  return (
    <StockPriceChart
      candles={candles}
      referenceLines={referenceLines}
      verticalMarkers={verticalMarkers}
      showControls={variant === 'full'}
      defaultRange={initialRange === 'Trade' && !tradeSpan ? '3M' : initialRange}
      height={variant === 'card' ? 160 : fullHeight}
      frameless={frameless ?? variant === 'card'}
      showIntraday={enableIntraday}
      intradayCandles={intraday}
      intradayLoading={intradayLoading}
      priorClose={intradayPrevClose}
      hourlyCandles={enableIntraday ? hourly : undefined}
      weekCandles={enableIntraday ? week : undefined}
      onRangeChange={(r) => {
        setIs1D(r === '1D');
        if (r === '1W' || r === '1M') setWantHourly(true);
        if (r === '1W') setWantWeek(true);
      }}
      tradeSpan={tradeSpan}
      onChange={onChange}
      showChange={showChange}
    />
  );
}
