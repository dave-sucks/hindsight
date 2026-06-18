'use client';

import { StockPriceChart } from '@/components/stocks/StockPriceChart';
import { PriceTargetsBlock } from '@/components/domain/price-targets-block';
import type { StockCandle } from '@/lib/actions/finnhub.actions';

// Reference-line / marker colors. Hardcoded hex (not CSS vars) because the
// chart renders to SVG and our theme vars are oklch(), which SVG stroke/fill
// can't consume — same constraint StockPriceChart documents.
const ENTRY = '#a1a1aa'; // zinc-400
const TARGET = '#22c55e'; // green-500
const STOP = '#ef4444'; // red-500
const WATCH = '#a1a1aa'; // zinc-400 (muted "started watching" mark)

type ThesisChartProps = {
  ticker: string;
  candles: StockCandle[];
  direction: 'LONG' | 'SHORT' | null;
  /** Planned entry (Thesis.entryPrice). */
  entryPrice: number | null;
  /** Actual fill (Position.avgCost) — wins over entryPrice when present. */
  avgCost?: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  /** Live current price (drives the gauge fallback + day color). */
  current: number | null;
  /** Thesis.createdAt — "started watching" vertical marker (full only). */
  addedAt?: string | null;
  /** Position.openedAt — "entered" vertical marker (full only). */
  enteredAt?: string | null;
  /**
   * full — sheet / trade page: range pills, vertical add/entry markers, 3M.
   * card — feed card: fixed 1M window, no controls, no vertical markers.
   */
  variant: 'full' | 'card';
};

/**
 * One annotated price chart shared across the thesis sheet, the thesis cards,
 * and the trade detail page. Horizontal Entry/Target/Stop lines on every
 * surface; vertical "started watching" / "entered" markers only on the full
 * variant (the card's short fixed window usually predates entry). Degrades to
 * the PriceTargetsBlock gauge when there's no candle data, and renders nothing
 * when there's neither a chart nor any price levels to show.
 */
export function ThesisChart({
  ticker,
  candles,
  direction,
  entryPrice,
  avgCost,
  targetPrice,
  stopLoss,
  current,
  addedAt,
  enteredAt,
  variant,
}: ThesisChartProps) {
  const entry = avgCost ?? entryPrice; // actual fill wins over planned
  const dir: 'LONG' | 'SHORT' = direction === 'SHORT' ? 'SHORT' : 'LONG';
  const hasLevels = entry != null && (targetPrice != null || stopLoss != null);

  // ── No candles → gauge fallback (or nothing if there's nothing to show) ──
  if (candles.length < 2) {
    if (!hasLevels || entry == null) return null;
    return (
      <PriceTargetsBlock
        entry={entry}
        target={targetPrice}
        stop={stopLoss}
        current={current}
        direction={dir}
      />
    );
  }

  const referenceLines = [
    entry != null ? { price: entry, color: ENTRY, label: 'Entry', dashed: true } : null,
    targetPrice != null ? { price: targetPrice, color: TARGET, label: 'Target', dashed: true } : null,
    stopLoss != null ? { price: stopLoss, color: STOP, label: 'Stop', dashed: true } : null,
  ].filter((l): l is NonNullable<typeof l> => l !== null);

  // Vertical markers only on the full variant — the card's fixed short window
  // usually starts after these events, so they'd just be dropped off-range.
  const verticalMarkers =
    variant === 'full'
      ? [
          addedAt ? { date: addedAt.slice(0, 10), color: WATCH, label: 'Watching' } : null,
          enteredAt ? { date: enteredAt.slice(0, 10), color: ENTRY, label: 'Entry' } : null,
        ].filter((m): m is NonNullable<typeof m> => m !== null)
      : undefined;

  return (
    <StockPriceChart
      candles={candles}
      referenceLines={referenceLines}
      verticalMarkers={verticalMarkers}
      showControls={variant === 'full'}
      defaultRange={variant === 'card' ? '1M' : '3M'}
      height={variant === 'card' ? 160 : 300}
      frameless={variant === 'card'}
    />
  );
}
