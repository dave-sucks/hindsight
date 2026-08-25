'use client';

import { useEffect, useState } from 'react';
import { StockPriceChart } from '@/components/stocks/StockPriceChart';
import { PriceTargetsBlock } from '@/components/domain/price-targets-block';
import type { StockCandle } from '@/lib/actions/finnhub.actions';
import type { ThesisStateLevels } from '@/lib/types/thesis-sheet';
import type { CardLevel } from '@/components/domain/price-targets-block';

// Reference-line / marker colors. Hardcoded hex (not CSS vars) because the
// chart renders to SVG and our theme vars are oklch(), which SVG stroke/fill
// can't consume — same constraint StockPriceChart documents.
const ENTRY = '#a1a1aa'; // zinc-400
const TARGET = '#51b857'; // sRGB of --positive (app green)
const STOP = '#ff6d87'; // sRGB of --negative (app red)
const WATCH = '#a1a1aa'; // zinc-400 (muted "started watching" mark)
const SOLD = '#e4e4e7'; // zinc-200 (brighter — the "closed the book" exit mark)

type ThesisChartProps = {
  ticker: string;
  candles: StockCandle[];
  direction: 'LONG' | 'SHORT' | null;
  /** Planned entry (Thesis.entryPrice). */
  entryPrice: number | null;
  /** Actual fill (Position.avgCost) — wins over entryPrice when present. */
  avgCost?: number | null;
  /**
   * Cached level columns. A fallback only — pass `levels` where you have it.
   * These can name a price no trigger enforces (the SNOW failure).
   */
  targetPrice: number | null;
  stopLoss: number | null;
  /**
   * The levels actually in force, from `canonicalLevels`. When supplied the
   * chart draws EVERY price level as its own labelled line — tiered trims,
   * a warning review below the floor, a trail sitting at the price it
   * currently occupies — instead of three numbers, two of which historically
   * fired nothing. Falls back to the scalar columns when absent.
   */
  levels?: ThesisStateLevels | null;
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
};

/**
 * One annotated price chart shared across the thesis sheet, the thesis cards,
 * and the trade detail page. Horizontal Entry/Target/Stop lines on every
 * surface; vertical "started watching" / "entered" markers only on the full
 * variant (the card's short fixed window usually predates entry). Degrades to
 * the PriceTargetsBlock gauge when there's no candle data, and renders nothing
 * when there's neither a chart nor any price levels to show.
 */
/** Plain-language name for a non-canonical level's line. */
function actionLineLabel(action: string): string {
  switch (action) {
    case 'EXIT':
      return 'Sell';
    case 'ENTER':
      return 'Buy';
    case 'ADD':
      return 'Add';
    case 'TRIM':
      return 'Trim';
    default:
      return 'Review';
  }
}

export function ThesisChart({
  ticker,
  candles,
  direction,
  entryPrice,
  avgCost,
  targetPrice,
  stopLoss,
  levels,
  current,
  addedAt,
  enteredAt,
  soldAt,
  variant,
  frameless,
}: ThesisChartProps) {
  const entry = avgCost ?? entryPrice; // actual fill wins over planned
  const dir: 'LONG' | 'SHORT' = direction === 'SHORT' ? 'SHORT' : 'LONG';

  // Prefer the resolved levels; fall back to the cached columns for callers
  // that don't have them yet. `asCardLevel` marks a column-sourced number as
  // un-projected, which is right — a typed column never moves.
  const asCardLevel = (p: number | null, kind: string): CardLevel | null =>
    p == null ? null : { price: p, projected: false, predicateKind: kind };
  const floorLevel: CardLevel | null =
    levels !== undefined
      ? levels?.floor ?? null
      : asCardLevel(stopLoss, dir === 'LONG' ? 'PRICE_BELOW' : 'PRICE_ABOVE');
  const targetLevel: CardLevel | null =
    levels !== undefined
      ? levels?.target ?? null
      : asCardLevel(targetPrice, dir === 'LONG' ? 'PRICE_ABOVE' : 'PRICE_BELOW');
  const hasLevels =
    entry != null && (targetLevel != null || floorLevel != null);

  // Intraday "1D" tab — full variant only. Lazily fetch 5-min bars for the
  // current session the moment the user selects 1D, then re-poll every 30s
  // while that tab stays active (cheap IEX re-fetch — no equity WS needed).
  // Switch away or unmount → the interval is cleared. Cards keep daily-only.
  const enableIntraday = variant === 'full';
  const [intraday, setIntraday] = useState<StockCandle[] | undefined>(undefined);
  const [intradayLoading, setIntradayLoading] = useState(false);
  const [is1D, setIs1D] = useState(false);

  useEffect(() => {
    if (!is1D) return;
    let cancelled = false;
    const load = async () => {
      setIntradayLoading(true);
      try {
        const res = await fetch(
          `/api/stocks/intraday?symbol=${encodeURIComponent(ticker)}`,
        );
        const json = (await res.json()) as { candles?: StockCandle[] };
        if (!cancelled) setIntraday(Array.isArray(json.candles) ? json.candles : []);
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

  useEffect(() => {
    setHourly(undefined);
    setWantHourly(false);
  }, [ticker]);

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

  // ── No candles → gauge fallback (or nothing if there's nothing to show) ──
  if (candles.length < 2) {
    if (!hasLevels || entry == null) return null;
    return (
      <PriceTargetsBlock
        entry={entry}
        target={targetLevel}
        stop={floorLevel}
        storedTarget={targetPrice}
        storedStop={stopLoss}
        current={current}
        direction={dir}
      />
    );
  }

  // One line per level that actually fires. Colour is the SIDE of the trade
  // (upside green, downside red), which stays correct on a short where a
  // falling price is the winning direction. The canonical three keep their
  // familiar names; extra levels are labelled by what they do, so a tiered
  // trim reads "Trim" rather than being collapsed into "Target".
  const levelLines =
    levels?.all.map((l) => ({
      price: l.price,
      color: l.action === 'ENTER' ? ENTRY : l.side === 'UPSIDE' ? TARGET : STOP,
      label:
        l.slot === 'FLOOR'
          ? l.projected
            ? 'Stop (trailing)'
            : 'Stop'
          : l.slot === 'TARGET'
            ? 'Target'
            : l.slot === 'ENTRY'
              ? 'Entry'
              : actionLineLabel(l.action),
      dashed: true,
    })) ?? [
      targetPrice != null
        ? { price: targetPrice, color: TARGET, label: 'Target', dashed: true }
        : null,
      stopLoss != null
        ? { price: stopLoss, color: STOP, label: 'Stop', dashed: true }
        : null,
    ].filter((l): l is NonNullable<typeof l> => l !== null);

  const referenceLines = [
    // The entry line comes from the fill when held, so it is drawn here
    // rather than from `levels` (which reports the same number for a held
    // thesis but nothing for a watch item that hasn't set one).
    entry != null ? { price: entry, color: ENTRY, label: 'Entry', dashed: true } : null,
    ...levelLines.filter((l) => l.label !== 'Entry'),
  ].filter((l): l is NonNullable<typeof l> => l !== null);

  // Vertical markers on BOTH variants — StockPriceChart drops any marker whose
  // date falls before the visible window, so on the card's fixed window they
  // simply appear only when the watch/entry date lands inside it.
  const verticalMarkers = [
    addedAt ? { date: addedAt.slice(0, 10), color: WATCH, label: 'Watching' } : null,
    enteredAt ? { date: enteredAt.slice(0, 10), color: ENTRY, label: 'Entry' } : null,
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

  return (
    <StockPriceChart
      candles={candles}
      referenceLines={referenceLines}
      verticalMarkers={verticalMarkers}
      showControls={variant === 'full'}
      defaultRange={
        variant === 'card' ? '1M' : soldAt && tradeSpan ? 'Trade' : '3M'
      }
      height={variant === 'card' ? 160 : 300}
      frameless={frameless ?? variant === 'card'}
      showIntraday={enableIntraday}
      intradayCandles={intraday}
      intradayLoading={intradayLoading}
      hourlyCandles={enableIntraday ? hourly : undefined}
      onRangeChange={(r) => {
        setIs1D(r === '1D');
        if (r === '1W' || r === '1M') setWantHourly(true);
      }}
      tradeSpan={tradeSpan}
    />
  );
}
